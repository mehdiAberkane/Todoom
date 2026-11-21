import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { addMonths, agenda, byDay, dueCards, monthGrid, shift } from "./calendar";

const board = (id: string) =>
  ({ id, name: id, columns: [{ id: "todo", name: "À faire" }, { id: "done", name: "Terminé" }], labels: [] }) as unknown as Board;
const card = (id: string, boardId: string, due: string | null, extra: Partial<Card> = {}) =>
  ({ id, boardId, columnId: "todo", order: 0, due, archivedAt: null, ...extra }) as Card;

const boards = [board("a"), board("b")];
const cards = {
  a: [
    card("late", "a", "2026-11-18"),
    card("today", "a", "2026-11-21"),
    card("done", "a", "2026-11-19", { columnId: "done" }),
    card("archived", "a", "2026-11-20", { archivedAt: "2026-11-20T10:00:00Z" }),
    card("none", "a", null),
  ],
  b: [card("soon", "b", "2026-11-25"), card("far", "b", "2026-12-30"), card("today-b", "b", "2026-11-21")],
};

describe("due dates", () => {
  const list = dueCards(boards, cards);

  it("takes the open cards with a due date, from every board, earliest first", () => {
    expect(list.map((d) => d.card.id)).toEqual(["late", "today", "today-b", "soon", "far"]);
    expect(byDay(list).get("2026-11-21")?.map((d) => d.board.id)).toEqual(["a", "b"]);
  });

  it("lists what is late, due today and due this coming week", () => {
    const a = agenda(list, "2026-11-21");
    expect(a.overdue.map((d) => d.card.id)).toEqual(["late"]);
    expect(a.today.map((d) => d.card.id)).toEqual(["today", "today-b"]);
    expect(a.soon.map((d) => d.card.id)).toEqual(["soon"]);
  });
});

describe("month grid", () => {
  it("shows whole weeks, Monday first", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const weeks = monthGrid(2026, 10);
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks[0][6]).toBe("2026-11-01");
    expect(weeks[weeks.length - 1]).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("starts on the 1st when the month starts on a Monday", () => {
    expect(monthGrid(2026, 5)[0][0]).toBe("2026-06-01");
  });

  it("moves across months and years, and counts days across the end of a month", () => {
    expect(addMonths(2026, 11, 1)).toEqual([2027, 0]);
    expect(addMonths(2026, 0, -1)).toEqual([2025, 11]);
    expect(shift("2026-11-28", 7)).toBe("2026-12-05");
    expect(shift("2026-03-01", -1)).toBe("2026-02-28");
  });
});
