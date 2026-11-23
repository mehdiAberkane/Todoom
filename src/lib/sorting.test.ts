import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../types";
import { columnSort, loadFilter, matchesDue, NO_FILTER, orderColumn, saveFilter, tiedWith } from "./sorting";

const card = (id: string, patch: Partial<Card>) => ({ id, order: 0, priority: null, due: null, createdAt: "", updatedAt: "", ...patch }) as Card;

describe("the order of a column", () => {
  const today = "2026-11-23";
  const cards = [
    card("a", { order: 0, priority: "p3", due: "2026-12-10", createdAt: "2026-11-03", updatedAt: "2026-11-20" }),
    card("b", { order: 1, priority: "p1", due: null, createdAt: "2026-11-01", updatedAt: "2026-11-18" }),
    card("c", { order: 2, priority: null, due: "2026-11-25", createdAt: "2026-11-02", updatedAt: "2026-11-21" }),
  ];
  const ids = (sort: string, list = cards, name = "Colonne") => orderColumn(list, { name, sort }, {}, today).map((c) => c.id);

  it("sorts by priority, due date, creation and last change, or keeps the order by hand", () => {
    expect(ids("priority")).toEqual(["b", "a", "c"]);
    expect(ids("due")).toEqual(["c", "a", "b"]);
    expect(ids("created")).toEqual(["b", "c", "a"]);
    expect(ids("updated")).toEqual(["c", "a", "b"]);
    expect(ids("manual", [cards[2], cards[0], cards[1]])).toEqual(["a", "b", "c"]);
  });

  it("settles a tie on the priority with the due date, then the order by hand", () => {
    const list = [
      card("x", { order: 0, priority: "p1", due: null }),
      card("y", { order: 1, priority: "p1", due: "2026-12-01" }),
      card("z", { order: 2, priority: "p1", due: "2026-12-01" }),
      card("w", { order: 3, priority: "p1", due: "2026-11-30" }),
    ];
    expect(ids("priority", list)).toEqual(["w", "y", "z", "x"]);
  });

  it("puts a late card first when kept sorted, not by hand nor in a done column", () => {
    const late = card("late", { order: 5, priority: "p3", due: "2026-11-20", updatedAt: "2026-11-01" });
    expect(ids("priority", [...cards, late])[0]).toBe("late");
    expect(ids("created", [...cards, late])[0]).toBe("late");
    expect(ids("manual", [...cards, late]).pop()).toBe("late");
    expect(ids("updated", [...cards, late], "Terminé").pop()).toBe("late");
  });

  it("follows the board's own priority levels", () => {
    const board = { priorities: [{ id: "low", name: "Basse", color: "" }, { id: "high", name: "Haute", color: "" }] };
    const list = [card("h", { order: 0, priority: "high" }), card("l", { order: 1, priority: "low" })];
    expect(orderColumn(list, { name: "À faire" }, board, today).map((c) => c.id)).toEqual(["l", "h"]);
  });

  it("chooses a sort from the column's name until one is chosen", () => {
    expect(columnSort({ name: "À faire" })).toBe("priority");
    expect(columnSort({ name: "En cours" })).toBe("priority");
    expect(columnSort({ name: "Backlog" })).toBe("priority");
    expect(columnSort({ name: "A vérifier" })).toBe("manual");
    expect(columnSort({ name: "Terminé" })).toBe("updated");
    expect(columnSort({ name: "Done" })).toBe("updated");
    expect(columnSort({ name: "À faire", sort: "due" })).toBe("due");
    expect(columnSort({ name: "Terminé", sort: "manual" })).toBe("manual");
    // A sort a newer version would know: the default, not an error.
    expect(columnSort({ name: "À faire", sort: "magic" })).toBe("priority");
  });

  it("lets a drag reorder only the cards tied with the one moved", () => {
    const list = [
      card("p1a", { order: 0, priority: "p1" }),
      card("p1b", { order: 1, priority: "p1" }),
      card("p2", { order: 2, priority: "p2" }),
      card("p1late", { order: 3, priority: "p1", due: "2026-11-01" }),
    ];
    const byId = new Map(list.map((c) => [c.id, c]));
    const after = ["p2", "p1b", "p1a", "p1late"];
    expect(tiedWith(after, "p1a", (id) => byId.get(id), { name: "À faire" }, {}, today)).toEqual(["p1b", "p1a"]);
    expect(tiedWith(after, "p1a", (id) => byId.get(id), { name: "A verifier" }, {}, today)).toEqual(after);
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
