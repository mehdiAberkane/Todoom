// Several cards selected on a board (Ctrl + click, Shift + click), and the
// changes applied to all of them at once.

import type { Card } from "../types";

/** Ctrl + click: adds the card, or takes it out. */
export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Shift + click: every card between the last one clicked and this one, in the
 * board's order (column by column, top to bottom), added to the selection.
 */
export function withRange(selected: ReadonlySet<string>, order: string[], anchor: string | null, id: string): Set<string> {
  const next = new Set(selected);
  const from = anchor ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  if (from < 0 || to < 0) return next.add(id);
  const [a, b] = from < to ? [from, to] : [to, from];
  for (const x of order.slice(a, b + 1)) next.add(x);
  return next;
}

/**
 * New column and positions for cards moved together: at the bottom of the
 * column, after `start`, keeping the order they had on the board.
 */
export function movedTogether(cards: Card[], boardOrder: string[], columnId: string, start: number): Card[] {
  const rank = (c: Card) => boardOrder.indexOf(c.id);
  return [...cards].sort((a, b) => rank(a) - rank(b)).map((c, i) => ({ ...c, columnId, order: start + i }));
}
