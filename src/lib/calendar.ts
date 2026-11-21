// Due dates across every board: the month grid of the calendar page, and the
// « today » list (overdue, due today, the coming days). Only open cards count:
// not archived, not in a « done » column.
import type { Board, Card } from "../types";
import { isFinished } from "./links";
import { toISODate } from "./utils";

export interface DueCard {
  card: Card;
  board: Board;
  /** YYYY-MM-DD. */
  due: string;
}

/** Open cards with a due date, every board, earliest first (then by board and card order). */
export function dueCards(boards: Board[], cards: Record<string, Card[]>): DueCard[] {
  const out: DueCard[] = [];
  boards.forEach((board) => {
    for (const card of cards[board.id] ?? []) {
      if (card.due && !isFinished(card, board)) out.push({ card, board, due: card.due });
    }
  });
  const boardRank = new Map(boards.map((b, i) => [b.id, i]));
  return out.sort((a, b) => a.due.localeCompare(b.due) || boardRank.get(a.board.id)! - boardRank.get(b.board.id)! || a.card.order - b.card.order);
}

/** Cards by due date. */
export function byDay(list: DueCard[]): Map<string, DueCard[]> {
  const map = new Map<string, DueCard[]>();
  for (const d of list) map.set(d.due, [...(map.get(d.due) ?? []), d]);
  return map;
}

/** What needs attention: late, due today, and due in the next `days` days (tomorrow onwards). */
export function agenda(list: DueCard[], today: string, days = 7) {
  const end = shift(today, days);
  return {
    overdue: list.filter((d) => d.due < today),
    today: list.filter((d) => d.due === today),
    soon: list.filter((d) => d.due > today && d.due <= end),
  };
}

/** The date `n` days after a YYYY-MM-DD date (before, when negative). */
export function shift(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + n));
}

/**
 * The weeks shown for a month, Monday first: whole weeks, so the first and
 * last may hold days of the months around it. `month` is 0 for January.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // days since Monday
  const start = new Date(year, month, 1 - offset);
  const last = new Date(year, month + 1, 0);
  const weeks: string[][] = [];
  for (let day = new Date(start); day <= last || weeks[weeks.length - 1]?.length < 7; ) {
    if (!weeks.length || weeks[weeks.length - 1].length === 7) weeks.push([]);
    weeks[weeks.length - 1].push(toISODate(day));
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return weeks;
}

/** The month before or after, as [year, month]. */
export function addMonths(year: number, month: number, n: number): [number, number] {
  const d = new Date(year, month + n, 1);
  return [d.getFullYear(), d.getMonth()];
}
