import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../types";
import { loadFilter, matchesDue, NO_FILTER, saveFilter, sortCards } from "./sorting";

const card = (id: string, patch: Partial<Card>) => ({ id, order: 0, priority: null, due: null, createdAt: "", updatedAt: "", ...patch }) as Card;

describe("sorting a column", () => {
  const cards = [
    card("a", { order: 0, priority: "p3", due: "2026-12-10", createdAt: "2026-11-03", updatedAt: "2026-11-20" }),
    card("b", { order: 1, priority: "p1", due: null, createdAt: "2026-11-01", updatedAt: "2026-11-18" }),
    card("c", { order: 2, priority: null, due: "2026-11-25", createdAt: "2026-11-02", updatedAt: "2026-11-21" }),
  ];
  const ids = (key: Parameters<typeof sortCards>[1]) => sortCards(cards, key, {}).map((c) => c.id);

  it("sorts by priority, due date, creation and last change", () => {
    expect(ids("priority")).toEqual(["b", "a", "c"]);
    expect(ids("due")).toEqual(["c", "a", "b"]);
    expect(ids("created")).toEqual(["b", "c", "a"]);
    expect(ids("updated")).toEqual(["c", "a", "b"]);
  });
});

describe("filtering by due date", () => {
  const today = "2026-11-21";
  const week = "2026-11-28";
  const due = (d: string | null) => ({ due: d });

  it("tells late, today, this week and no date apart", () => {
    expect(matchesDue(due("2026-11-20"), "overdue", today, week)).toBe(true);
    expect(matchesDue(due(today), "overdue", today, week)).toBe(false);
    expect(matchesDue(due(today), "today", today, week)).toBe(true);
    expect(matchesDue(due("2026-11-28"), "week", today, week)).toBe(true);
    expect(matchesDue(due("2026-11-29"), "week", today, week)).toBe(false);
    expect(matchesDue(due(null), "none", today, week)).toBe(true);
    expect(matchesDue(due(null), "", today, week)).toBe(true);
  });
});

describe("a board's filter", () => {
  // Tests run without a browser: an in-memory localStorage stands in for it.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      clear: () => store.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("comes back as it was left, and a damaged one is ignored", () => {
    const filter = { query: "login", labels: ["l1"], priorities: ["p1"], due: "week" as const };
    saveFilter("b1", filter);
    expect(loadFilter("b1")).toEqual(filter);
    expect(loadFilter("other")).toEqual(NO_FILTER);
    localStorage.setItem("todoom-filter-b2", JSON.stringify({ query: 3, labels: "x", due: "someday" }));
    expect(loadFilter("b2")).toEqual(NO_FILTER);
  });
});
