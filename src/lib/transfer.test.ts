import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { duplicateOf, mapByName } from "./transfer";

const board = (id: string, labels: [string, string][], priorities?: [string, string][]) =>
  ({
    id,
    name: id,
    columns: [],
    labels: labels.map(([lid, name]) => ({ id: lid, name, color: "#000" })),
    ...(priorities ? { priorities: priorities.map(([pid, name]) => ({ id: pid, name, color: "#000" })) } : {}),
    createdAt: "",
    updatedAt: "",
  }) as Board;

describe("moving a card between boards", () => {
  const sol = board("sol", [["b", "Bug"], ["s", "Sécurité"], ["x", "Interne"]]);
  const nyx = board("nyx", [["bug", "bug"], ["sec", "Securite"]], [["high", "P1"]]);

  it("keeps labels and priority found by name on the other board, drops the rest", () => {
    expect(mapByName({ labels: ["b", "s", "x"], priority: "p1" }, sol, nyx)).toEqual({ labels: ["bug", "sec"], priority: "high" });
    expect(mapByName({ labels: [], priority: "p3" }, sol, nyx)).toEqual({ labels: [], priority: null });
  });
});

describe("duplicating a card", () => {
  it("copies the content, not the links, taker, branch or checklist card links", () => {
    const card = {
      id: "c1",
      number: 4,
      title: "T",
      description: "D",
      labels: ["b"],
      priority: "p1",
      due: "2026-12-01",
      checklist: [{ id: "i", text: "x", done: true, cardId: "c9" }],
      links: [{ type: "dependsOn", cardId: "c9" }],
      branch: "fix/x",
      mergeRequest: { url: "https://x/-/merge_requests/1", state: "open" },
      claimedBy: { host: "PC", at: "" },
      archivedAt: null,
      columnId: "col",
      order: 1,
      boardId: "sol",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    } as Card;
    const copy = duplicateOf(card, "T (copie)", 9, 12, "2026-11-21");
    expect(copy).toMatchObject({ title: "T (copie)", description: "D", labels: ["b"], priority: "p1", due: "2026-12-01", order: 9, number: 12 });
    expect(copy).toMatchObject({ links: [], branch: null, mergeRequest: null, claimedBy: null, createdAt: "2026-11-21" });
    expect(copy.id).not.toBe("c1");
    expect(copy.checklist).toEqual([{ id: copy.checklist[0].id, text: "x", done: true }]);
    expect(copy.checklist[0].id).not.toBe("i");
  });
});
