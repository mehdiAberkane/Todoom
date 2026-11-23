// Priority levels: per board, highest first. A board that never changed them
// uses P1, P2, P3; their ids are fixed so every machine and script agrees
// without the board file being rewritten.

import type { Board, Card, Priority } from "../types";

export const DEFAULT_PRIORITIES: Priority[] = [
  { id: "p1", name: "P1", color: "#ff4d2e" },
  { id: "p2", name: "P2", color: "#ff9f1c" },
  { id: "p3", name: "P3", color: "#3ddc84" },
];

export const prioritiesOf = (board: Pick<Board, "priorities">): Priority[] => board.priorities ?? DEFAULT_PRIORITIES;

/** The card's level, or undefined when it has none or its level was deleted. */
export const priorityOf = (board: Pick<Board, "priorities">, card: Pick<Card, "priority">): Priority | undefined =>
  card.priority ? prioritiesOf(board).find((p) => p.id === card.priority) : undefined;

/**
 * The color of a card's band: its own, else its priority's (unless the board
 * turned that off), else none.
 */
export function cardColor(board: Pick<Board, "priorities" | "colorByPriority">, card: Pick<Card, "color" | "priority">): string | null {
  if (card.color) return card.color;
  if (board.colorByPriority === false) return null;
  return priorityOf(board, card)?.color ?? null;
}

/** Highest priority first, cards without one last; same level keeps the current order. */
export function byPriority<T extends Pick<Card, "priority" | "order">>(board: Pick<Board, "priorities">, cards: T[]): T[] {
  const levels = prioritiesOf(board);
  const rank = (c: T) => {
    const i = levels.findIndex((p) => p.id === c.priority);
    return i < 0 ? levels.length : i;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.order - b.order);
}
