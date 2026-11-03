import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, FileEntry } from "./backend";
import type { Board, Card, Presence } from "../types";
import { LABEL_COLORS, now, uid } from "./utils";

export interface Data {
  boards: Board[];
  cards: Record<string, Card[]>;
  presence: Presence[];
}

export type SyncStatus = "loading" | "synced" | "saving" | "error";

const EMPTY: Data = { boards: [], cards: {}, presence: [] };
const POLL_MS = 30_000;
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
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? "",
  };
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
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? "",
  };
}

/**
 * Turns the folder listing into app state. Drive conflict copies such as
 * "board (1).json" carry the same id, so the most recently updated one wins.
 */
function parse(files: FileEntry[]): Data {
  const boards = new Map<string, Board>();
  const cards = new Map<string, Card>();
  const presence: Presence[] = [];

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(file.content);
    } catch {
      continue;
    }
    const parts = file.path.split("/");
    if (parts[0] === ".presence") {
      if (raw?.host && raw?.at) presence.push(raw);
      continue;
    }
    if (parts[0] !== "boards" || !raw?.id) continue;
    if (parts.length === 3 && parts[2].startsWith("board")) {
      const board = normalizeBoard(raw);
      const prev = boards.get(board.id);
      if (!prev || board.updatedAt > prev.updatedAt) boards.set(board.id, board);
    } else if (parts.length === 4 && parts[2] === "cards") {
      const card = normalizeCard(raw, parts[1]);
      const prev = cards.get(card.id);
      if (!prev || card.updatedAt > prev.updatedAt) cards.set(card.id, card);
    }
  }

  const byBoard: Record<string, Card[]> = {};
  for (const board of boards.values()) byBoard[board.id] = [];
  for (const card of cards.values()) byBoard[card.boardId]?.push(card);

  return {
    boards: [...boards.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    cards: byBoard,
    presence,
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
      setData((d) => ({ ...d, boards: d.boards.map((b) => (b.id === saved.id ? saved : b)) }));
      writeJson(boardPath(saved.id), saved);
    };

    return {
      saveCard,
      deleteCard,
      saveBoard,

      createBoard(name: string): Board {
        const t = now();
        const board: Board = {
          id: uid(),
          name,
          columns: DEFAULT_COLUMNS.map((n) => ({ id: uid(), name: n })),
          labels: DEFAULT_LABELS.map((l) => ({ ...l, id: uid() })),
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

      deleteColumn(board: Board, columnId: string, cards: Card[]) {
        cards.filter((c) => c.columnId === columnId).forEach(deleteCard);
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
