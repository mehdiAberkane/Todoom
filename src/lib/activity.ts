// Comments and history of a card, kept out of its description.
//
// A comment is a file of its own: boards/<board>/comments/<card>/<id>.json.
// History is one file per card and per writer, boards/<board>/history/<card>/<writer>.json,
// where the writer is a computer's name (the app), "<name>-cli" (the todoom
// command) or "<name>-agent". Each file has a single writer, so two computers
// never write the same file and Drive has no conflict to settle.

import type { Author, Board, Card, CardComment, HistoryEvent } from "../types";
import { priorityOf } from "./priority";

/** File-safe name of a writer of history files. */
export const writerName = (host: string, suffix?: string) =>
  (host.replace(/[^\w-]/g, "_") || "unknown") + (suffix ? `-${suffix}` : "");

export const commentsDir = (boardId: string, cardId: string) => `boards/${boardId}/comments/${cardId}`;
export const historyDir = (boardId: string, cardId: string) => `boards/${boardId}/history/${cardId}`;
export const commentPath = (c: Pick<CardComment, "id" | "cardId">, boardId: string) => `${commentsDir(boardId, c.cardId)}/${c.id}.json`;
export const historyPath = (boardId: string, cardId: string, writer: string) => `${historyDir(boardId, cardId)}/${writer}.json`;

export type Change = Pick<HistoryEvent, "field" | "from" | "to">;

const columnName = (board: Board, id: string) => board.columns.find((c) => c.id === id)?.name ?? null;
const labelNames = (board: Board, ids: string[]) =>
  ids.map((id) => board.labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ") || null;

/**
 * What changed between two versions of a card, worth a line in its history.
 * Values are kept as names at the time of the change, so the history stays
 * readable after a column or a label is renamed or deleted. Position, number,
 * links and checklist ticks are left out.
 */
export function changesBetween(prev: Card | undefined, next: Card, board: Board): Change[] {
  if (!prev) return [{ field: "created", to: columnName(board, next.columnId) }];
  const out: Change[] = [];
  if (prev.columnId !== next.columnId) out.push({ field: "column", from: columnName(board, prev.columnId), to: columnName(board, next.columnId) });
  if (prev.title !== next.title) out.push({ field: "title", from: prev.title, to: next.title });
  if (prev.priority !== next.priority)
    out.push({ field: "priority", from: priorityOf(board, prev)?.name ?? null, to: priorityOf(board, next)?.name ?? null });
  if ([...prev.labels].sort().join() !== [...next.labels].sort().join())
    out.push({ field: "labels", from: labelNames(board, prev.labels), to: labelNames(board, next.labels) });
  if (prev.due !== next.due) out.push({ field: "due", from: prev.due, to: next.due });
  if (prev.description !== next.description) out.push({ field: "description" });
  if (!prev.archivedAt !== !next.archivedAt) out.push({ field: "archived", to: next.archivedAt ? "archived" : null });
  return out;
}

export const eventsFor = (changes: Change[], by: Author, at = new Date().toISOString()): HistoryEvent[] =>
  changes.map((c) => ({ at, by, ...c }));

/** All the history of a card, from every writer, oldest first. */
export function mergedHistory(byWriter: Record<string, HistoryEvent[]> | undefined): HistoryEvent[] {
  return Object.values(byWriter ?? {})
    .flat()
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Who wrote something, for display: "PC-Main", "PC-Main · Claude". */
export const authorLabel = (a: Author) => [a.host, a.agent].filter(Boolean).join(" · ");
