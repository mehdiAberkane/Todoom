import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, FileEntry } from "./backend";
import type { AppSettings, Board, Card, Presence } from "../types";
import { LABEL_COLORS, now, reorder, uid } from "./utils";
import { boardProblem, cardProblem, settingsProblem } from "./validate";

/** A file of the data folder that couldn't be loaded, and why. */
export interface FileIssue {
  path: string;
  reason: string;
}

export interface Data {
  boards: Board[];
  cards: Record<string, Card[]>;
  presence: Presence[];
  settings: AppSettings;
  issues: FileIssue[];
}

export type SyncStatus = "loading" | "synced" | "saving" | "error";

export const DEFAULT_SETTINGS: AppSettings = { background: null, backgroundDim: 0.45, updatedAt: "" };
const EMPTY: Data = { boards: [], cards: {}, presence: [], settings: DEFAULT_SETTINGS, issues: [] };
const SETTINGS_PATH = "settings.json";
// Safety net only: the folder watcher reports other machines' changes as they happen.
const POLL_MS = 120_000;
const HEARTBEAT_MS = 60_000;

const DEFAULT_COLUMNS = ["À faire", "En cours", "Terminé"];
const DEFAULT_LABELS = [
  { name: "Urgent", color: LABEL_COLORS[0] },
  { name: "Bug", color: LABEL_COLORS[1] },
  { name: "Idée", color: LABEL_COLORS[6] },
  { name: "Perso", color: LABEL_COLORS[3] },
];

const boardDir = (boardId: string) => `boards/${boardId}`;
const boardPath = (boardId: string) => `${boardDir(boardId)}/board.json`;
const cardPath = (c: Card) => `${boardDir(c.boardId)}/cards/${c.id}.json`;
const presencePath = (host: string) => `.presence/${host.replace(/[^\w-]/g, "_")}.json`;

function normalizeBoard(raw: Partial<Board>): Board {
  return {
    id: raw.id!,
    name: raw.name ?? "Sans nom",
    columns: raw.columns ?? [],
    labels: raw.labels ?? [],
    ...(typeof raw.order === "number" ? { order: raw.order } : {}),
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? "",
  };
}

/** Boards without an order (older files) come last, oldest first. */
function sortBoards(boards: Board[]): Board[] {
  return [...boards].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt),
  );
}

function normalizeCard(raw: Partial<Card>, boardId: string): Card {
  return {
    id: raw.id!,
    boardId,
    columnId: raw.columnId ?? "",
    order: typeof raw.order === "number" ? raw.order : 0,
    title: raw.title ?? "",
    description: raw.description ?? "",
    labels: raw.labels ?? [],
    due: raw.due ?? null,
    checklist: raw.checklist ?? [],
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? "",
  };
}

type Kind = "board" | "card" | "settings" | "presence";

/** Which kind of Todoom file a path is, or null for files Todoom doesn't own. */
function kindOf(parts: string[]): Kind | null {
  if (parts[0] === ".presence") return "presence";
  // Also matches Drive conflict copies such as "settings (1).json" or "board (1).json".
  if (parts.length === 1 && parts[0].startsWith("settings")) return "settings";
  if (parts[0] !== "boards") return null;
  if (parts.length === 3 && parts[2].startsWith("board")) return "board";
  if (parts.length === 4 && parts[2] === "cards") return "card";
  return null;
}

/**
 * Turns the folder listing into app state. Drive conflict copies such as
 * "board (1).json" carry the same id, so the most recently updated one wins.
 * Files that can't be used are listed in `issues` rather than dropped silently.
 */
export function parse(files: FileEntry[]): Data {
  const boards = new Map<string, Board>();
  const cards = new Map<string, { card: Card; path: string }>();
  const presence: Presence[] = [];
  const issues: FileIssue[] = [];
  let settings = DEFAULT_SETTINGS;

  for (const file of files) {
    const parts = file.path.split("/");
    const kind = kindOf(parts);
    if (!kind) continue;
    let raw;
    try {
      raw = JSON.parse(file.content);
    } catch {
      // Heartbeats are rewritten every minute; a half-synced one isn't worth a warning.
      if (kind !== "presence") issues.push({ path: file.path, reason: "JSON invalide (fichier partiel ou corrompu)" });
      continue;
    }
    if (kind === "presence") {
      if (raw?.host && raw?.at) presence.push(raw);
      continue;
    }
    const why = kind === "card" ? cardProblem(raw) : kind === "board" ? boardProblem(raw) : settingsProblem(raw);
    if (why) {
      issues.push({ path: file.path, reason: why });
      continue;
    }
    if (kind === "settings") {
      const s = { ...DEFAULT_SETTINGS, ...raw } as AppSettings;
      if (s.updatedAt > settings.updatedAt) settings = s;
    } else if (kind === "board") {
      const board = normalizeBoard(raw);
      const prev = boards.get(board.id);
      if (!prev || board.updatedAt > prev.updatedAt) boards.set(board.id, board);
    } else {
      const card = normalizeCard(raw, parts[1]);
      const prev = cards.get(card.id);
      if (!prev || card.updatedAt > prev.card.updatedAt) cards.set(card.id, { card, path: file.path });
    }
  }

  const byBoard: Record<string, Card[]> = {};
  for (const board of boards.values()) byBoard[board.id] = [];
  for (const { card, path } of cards.values()) {
    const board = boards.get(card.boardId);
    if (!board) {
      issues.push({ path, reason: "son tableau (board.json) est absent ou illisible" });
      continue;
    }
    byBoard[card.boardId].push(card);
    if (!card.archivedAt && !board.columns.some((c) => c.id === card.columnId)) {
      issues.push({ path, reason: "colonne inconnue : la carte est affichée dans la première colonne" });
    }
  }

  return {
    boards: sortBoards([...boards.values()]),
    cards: byBoard,
    presence,
    settings,
    issues: issues.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function useTodoom(backend: Backend) {
  const [data, setData] = useState<Data>(EMPTY);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const pending = useRef(0);

  const reload = useCallback(async () => {
    // A reload racing our own write could briefly resurrect the old state.
    if (pending.current > 0) return;
    try {
      const files = await backend.loadAll();
      if (pending.current > 0) return;
      setData(parse(files));
      setStatus("synced");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  }, [backend]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(reload, 300);
    };
    reload();
    const unlisten = backend.onChange(schedule);
    const poll = window.setInterval(reload, POLL_MS);
    window.addEventListener("focus", schedule);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", schedule);
      unlisten.then((off) => off());
    };
  }, [backend, reload]);

  useEffect(() => {
    let name = "";
    const beat = async () => {
      name ||= await backend.hostname();
      setHost(name);
      await backend.write(presencePath(name), JSON.stringify({ host: name, at: now() })).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [backend]);

  const run = useCallback(async (op: () => Promise<void>) => {
    pending.current++;
    setStatus("saving");
    try {
      await op();
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current--;
      if (pending.current === 0) setStatus((s) => (s === "saving" ? "synced" : s));
    }
  }, []);

  const writeJson = useCallback(
    (path: string, value: unknown) => run(() => backend.write(path, JSON.stringify(value, null, 2))),
    [backend, run],
  );

  const actions = useMemo(() => {
    const saveCard = (card: Card) => {
      const saved = { ...card, updatedAt: now() };
      setData((d) => {
        const list = d.cards[saved.boardId] ?? [];
        const exists = list.some((c) => c.id === saved.id);
        const next = exists ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved];
        return { ...d, cards: { ...d.cards, [saved.boardId]: next } };
      });
      writeJson(cardPath(saved), saved);
    };

    const deleteCard = (card: Card) => {
      setData((d) => ({
        ...d,
        cards: { ...d.cards, [card.boardId]: (d.cards[card.boardId] ?? []).filter((c) => c.id !== card.id) },
      }));
      run(() => backend.remove(cardPath(card)));
    };

    const saveBoard = (board: Board) => {
      const saved = { ...board, updatedAt: now() };
      setData((d) => ({ ...d, boards: sortBoards(d.boards.map((b) => (b.id === saved.id ? saved : b))) }));
      writeJson(boardPath(saved.id), saved);
    };

    return {
      saveCard,
      deleteCard,
      saveBoard,

      saveSettings(settings: AppSettings) {
        const saved = { ...settings, updatedAt: now() };
        setData((d) => ({ ...d, settings: saved }));
        writeJson(SETTINGS_PATH, saved);
      },

      /** `ids` is the full sidebar order after the drop; only the moved board is rewritten when possible. */
      moveBoard(boards: Board[], movedId: string, ids: string[]) {
        const byId = new Map(boards.map((b) => [b.id, b]));
        for (const [id, order] of reorder(ids, movedId, (id) => byId.get(id)?.order)) {
          const b = byId.get(id);
          if (b) saveBoard({ ...b, order });
        }
      },

      createBoard(name: string, existing: Board[]): Board {
        const t = now();
        const orders = existing.map((b) => b.order).filter((o): o is number => o !== undefined);
        const board: Board = {
          id: uid(),
          name,
          columns: DEFAULT_COLUMNS.map((n) => ({ id: uid(), name: n })),
          labels: DEFAULT_LABELS.map((l) => ({ ...l, id: uid() })),
          ...(orders.length ? { order: Math.max(...orders) + 1 } : {}),
          createdAt: t,
          updatedAt: t,
        };
        setData((d) => ({ ...d, boards: [...d.boards, board], cards: { ...d.cards, [board.id]: [] } }));
        writeJson(boardPath(board.id), board);
        return board;
      },

      deleteBoard(boardId: string) {
        setData((d) => {
          const cards = { ...d.cards };
          delete cards[boardId];
          return { ...d, boards: d.boards.filter((b) => b.id !== boardId), cards };
        });
        run(() => backend.remove(boardDir(boardId)));
      },

      archiveCard(card: Card) {
        saveCard({ ...card, archivedAt: now() });
      },

      /** Puts the card back at the bottom of its column, or of the first column if its own was deleted. */
      restoreCard(board: Board, card: Card, cards: Card[]) {
        const columnId = board.columns.some((c) => c.id === card.columnId) ? card.columnId : board.columns[0]?.id;
        if (!columnId) return;
        const last = cards
          .filter((c) => c.columnId === columnId && !c.archivedAt)
          .reduce((m, c) => Math.max(m, c.order), -1);
        saveCard({ ...card, columnId, order: last + 1, archivedAt: null });
      },

      /** The column's cards are archived, not deleted, so they can still be restored. */
      deleteColumn(board: Board, columnId: string, cards: Card[]) {
        const t = now();
        cards.filter((c) => c.columnId === columnId && !c.archivedAt).forEach((c) => saveCard({ ...c, archivedAt: t }));
        saveBoard({ ...board, columns: board.columns.filter((c) => c.id !== columnId) });
      },

      newCard(board: Board, columnId: string, title: string, order: number): Card {
        const t = now();
        const card: Card = {
          id: uid(),
          boardId: board.id,
          columnId,
          order,
          title,
          description: "",
          labels: [],
          due: null,
          checklist: [],
          archivedAt: null,
          createdAt: t,
          updatedAt: t,
        };
        saveCard(card);
        return card;
      },
    };
  }, [backend, run, writeJson]);

  return { data, status, error, host, actions, reload };
}

export type Actions = ReturnType<typeof useTodoom>["actions"];
