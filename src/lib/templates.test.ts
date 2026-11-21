import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { applyTemplate, boardSetup, fromSetup } from "./templates";

const source: Board = {
  id: "src",
  name: "Solaris",
  key: "SOL",
  columns: [
    { id: "c1", name: "À faire" },
    { id: "c2", name: "Terminé", collapsed: true, limit: 9 },
  ],
  labels: [{ id: "l1", name: "Fonctionnalité", color: "#00f" }],
  priorities: [{ id: "p", name: "Haute", color: "#f00" }],
  description: "## Dépôt\nC:/projets/solaris",
  createdAt: "",
  updatedAt: "",
};

describe("board templates", () => {
  it("sets up a development board: five columns, Done and Backlog collapsed, labels and a context", () => {
    const dev = boardSetup("dev", []);
    expect(dev.columns.map((c) => [c.name, !!c.collapsed])).toEqual([
      ["À faire", false],
      ["En cours", false],
      ["A verifier", false],
      ["Terminé", true],
      ["Backlog", true],
    ]);
    expect(dev.labels.map((l) => l.name)).toContain("Bug");
    expect(dev.description).toContain("« A verifier »");
  });

  it("copies a board's set-up, with new ids, and nothing else", () => {
    const made = fromSetup(boardSetup("copy:src", [source]));
    expect(made.columns.map((c) => [c.name, c.collapsed, c.limit])).toEqual([
      ["À faire", undefined, undefined],
      ["Terminé", true, 9],
    ]);
    expect(made.columns.every((c) => c.id && !["c1", "c2"].includes(c.id))).toBe(true);
    expect(made.labels[0]).toMatchObject({ name: "Fonctionnalité", color: "#00f" });
    expect(made.labels[0].id).not.toBe("l1");
    expect(made.priorities?.map((p) => p.name)).toEqual(["Haute"]);
    expect(made.description).toBe(source.description);
    expect("key" in made).toBe(false);
  });

  it("falls back to the simple set-up", () => {
    expect(boardSetup("copy:gone", []).columns.map((c) => c.name)).toEqual(["À faire", "En cours", "Terminé"]);
  });
});

describe("card templates", () => {
  it("fills the outline and adds the matching label once", () => {
    const card = { title: "Export", description: "", labels: [] as string[] } as Card;
    const feature = applyTemplate(card, "feature", source);
    expect(feature.description).toContain("## Besoin");
    expect(feature.labels).toEqual(["l1"]);
    expect(applyTemplate(feature, "feature", source).labels).toEqual(["l1"]);
    expect(applyTemplate(card, "bug", source).labels).toEqual([]);
    expect(applyTemplate(card, "bug", source).title).toBe("Export");
  });
});
