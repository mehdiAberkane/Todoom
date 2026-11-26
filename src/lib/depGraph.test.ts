import { describe, expect, it } from "vitest";
import type { Board, Card, CardLink } from "../types";
import { indexCards } from "./links";
import { createsCycle, dependencyGraph, dependsOnIn } from "./depGraph";

const columns = [
  { id: "todo", name: "À faire" },
  { id: "doing", name: "En cours" },
  { id: "done", name: "Terminé" },
];
const board = (id: string) => ({ id, name: id, key: id.toUpperCase(), columns, labels: [] }) as unknown as Board;
let n = 0;
const card = (id: string, boardId: string, links: CardLink[] = [], patch: Partial<Card> = {}) =>
  ({ id, boardId, number: ++n, title: id, columnId: "todo", links, archivedAt: null, ...patch }) as unknown as Card;
const dep = (cardId: string): CardLink => ({ type: "dependsOn", cardId });

describe("the dependency graph of a board", () => {
  // design ← (api, ui) ← release, plus ops (other board) ← api; lonely has no link.
  const a = board("a");
  const ops = board("ops");
  const cards = {
    a: [
      card("design", "a", [], { columnId: "done" }),
      card("api", "a", [dep("design"), dep("infra")], { columnId: "doing" }),
      card("ui", "a", [dep("design")]),
      card("release", "a", [dep("api"), dep("ui")]),
      card("lonely", "a"),
    ],
    ops: [card("infra", "ops")],
  };
  const g = dependencyGraph(a, indexCards([a, ops], cards));
  const node = (id: string) => g.nodes.find((x) => x.card.id === id)!;

  it("keeps the linked cards, those of other boards too, left to right", () => {
    expect(g.nodes.map((x) => [x.card.id, x.layer, x.outside])).toEqual([
      ["design", 0, false],
      ["infra", 0, true],
      ["api", 1, false],
      ["ui", 1, false],
      ["release", 2, false],
    ]);
    expect(g.edges).toContainEqual({ from: "infra", to: "api" });
  });

  it("colors by state: done, waiting on an unfinished one, in progress, to do", () => {
    expect(["design", "api", "ui", "release", "infra"].map((id) => node(id).state)).toEqual(["done", "blocked", "todo", "blocked", "todo"]);
  });

  it("finds the ready ones, what unblocks the most, the longest chain left", () => {
    expect(g.nodes.filter((x) => x.ready).map((x) => x.card.id)).toEqual(["infra", "ui"]);
    expect(node("infra").unblocks).toBe(2);
    expect(node("design").unblocks).toBe(0);
    expect(g.longestChain).toEqual(["infra", "api", "release"]);
    expect(g.cycles).toEqual([]);
  });

  it("reads a « blocks » link written on one card only, and leaves archived cards out", () => {
    const b = board("b");
    const g2 = dependencyGraph(b, indexCards([b], { b: [card("x", "b", [{ type: "blocks", cardId: "y" }]), card("y", "b"), card("z", "b", [dep("old")]), card("old", "b", [], { archivedAt: "2026-01-01" })] }));
    expect(g2.edges).toEqual([{ from: "x", to: "y" }]);
    expect(g2.nodes.map((x) => x.card.id)).toEqual(["x", "y"]);
  });

  it("shows the cycles, and still lays the cards out", () => {
    const c = board("c");
    const g3 = dependencyGraph(c, indexCards([c], { c: [card("p", "c", [dep("q")]), card("q", "c", [dep("r")]), card("r", "c", [dep("p")]), card("s", "c", [dep("p")])] }));
    expect(g3.cycles.map((cy) => [...cy].sort())).toEqual([["p", "q", "r"]]);
    expect(g3.nodes.filter((x) => x.inCycle).map((x) => x.card.id).sort()).toEqual(["p", "q", "r"]);
    expect(g3.nodes.find((x) => x.card.id === "s")!.layer).toBeGreaterThan(0);
  });
});

describe("a link that would close a cycle", () => {
  const b = board("b");
  const index = indexCards([b], { b: [card("a", "b", [dep("b")]), card("b", "b", [dep("c")]), card("c", "b"), card("d", "b")] });
  const deps = dependsOnIn(index);

  it("is refused: « c depends on a » while a already waits on c, or « a blocks c »", () => {
    expect(createsCycle("c", "dependsOn", "a", deps)).toBe(true);
    expect(createsCycle("a", "blocks", "c", deps)).toBe(true);
    expect(createsCycle("a", "dependsOn", "a", deps)).toBe(true);
  });

  it("is allowed otherwise, and for the other kinds of links", () => {
    expect(createsCycle("a", "dependsOn", "d", deps)).toBe(false);
    expect(createsCycle("c", "blocks", "a", deps)).toBe(false);
    expect(createsCycle("c", "relatesTo", "a", deps)).toBe(false);
  });
});
