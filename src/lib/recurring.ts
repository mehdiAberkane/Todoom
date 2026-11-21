// Recurring cards, for routines: when a card that repeats reaches a « done »
// column, the next one is made, due one period later, and the repetition moves
// to it. Every computer runs this when it reads the folder (so cards finished
// from the CLI, an agent or another computer count too); the next card's id
// comes from the finished one and its due date, so two computers doing it at
// once write the same file instead of two cards.
import type { Board, Card } from "../types";
import { uid } from "./ids";
import { isDoneName } from "./links";
import { toISODate } from "./utils";

export type Repeat = NonNullable<Card["repeat"]>;
export const REPEATS: Repeat["every"][] = ["day", "week", "month"];

const parse = (date: string) => date.split("-").map(Number) as [number, number, number];

/** `anchor` moved `k` periods forward; a month keeps the anchor's day, or the month's last day. */
function step(anchor: string, every: Repeat["every"], k: number): string {
  const [y, m, d] = parse(anchor);
  if (every === "day") return toISODate(new Date(y, m - 1, d + k));
  if (every === "week") return toISODate(new Date(y, m - 1, d + 7 * k));
  const last = new Date(y, m - 1 + k + 1, 0).getDate();
  return toISODate(new Date(y, m - 1 + k, Math.min(d, last)));
}

/**
 * The next due date: one period after the last one, skipping the dates already
 * past (a weekly card done late comes back next week, not for the missed ones).
 * Without a due date, one period after today.
 */
export function nextDue(due: string | null, repeat: Repeat, today: string): string {
  const anchor = due ?? today;
  for (let k = 1; ; k++) {
    const next = step(anchor, repeat.every, k);
    if (next > today) return next;
  }
}

/** Repeating cards that reached a « done » column and have no next one yet. Archiving one stops it. */
export function pendingRepeats(boards: Board[], cards: Record<string, Card[]>): { card: Card; board: Board }[] {
  const out: { card: Card; board: Board }[] = [];
  for (const board of boards) {
    const done = new Set(board.columns.filter((c) => isDoneName(c.name)).map((c) => c.id));
    for (const card of cards[board.id] ?? []) if (card.repeat && !card.archivedAt && done.has(card.columnId)) out.push({ card, board });
  }
  return out;
}

/** The id of the card following `card` on `due`: the same on every computer. */
export const successorId = (card: Card, due: string) => `${card.id}r${due.replace(/-/g, "")}`;

/**
 * The next card of a routine: same title, description, labels, priority, color
 * and checklist (unticked), in the board's first column, due one period later;
 * the repetition goes with it. Not its links, branch, merge request or taker.
 */
export function successorOf(card: Card, board: Board, today: string, order: number, at = new Date().toISOString()): Card {
  const due = nextDue(card.due, card.repeat!, today);
  const { number: _number, ...rest } = card;
  return {
    ...rest,
    id: successorId(card, due),
    columnId: board.columns[0]?.id ?? card.columnId,
    order,
    due,
    checklist: card.checklist.map(({ cardId: _linked, ...item }) => ({ ...item, id: uid(), done: false })),
    links: [],
    branch: null,
    mergeRequest: null,
    claimedBy: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}
