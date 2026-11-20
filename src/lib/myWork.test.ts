import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { DEFAULT_MY_WORK, myWork, myWorkColumns } from "../components/MyWork";
import { settingsProblem } from "./validate";

const board = (id: string, columns: string[], archivedAt: string | null = null): Board => ({
  id,
  name: id,
  columns: columns.map((name, i) => ({ id: `${id}-${i}`, name })),
  labels: [],
  archivedAt,
  createdAt: "",
  updatedAt: "",
});
const card = (id: string, columnId: string, order: number, archivedAt: string | null = null) => ({ id, columnId, order, archivedAt }) as Card;

describe("my work", () => {
  const solaris = board("sol", ["À faire", "En cours", "À vérifier", "Terminé"]);
  const nyx = board("nyx", ["Todo", "In progress"]);
  const empty = board("luna", ["À faire", "En cours"]);
  const trashed = board("old", ["En cours"], "2026-11-01");
  const cards = {
    sol: [card("s1", "sol-1", 2), card("s2", "sol-1", 1), card("s3", "sol-2", 0), card("s4", "sol-0", 0), card("s5", "sol-1", 0, "2026-11-01")],
    nyx: [card("n1", "nyx-1", 0)],
    luna: [card("l1", "luna-0", 0)],
    old: [card("o1", "old-0", 0)],
  };

  it("groups the chosen columns by board, ignoring case and accents, cards in order", () => {
    const groups = myWork([solaris, nyx, empty, trashed], cards, DEFAULT_MY_WORK);
    expect(groups.map((g) => [g.board.id, g.columns.map((c) => [c.name, c.cards.map((x) => x.id)])])).toEqual([
      ["sol", [["En cours", ["s2", "s1"]], ["À vérifier", ["s3"]]]],
      ["nyx", [["In progress", ["n1"]]]],
    ]);
  });

  it("uses the columns chosen in the settings, shared between computers", () => {
    expect(myWorkColumns({ background: null, backgroundDim: 0, language: null, updatedAt: "" })).toEqual(DEFAULT_MY_WORK);
    expect(myWork([solaris], cards, ["à faire"]).map((g) => g.columns.map((c) => c.name))).toEqual([["À faire"]]);
    expect(settingsProblem({ myWorkColumns: ["En cours"] })).toBeNull();
    expect(settingsProblem({ myWorkColumns: "En cours" })).toEqual({ code: "bad_field", field: "myWorkColumns" });
  });
});
