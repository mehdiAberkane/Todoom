import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { indexCards, inverseOf, isFinished, openBlockers, withLink, withoutLink } from "./links";
import { cardProblem } from "./validate";

const board = (id: string, columns: string[]): Board => ({
  id,
  name: id,
  columns: columns.map((name, i) => ({ id: `${id}-c${i}`, name })),
  labels: [],
  createdAt: "",
  updatedAt: "",
});

const card = (id: string, boardId: string, columnId: string, patch: Partial<Card> = {}): Card => ({
  id,
  boardId,
  columnId,
  order: 0,
  title: id,
  description: "",
  labels: [],
  priority: null,
  due: null,
  checklist: [],
  links: [],
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
  ...patch,
});

describe("links", () => {
  it("reverses each kind", () => {
    expect(inverseOf("dependsOn")).toBe("blocks");
    expect(inverseOf("blocks")).toBe("dependsOn");
    expect(inverseOf("duplicateOf")).toBe("duplicatedBy");
    expect(inverseOf("relatesTo")).toBe("relatesTo");
    expect(inverseOf("whatever")).toBe("relatesTo");
  });

  it("keeps one link per pair of cards", () => {
    const a = withLink(withLink(card("a", "b1", "x"), "relatesTo", "b"), "dependsOn", "b");
    expect(a.links).toEqual([{ type: "dependsOn", cardId: "b" }]);
    expect(withoutLink(a, "b").links).toEqual([]);
  });

  it("counts a card finished when archived or in a « Terminé » column", () => {
    const b = board("b1", ["À faire", "Terminé", "Done"]);
    expect(isFinished(card("x", "b1", "b1-c0"), b)).toBe(false);
    expect(isFinished(card("x", "b1", "b1-c1"), b)).toBe(true);
    expect(isFinished(card("x", "b1", "b1-c2"), b)).toBe(true);
    expect(isFinished(card("x", "b1", "b1-c0", { archivedAt: "2026-01-01" }), b)).toBe(true);
  });

  it("is blocked only by unfinished cards it depends on, across boards", () => {
    const solaris = board("sol", ["À faire", "Terminé"]);
    const nyx = board("nyx", ["À faire", "Terminé"]);
    const a = card("a", "sol", "sol-c0", {
      links: [
        { type: "dependsOn", cardId: "n1" },
        { type: "dependsOn", cardId: "n2" },
        { type: "relatesTo", cardId: "n3" },
        { type: "dependsOn", cardId: "gone" },
      ],
    });
    const index = indexCards([solaris, nyx], {
      sol: [a],
      nyx: [card("n1", "nyx", "nyx-c0"), card("n2", "nyx", "nyx-c1"), card("n3", "nyx", "nyx-c0")],
    });
    expect(openBlockers(a, index).map((l) => l.card.id)).toEqual(["n1"]);
  });

  it("is checked when files are read", () => {
    expect(cardProblem({ id: "x", links: [{ type: "dependsOn", cardId: "y" }] })).toBeNull();
    expect(cardProblem({ id: "x", links: [{ type: "dependsOn" }] })).toEqual({ code: "bad_field", field: "links" });
  });
});
