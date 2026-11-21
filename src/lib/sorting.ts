// Sorting a column, filtering by due date, and the filter each board remembers.

import type { Board, Card } from "../types";
import { byPriority } from "./priority";
import { addDays, localGet, localSet, toISODate } from "./utils";

export type SortKey = "priority" | "due" | "created" | "updated";
export const SORT_KEYS: SortKey[] = ["priority", "due", "created", "updated"];

/**
 * A column's cards in a new order: highest priority first; nearest due date
 * first (none last); oldest first; most recently changed first. Ties keep
 * the current order.
 */
export function sortCards(cards: Card[], key: SortKey, board: Pick<Board, "priorities">): Card[] {
  const current = [...cards].sort((a, b) => a.order - b.order);
  switch (key) {
    case "priority":
      return byPriority(board, current);
    case "due":
      return current.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    case "created":
      return current.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "updated":
      return current.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export type DueFilter = "" | "overdue" | "today" | "week" | "none";
export const DUE_FILTERS: Exclude<DueFilter, "">[] = ["overdue", "today", "week", "none"];

/** Due date filter: late, due today, within the next 7 days (late included), no due date. */
export function matchesDue(card: Pick<Card, "due">, filter: DueFilter, today = toISODate(new Date()), inAWeek = addDays(7)): boolean {
  switch (filter) {
    case "":
      return true;
    case "overdue":
      return !!card.due && card.due < today;
    case "today":
      return card.due === today;
    case "week":
      return !!card.due && card.due <= inAWeek;
    case "none":
      return !card.due;
  }
}

/** What a board's filter bar holds; kept per board on this computer, so it is there again next time. */
export interface BoardFilter {
  query: string;
  labels: string[];
  priorities: string[];
  due: DueFilter;
}

export const NO_FILTER: BoardFilter = { query: "", labels: [], priorities: [], due: "" };
const key = (boardId: string) => `todoom-filter-${boardId}`;

export function loadFilter(boardId: string): BoardFilter {
  try {
    const saved = JSON.parse(localGet(key(boardId)) ?? "null");
    if (!saved || typeof saved !== "object") return NO_FILTER;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return {
      query: typeof saved.query === "string" ? saved.query : "",
      labels: strings(saved.labels),
      priorities: strings(saved.priorities),
      due: DUE_FILTERS.includes(saved.due) ? saved.due : "",
    };
  } catch {
    return NO_FILTER;
  }
}

export function saveFilter(boardId: string, filter: BoardFilter) {
  localSet(key(boardId), JSON.stringify(filter));
}
