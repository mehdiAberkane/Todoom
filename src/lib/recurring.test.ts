import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { nextDue, pendingRepeats, successorId, successorOf } from "./recurring";

const board = {
  id: "b",
  name: "Maison",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "done", name: "Terminé" },
  ],
  labels: [],
} as unknown as Board;
const card = (extra: Partial<Card> = {}) =>
  ({
    id: "c1",
    number: 7,
    boardId: "b",
    columnId: "done",
    order: 3,
    title: "Sortir les poubelles",
    description: "Le jaune aussi",
    labels: ["l"],
    priority: "p1",
    due: "2026-11-17",
    checklist: [{ id: "i", text: "Verre", done: true, cardId: "x" }],
    links: [{ type: "relatesTo", cardId: "z" }],
    branch: "feat/x",
    mergeRequest: null,
    claimedBy: { host: "PC", at: "" },
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    repeat: { every: "week" },
    color: "#3a86ff",
    ...extra,
  }) as Card;

describe("next due date", () => {
  it("comes one period after the last one", () => {
    expect(nextDue("2026-11-21", { every: "day" }, "2026-11-20")).toBe("2026-11-22");
    expect(nextDue("2026-11-23", { every: "week" }, "2026-11-21")).toBe("2026-11-30");
    expect(nextDue("2026-11-15", { every: "month" }, "2026-11-15")).toBe("2026-12-15");
  });

  it("skips the dates already past", () => {
    // Weekly on Tuesdays, done on Saturday 21: next Tuesday, the 24th.
    expect(nextDue("2026-11-10", { every: "week" }, "2026-11-21")).toBe("2026-11-24");
    expect(nextDue("2026-11-01", { every: "day" }, "2026-11-21")).toBe("2026-11-22");
  });

  it("keeps a month's day, or takes the month's last day", () => {
    expect(nextDue("2026-01-31", { every: "month" }, "2026-01-31")).toBe("2026-02-28");
    expect(nextDue("2026-01-31", { every: "month" }, "2026-02-28")).toBe("2026-03-31");
  });

  it("starts from today without a due date", () => {
    expect(nextDue(null, { every: "week" }, "2026-11-21")).toBe("2026-11-28");
  });
});

describe("the next card", () => {
  it("is waited for when a repeating card is in a done column, not archived", () => {
    const cards = { b: [card(), card({ id: "c2", columnId: "todo" }), card({ id: "c3", archivedAt: "x" }), card({ id: "c4", repeat: null })] };
    expect(pendingRepeats([board], cards).map((p) => p.card.id)).toEqual(["c1"]);
  });

  it("copies the routine, unticked, in the first column, due one period later", () => {
    const next = successorOf(card(), board, "2026-11-21", 5, "2026-11-21T09:00:00.000Z");
    expect(next).toMatchObject({
      id: "c1r20261124",
      columnId: "todo",
      order: 5,
      due: "2026-11-24",
      title: "Sortir les poubelles",
      description: "Le jaune aussi",
      labels: ["l"],
      priority: "p1",
      color: "#3a86ff",
      repeat: { every: "week" },
      links: [],
      branch: null,
      claimedBy: null,
      createdAt: "2026-11-21T09:00:00.000Z",
    });
    expect("number" in next).toBe(false);
    expect(next.checklist).toHaveLength(1);
    expect(next.checklist[0]).toMatchObject({ text: "Verre", done: false });
    expect(next.checklist[0].id).not.toBe("i");
    expect("cardId" in next.checklist[0]).toBe(false);
  });

  it("gets the same id on every computer", () => {
    expect(successorOf(card(), board, "2026-11-21", 0).id).toBe(successorId(card(), "2026-11-24"));
  });
});
