import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import type { Review } from "./reviews";
import { projectSummaries, workColumns } from "./myWorkView";

const board = (id: string, order: number, extra: Partial<Board> = {}) =>
  ({
    id,
    name: id,
    order,
    labels: [],
    columns: [
      { id: `${id}-doing`, name: "En cours" },
      { id: `${id}-review`, name: "À vérifier" },
      { id: `${id}-failed`, name: "Echec" },
      { id: `${id}-done`, name: "Terminé" },
    ],
    ...extra,
  }) as Board;
const card = (id: string, b: string, column: string, updatedAt: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: b, columnId: `${b}-${column}`, updatedAt, ...extra }) as Card;

const todoom = board("todoom", 1, { repo: "https://github.com/o/todoom" });
const ongaku = board("ongaku", 2);
const nyx = board("nyx", 3);
const cards = {
  todoom: [card("t1", "todoom", "doing", "2026-11-22T10:00:00Z"), card("t2", "todoom", "done", "2026-11-22T11:00:00Z")],
  ongaku: [card("o1", "ongaku", "doing", "2026-11-22T12:00:00Z"), card("o2", "ongaku", "review", "2026-11-21T09:00:00Z")],
  nyx: [card("n1", "nyx", "done", "2026-11-20T09:00:00Z"), card("n2", "nyx", "doing", "2026-11-20T09:00:00Z", { archivedAt: "x" })],
};

describe("the followed columns, every board mixed", () => {
  it("keeps the chosen order, latest change first, each card with its board", () => {
    const cols = workColumns([todoom, ongaku, nyx], cards, ["En cours", "A verifier"]);
    expect(cols.map((c) => c.name)).toEqual(["En cours", "À vérifier"]);
    expect(cols[0].items.map((i) => `${i.board.id}/${i.card.id}`)).toEqual(["ongaku/o1", "todoom/t1"]);
    expect(cols[1].items.map((i) => i.card.id)).toEqual(["o2"]);
  });

  it("shows only the boards picked, all when none is", () => {
    expect(workColumns([todoom, ongaku], cards, ["En cours"], new Set(["todoom"]))[0].items.map((i) => i.card.id)).toEqual(["t1"]);
    expect(workColumns([todoom, ongaku], cards, ["En cours"], new Set())[0].items).toHaveLength(2);
  });
});

describe("the summary per project", () => {
  const pr = (ci: Review["ci"]) => ({ ci }) as Review;

  it("waiting for me first, then active, then paused", () => {
    const s = projectSummaries([nyx, todoom, ongaku], cards, { "github:github.com/o/todoom": [pr("failure"), pr("success"), pr("running")] });
    expect(s.map((p) => [p.board.id, p.state])).toEqual([
      ["todoom", "attention"],
      ["ongaku", "attention"],
      ["nyx", "paused"],
    ]);
    expect(s[0]).toMatchObject({ doing: 1, review: 0, failed: 0, prs: { open: 3, failing: 1, running: 1, passing: 1 } });
    expect(s[1]).toMatchObject({ doing: 1, review: 1, prs: null });
  });

  it("is active with cards in progress or an open PR, nothing waiting", () => {
    const s = projectSummaries([todoom], { todoom: [] }, { "github:github.com/o/todoom": [pr("running")] });
    expect(s[0].state).toBe("active");
    expect(projectSummaries([todoom], { todoom: [] }, {})[0].state).toBe("paused");
  });
});
