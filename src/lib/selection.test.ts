import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { movedTogether, toggled, withRange } from "./selection";

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
