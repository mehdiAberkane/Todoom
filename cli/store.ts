// The data folder seen from outside the app: the `todoom` command and the MCP
// server both go through here, so scripts and agents follow the app's rules:
// same files, same checks, atomic writes, updatedAt that always moves forward.
// The app watches the folder and picks the changes up by itself.

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Board, Card, Column } from "../src/types";
import { boardProblem, cardProblem } from "../src/lib/validate";
import { nextUpdatedAt, uid } from "../src/lib/ids";
import { prioritiesOf, priorityOf } from "../src/lib/priority";
import { inverseOf, isFinished, isLinkType, withLink, withoutLink } from "../src/lib/links";
import type { LinkType } from "../src/types";

export class TodoomError extends Error {}

const APP_ID = "fr.devsecopsforce.todoom";

/** Where the app keeps its config.json on this system. */
export function appConfigPath(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_ID, "config.json");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_ID, "config.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), APP_ID, "config.json");
}

/** The data folder: given explicitly, else TODOOM_DIR, else the one chosen in the app. */
export function findDataDir(explicit?: string): string {
  let dir = explicit || process.env.TODOOM_DIR;
  if (!dir) {
    try {
      dir = JSON.parse(readFileSync(appConfigPath(), "utf8")).data_dir ?? undefined;
    } catch {
      /* no app config on this machine */
    }
  }
  if (!dir) {
    throw new TodoomError(
      "Dossier de données introuvable : passe --dir, définis TODOOM_DIR, ou choisis le dossier dans l'application.",
    );
  }
  if (!existsSync(join(dir, "boards"))) throw new TodoomError(`Pas un dossier de données Todoom (pas de sous-dossier boards) : ${dir}`);
  return dir;
}

/** Lowercase, no accents, single spaces: "À faire" and "a  FAIRE" are the same column. */
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The item named `wanted`: exact name first, then a unique name that starts with it. */
function byName<T extends { id: string; name: string }>(items: T[], wanted: string, what: string): T {
  const w = normalize(wanted);
  if (!w) throw new TodoomError(`${what} : nom vide`);
  const exact = items.filter((i) => normalize(i.name) === w || i.id === wanted);
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((i) => normalize(i.name).startsWith(w));
  if (exact.length === 0 && prefix.length === 1) return prefix[0];
  const names = items.map((i) => `« ${i.name} »`).join(", ");
  throw new TodoomError(
    exact.length > 1 || prefix.length > 1
      ? `${what} : « ${wanted} » correspond à plusieurs noms. Choix : ${names}`
      : `${what} : « ${wanted} » introuvable. Choix : ${names || "aucun"}`,
  );
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Writes through a temporary file, so the app and Drive never see half a file. */
function writeAtomic(path: string, data: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** A card with names instead of ids, for people and agents. */
export interface CardView {
  id: string;
  board: string;
  boardId: string;
  column: string | null;
  columnId: string;
  title: string;
  description: string;
  labels: string[];
  priority: string | null;
  due: string | null;
  checklist: Card["checklist"];
  links: Card["links"];
  order: number;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardChanges {
  title?: string;
  description?: string;
  /** Added at the end of the description, after a blank line. */
  append?: string;
  addLabels?: string[];
  removeLabels?: string[];
  /** Name of one of the board's priority levels, or null to remove it. */
  priority?: string | null;
  /** YYYY-MM-DD, or null to remove it. */
  due?: string | null;
}

export class Store {
  constructor(readonly dir: string) {}

  private boardDir(id: string) {
    return join(this.dir, "boards", id);
  }

  private boardIds(): string[] {
    return readdirSync(join(this.dir, "boards"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.dir, "boards", d.name, "board.json")))
      .map((d) => d.name);
  }

  /** Boards that read and pass the checks; broken files are skipped, as in the app. */
  boards(includeTrashed = false): Board[] {
    const boards: Board[] = [];
    for (const id of this.boardIds()) {
      try {
        const raw = readJson(join(this.boardDir(id), "board.json"));
        if (boardProblem(raw)) continue;
        const b = raw as Board;
        if (includeTrashed || !b.archivedAt) boards.push({ ...b, columns: b.columns ?? [], labels: b.labels ?? [] });
      } catch {
        /* unreadable: reported by the app */
      }
    }
    return boards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }

  board(wanted: string): Board {
    return byName(this.boards(true), wanted, "Tableau");
  }

  cards(board: Board): Card[] {
    const dir = join(this.boardDir(board.id), "cards");
    if (!existsSync(dir)) return [];
    const cards: Card[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = readJson(join(dir, f));
        if (cardProblem(raw)) continue;
        cards.push(withDefaults(raw as Card, board));
      } catch {
        /* unreadable: reported by the app */
      }
    }
    return cards.sort((a, b) => a.order - b.order);
  }

  /** A card by id (or a unique start of its id), on any board. */
  card(wanted: string): { card: Card; board: Board } {
    const id = wanted.trim();
    if (!/^[\w-]+$/.test(id)) throw new TodoomError(`Identifiant de carte invalide : ${wanted}`);
    const found: { card: Card; board: Board }[] = [];
    for (const board of this.boards(true)) {
      const exact = join(this.boardDir(board.id), "cards", `${id}.json`);
      if (existsSync(exact)) return { card: this.readCard(board, id), board };
      if (id.length >= 4) for (const c of this.cards(board)) if (c.id.startsWith(id)) found.push({ card: c, board });
    }
    if (found.length === 1) return found[0];
    throw new TodoomError(found.length ? `Identifiant « ${wanted} » ambigu (${found.length} cartes)` : `Carte « ${wanted} » introuvable`);
  }

  private readCard(board: Board, id: string): Card {
    const raw = readJson(join(this.boardDir(board.id), "cards", `${id}.json`));
    const problem = cardProblem(raw);
    if (problem) throw new TodoomError(`Fichier de la carte ${id} invalide (${problem.code}${problem.field ? ` : ${problem.field}` : ""})`);
    return withDefaults(raw as Card, board);
  }

  column(board: Board, wanted: string): Column {
    return byName(board.columns, wanted, `Colonne (tableau « ${board.name} »)`);
  }

  view(card: Card, board: Board): CardView {
    return {
      id: card.id,
      board: board.name,
      boardId: board.id,
      column: board.columns.find((c) => c.id === card.columnId)?.name ?? null,
      columnId: card.columnId,
      title: card.title,
      description: card.description,
      labels: card.labels.map((id) => board.labels.find((l) => l.id === id)?.name ?? id),
      priority: priorityOf(board, card)?.name ?? null,
      due: card.due,
      checklist: card.checklist,
      links: card.links,
      order: card.order,
      archived: !!card.archivedAt,
      archivedAt: card.archivedAt,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  /** Position at the bottom (or top) of a column, among the cards still on the board. */
  private position(board: Board, columnId: string, where: "top" | "bottom", except?: string): number {
    const orders = this.cards(board)
      .filter((c) => c.columnId === columnId && !c.archivedAt && c.id !== except)
      .map((c) => c.order);
    if (!orders.length) return 0;
    return where === "top" ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
  }

  private priorityId(board: Board, name: string | null | undefined): string | null {
    return name ? byName(prioritiesOf(board), name, `Priorité (tableau « ${board.name} »)`).id : null;
  }

  private labelIds(board: Board, names: string[]): string[] {
    return names.map((n) => byName(board.labels, n, `Étiquette (tableau « ${board.name} »)`).id);
  }

  /** Checks the card like the app does when loading it, then writes it. */
  private save(board: Board, card: Card, previous?: Card): Card {
    if (card.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(card.due)) {
      throw new TodoomError(`Échéance invalide : ${card.due} (format AAAA-MM-JJ)`);
    }
    if (!card.title.trim()) throw new TodoomError("Le titre ne peut pas être vide");
    const saved = { ...card, updatedAt: nextUpdatedAt(previous?.updatedAt) };
    const problem = cardProblem(saved);
    if (problem) throw new TodoomError(`Carte refusée (${problem.code}${problem.field ? ` : ${problem.field}` : ""})`);
    writeAtomic(join(this.boardDir(board.id), "cards", `${card.id}.json`), saved);
    return saved;
  }

  create(
    boardName: string,
    title: string,
    opts: { column?: string; description?: string; labels?: string[]; priority?: string | null; due?: string | null } = {},
  ): CardView {
    const board = this.board(boardName);
    if (board.archivedAt) throw new TodoomError(`Le tableau « ${board.name} » est dans la corbeille`);
    const column = opts.column ? this.column(board, opts.column) : board.columns[0];
    if (!column) throw new TodoomError(`Le tableau « ${board.name} » n'a aucune colonne`);
    const at = new Date().toISOString();
    const card: Card = {
      id: uid(),
      boardId: board.id,
      columnId: column.id,
      order: this.position(board, column.id, "bottom"),
      title: title.trim(),
      description: opts.description ?? "",
      labels: this.labelIds(board, opts.labels ?? []),
      priority: this.priorityId(board, opts.priority),
      due: opts.due ?? null,
      checklist: [],
      links: [],
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    return this.view(this.save(board, card), board);
  }

  update(cardId: string, changes: CardChanges): CardView {
    const { card, board } = this.card(cardId);
    let description = changes.description ?? card.description;
    if (changes.append) description = joinParagraphs(description, changes.append);
    let labels = card.labels;
    if (changes.addLabels?.length) labels = [...new Set([...labels, ...this.labelIds(board, changes.addLabels)])];
    if (changes.removeLabels?.length) {
      const gone = new Set(this.labelIds(board, changes.removeLabels));
      labels = labels.filter((l) => !gone.has(l));
    }
    const next: Card = {
      ...card,
      title: changes.title !== undefined ? changes.title.trim() : card.title,
      description,
      labels,
      priority: changes.priority !== undefined ? this.priorityId(board, changes.priority) : card.priority,
      due: changes.due !== undefined ? changes.due : card.due,
    };
    return this.view(this.save(board, next, card), board);
  }

  move(cardId: string, columnName: string, where: "top" | "bottom" = "bottom"): CardView {
    const { card, board } = this.card(cardId);
    const column = this.column(board, columnName);
    const next = { ...card, columnId: column.id, order: this.position(board, column.id, where, card.id) };
    return this.view(this.save(board, next, card), board);
  }

  archive(cardId: string): CardView {
    const { card, board } = this.card(cardId);
    if (card.archivedAt) return this.view(card, board);
    return this.view(this.save(board, { ...card, archivedAt: new Date().toISOString() }, card), board);
  }

  /** Back on the board, at the bottom of its column (the first one if its column is gone). */
  restore(cardId: string): CardView {
    const { card, board } = this.card(cardId);
    if (!card.archivedAt) return this.view(card, board);
    const columnId = board.columns.some((c) => c.id === card.columnId) ? card.columnId : board.columns[0]?.id;
    if (!columnId) throw new TodoomError(`Le tableau « ${board.name} » n'a aucune colonne`);
    const next = { ...card, archivedAt: null, columnId, order: this.position(board, columnId, "bottom", card.id) };
    return this.view(this.save(board, next, card), board);
  }

  /** The card with its links spelled out: the other card's title, board, column, and whether it is finished. */
  detail(card: Card, board: Board) {
    const links = card.links.map((l) => {
      try {
        const other = this.card(l.cardId);
        return {
          type: l.type,
          cardId: l.cardId,
          title: other.card.title,
          board: other.board.name,
          column: other.board.columns.find((c) => c.id === other.card.columnId)?.name ?? null,
          finished: isFinished(other.card, other.board),
        };
      } catch {
        return { type: l.type, cardId: l.cardId, missing: true };
      }
    });
    return { ...this.view(card, board), links };
  }

  /** Links two cards, on any boards; the link is written on both, each in its own direction. */
  link(cardId: string, type: string, otherId: string) {
    const kind = linkType(type);
    const a = this.card(cardId);
    const b = this.card(otherId);
    if (a.card.id === b.card.id) throw new TodoomError("Une carte ne peut pas être liée à elle-même");
    const saved = this.save(a.board, withLink(a.card, kind, b.card.id), a.card);
    this.save(b.board, withLink(b.card, inverseOf(kind), a.card.id), b.card);
    return this.detail(saved, a.board);
  }

  /** Removes the link between two cards, from both. */
  unlink(cardId: string, otherId: string) {
    const a = this.card(cardId);
    const target = a.card.links.find((l) => l.cardId === otherId || (otherId.length >= 4 && l.cardId.startsWith(otherId)));
    if (!target) throw new TodoomError(`Pas de lien entre ${a.card.id} et ${otherId}`);
    const saved = this.save(a.board, withoutLink(a.card, target.cardId), a.card);
    try {
      const b = this.card(target.cardId);
      if (b.card.links.some((l) => l.cardId === a.card.id)) this.save(b.board, withoutLink(b.card, a.card.id), b.card);
    } catch {
      /* the other card is gone: nothing to clean there */
    }
    return this.detail(saved, a.board);
  }

  /**
   * Adds a dated, signed note at the end of the description. Cards have no
   * comment thread yet; when they do, this is the one place to change.
   */
  comment(cardId: string, text: string, author = hostname()): CardView {
    if (!text.trim()) throw new TodoomError("Le commentaire est vide");
    const stamp = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    return this.update(cardId, { append: `--- ${stamp} · ${author} ---\n${text.trim()}` });
  }
}

const LINK_NAMES: Record<string, LinkType> = {
  "depends-on": "dependsOn",
  blocks: "blocks",
  "duplicate-of": "duplicateOf",
  "duplicated-by": "duplicatedBy",
  "relates-to": "relatesTo",
};

/** A link type from its command name (depends-on…) or its stored name (dependsOn…). */
export function linkType(name: string): LinkType {
  const kind = LINK_NAMES[name.toLowerCase()] ?? (isLinkType(name) ? name : undefined);
  if (!kind) throw new TodoomError(`Type de lien inconnu : ${name}. Choix : ${Object.keys(LINK_NAMES).join(", ")}`);
  return kind;
}

function joinParagraphs(text: string, extra: string): string {
  const head = text.replace(/\s+$/, "");
  return head ? `${head}\n\n${extra.trim()}` : extra.trim();
}

/** Same defaults as the app for fields a script may have left out. */
function withDefaults(raw: Card, board: Board): Card {
  return {
    ...raw,
    boardId: raw.boardId ?? board.id,
    columnId: raw.columnId ?? board.columns[0]?.id ?? "",
    order: raw.order ?? 0,
    title: raw.title ?? "",
    description: raw.description ?? "",
    labels: raw.labels ?? [],
    priority: raw.priority ?? null,
    due: raw.due ?? null,
    checklist: raw.checklist ?? [],
    links: raw.links ?? [],
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
}
