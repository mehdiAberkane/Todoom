import { describe, expect, it } from "vitest";
import type { Board, Card, HistoryEvent } from "../types";
import { boardMetrics, columnAverages, combined, mean, median, oldest } from "./metrics";

const board = {
  id: "b",
  name: "Todoom",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
    { id: "done", name: "Terminé" },
  ],
} as unknown as Board;

const by = { host: "PC" };
const H = 3_600_000;
const card = (id: string, columnId: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: "b", columnId, createdAt: "2026-11-16T08:00:00.000Z", archivedAt: null, due: null, ...extra }) as Card;

// a: done after 2 h of work; b: done after 4 h, then archived; c: in progress since 10:00; d: waiting, overdue.
const history: Record<string, HistoryEvent[]> = {
  a: [
    { at: "2026-11-16T08:00:00.000Z", by, field: "created", to: "À faire" },
    { at: "2026-11-16T09:00:00.000Z", by, field: "column", from: "À faire", to: "En cours" },
    { at: "2026-11-16T11:00:00.000Z", by, field: "column", from: "En cours", to: "Terminé" },
  ],
  b: [
    { at: "2026-11-16T08:00:00.000Z", by, field: "created", to: "En cours" },
    { at: "2026-11-16T12:00:00.000Z", by, field: "column", from: "En cours", to: "Terminé" },
  ],
  c: [
    { at: "2026-11-16T08:00:00.000Z", by, field: "created", to: "À faire" },
    { at: "2026-11-16T10:00:00.000Z", by, field: "column", from: "À faire", to: "En cours" },
  ],
  d: [{ at: "2026-11-16T08:00:00.000Z", by, field: "created", to: "À faire" }],
};
const cards = [
  card("a", "done"),
  card("b", "done", { archivedAt: "2026-11-16T13:00:00.000Z" }),
  card("c", "doing"),
  card("d", "todo", { due: "2026-11-17" }),
];
const now = new Date("2026-11-18T10:00:00.000Z");
const m = boardMetrics(board, cards, (id) => history[id] ?? [], now);

describe("board metrics", () => {
  it("counts cards per column, open and overdue ones", () => {
    expect(m.byColumn.map((c) => c.count)).toEqual([1, 1, 1]); // the archived card isn't on the board
    expect(m.open).toBe(2);
    expect(m.overdue).toBe(1);
  });

  it("measures the time from start to finish, archived cards included", () => {
    expect([...m.cycleTimes].sort((x, y) => x - y)).toEqual([2 * H, 4 * H]);
    expect(mean(m.cycleTimes)).toBe(3 * H);
    expect(m.weekly[m.weekly.length - 1].count).toBe(2);
  });

  it("averages the time spent in each column, leaving « done » out", () => {
    const avg = columnAverages(board, m.columnTime);
    expect(avg.map((a) => a.column)).toEqual(["À faire", "En cours"]);
    // À faire: a 1 h, c 2 h, d 50 h (still there) → 3 cards.
    expect(avg[0]).toMatchObject({ cards: 3, ms: (1 + 2 + 50) * H / 3 });
    // En cours: a 2 h, b 4 h, c 48 h (still there).
    expect(avg[1]).toMatchObject({ cards: 3, ms: (2 + 4 + 48) * H / 3 });
  });

  it("lists the open cards waiting longest first", () => {
    expect(oldest(m.openCards).map((o) => o.card.id)).toEqual(["d", "c"]);
  });
});

describe("all boards together", () => {
  it("adds the figures up week by week", () => {
    const other = boardMetrics({ ...board, id: "o" } as Board, [card("x", "todo", { boardId: "o" })], () => [], now);
    const sum = combined([m, other]);
    expect(sum.open).toBe(3);
    expect(sum.weekly).toEqual(m.weekly);
    expect(sum.cycleTimes).toHaveLength(2);
  });

  it("median and mean of nothing are unknown", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});
