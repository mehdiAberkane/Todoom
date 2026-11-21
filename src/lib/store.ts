import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, FileEntry } from "./backend";
import type { AgentStatus, AppSettings, Attachment, Board, Card, CardComment, HistoryEvent, LinkType, Presence } from "../types";
import { nextUpdatedAt, now, reorder, uid } from "./utils";
import { agentProblem, attachmentProblem, boardProblem, cardProblem, commentProblem, historyProblem, settingsProblem, type IssueReason } from "./validate";
import { changesBetween, commentPath, commentsDir, eventsFor, historyDir, historyPath, writerName } from "./activity";
import { t } from "./i18n";
import { inverseOf, withLink, withoutLink } from "./links";
import { newClaim } from "./claim";
import { boardSetup, DEFAULT_TEMPLATE, fromSetup, type BoardTemplate } from "./templates";
import { duplicateOf, mapByName } from "./transfer";
import { nextNumber } from "./shortid";
import { attachmentFilePath, attachmentMetaPath, attachmentsDir, MAX_ATTACHMENT_BYTES, readAsBase64, storedName } from "./attachments";

/** A file of the data folder that couldn't be loaded, and why. */
export interface FileIssue {
  path: string;
  reason: IssueReason;
}

export interface Data {
  boards: Board[];
  cards: Record<string, Card[]>;
  presence: Presence[];
  settings: AppSettings;
  issues: FileIssue[];
  /** Comments by card id, oldest first. */
  comments: Record<string, CardComment[]>;
  /** History by card id, then by writer (a computer or a tool). */
  history: Record<string, Record<string, HistoryEvent[]>>;
  /** Agents watching each board, by board id. */
  agents: Record<string, AgentStatus[]>;
  /** Attached files by card id, oldest first. */
  attachments: Record<string, Attachment[]>;
}

export type SyncStatus = "loading" | "synced" | "saving" | "error";

export const DEFAULT_SETTINGS: AppSettings = { background: null, backgroundDim: 0.45, language: null, updatedAt: "" };
const EMPTY: Data = { boards: [], cards: {}, presence: [], settings: DEFAULT_SETTINGS, issues: [], comments: {}, history: {}, agents: {}, attachments: {} };
const SETTINGS_PATH = "settings.json";
// Safety net only: the folder watcher reports other machines' changes as they happen.
const POLL_MS = 120_000;
const HEARTBEAT_MS = 60_000;

const boardDir = (boardId: string) => `boards/${boardId}`;
const boardPath = (boardId: string) => `${boardDir(boardId)}/board.json`;
const cardPath = (c: Card) => `${boardDir(c.boardId)}/cards/${c.id}.json`;
const presencePath = (host: string) => `.presence/${host.replace(/[^\w-]/g, "_")}.json`;

// Fields this version doesn't know (written by a newer one, or a script) are kept as they are,
// so saving the item doesn't erase them.
function normalizeBoard(raw: Partial<Board>): Board {
  return {
    ...raw,
    id: raw.id!,
    name: raw.name ?? t("board.untitled"),
    ...(raw.key ? { key: raw.key } : {}),
    ...(raw.description ? { description: raw.description } : {}),
    columns: raw.columns ?? [],
    labels: raw.labels ?? [],
    ...(raw.priorities ? { priorities: raw.priorities } : {}),
    ...(typeof raw.order === "number" ? { order: raw.order } : {}),
    archivedAt: raw.archivedAt ?? null,
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
    ...raw,
    id: raw.id!,
    ...(typeof raw.number === "number" ? { number: raw.number } : {}),
    boardId,
    columnId: raw.columnId ?? "",
    order: typeof raw.order === "number" ? raw.order : 0,
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
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? "",
  };
}

type Kind = "board" | "card" | "settings" | "presence" | "comment" | "history" | "agent" | "attachment";

/** Which kind of Todoom file a path is, or null for files Todoom doesn't own. */
function kindOf(parts: string[]): Kind | null {
  if (parts[0] === ".presence") return "presence";
  // Also matches Drive conflict copies such as "settings (1).json" or "board (1).json".
  if (parts.length === 1 && parts[0].startsWith("settings")) return "settings";
  if (parts[0] !== "boards") return null;
  if (parts.length === 3 && parts[2].startsWith("board")) return "board";
  if (parts.length === 4 && parts[2] === "cards") return "card";
  if (parts.length === 4 && parts[2] === "agents") return "agent";
  if (parts.length === 5 && parts[2] === "comments") return "comment";
  if (parts.length === 5 && parts[2] === "history") return "history";
  if (parts.length === 5 && parts[2] === "attachments" && parts[4].endsWith(".json")) return "attachment";
  return null;
}

/**
 * Turns the folder listing into app state. Drive conflict copies such as
 * "board (1).json" carry the same id, so the most recently updated one wins.
 * Files that can't be used are listed in `issues` rather than dropped silently.
 */
export function parse(files: FileEntry[], pending: string[] = []): Data {
  // Boards whose file Google Drive is still downloading: their cards wait silently.
  const boardPending = new Set(pending.filter((p) => /^boards\/[^/]+\/board\.json$/.test(p)).map((p) => p.split("/")[1]));
  const boards = new Map<string, Board>();
  const cards = new Map<string, { card: Card; path: string }>();
  const presence: Presence[] = [];
  const issues: FileIssue[] = [];
  let settings = DEFAULT_SETTINGS;
  const comments = new Map<string, CardComment>();
  const history: Data["history"] = {};
  const agents: Data["agents"] = {};
  const attachments = new Map<string, Attachment>();

  for (const file of files) {
    const parts = file.path.split("/");
    const kind = kindOf(parts);
    if (!kind) continue;
    let raw;
    try {
      raw = JSON.parse(file.content);
    } catch {
      // Heartbeats are rewritten every minute; a half-synced one isn't worth a warning.
      if (kind !== "presence") issues.push({ path: file.path, reason: { code: "invalid_json" } });
      continue;
    }
    if (kind === "presence") {
      if (raw?.host && raw?.at) presence.push(raw);
      continue;
    }
    const why =
      kind === "card"
        ? cardProblem(raw)
        : kind === "board"
          ? boardProblem(raw)
          : kind === "comment"
            ? commentProblem(raw)
            : kind === "history"
              ? historyProblem(raw)
              : kind === "agent"
                ? agentProblem(raw)
                : kind === "attachment"
                  ? attachmentProblem(raw)
                  : settingsProblem(raw);
    if (why) {
      issues.push({ path: file.path, reason: why });
      continue;
    }
    if (kind === "comment") {
      // A Drive conflict copy of a comment is the same comment.
      comments.set(raw.id, raw as CardComment);
      continue;
    }
    if (kind === "attachment") {
      attachments.set(raw.id, raw as Attachment);
      continue;
    }
    if (kind === "agent") {
      // Several agents, one file each; a Drive conflict copy is the same agent: keep the freshest.
      const list = (agents[parts[1]] ??= []);
      const status = raw as AgentStatus;
      const same = list.findIndex((a) => a.host === status.host && a.agent === status.agent);
      if (same < 0) list.push(status);
      else if (status.heartbeat > list[same].heartbeat) list[same] = status;
      continue;
    }
    if (kind === "history") {
      const file = raw as { cardId: string; writer: string; events?: HistoryEvent[] };
      const events = file.events ?? [];
      const forCard = (history[file.cardId] ??= {});
      // A conflict copy of a writer's file: keep the longer one, history only grows.
      if ((forCard[file.writer]?.length ?? -1) < events.length) forCard[file.writer] = events;
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
      if (!boardPending.has(card.boardId)) issues.push({ path, reason: { code: "missing_board" } });
      continue;
    }
    byBoard[card.boardId].push(card);
    if (!card.archivedAt && !board.columns.some((c) => c.id === card.columnId)) {
      issues.push({ path, reason: { code: "unknown_column" } });
    }
  }

  return {
    boards: sortBoards([...boards.values()]),
    cards: byBoard,
    presence,
    settings,
    issues: issues.sort((a, b) => a.path.localeCompare(b.path)),
    comments: groupComments([...comments.values()]),
    history,
    agents,
    attachments: groupAttachments([...attachments.values()]),
  };
}

function groupAttachments(list: Attachment[]): Record<string, Attachment[]> {
  const out: Record<string, Attachment[]> = {};
  for (const a of list.sort((x, y) => x.createdAt.localeCompare(y.createdAt))) (out[a.cardId] ??= []).push(a);
  return out;
}

function groupComments(list: CardComment[]): Record<string, CardComment[]> {
  const out: Record<string, CardComment[]> = {};
  for (const c of list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) (out[c.cardId] ??= []).push(c);
  return out;
}

/** A change not yet confirmed on disk: the latest content wanted for a path, or its removal. */
export type PendingOp = { kind: "write"; content: string } | { kind: "remove" };

/** A queued change whose last attempt failed. */
export interface WriteFailure {
  path: string;
  error: string;
}

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** A load taking longer than this is said to be slow. */
const SLOW_LOAD_MS = 8_000;
/** While files are pending, the folder is loaded again this often. */
const PENDING_RETRY_MS = 3_000;

/** How long a board stays in the trash before it is deleted for good. */
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

/** When a trashed board will be deleted for good. */
export const purgeDate = (board: Board) => new Date(Date.parse(board.archivedAt!) + TRASH_DAYS * DAY_MS);

/** Boards whose time in the trash is over. */
export function expiredBoards(boards: Board[], now = Date.now()): Board[] {
  return boards.filter((b) => b.archivedAt && purgeDate(b).getTime() <= now);
}

/** The card or board id a data file belongs to, or null for other files. */
export function idOfPath(path: string): string | null {
  const m = path.match(/^boards\/([^/]+)(?:\/board\.json|\/cards\/([^/]+)\.json)?$/);
  return m ? (m[2] ?? m[1]) : null;
}

/**
 * The folder as it will be once the queued changes are written. Reloads use it
 * so that a change the disk refused stays on screen instead of reverting.
 */
export function overlay(files: FileEntry[], queue: ReadonlyMap<string, PendingOp>): FileEntry[] {
  const out = new Map(files.map((f) => [f.path, f.content]));
  for (const [path, op] of queue) {
    if (op.kind === "write") {
      out.set(path, op.content);
    } else {
      for (const p of [...out.keys()]) if (p === path || p.startsWith(path + "/")) out.delete(p);
    }
  }
  return [...out].map(([path, content]) => ({ path, content }));
}

/** Told of every read of the data folder: what was shown before, what was read, and whether the previous read was complete. */
export type OnLoaded = (prev: Data, next: Data, prevComplete: boolean) => void;

export function useTodoom(backend: Backend, onLoaded?: OnLoaded) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  // Whether the last read had every file; the first read has nothing to compare to.
  const lastComplete = useRef(false);
  const [data, setData] = useState<Data>(EMPTY);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  // Files Google Drive hasn't downloaded yet; while there are some, the data is incomplete.
  const [pending, setPending] = useState<string[]>([]);
  // The folder has been slow to answer: said instead of an endless « loading ».
  const [slow, setSlow] = useState(false);
  const pendingTimer = useRef<number | undefined>(undefined);
  // Read by the actions, which don't change between renders.
  const hostRef = useRef("");
  hostRef.current = host;
  const dataRef = useRef(data);
  dataRef.current = data;
  // The last version of each card saved here, newer than `data` until it re-renders.
  const lastSaved = useRef(new Map<string, Card>());
  // Changes waiting for the disk, by path; only the latest change of a path is kept.
  const queue = useRef(new Map<string, PendingOp>());
  const [unsaved, setUnsaved] = useState<string[]>([]);
  const [failures, setFailures] = useState<WriteFailure[]>([]);
  const [nextRetry, setNextRetry] = useState<number | null>(null);
  const flushing = useRef(false);
  const flushAgain = useRef(false);
  const retryTimer = useRef<number | undefined>(undefined);
  const attempt = useRef(0);

  const reload = useCallback(async () => {
    // A reload racing a write in progress could briefly resurrect the old state.
    if (flushing.current) return;
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    try {
      const { files, pending } = await backend.loadAll();
      if (flushing.current) return;
      const next = parse(overlay(files, queue.current), pending);
      const prev = dataRef.current;
      const prevComplete = lastComplete.current;
      lastComplete.current = pending.length === 0;
      setData(next);
      try {
        onLoadedRef.current?.(prev, next, prevComplete);
      } catch {
        /* a listener failing must not break loading */
      }
      setPending(pending);
      setError(null);
      setStatus(queue.current.size ? "error" : "synced");
      // Loads again shortly while Drive downloads the rest.
      clearTimeout(pendingTimer.current);
      if (pending.length) pendingTimer.current = window.setTimeout(() => reloadRef.current(), PENDING_RETRY_MS);
    } catch (e) {
      setStatus("error");
      setError(String(e));
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  }, [backend]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  /** Writes the queued changes in order; failed ones stay queued and are retried later. */
  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }
    flushing.current = true;
    clearTimeout(retryTimer.current);
    setStatus("saving");
    const failed: WriteFailure[] = [];
    try {
      for (const [path, op] of [...queue.current]) {
        try {
          if (op.kind === "write") await backend.write(path, op.content);
          else await backend.remove(path);
          // A newer change of the same path queued meanwhile stays for the next round.
          if (queue.current.get(path) === op) queue.current.delete(path);
        } catch (e) {
          failed.push({ path, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      flushing.current = false;
    }
    setUnsaved([...queue.current.keys()]);
    setFailures(failed);
    if (flushAgain.current) {
      flushAgain.current = false;
      return flush();
    }
    if (failed.length) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt.current++, RETRY_DELAYS_MS.length - 1)];
      retryTimer.current = window.setTimeout(flush, delay);
      setNextRetry(Date.now() + delay);
      setStatus("error");
    } else {
      attempt.current = 0;
      setNextRetry(null);
      setStatus("synced");
    }
  }, [backend]);

  const enqueue = useCallback(
    (path: string, op: PendingOp) => {
      if (op.kind === "remove") {
        // Writes inside a removed board are moot.
        for (const p of [...queue.current.keys()]) if (p.startsWith(path + "/")) queue.current.delete(p);
      }
      queue.current.set(path, op);
      setUnsaved([...queue.current.keys()]);
      void flush();
    },
    [flush],
  );

  /** Retries now, skipping the wait; resolves once the attempt is over. */
  const retryNow = useCallback(() => {
    attempt.current = 0;
    return flush();
  }, [flush]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

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

  const writeJson = useCallback(
    (path: string, value: unknown) => enqueue(path, { kind: "write", content: JSON.stringify(value, null, 2) }),
    [enqueue],
  );
  const removePath = useCallback((path: string) => enqueue(path, { kind: "remove" }), [enqueue]);

  const actions = useMemo(() => {
    /** Adds what changed to this computer's history file of the card. */
    const recordHistory = (prev: Card | undefined, next: Card) => {
      const board = dataRef.current.boards.find((b) => b.id === next.boardId);
      if (!board || !hostRef.current) return;
      appendHistory(next, eventsFor(changesBetween(prev, next, board), { host: hostRef.current }));
    };

    /** Adds events to this computer's history file of the card, where the card is now. */
    const appendHistory = (next: Card, events: HistoryEvent[]) => {
      if (!events.length || !hostRef.current) return;
      const writer = writerName(hostRef.current);
      const all = [...(dataRef.current.history[next.id]?.[writer] ?? []), ...events];
      dataRef.current = {
        ...dataRef.current,
        history: { ...dataRef.current.history, [next.id]: { ...dataRef.current.history[next.id], [writer]: all } },
      };
      setData((d) => ({ ...d, history: { ...d.history, [next.id]: { ...d.history[next.id], [writer]: all } } }));
      writeJson(historyPath(next.boardId, next.id, writer), { cardId: next.id, writer, events: all });
    };

    const saveCard = (card: Card) => {
      const fromData = (dataRef.current.cards[card.boardId] ?? []).find((c) => c.id === card.id);
      const fromHere = lastSaved.current.get(card.id);
      const prev = fromHere && (!fromData || fromHere.updatedAt >= fromData.updatedAt) ? fromHere : fromData;
      const saved = { ...card, updatedAt: nextUpdatedAt(card.updatedAt) };
      lastSaved.current.set(saved.id, saved);
      recordHistory(prev, saved);
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
      removePath(cardPath(card));
      removePath(commentsDir(card.boardId, card.id));
      removePath(historyDir(card.boardId, card.id));
      removePath(attachmentsDir(card.boardId, card.id));
    };

    const saveBoard = (board: Board) => {
      const saved = { ...board, updatedAt: nextUpdatedAt(board.updatedAt) };
      setData((d) => ({ ...d, boards: sortBoards(d.boards.map((b) => (b.id === saved.id ? saved : b))) }));
      writeJson(boardPath(saved.id), saved);
    };

    return {
      saveCard,
      deleteCard,
      saveBoard,

      saveSettings(settings: AppSettings) {
        const saved = { ...settings, updatedAt: nextUpdatedAt(settings.updatedAt) };
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

      /** A new board, set up from a template (simple, development, or a copy of a board's set-up). */
      createBoard(name: string, existing: Board[], template: BoardTemplate = DEFAULT_TEMPLATE): Board {
        const t = now();
        const orders = existing.map((b) => b.order).filter((o): o is number => o !== undefined);
        const board: Board = {
          id: uid(),
          name,
          ...fromSetup(boardSetup(template, existing)),
          ...(orders.length ? { order: Math.max(...orders) + 1 } : {}),
          createdAt: t,
          updatedAt: t,
        };
        setData((d) => ({ ...d, boards: [...d.boards, board], cards: { ...d.cards, [board.id]: [] } }));
        writeJson(boardPath(board.id), board);
        return board;
      },

      /** Hides the board; it stays on disk, restorable, until purged. */
      trashBoard(board: Board) {
        saveBoard({ ...board, archivedAt: now() });
      },

      restoreBoard(board: Board) {
        saveBoard({ ...board, archivedAt: null });
      },

      /** Deletes the board folder and all its cards for good. */
      purgeBoard(boardId: string) {
        setData((d) => {
          const cards = { ...d.cards };
          delete cards[boardId];
          return { ...d, boards: d.boards.filter((b) => b.id !== boardId), cards };
        });
        removePath(boardDir(boardId));
      },

/**
       * Attaches a file: the file itself is written right away (it can't wait in
       * the queue, being large), then its description. Fails with a message when
       * the file is too big or the folder refuses it.
       */
      async addAttachment(card: Card, file: File) {
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(t("attach.tooBig", { name: file.name }));
        const id = uid();
        const attachment: Attachment = {
          id,
          cardId: card.id,
          name: file.name || t("attach.pasted"),
          type: file.type || "application/octet-stream",
          size: file.size,
          file: storedName(id, file.name || "capture.png"),
          createdAt: now(),
          author: { host: hostRef.current },
        };
        await backend.writeAttachment(attachmentFilePath(attachment, card.boardId), await readAsBase64(file));
        setData((d) => ({ ...d, attachments: { ...d.attachments, [card.id]: [...(d.attachments[card.id] ?? []), attachment] } }));
        writeJson(attachmentMetaPath(attachment, card.boardId), attachment);
      },

      removeAttachment(attachment: Attachment, boardId: string) {
        setData((d) => ({
          ...d,
          attachments: { ...d.attachments, [attachment.cardId]: (d.attachments[attachment.cardId] ?? []).filter((a) => a.id !== attachment.id) },
        }));
        removePath(attachmentMetaPath(attachment, boardId));
        removePath(attachmentFilePath(attachment, boardId));
      },

/** A copy of the card at the bottom of its column, with the board's next number. */
      duplicateCard(card: Card): Card {
        const siblings = dataRef.current.cards[card.boardId] ?? [];
        const bottom = siblings.filter((c) => c.columnId === card.columnId && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1) + 1;
        const copy = duplicateOf(card, t("transfer.copyTitle", { title: card.title }), bottom, nextNumber(siblings));
        saveCard(copy);
        return copy;
      },

      /**
       * Moves a card to another board, in the given column, at its bottom. The card
       * keeps its id, so links to it still work; labels and priority follow by
       * name; its comments, history and attachments move with it. It gets the
       * new board's next number. Returns the moved card.
       */
      async moveCardToBoard(card: Card, target: Board, columnId: string): Promise<Card> {
        const d = dataRef.current;
        const source = d.boards.find((b) => b.id === card.boardId);
        if (!source || source.id === target.id) return card;
        const targetCards = (d.cards[target.id] ?? []).filter((c) => c.id !== card.id);
        const order = targetCards.filter((c) => c.columnId === columnId && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1) + 1;
        const moved: Card = {
          ...card,
          ...mapByName(card, source, target),
          boardId: target.id,
          columnId,
          order,
          number: nextNumber(targetCards),
          updatedAt: nextUpdatedAt(card.updatedAt),
        };

        // Attached files first: they are the only part that can fail (size, disk).
        for (const a of d.attachments[card.id] ?? []) {
          const data = await backend.readAttachment(attachmentFilePath(a, source.id));
          await backend.writeAttachment(attachmentFilePath(a, target.id), data);
          writeJson(attachmentMetaPath(a, target.id), a);
        }
        for (const c of d.comments[card.id] ?? []) writeJson(commentPath(c, target.id), c);
        for (const [writer, events] of Object.entries(d.history[card.id] ?? {})) {
          writeJson(historyPath(target.id, card.id, writer), { cardId: card.id, writer, events });
        }

        setData((s) => ({
          ...s,
          cards: {
            ...s.cards,
            [source.id]: (s.cards[source.id] ?? []).filter((c) => c.id !== card.id),
            [target.id]: [...(s.cards[target.id] ?? []).filter((c) => c.id !== card.id), moved],
          },
        }));
        lastSaved.current.set(moved.id, moved);
        writeJson(cardPath(moved), moved);
        const column = (b: Board, id: string) => b.columns.find((c) => c.id === id)?.name ?? "?";
        appendHistory(moved, [
          {
            at: now(),
            by: { host: hostRef.current },
            field: "board",
            from: `${source.name} / ${column(source, card.columnId)}`,
            to: `${target.name} / ${column(target, columnId)}`,
          },
        ]);

        removePath(cardPath(card));
        removePath(commentsDir(source.id, card.id));
        removePath(historyDir(source.id, card.id));
        removePath(attachmentsDir(source.id, card.id));
        return moved;
      },

      addComment(card: Card, text: string) {
        const comment: CardComment = { id: uid(), cardId: card.id, createdAt: now(), author: { host: hostRef.current }, text };
        setData((d) => ({ ...d, comments: { ...d.comments, [card.id]: [...(d.comments[card.id] ?? []), comment] } }));
        writeJson(commentPath(comment, card.boardId), comment);
      },

      deleteComment(comment: CardComment, boardId: string) {
        setData((d) => ({
          ...d,
          comments: { ...d.comments, [comment.cardId]: (d.comments[comment.cardId] ?? []).filter((c) => c.id !== comment.id) },
        }));
        removePath(commentPath(comment, boardId));
      },

      /** Links two cards, writing the link on both, each in its own direction. */
      linkCards(from: Card, type: LinkType, to: Card) {
        saveCard(withLink(from, type, to.id));
        saveCard(withLink(to, inverseOf(type), from.id));
      },

      /** Removes the link from `from`, and from the other card when it is still there. */
      /** This computer works on the card (by hand: no agent, no conversation). */
      claimCard(card: Card) {
        saveCard({ ...card, claimedBy: newClaim({ host: hostRef.current }) });
      },

      releaseCard(card: Card) {
        saveCard({ ...card, claimedBy: null });
      },

      unlinkCards(from: Card, to: Card | undefined, toId: string) {
        saveCard(withoutLink(from, toId));
        if (to && to.links.some((l) => l.cardId === from.id)) saveCard(withoutLink(to, from.id));
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

      newCard(board: Board, columnId: string, title: string, order: number, number?: number): Card {
        const card = blankCard(board, columnId, title, order, number);
        saveCard(card);
        return card;
      },

      /** A card not written yet, for the editor to fill in before the first save. */
      draftCard: blankCard,
    };
  }, [writeJson, removePath]);

  // Ids of the cards and boards with a change the disk hasn't confirmed yet.
  const unsavedIds = useMemo(() => new Set(unsaved.map(idOfPath).filter((id): id is string => !!id)), [unsaved]);

  return { data, status, error, host, actions, reload, unsaved, unsavedIds, failures, nextRetry, retryNow, pending, slow };
}

function blankCard(board: Board, columnId: string, title: string, order: number, number?: number): Card {
  const t = now();
  return {
    id: uid(),
    ...(number ? { number } : {}),
    boardId: board.id,
    columnId,
    order,
    title,
    description: "",
    labels: [],
    priority: null,
    due: null,
    checklist: [],
    links: [],
    branch: null,
    mergeRequest: null,
    claimedBy: null,
    archivedAt: null,
    createdAt: t,
    updatedAt: t,
  };
}

export type Actions = ReturnType<typeof useTodoom>["actions"];
