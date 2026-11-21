import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { laneOf, lanesOf } from "./lanes";
import { boardProblem } from "./validate";

const board = {
  id: "b",
  name: "B",
  columns: [],
  labels: [
    { id: "bug", name: "Bug", color: "#f00" },
    { id: "ux", name: "UX", color: "#0f0" },
  ],
  createdAt: "",
  updatedAt: "",
} as Board;
const card = (patch: Partial<Card>) => ({ priority: null, labels: [], ...patch }) as Card;

describe("swimlanes", () => {
  it("has one lane per priority or label, then one for the rest", () => {
    expect(lanesOf(board, "priority").map((l) => l.name)).toEqual(["P1", "P2", "P3", null]);
    expect(lanesOf(board, "label").map((l) => l.id)).toEqual(["bug", "ux", ""]);
  });

  it("puts each card in one lane: its priority, or the first of its labels in the board's order", () => {
    expect(laneOf(board, card({ priority: "p2" }), "priority")).toBe("p2");
    expect(laneOf(board, card({ priority: "deleted" }), "priority")).toBe("");
    expect(laneOf(board, card({ labels: ["ux", "bug"] }), "label")).toBe("bug");
    expect(laneOf(board, card({ labels: [] }), "label")).toBe("");
  });

  it("checks a column's collapsed flag and limit when the board is read", () => {
    expect(boardProblem({ id: "b", columns: [{ id: "c", name: "Terminé", collapsed: true, limit: 3 }] })).toBeNull();
    expect(boardProblem({ id: "b", columns: [{ id: "c", name: "x", limit: "3" }] })).toEqual({ code: "bad_field", field: "columns" });
  });
});
