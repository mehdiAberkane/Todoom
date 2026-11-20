import { afterEach, describe, expect, it, vi } from "vitest";
import { dueStatus, orderBetween, reorder } from "./utils";

describe("orderBetween", () => {
  it("places an item before, after or between its neighbours", () => {
    expect(orderBetween(undefined, undefined)).toBe(0);
    expect(orderBetween(undefined, 3)).toBe(2);
    expect(orderBetween(3, undefined)).toBe(4);
    expect(orderBetween(1, 2)).toBe(1.5);
  });

  it("asks for a renumbering when neighbours are too close or out of order", () => {
    expect(orderBetween(1, 1)).toBeNull();
    expect(orderBetween(1, 1 + Number.EPSILON)).toBeNull();
    expect(orderBetween(2, 1)).toBeNull();
  });
});

describe("reorder after a drag and drop", () => {
  const positions = (orders: Record<string, number | undefined>) => (id: string) => orders[id];

  it("only moves the dropped item when there is room", () => {
    // c dropped between a and b
    expect(reorder(["a", "c", "b"], "c", positions({ a: 0, b: 1, c: 2 }))).toEqual([["c", 0.5]]);
    // dropped first or last
    expect(reorder(["c", "a", "b"], "c", positions({ a: 0, b: 1, c: 2 }))).toEqual([["c", -1]]);
    expect(reorder(["a", "b", "c"], "c", positions({ a: 0, b: 1, c: -5 }))).toEqual([["c", 2]]);
  });

  it("renumbers when the neighbours have no room left, writing only what changes", () => {
    expect(reorder(["a", "c", "b"], "c", positions({ a: 1, b: 1, c: 7 }))).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
    expect(reorder(["a", "c", "b"], "c", positions({ a: 0, b: 0, c: 1 }))).toEqual([["b", 2]]);
  });

  it("renumbers boards saved before positions existed", () => {
    expect(reorder(["b", "a"], "b", positions({ a: undefined, b: undefined }))).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("ignores an item that isn't in the list", () => {
    expect(reorder(["a"], "z", positions({ a: 0 }))).toEqual([]);
  });
});

describe("dueStatus", () => {
  afterEach(() => vi.useRealTimers());

  it("classifies a due date against today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 15, 0));
    expect(dueStatus(null)).toBeNull();
    expect(dueStatus("2026-11-19")).toBe("overdue");
    expect(dueStatus("2026-11-20")).toBe("today");
    expect(dueStatus("2026-11-23")).toBe("soon");
    expect(dueStatus("2026-11-24")).toBe("later");
  });
});
