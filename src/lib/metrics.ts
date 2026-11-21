// Figures for the metrics page, per board and for all boards together. Dates
// and durations come from the cards' history (see timeline.ts).
import type { Board, Card, Column, HistoryEvent } from "../types";
import { isDoneName, isFinished } from "./links";
import { datesOf, finishedPerWeek, staysOf, timeByColumn, weekOf } from "./timeline";
import { toISODate } from "./utils";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export interface OpenCard {
  card: Card;
  board: Board;
  /** Started, or created when it hasn't started: how long it has been waiting. */
  since: string;
}

export interface BoardMetrics {
  board: Board;
  /** Cards on the board now (not archived) by column, in column order. */
  byColumn: { column: Column; count: number }[];
  open: number;
  overdue: number;
  /** Oldest first, for the last 8 weeks. */
  weekly: { week: string; count: number }[];
  /** Start to finish of each finished card, in ms. */
  cycleTimes: number[];
  /** Total ms spent in each column, and how many cards spent it, by column name; « done » columns left out. */
  columnTime: Map<string, { total: number; cards: number }>;
  openCards: OpenCard[];
}

export function boardMetrics(board: Board, cards: Card[], historyOf: (cardId: string) => HistoryEvent[], now = new Date()): BoardMetrics {
  const today = toISODate(now);
  const live = cards.filter((c) => !c.archivedAt);
  const byColumn = board.columns.map((column) => ({ column, count: live.filter((c) => c.columnId === column.id).length }));
  const cycleTimes: number[] = [];
  const columnTime = new Map<string, { total: number; cards: number }>();
  const openCards: OpenCard[] = [];
  let overdue = 0;
  for (const card of cards) {
    const stays = staysOf(card, board, historyOf(card.id));
    const { created, started, finished } = datesOf(card, board, stays);
    if (finished) cycleTimes.push(Math.max(0, Date.parse(finished) - Date.parse(started ?? created)));
    for (const { column, ms } of timeByColumn(card, stays, now.getTime())) {
      if (isDoneName(column)) continue;
      const entry = columnTime.get(column) ?? { total: 0, cards: 0 };
      columnTime.set(column, { total: entry.total + ms, cards: entry.cards + 1 });
    }
    if (card.archivedAt || isFinished(card, board)) continue;
    if (card.due && card.due < today) overdue++;
    openCards.push({ card, board, since: started ?? created });
  }
  return {
    board,
    byColumn,
    open: openCards.length,
    overdue,
    weekly: finishedPerWeek(board, cards, historyOf, 8, now),
    cycleTimes,
    columnTime,
    openCards,
  };
}

/** The figures of several boards added together; weeks line up since they come from the same date. */
export function combined(list: BoardMetrics[]) {
  const weekly = (list[0]?.weekly ?? []).map((w, i) => ({ week: w.week, count: list.reduce((n, m) => n + (m.weekly[i]?.count ?? 0), 0) }));
  return {
    open: list.reduce((n, m) => n + m.open, 0),
    overdue: list.reduce((n, m) => n + m.overdue, 0),
    weekly,
    cycleTimes: list.flatMap((m) => m.cycleTimes),
    openCards: list.flatMap((m) => m.openCards),
  };
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Average time a card spends in each column, in the board's column order (names matched loosely). */
export function columnAverages(board: Board, columnTime: BoardMetrics["columnTime"]): { column: string; ms: number; cards: number }[] {
  const out: { column: string; ms: number; cards: number }[] = [];
  for (const column of board.columns) {
    const entry = [...columnTime].find(([name]) => plain(name) === plain(column.name))?.[1];
    if (entry?.cards) out.push({ column: column.name, ms: entry.total / entry.cards, cards: entry.cards });
  }
  return out;
}

/** The open cards waiting longest, oldest first. */
export function oldest(cards: OpenCard[], count = 5): OpenCard[] {
  return [...cards].sort((a, b) => a.since.localeCompare(b.since)).slice(0, count);
}

export const thisWeek = (now = new Date()) => weekOf(now);
