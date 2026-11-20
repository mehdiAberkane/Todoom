import { afterEach, describe, expect, it, vi } from "vitest";
import { dueStatus, nextUpdatedAt, orderBetween, reorder } from "./utils";

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

describe("nextUpdatedAt", () => {
  const at = (iso: string) => Date.parse(iso);

  it("uses the clock when it is ahead of the version being replaced", () => {
    expect(nextUpdatedAt("2026-11-20T10:00:00.000Z", at("2026-11-20T10:05:00.000Z"))).toBe("2026-11-20T10:05:00.000Z");
  });

  it("stays after the replaced version when this machine's clock lags", () => {
    // The card was last saved by a PC 3 minutes ahead; this edit must still win.
    expect(nextUpdatedAt("2026-11-20T10:05:00.000Z", at("2026-11-20T10:02:00.000Z"))).toBe("2026-11-20T10:05:00.001Z");
  });

  it("falls back to the clock for a new or undated item", () => {
    const clock = at("2026-11-20T10:00:00.000Z");
    expect(nextUpdatedAt(undefined, clock)).toBe("2026-11-20T10:00:00.000Z");
    expect(nextUpdatedAt("", clock)).toBe("2026-11-20T10:00:00.000Z");
    expect(nextUpdatedAt("n'importe quoi", clock)).toBe("2026-11-20T10:00:00.000Z");
  });
});
