// Sorting a column, filtering by due date, and the filter each board remembers.

import type { Board, Card, Column } from "../types";
import { isDoneName } from "./links";
import { prioritiesOf } from "./priority";
import { addDays, localGet, localSet, toISODate } from "./utils";

export type SortKey = "priority" | "due" | "created" | "updated";
export const SORT_KEYS: SortKey[] = ["priority", "due", "created", "updated"];

/** How a column orders its cards: by hand, or kept sorted. */
export type ColumnSort = "manual" | SortKey;
export const COLUMN_SORTS: ColumnSort[] = ["manual", ...SORT_KEYS];

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
/** Columns where cards wait for the user's review: taken in the order they arrived. */
const REVIEW_NAMES = ["a verifier", "a valider", "to review", "review", "in review"];
/** « A verifier » and its other names: work done, waiting for the user's review. */
export const isReviewName = (name: string) => REVIEW_NAMES.includes(plain(name));

/**
 * The sort of a column: its own choice, else one fitting its name. « Terminé »:
 * latest change first. « A verifier »: by hand (a card arriving goes at the
 * bottom, so the oldest is first). Any other (« À faire », « En cours »…):
 * highest priority first.
 */
export function columnSort(column: Pick<Column, "name" | "sort">): ColumnSort {
  if (column.sort && (COLUMN_SORTS as string[]).includes(column.sort)) return column.sort as ColumnSort;
  if (isDoneName(column.name)) return "updated";
  if (REVIEW_NAMES.includes(plain(column.name))) return "manual";
  return "priority";
}

type Sortable = Pick<Card, "priority" | "due" | "createdAt" | "updatedAt" | "order">;

/**
 * How two cards of a column compare under its sort, their order aside (0: a tie,
 * which their order settles, and which a drag inside the column may change).
 * When kept sorted, a late card comes first, except in a « done » column.
 */
export function columnCompare(column: Pick<Column, "name" | "sort">, board: Pick<Board, "priorities">, today = toISODate(new Date())): (a: Sortable, b: Sortable) => number {
  const sort = columnSort(column);
  if (sort === "manual") return () => 0;
  const levels = prioritiesOf(board);
  const rank = (c: Sortable) => {
    const i = levels.findIndex((p) => p.id === c.priority);
    return i < 0 ? levels.length : i;
  };
  const byDue = (a: Sortable, b: Sortable) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  const late = (c: Sortable) => (c.due && c.due < today ? 0 : 1);
  const lateFirst = isDoneName(column.name) ? () => 0 : (a: Sortable, b: Sortable) => late(a) - late(b);
  const key: Record<SortKey, (a: Sortable, b: Sortable) => number> = {
    priority: (a, b) => rank(a) - rank(b) || byDue(a, b),
    due: (a, b) => byDue(a, b) || rank(a) - rank(b),
    created: (a, b) => a.createdAt.localeCompare(b.createdAt),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  };
  return (a, b) => lateFirst(a, b) || key[sort](a, b);
}

/** A column's cards in the order it shows them (and agents take them): its sort, then their order. */
export function orderColumn<T extends Sortable>(cards: T[], column: Pick<Column, "name" | "sort">, board: Pick<Board, "priorities">, today?: string): T[] {
  const compare = columnCompare(column, board, today);
  return [...cards].sort((a, b) => compare(a, b) || a.order - b.order);
}

/**
 * The cards a drag inside a kept-sorted column can reorder: those tied with
 * `moved` (same priority and due date…), in the order of `ids` (the list after
 * the drop). The others keep the place their sort gives them.
 */
export function tiedWith<T extends Sortable>(ids: string[], moved: string, cardOf: (id: string) => T | undefined, column: Pick<Column, "name" | "sort">, board: Pick<Board, "priorities">, today?: string): string[] {
  const compare = columnCompare(column, board, today);
  const card = cardOf(moved);
  if (!card) return ids;
  return ids.filter((id) => {
    const other = id === moved ? card : cardOf(id);
    return !!other && compare(card, other) === 0;
  });
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
