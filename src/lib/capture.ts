// Quick capture: an idea noted from anywhere becomes a card at the top of the
// first column of a chosen board (the settings say which; else one named
// « Global »; else the first board).
import type { Board } from "../types";

/** Events between the capture window and the main one. */
export const CAPTURE_HELLO = "todoom://capture-hello";
export const CAPTURE_BOARDS = "todoom://capture-boards";
export const CAPTURE_SEND = "todoom://capture";

export interface CaptureTarget {
  boards: { id: string; name: string }[];
  boardId: string | null;
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** The board ideas go to. */
export function captureBoard(boards: Board[], chosen: string | undefined): Board | undefined {
  const live = boards.filter((b) => !b.archivedAt && b.columns.length);
  return live.find((b) => b.id === chosen) ?? live.find((b) => plain(b.name) === "global") ?? live[0];
}

/** The title of a noted idea: one line, trimmed; null when there is nothing to note. */
export function captureTitle(text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 500) : null;
}

/** The order that puts a card above the others of a column. */
export const topOrder = (orders: number[]) => (orders.length ? Math.min(...orders) - 1 : 0);
