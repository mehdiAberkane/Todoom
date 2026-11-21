// The data folder seen from outside the app: the `todoom` command and the MCP
// server both go through here, so scripts and agents follow the app's rules:
// same files, same checks, atomic writes, updatedAt that always moves forward.
// The app watches the folder and picks the changes up by itself.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Board, Card, Column } from "../src/types";
import { boardProblem, cardProblem } from "../src/lib/validate";
import { nextUpdatedAt, uid } from "../src/lib/ids";
import { prioritiesOf, priorityOf } from "../src/lib/priority";
import { inverseOf, isFinished, isLinkType, withLink, withoutLink } from "../src/lib/links";
import type { Author, CardComment, HistoryEvent, LinkType } from "../src/types";
import { deriveKey, nextNumber, parseRef, refOf } from "../src/lib/shortid";
import { changesBetween, commentPath, eventsFor, historyPath, writerName } from "../src/lib/activity";
import { agentProblem, commentProblem, historyProblem } from "../src/lib/validate";
import { MR_STATES, webUrl } from "../src/lib/dev";
import { claimLabel, mayClaim, newClaim, sameClaimant } from "../src/lib/claim";
import type { Claim } from "../src/types";
import type { MergeRequest, MergeRequestState } from "../src/types";
import { mapByName } from "../src/lib/transfer";

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
  /** Short id such as SOL-42, or null while the app hasn't numbered the card yet. */
  ref: string | null;
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
  branch: string | null;
  mergeRequest: MergeRequest | null;
  claimedBy: Claim | null;
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
  /** Git branch name, or null to remove it. */
  branch?: string | null;
  /** Web address of the merge request, or null to remove it. */
  mrUrl?: string | null;
  mrState?: string;
}

/**
 * Who is writing: this computer, plus the agent and conversation when given
 * (TODOOM_AGENT, TODOOM_CONVERSATION). `tool` names this program's history
 * file next to the app's: <computer>-cli.json or <computer>-mcp.json.
 */
export interface Identity {
  author: Author;
  tool: "cli" | "mcp";
}

export function identity(tool: Identity["tool"], agent = process.env.TODOOM_AGENT): Identity {
  const conversation = process.env.TODOOM_CONVERSATION;
  return { tool, author: { host: hostname(), ...(agent ? { agent } : {}), ...(conversation ? { conversation } : {}) } };
}

export class Store {
  constructor(
    readonly dir: string,
    readonly who: Identity = identity("cli"),
  ) {}

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

  /** A card by its short id (SOL-42), its id, or a unique start of its id, on any board. */
  card(wanted: string): { card: Card; board: Board } {
    const ref = parseRef(wanted);
    if (ref) {
      const board = this.boards(true).find((b) => b.key?.toUpperCase() === ref.key);
      const card = board && this.cards(board).find((c) => c.number === ref.number);
      if (board && card) return { card, board };
      throw new TodoomError(`Carte « ${wanted} » introuvable`);
    }
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

/** A board with everything an agent needs before taking one of its tickets. */
  boardDetail(wanted: string) {
    const b = this.board(wanted);
    return {
      id: b.id,
      name: b.name,
      key: b.key ?? null,
      trashed: !!b.archivedAt,
      description: b.description ?? "",
      columns: b.columns.map((c) => c.name),
      labels: b.labels.map((l) => l.name),
      priorities: prioritiesOf(b).map((p) => p.name),
      // What the agents watching this board are doing (written by them; a stale heartbeat means stopped).
      agents: this.jsonFiles(join(this.boardDir(b.id), "agents")).filter((raw) => !agentProblem(raw)),
    };
  }

  /** Rewrites the board's context page, keeping every other field of board.json. */
  setBoardDescription(wanted: string, text: string) {
    const board = this.board(wanted);
    const path = join(this.boardDir(board.id), "board.json");
    const raw = readJson(path) as Board;
    const description = text.replace(/\s+$/, "");
    const next = { ...raw, description, updatedAt: nextUpdatedAt(raw.updatedAt) };
    const problem = boardProblem(next);
    if (problem) throw new TodoomError(`Tableau refusé (${problem.code}${problem.field ? ` : ${problem.field}` : ""})`);
    writeAtomic(path, next);
    return this.boardDetail(board.id);
  }

  /** The board's key, given now (and written) if it has none yet, by the same rule as the app. */
  private ensureKey(board: Board): Board {
    if (board.key) return board;
    const key = deriveKey(board.name, this.boards(true).map((b) => b.key).filter((k): k is string => !!k));
    const path = join(this.boardDir(board.id), "board.json");
    const raw = readJson(path) as Board;
    writeAtomic(path, { ...raw, key, updatedAt: nextUpdatedAt(raw.updatedAt) });
    return { ...board, key };
  }

  column(board: Board, wanted: string): Column {
    return byName(board.columns, wanted, `Colonne (tableau « ${board.name} »)`);
  }

  view(card: Card, board: Board): CardView {
    return {
      id: card.id,
      ref: refOf(board, card),
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
      branch: card.branch,
      mergeRequest: card.mergeRequest,
      claimedBy: card.claimedBy,
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
    this.record(board, previous, saved);
    return saved;
  }

  /** Adds what changed to this tool's history file of the card, as the app does for its own. */
  private record(board: Board, previous: Card | undefined, next: Card) {
    this.appendEvents(board, next, eventsFor(changesBetween(previous, next, board), this.who.author));
  }

  private appendEvents(board: Board, next: Card, events: HistoryEvent[]) {
    if (!events.length) return;
    const writer = writerName(this.who.author.host, this.who.tool);
    const path = join(this.dir, historyPath(board.id, next.id, writer));
    let earlier: HistoryEvent[] = [];
    try {
      const raw = readJson(path);
      if (!historyProblem(raw)) earlier = (raw as { events: HistoryEvent[] }).events;
    } catch {
      /* first change recorded by this tool */
    }
    mkdirSync(dirname(path), { recursive: true });
    writeAtomic(path, { cardId: next.id, writer, events: [...earlier, ...events] });
  }

  /** Comments of a card, oldest first. */
  comments(board: Board, cardId: string): CardComment[] {
    return this.jsonFiles(join(this.boardDir(board.id), "comments", cardId))
      .filter((raw) => !commentProblem(raw))
      .map((raw) => raw as CardComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** History of a card from every computer and tool, oldest first. */
  history(board: Board, cardId: string): HistoryEvent[] {
    return this.jsonFiles(join(this.boardDir(board.id), "history", cardId))
      .filter((raw) => !historyProblem(raw))
      .flatMap((raw) => (raw as { events: HistoryEvent[] }).events)
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  private jsonFiles(dir: string): unknown[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [readJson(join(dir, f))];
        } catch {
          return [];
        }
      });
  }

  create(
    boardName: string,
    title: string,
    opts: { column?: string; description?: string; labels?: string[]; priority?: string | null; due?: string | null } = {},
  ): CardView {
    const found = this.board(boardName);
    if (found.archivedAt) throw new TodoomError(`Le tableau « ${found.name} » est dans la corbeille`);
    const board = this.ensureKey(found);
    const column = opts.column ? this.column(board, opts.column) : board.columns[0];
    if (!column) throw new TodoomError(`Le tableau « ${board.name} » n'a aucune colonne`);
    const at = new Date().toISOString();
    const card: Card = {
      id: uid(),
      number: nextNumber(this.cards(board)),
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
      branch: null,
      mergeRequest: null,
      claimedBy: null,
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
      branch: changes.branch !== undefined ? changes.branch?.trim() || null : card.branch,
      mergeRequest: mergeRequestAfter(card.mergeRequest, changes),
    };
    return this.view(this.save(board, next, card), board);
  }

  move(cardId: string, columnName: string, where: "top" | "bottom" = "bottom"): CardView {
    const { card, board } = this.card(cardId);
    const column = this.column(board, columnName);
    const next = { ...card, columnId: column.id, order: this.position(board, column.id, where, card.id) };
    return this.view(this.save(board, next, card), board);
  }

  /**
   * Moves a card to another board, at the bottom of a column. Same rules as the
   * app: same id (links keep working), labels and priority by name, comments,
   * history and attachments moved along, the new board's next number.
   */
  moveToBoard(cardId: string, boardName: string, columnName?: string): CardView {
    const { card, board: source } = this.card(cardId);
    const found = this.board(boardName);
    if (found.archivedAt) throw new TodoomError(`Le tableau « ${found.name} » est dans la corbeille`);
    if (found.id === source.id) return columnName ? this.move(cardId, columnName) : this.view(card, source);
    const target = this.ensureKey(found);
    const column = columnName ? this.column(target, columnName) : target.columns[0];
    if (!column) throw new TodoomError(`Le tableau « ${target.name} » n'a aucune colonne`);
    const moved: Card = {
      ...card,
      ...mapByName(card, source, target),
      boardId: target.id,
      columnId: column.id,
      order: this.position(target, column.id, "bottom"),
      number: nextNumber(this.cards(target)),
    };
    // Comments, history and attachments: their folders move as they are.
    for (const kind of ["comments", "history", "attachments"]) {
      const from = join(this.boardDir(source.id), kind, card.id);
      if (!existsSync(from)) continue;
      const to = join(this.boardDir(target.id), kind, card.id);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
    const saved = { ...moved, updatedAt: nextUpdatedAt(card.updatedAt) };
    const problem = cardProblem(saved);
    if (problem) throw new TodoomError(`Carte refusée (${problem.code})`);
    writeAtomic(join(this.boardDir(target.id), "cards", `${card.id}.json`), saved);
    rmSync(join(this.boardDir(source.id), "cards", `${card.id}.json`), { force: true });
    const columnName0 = source.columns.find((c) => c.id === card.columnId)?.name ?? "?";
    this.appendEvents(target, saved, [
      { at: new Date().toISOString(), by: this.who.author, field: "board", from: `${source.name} / ${columnName0}`, to: `${target.name} / ${column.name}` },
    ]);
    return this.view(saved, target);
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
          ref: refOf(other.board, other.card),
          title: other.card.title,
          board: other.board.name,
          column: other.board.columns.find((c) => c.id === other.card.columnId)?.name ?? null,
          finished: isFinished(other.card, other.board),
        };
      } catch {
        return { type: l.type, cardId: l.cardId, missing: true };
      }
    });
    return { ...this.view(card, board), links, comments: this.comments(board, card.id), history: this.history(board, card.id) };
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
    // The other card may be gone: then only its raw id (or a start of it) can name it.
    let otherFull = otherId;
    try {
      otherFull = this.card(otherId).card.id;
    } catch {
      /* not found: match the raw id below */
    }
    const target = a.card.links.find((l) => l.cardId === otherFull || (otherId.length >= 4 && l.cardId.startsWith(otherId)));
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
   * Takes the card: this computer, agent and conversation work on it. Refused
   * when someone else holds it, unless forced. Optionally moves it at the same
   * time, so "take and put in En cours" is one write.
   */
  claim(cardId: string, opts: { column?: string; force?: boolean; conversation?: string } = {}): CardView {
    const { card, board } = this.card(cardId);
    const who = { ...this.who.author, ...(opts.conversation ? { conversation: opts.conversation } : {}) };
    if (!mayClaim(card.claimedBy, who, opts.force)) {
      const ref = refOf(board, card) ?? card.id;
      throw new TodoomError(
        `${ref} est déjà pris par ${claimLabel(card.claimedBy!)} depuis ${card.claimedBy!.at} : laisse-le, ou force avec --force (force: true).`,
      );
    }
    let next: Card = { ...card, claimedBy: newClaim(who) };
    if (opts.column) {
      const column = this.column(board, opts.column);
      if (column.id !== card.columnId) next = { ...next, columnId: column.id, order: this.position(board, column.id, "bottom", card.id) };
    }
    return this.view(this.save(board, next, card), board);
  }

  /** Nobody works on the card any more. Only its holder may release it, unless forced. */
  release(cardId: string, opts: { force?: boolean; conversation?: string } = {}): CardView {
    const { card, board } = this.card(cardId);
    if (!card.claimedBy) return this.view(card, board);
    const who = { ...this.who.author, ...(opts.conversation ? { conversation: opts.conversation } : {}) };
    if (!opts.force && !sameClaimant(card.claimedBy, who)) {
      throw new TodoomError(`Pris par ${claimLabel(card.claimedBy)}, pas par toi : force avec --force (force: true) pour le libérer.`);
    }
    return this.view(this.save(board, { ...card, claimedBy: null }, card), board);
  }

  /** Adds a comment, dated and signed (computer, agent, conversation), in a file of its own. */
  comment(cardId: string, text: string): CardComment & { ref: string | null } {
    if (!text.trim()) throw new TodoomError("Le commentaire est vide");
    const { card, board } = this.card(cardId);
    const comment: CardComment = { id: uid(), cardId: card.id, createdAt: new Date().toISOString(), author: this.who.author, text: text.trim() };
    const path = join(this.dir, commentPath(comment, board.id));
    mkdirSync(dirname(path), { recursive: true });
    writeAtomic(path, comment);
    return { ...comment, ref: refOf(board, card) };
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

/** The merge request once the changes are applied: a new address keeps the state, or starts open. */
function mergeRequestAfter(current: MergeRequest | null, changes: CardChanges): MergeRequest | null {
  if (changes.mrState !== undefined && !MR_STATES.includes(changes.mrState as MergeRequestState)) {
    throw new TodoomError(`État de merge request inconnu : ${changes.mrState}. Choix : ${MR_STATES.join(", ")}`);
  }
  const state = changes.mrState as MergeRequestState | undefined;
  if (changes.mrUrl === null) return null;
  if (changes.mrUrl !== undefined) {
    const url = webUrl(changes.mrUrl);
    if (!url) throw new TodoomError(`Adresse de merge request invalide : ${changes.mrUrl} (https://… attendu)`);
    return { url, state: state ?? current?.state ?? "open" };
  }
  if (state) {
    if (!current) throw new TodoomError("La carte n'a pas de merge request : donne aussi son adresse");
    return { ...current, state };
  }
  return current;
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
    branch: raw.branch ?? null,
    mergeRequest: raw.mergeRequest ?? null,
    claimedBy: raw.claimedBy ?? null,
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
}
