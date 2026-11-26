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
import { cardProblem } from "./validate";

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

/** How many days before its due date the next card of a routine comes on the board. */
export const WAKE_LEAD_DAYS: Record<Repeat["every"], number> = { day: 0, week: 1, month: 7 };

/**
 * The day the next card comes on the board (TOD-82): a few days before it is due,
 * not as soon as the last one is done; null when that day is already here.
 */
export function wakeOnFor(due: string, every: Repeat["every"], today: string): string | null {
  const [y, m, d] = parse(due);
  const wake = toISODate(new Date(y, m - 1, d - WAKE_LEAD_DAYS[every]));
  return wake > today ? wake : null;
}

/** A card still waiting off the board until its wakeOn day: the next card of a routine. */
export const isAsleep = (card: Pick<Card, "wakeOn">, today: string) => !!card.wakeOn && card.wakeOn > today;

/** Repeating cards that reached a « done » column and have no next one yet. Archiving one stops it. */
export function pendingRepeats(boards: Board[], cards: Record<string, Card[]>): { card: Card; board: Board }[] {
  const out: { card: Card; board: Board }[] = [];
  for (const board of boards) {
    const done = new Set(board.columns.filter((c) => isDoneName(c.name)).map((c) => c.id));
    for (const card of cards[board.id] ?? []) if (card.repeat && !card.archivedAt && done.has(card.columnId)) out.push({ card, board });
  }
  return out;
}

/** What a routine's card ids end with: « r » and a due date, then « -2 »… when that date was taken. */
const DATE_SUFFIX = /(?:r\d{8}(?:-\d+)?)+$/;
/** Room left for the routine's base id under the 128 characters of an id: « r20261222-99 ». */
const BASE_MAX = 128 - 12;

/**
 * The id of the card following `card` on `due`: the same on every computer, so two of
 * them write the same file. The routine's first id with this due date, not the
 * previous id grown by one more date: it would pass the 128 characters an id may have
 * after a dozen times, and the routine would be lost (TOD-83). `n` > 1 when that date's
 * id is already an old card of the routine (its due date was moved back by hand).
 */
export const successorId = (card: Pick<Card, "id">, due: string, n = 1) =>
  `${card.id.replace(DATE_SUFFIX, "").slice(0, BASE_MAX) || "r"}r${due.replace(/-/g, "")}${n > 1 ? `-${n}` : ""}`;

/**
 * The next card of a routine, and whether to write it. Its id taken by a card on the
 * board: another computer made it already, only the repetition is to move. Taken by
 * an archived card: an older one of the routine on the same date, so the next free
 * « -2 », « -3 »… (the same on every computer). Never one that isn't a valid card.
 */
export function nextOfRoutine(card: Card, board: Board, today: string, order: number, existing: Card[], at?: string): { next: Card; made: boolean } | null {
  const first = successorOf(card, board, today, order, at);
  for (let n = 1; n <= 99; n++) {
    const next = n === 1 ? first : { ...first, id: successorId(card, first.due!, n) };
    const taken = existing.find((c) => c.id === next.id);
    if (!taken) return cardProblem(next) ? null : { next, made: true };
    if (!taken.archivedAt) return { next: taken, made: false };
  }
  return null;
}

/**
 * The next card of a routine: same title, description, labels, priority, color
 * and checklist (unticked), in the board's first column, due one period later;
 * the repetition goes with it. Not its links, branch, merge request or taker.
 * It waits off the board until a few days before it is due (wakeOn).
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
    wakeOn: wakeOnFor(due, card.repeat!.every, today),
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
