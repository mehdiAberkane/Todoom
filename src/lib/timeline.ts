// Dates and durations of a card, read from its history: the app, the CLI and
// the agent all record each column change with its time, so nothing more is
// stored on the card, and cards moved before this existed get their dates too.
import type { Board, Card, HistoryEvent } from "../types";
import { isDoneName } from "./links";
import { t } from "./i18n";
import { toISODate } from "./utils";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Columns where work hasn't started: entering one of them doesn't start a card. */
const WAITING_NAMES = ["a faire", "todo", "to do", "backlog", "idees", "idee", "ideas", "icebox", "plus tard", "later"];

/** A stay of the card in a column; `to` is null while it's still there. */
export interface Stay {
  column: string;
  from: string;
  to: string | null;
  /** The start isn't in the history (a card older than it): only the creation date is known. */
  guessed?: boolean;
}

/** "Board / Column" in a move between boards: the column is after the last " / ". */
const columnOf = (value: string | null | undefined) => (value ?? "").split(" / ").pop()!.trim();

/** The columns the card went through, oldest first, from its merged history. */
export function staysOf(card: Card, board: Board, history: HistoryEvent[]): Stay[] {
  const moves = history.filter((e) => e.field === "created" || e.field === "column" || e.field === "board");
  const current = board.columns.find((c) => c.id === card.columnId)?.name ?? "?";
  const first = moves[0];
  const stays: Stay[] = [];
  let column = first ? (first.field === "created" ? columnOf(first.to) : columnOf(first.from)) : current;
  let since = first?.field === "created" ? first.at : card.createdAt;
  let guessed = first?.field !== "created";
  for (const e of moves) {
    if (e.field === "created") continue;
    const to = columnOf(e.to);
    if (!to) continue;
    stays.push({ column, from: since, to: e.at, ...(guessed ? { guessed } : {}) });
    column = to;
    since = e.at;
    guessed = false;
  }
  stays.push({ column, from: since, to: null, ...(guessed ? { guessed } : {}) });
  return stays.filter((s) => s.column);
}

export interface CardDates {
  created: string;
  /** First time the card entered a column where work happens (or is done). */
  started: string | null;
  /** When it entered the « done » column it is in now; null if it isn't done. */
  finished: string | null;
}

export function datesOf(card: Card, board: Board, stays: Stay[]): CardDates {
  const firstColumn = board.columns[0]?.name;
  const waiting = (name: string) => WAITING_NAMES.includes(plain(name)) || (!!firstColumn && plain(name) === plain(firstColumn));
  const start = stays.find((s) => !waiting(s.column));
  const started = start && !start.guessed ? start.from : null;
  const last = stays[stays.length - 1];
  const finished = last && !last.guessed && isDoneName(last.column) ? last.from : null;
  return { created: stays[0]?.from ?? card.createdAt, started, finished };
}

/**
 * Time spent in each column, in ms, in the order first reached. The current
 * stay counts up to now, or up to the archiving of an archived card. A stay
 * whose start isn't known is left out.
 */
export function timeByColumn(card: Card, stays: Stay[], now = Date.now()): { column: string; ms: number }[] {
  const end = card.archivedAt ? Date.parse(card.archivedAt) : now;
  const out = new Map<string, number>();
  for (const s of stays) {
    if (s.guessed) continue;
    const ms = Math.max(0, (s.to ? Date.parse(s.to) : end) - Date.parse(s.from));
    out.set(s.column, (out.get(s.column) ?? 0) + (Number.isFinite(ms) ? ms : 0));
  }
  return [...out].map(([column, ms]) => ({ column, ms }));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3 j 4 h", "2 h 10 min", "5 min", "< 1 min". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return t("dur.lessThanMinute");
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (d) return h ? t("dur.dh", { d, h }) : t("dur.d", { d });
  if (h) return m ? t("dur.hm", { h, m }) : t("dur.h", { h });
  return t("dur.m", { m });
}

/** Monday of the week of `date`, as YYYY-MM-DD in local time. */
export function weekOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISODate(d);
}

/**
 * Cards finished each week on a board, for the last `weeks` weeks, oldest
 * first; archived cards count too when they were archived from « done ».
 */
export function finishedPerWeek(
  board: Board,
  cards: Card[],
  historyOf: (cardId: string) => HistoryEvent[],
  weeks = 8,
  now = new Date(),
): { week: string; count: number }[] {
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) starts.push(weekOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * i)));
  const counts = new Map(starts.map((w) => [w, 0]));
  for (const card of cards) {
    const { finished } = datesOf(card, board, staysOf(card, board, historyOf(card.id)));
    if (!finished) continue;
    const week = weekOf(new Date(finished));
    if (counts.has(week)) counts.set(week, counts.get(week)! + 1);
  }
  return starts.map((week) => ({ week, count: counts.get(week)! }));
}
