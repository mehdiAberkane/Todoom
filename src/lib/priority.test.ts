import { describe, expect, it } from "vitest";
import { byPriority, DEFAULT_PRIORITIES, prioritiesOf, priorityOf } from "./priority";
import { cardProblem, boardProblem } from "./validate";

const custom = { priorities: [{ id: "hi", name: "Haute", color: "#f00" }, { id: "lo", name: "Basse", color: "#0f0" }] };

describe("priorities", () => {
  it("uses P1, P2, P3 on a board that never set its own", () => {
    expect(prioritiesOf({}).map((p) => p.name)).toEqual(["P1", "P2", "P3"]);
    expect(prioritiesOf(custom).map((p) => p.id)).toEqual(["hi", "lo"]);
  });

  it("treats a deleted level as no priority", () => {
    expect(priorityOf(custom, { priority: "p1" })).toBeUndefined();
    expect(priorityOf({}, { priority: "p2" })?.name).toBe("P2");
    expect(priorityOf({}, { priority: null })).toBeUndefined();
  });

  it("sorts highest first, none last, keeping the order within a level", () => {
    const cards = [
      { id: "a", priority: null, order: 0 },
      { id: "b", priority: "p3", order: 1 },
      { id: "c", priority: "p1", order: 2 },
      { id: "d", priority: "p3", order: 3 },
      { id: "e", priority: "gone", order: 4 },
      { id: "f", priority: "p1", order: 5 },
    ];
    expect(byPriority({}, cards).map((c) => c.id)).toEqual(["c", "f", "b", "d", "a", "e"]);
  });

  it("is checked when files are read", () => {
    expect(cardProblem({ id: "x", priority: "p1" })).toBeNull();
    expect(cardProblem({ id: "x", priority: 1 })).toEqual({ code: "bad_field", field: "priority" });
    expect(boardProblem({ id: "b", priorities: DEFAULT_PRIORITIES })).toBeNull();
    expect(boardProblem({ id: "b", priorities: [{ id: "p", name: "P" }] })).toEqual({ code: "bad_field", field: "priorities" });
  });
});
