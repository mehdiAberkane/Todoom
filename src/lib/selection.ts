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

/**
 * Selected cards dragged together: in the drop column, the dragged card's
 * place takes all of them, in their board order; they leave the others.
 * `lists` are the columns as the drag left them (the dragged card in place).
 */
export function dropTogether(lists: Record<string, string[]>, moving: string[], draggedId: string, targetColumn: string): Record<string, string[]> {
  const group = new Set(moving);
  const out: Record<string, string[]> = {};
  for (const [column, ids] of Object.entries(lists)) {
    if (column !== targetColumn) {
      out[column] = ids.filter((id) => !group.has(id));
      continue;
    }
    out[column] = ids.flatMap((id) => (id === draggedId ? moving : group.has(id) ? [] : [id]));
  }
  return out;
}

/**
 * Positions for a block of cards put together in a column: between the card
 * before the block and the card after, so only the block is rewritten. When
 * there is no room left between them, the whole column is numbered again.
 */
export function blockOrders(list: string[], block: string[], orderOf: (id: string) => number | undefined): [string, number][] {
  const inBlock = new Set(block);
  const first = list.findIndex((id) => inBlock.has(id));
  if (first < 0) return [];
  const count = block.length;
  const before = first > 0 ? orderOf(list[first - 1]) : undefined;
  const after = first + count < list.length ? orderOf(list[first + count]) : undefined;
  const ids = list.slice(first, first + count);
  const numberAll = () => list.flatMap((id, i): [string, number][] => (inBlock.has(id) || orderOf(id) !== i ? [[id, i]] : []));
  if ((first > 0 && before === undefined) || (first + count < list.length && after === undefined)) return numberAll();
  if (before === undefined && after === undefined) return ids.map((id, i) => [id, i]);
  if (before === undefined) return ids.map((id, i) => [id, after! - count + i]);
  if (after === undefined) return ids.map((id, i) => [id, before + 1 + i]);
  const step = (after - before) / (count + 1);
  if (!(step > 1e-6)) return numberAll();
  return ids.map((id, i) => [id, before + step * (i + 1)]);
}
