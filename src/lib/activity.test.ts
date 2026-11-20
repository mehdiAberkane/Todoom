import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { changesBetween, mergedHistory, writerName } from "./activity";
import { commentProblem, historyProblem } from "./validate";

const board: Board = {
  id: "b1",
  name: "Todoom",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
  ],
  labels: [{ id: "l1", name: "Bug", color: "#f00" }],
  createdAt: "",
  updatedAt: "",
};

const card: Card = {
  id: "c1",
  boardId: "b1",
  columnId: "todo",
  order: 0,
  title: "Un",
  description: "",
  labels: [],
  priority: null,
  due: null,
  checklist: [],
  links: [],
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
};

describe("history", () => {
  it("records a creation and the changes worth a line, with names", () => {
    expect(changesBetween(undefined, card, board)).toEqual([{ field: "created", to: "À faire" }]);
    const next = { ...card, columnId: "doing", title: "Deux", priority: "p1", labels: ["l1"], due: "2026-12-01", description: "x" };
    expect(changesBetween(card, next, board)).toEqual([
      { field: "column", from: "À faire", to: "En cours" },
      { field: "title", from: "Un", to: "Deux" },
      { field: "priority", from: null, to: "P1" },
      { field: "labels", from: null, to: "Bug" },
      { field: "due", from: null, to: "2026-12-01" },
      { field: "description" },
    ]);
    expect(changesBetween(card, { ...card, archivedAt: "2026-01-01" }, board)).toEqual([{ field: "archived", to: "archived" }]);
  });

  it("ignores position, number, links and checklist", () => {
    const moved = { ...card, order: 5, number: 3, links: [{ type: "relatesTo" as const, cardId: "x" }], checklist: [{ id: "i", text: "t", done: true }] };
    expect(changesBetween(card, moved, board)).toEqual([]);
  });

  it("merges every writer, oldest first, and names writers safely", () => {
    const by = { host: "PC" };
    const merged = mergedHistory({
      PC: [{ at: "2026-01-02", by, field: "title" }],
      "PC-cli": [{ at: "2026-01-01", by, field: "created" }],
    });
    expect(merged.map((e) => e.field)).toEqual(["created", "title"]);
    expect(writerName("Mon PC.local", "cli")).toBe("Mon_PC_local-cli");
  });

  it("checks the files when they are read", () => {
    const comment = { id: "k", cardId: "c1", createdAt: "2026-01-01", author: { host: "PC" }, text: "ok" };
    expect(commentProblem(comment)).toBeNull();
    expect(commentProblem({ ...comment, author: "PC" })).toEqual({ code: "bad_field", field: "author" });
    expect(historyProblem({ cardId: "c1", writer: "PC", events: [{ at: "x", by: { host: "PC" }, field: "title" }] })).toBeNull();
    expect(historyProblem({ cardId: "c1", writer: "PC", events: [{ at: "x", field: "title" }] })).toEqual({ code: "bad_field", field: "events" });
  });
});
