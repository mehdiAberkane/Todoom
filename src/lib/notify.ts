// What deserves a system notification: a card that another computer, the CLI
// or an agent put in a watched column (« A verifier », « Echec »…), and the
// cards due today. Only the changes read from the data folder are compared, so
// a card moved in this window never notifies its own mover.
import type { AppSettings, Board, Card } from "../types";
import { isFinished } from "./links";
import { refOf } from "./shortid";
import { t, tn } from "./i18n";

/** Watched columns when none were chosen, in French and English. */
export const DEFAULT_NOTIFY_COLUMNS = ["A verifier", "Echec", "To review", "Failed"];

export interface NotifySettings {
  enabled: boolean;
  columns: string[];
  due: boolean;
}

export function notifySettings(settings: AppSettings): NotifySettings {
  const n = settings.notifications;
  return { enabled: n?.enabled ?? true, columns: n?.columns ?? DEFAULT_NOTIFY_COLUMNS, due: n?.due ?? true };
}

export const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export interface Snapshot {
  boards: Board[];
  cards: Record<string, Card[]>;
}

export interface Arrival {
  card: Card;
  board: Board;
  column: string;
}

function live(data: Snapshot) {
  const out: { card: Card; board: Board }[] = [];
  for (const board of data.boards) {
    if (board.archivedAt) continue;
    for (const card of data.cards[board.id] ?? []) if (!card.archivedAt) out.push({ card, board });
  }
  return out;
}

/**
 * Cards now in a watched column that weren't there before: moved there, moved
 * from another board, or (when the previous read was complete, so it isn't just
 * a file Drive downloaded late) created there.
 */
export function arrivals(prev: Snapshot, next: Snapshot, columns: string[], prevComplete: boolean): Arrival[] {
  const watched = new Set(columns.map(plain));
  const before = new Map(live(prev).map((x) => [x.card.id, x.card]));
  const out: Arrival[] = [];
  for (const { card, board } of live(next)) {
    const column = board.columns.find((c) => c.id === card.columnId);
    if (!column || !watched.has(plain(column.name))) continue;
    const old = before.get(card.id);
    if (old ? old.columnId === card.columnId && old.boardId === card.boardId : !prevComplete) continue;
    out.push({ card, board, column: column.name });
  }
  return out;
}

/** Cards due on `today` (YYYY-MM-DD, local) that aren't finished. */
export function dueOn(data: Snapshot, today: string): { card: Card; board: Board }[] {
  return live(data).filter(({ card, board }) => card.due?.slice(0, 10) === today && !isFinished(card, board));
}

/** Due cards already notified today on this computer; a new day starts over. */
export interface DueMemory {
  day: string;
  ids: string[];
}

export function freshDue<T extends { card: Card }>(due: T[], today: string, memory: DueMemory | null): { fresh: T[]; memory: DueMemory } {
  const seen = new Set(memory?.day === today ? memory.ids : []);
  const fresh = due.filter((x) => !seen.has(x.card.id));
  return { fresh, memory: { day: today, ids: [...seen, ...fresh.map((x) => x.card.id)] } };
}

export interface Notice {
  title: string;
  body: string;
}

const label = (card: Card, board: Board) => {
  const ref = refOf(board, card);
  return ref ? `${ref} · ${card.title}` : card.title;
};

/** At most a few notifications per read: past that, one sums them up. */
const MAX_SINGLE = 3;

export function noticesFor(arrived: Arrival[], due: { card: Card; board: Board }[]): Notice[] {
  const out: Notice[] = [];
  if (arrived.length > MAX_SINGLE) {
    out.push({ title: tn("notify.arrivedMany", arrived.length), body: arrived.map((a) => `${label(a.card, a.board)} → ${a.column}`).join("\n") });
  } else {
    for (const a of arrived) out.push({ title: t("notify.arrived", { column: a.column }), body: `${label(a.card, a.board)}\n${a.board.name}` });
  }
  if (due.length === 1) out.push({ title: t("notify.dueOne"), body: `${label(due[0].card, due[0].board)}\n${due[0].board.name}` });
  else if (due.length > 1) out.push({ title: tn("notify.dueMany", due.length), body: due.map((d) => label(d.card, d.board)).join("\n") });
  return out;
}

