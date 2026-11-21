import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { blockOrders, dropTogether, movedTogether, toggled, withRange } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("selecting several cards", () => {
  it("adds or takes out a card with Ctrl + click", () => {
    expect([...toggled(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggled(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("selects a range with Shift + click, either way, keeping what was selected", () => {
    expect([...withRange(new Set(), order, "b", "d")].sort()).toEqual(["b", "c", "d"]);
    expect([...withRange(new Set(["a"]), order, "e", "c")].sort()).toEqual(["a", "c", "d", "e"]);
    expect([...withRange(new Set(), order, null, "c")]).toEqual(["c"]);
  });

  it("moves cards together to the bottom of a column, in their board order", () => {
    const cards = [{ id: "d", order: 9 }, { id: "a", order: 4 }] as Card[];
    expect(movedTogether(cards, order, "done", 7).map((c) => [c.id, c.columnId, c.order])).toEqual([
      ["a", "done", 7],
      ["d", "done", 8],
    ]);
  });
});

describe("dragging several cards", () => {
  const lists = { todo: ["a", "x", "b"], doing: ["c", "y"], done: ["d"] };

  it("puts the selected cards where the dragged one was dropped, in board order", () => {
    // x was dragged between c and y; a, b and d are selected with it.
    const dragged = { todo: ["a", "b"], doing: ["c", "x", "y"], done: ["d"] };
    expect(dropTogether(dragged, ["a", "x", "b", "d"], "x", "doing")).toEqual({ todo: [], doing: ["c", "a", "x", "b", "d", "y"], done: [] });
    expect(dropTogether(lists, ["a", "b"], "a", "todo")).toEqual({ todo: ["a", "b", "x"], doing: ["c", "y"], done: ["d"] });
  });

  it("gives the block positions between its neighbours, the rest untouched", () => {
    const orders: Record<string, number> = { c: 0, y: 4 };
    expect(blockOrders(["c", "a", "b", "y"], ["a", "b"], (id) => orders[id])).toEqual([["a", 4 / 3], ["b", 8 / 3]]);
    expect(blockOrders(["a", "b", "c"], ["a", "b"], (id) => orders[id])).toEqual([["a", -2], ["b", -1]]);
    expect(blockOrders(["c", "a", "b"], ["a", "b"], (id) => orders[id])).toEqual([["a", 1], ["b", 2]]);
    expect(blockOrders(["a", "b"], ["a", "b"], () => undefined)).toEqual([["a", 0], ["b", 1]]);
  });

  it("numbers the whole column again when there is no room left", () => {
    const tight: Record<string, number> = { c: 1, y: 1 + 1e-9 };
    expect(blockOrders(["c", "a", "y"], ["a"], (id) => tight[id])).toEqual([["c", 0], ["a", 1], ["y", 2]]);
  });
});
