import { describe, expect, it } from "vitest";
import type { Board, Card, CardComment } from "../types";
import { searchCards } from "./search";

const board = (id: string, key: string, archivedAt: string | null = null): Board => ({
  id,
  name: id,
  key,
  columns: [{ id: `${id}-c`, name: "À faire" }],
  labels: [],
  archivedAt,
  createdAt: "",
  updatedAt: "",
});
const card = (id: string, number: number, patch: Partial<Card> = {}) =>
  ({
    id,
    number,
    columnId: "x",
    title: "",
    description: "",
    checklist: [],
    archivedAt: null,
    updatedAt: "2026-11-20T10:00:00Z",
    ...patch,
  }) as Card;

const sol = board("Solaris", "SOL");
const nyx = board("Nyx", "NYX");
const old = board("Ancien", "OLD", "2026-11-01");
const cards = {
  Solaris: [
    card("s1", 1, { title: "Écran de connexion" }),
    card("s2", 2, { title: "Export", description: "Le fichier CSV doit suivre la connexion", updatedAt: "2026-11-20T12:00:00Z" }),
    card("s3", 3, { title: "Vieux ticket connexion", archivedAt: "2026-11-02" }),
  ],
  Nyx: [card("n1", 7, { title: "API", checklist: [{ id: "i", text: "Gérer l'expiration du jeton", done: false }] })],
  Ancien: [card("o1", 1, { title: "Connexion v1" })],
};
const comments: Record<string, CardComment[]> = {
  n1: [{ id: "k", cardId: "n1", createdAt: "", author: { host: "PC" }, text: "Le jeton expire trop tôt sur mobile" }],
};

const ids = (q: string) => searchCards(q, [sol, nyx, old], cards, comments).map((r) => `${r.card.id}:${r.field}`);

describe("search every board", () => {
  it("ignores case and accents, titles first, cards on the board before archived ones", () => {
    expect(ids("CONNEXION")).toEqual(["s1:title", "s3:title", "o1:title", "s2:description"]);
    expect(ids("ecran")).toEqual(["s1:title"]);
  });

  it("finds words in checklists and comments, every word required", () => {
    expect(ids("jeton")).toEqual(["n1:checklist"]);
    expect(ids("mobile")).toEqual(["n1:comment"]);
    expect(ids("jeton mobile")).toEqual(["n1:checklist"]);
    expect(ids("jeton csv")).toEqual([]);
  });

  it("finds a card by its short id, before everything else", () => {
    expect(ids("nyx-7")).toEqual(["n1:ref"]);
    expect(ids("SOL-2")).toEqual(["s2:ref"]);
    expect(ids("")).toEqual([]);
  });

  it("shows the words found in a long text", () => {
    const r = searchCards("csv", [sol], cards, {})[0];
    expect(r.snippet).toContain("CSV");
  });
});
