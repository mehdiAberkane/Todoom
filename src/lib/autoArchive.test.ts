import { describe, expect, it } from "vitest";
import type { Board, Card, HistoryEvent } from "../types";
import { dueForArchive, enteredAt } from "./autoArchive";

const board = {
  id: "b",
  name: "Todoom",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "done", name: "Terminé", archiveAfter: 7 },
  ],
  labels: [],
} as unknown as Board;
const by = { host: "PC" };
const card = (id: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: "b", columnId: "done", archivedAt: null, claimedBy: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z", ...extra }) as Card;

const history: Record<string, HistoryEvent[]> = {
  old: [
    { at: "2026-11-01T08:00:00.000Z", by, field: "created", to: "À faire" },
    { at: "2026-11-10T08:00:00.000Z", by, field: "column", from: "À faire", to: "Terminé" },
  ],
  recent: [
    { at: "2026-11-01T08:00:00.000Z", by, field: "created", to: "À faire" },
    { at: "2026-11-20T08:00:00.000Z", by, field: "column", from: "À faire", to: "Terminé" },
  ],
};
const historyOf = (id: string) => history[id] ?? [];
const now = Date.parse("2026-11-22T09:00:00.000Z");

describe("automatic archiving", () => {
  it("knows when a card entered its column, or falls back on its last change", () => {
    expect(enteredAt(card("old"), board, history.old)).toBe("2026-11-10T08:00:00.000Z");
    expect(enteredAt(card("nohistory"), board, [])).toBe("2026-11-20T08:00:00.000Z");
  });

  it("starts over for a card restored from the archives", () => {
    const restored: HistoryEvent[] = [
      ...history.old,
      { at: "2026-11-18T08:00:00.000Z", by, field: "archived", to: "archived" },
      { at: "2026-11-21T08:00:00.000Z", by, field: "archived", to: null },
    ];
    expect(enteredAt(card("old"), board, restored)).toBe("2026-11-21T08:00:00.000Z");
    expect(dueForArchive(board, [card("old")], () => restored, now)).toEqual([]);
  });

  it("archives the cards past the column's delay", () => {
    const cards = [
      card("old"),
      card("recent"),
      card("nohistory"), // last changed 2 days ago: kept
      card("stale", { updatedAt: "2026-11-02T08:00:00.000Z" }),
      card("todo", { columnId: "todo", updatedAt: "2026-01-01T00:00:00.000Z" }),
      card("archived", { archivedAt: "2026-11-15T00:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z" }),
      card("taken", { claimedBy: { host: "PC", at: "" }, updatedAt: "2026-11-02T08:00:00.000Z" }),
      card("routine", { repeat: { every: "week" }, updatedAt: "2026-11-02T08:00:00.000Z" }),
    ];
    expect(dueForArchive(board, cards, historyOf, now).map((c) => c.id)).toEqual(["old", "stale"]);
  });

  it("does nothing on a board without a delay", () => {
    const plain = { ...board, columns: board.columns.map(({ archiveAfter: _a, ...c }) => c) } as Board;
    expect(dueForArchive(plain, [card("old")], historyOf, now)).toEqual([]);
  });
});
