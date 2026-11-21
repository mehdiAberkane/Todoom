// Swimlanes: the board's cards grouped in rows by priority or by label.

import type { Board, Card } from "../types";
import { prioritiesOf } from "./priority";
import { localGet, localSet } from "./utils";

export type LaneMode = "" | "priority" | "label";

export interface Lane {
  /** A priority or label id, or "" for the cards without one. */
  id: string;
  name: string | null;
  color: string | null;
}

/** The lanes of a board, in its own order, then the one for cards without a priority or label. */
export function lanesOf(board: Board, mode: Exclude<LaneMode, "">): Lane[] {
  const items = mode === "priority" ? prioritiesOf(board) : board.labels;
  return [...items.map((i) => ({ id: i.id, name: i.name, color: i.color })), { id: "", name: null, color: null }];
}

/**
 * The lane of a card. By label, a card with several labels goes in the lane of
 * the first one in the board's order, so it shows once and counts once.
 */
export function laneOf(board: Board, card: Card, mode: Exclude<LaneMode, "">): string {
  if (mode === "priority") return prioritiesOf(board).some((p) => p.id === card.priority) ? card.priority! : "";
  return board.labels.find((l) => card.labels.includes(l.id))?.id ?? "";
}

/** Each board's lane mode, kept on this computer. */
export const loadLaneMode = (boardId: string): LaneMode => {
  const v = localGet(`todoom-lanes-${boardId}`);
  return v === "priority" || v === "label" ? v : "";
};
export const saveLaneMode = (boardId: string, mode: LaneMode) => localSet(`todoom-lanes-${boardId}`, mode);
