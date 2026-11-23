import { describe, expect, it } from "vitest";
import { byPriority, cardColor, DEFAULT_PRIORITIES, prioritiesOf, priorityOf } from "./priority";
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

describe("the color of a card", () => {
  it("is its own, else its priority's: P1 red, P2 orange, P3 green", () => {
    expect(cardColor({}, { color: null, priority: "p1" })).toBe("#ff4d2e");
    expect(cardColor({}, { color: null, priority: "p2" })).toBe("#ff9f1c");
    expect(cardColor({}, { color: null, priority: "p3" })).toBe("#3ddc84");
    expect(cardColor({}, { color: "#3a86ff", priority: "p1" })).toBe("#3a86ff");
    expect(cardColor({}, { color: null, priority: null })).toBeNull();
    expect(cardColor(custom, { priority: "lo" })).toBe("#0f0");
    expect(cardColor(custom, { priority: "p1" })).toBeNull();
  });

  it("is only its own once the board turned the priority colors off", () => {
    expect(cardColor({ colorByPriority: false }, { color: null, priority: "p1" })).toBeNull();
    expect(cardColor({ colorByPriority: false }, { color: "#3a86ff", priority: "p1" })).toBe("#3a86ff");
  });

  it("accepts the setting in a board file, and nothing else than true or false", () => {
    const board = { id: "b", name: "B", columns: [], labels: [] };
    expect(boardProblem({ ...board, colorByPriority: false })).toBeNull();
    expect(boardProblem({ ...board, colorByPriority: "no" })).not.toBeNull();
  });
});
