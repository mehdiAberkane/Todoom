import { beforeAll, describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { setLang } from "./i18n";
import { arrivals, dueOn, freshDue, noticesFor, notifySettings, type Snapshot } from "./notify";
import { settingsProblem } from "./validate";

beforeAll(() => setLang("fr"));

const board = {
  id: "b",
  name: "Todoom",
  key: "TOD",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
    { id: "review", name: "À vérifier" },
    { id: "fail", name: "Echec" },
    { id: "done", name: "Terminé" },
  ],
  labels: [],
  createdAt: "",
  updatedAt: "",
} as unknown as Board;

const card = (id: string, columnId: string, extra: Partial<Card> = {}) =>
  ({ id, number: Number(id.slice(1)), title: `Carte ${id}`, boardId: "b", columnId, archivedAt: null, due: null, ...extra }) as Card;

const snap = (...cards: Card[]): Snapshot => ({ boards: [board], cards: { b: cards } });
const COLUMNS = ["A verifier", "Echec"];

describe("cards arriving in a watched column", () => {
  it("notices a card moved there, whatever the case and accents of the name", () => {
    const got = arrivals(snap(card("c1", "doing"), card("c2", "todo")), snap(card("c1", "review"), card("c2", "doing")), COLUMNS, true);
    expect(got.map((a) => [a.card.id, a.column])).toEqual([["c1", "À vérifier"]]);
  });

  it("ignores cards already there, archived ones and unwatched columns", () => {
    const prev = snap(card("c1", "review"), card("c2", "doing"), card("c3", "doing"));
    const next = snap(card("c1", "review"), card("c2", "fail", { archivedAt: "x" }), card("c3", "done"));
    expect(arrivals(prev, next, COLUMNS, true)).toEqual([]);
  });

  it("counts a new card only when the previous read was complete", () => {
    expect(arrivals(snap(), snap(card("c1", "fail")), COLUMNS, true)).toHaveLength(1);
    // First read, or Drive still downloading: the card may just be late, not new.
    expect(arrivals(snap(), snap(card("c1", "fail")), COLUMNS, false)).toEqual([]);
  });

  it("notices a card moved in from another board", () => {
    const other = { ...board, id: "o", name: "Autre", columns: [{ id: "x", name: "A verifier" }] } as Board;
    const prev: Snapshot = { boards: [board, other], cards: { b: [card("c1", "doing")], o: [] } };
    const next: Snapshot = { boards: [board, other], cards: { b: [], o: [card("c1", "x", { boardId: "o" })] } };
    expect(arrivals(prev, next, COLUMNS, true).map((a) => a.board.id)).toEqual(["o"]);
  });
});

describe("cards due today", () => {
  it("lists unfinished cards due today", () => {
    const data = snap(card("c1", "doing", { due: "2026-11-21" }), card("c2", "done", { due: "2026-11-21" }), card("c3", "todo", { due: "2026-11-22" }));
    expect(dueOn(data, "2026-11-21").map((d) => d.card.id)).toEqual(["c1"]);
  });

  it("notifies each card once a day", () => {
    const due = [{ card: card("c1", "doing") }, { card: card("c2", "doing") }];
    const first = freshDue(due, "2026-11-21", null);
    expect(first.fresh).toHaveLength(2);
    expect(freshDue(due, "2026-11-21", first.memory).fresh).toEqual([]);
    expect(freshDue(due, "2026-11-22", first.memory).fresh).toHaveLength(2);
  });
});

describe("notification texts", () => {
  it("one per card, or one summary past three", () => {
    const one = noticesFor([{ card: card("c7", "review"), board, column: "À vérifier" }], []);
    expect(one).toEqual([{ title: "Ticket dans « À vérifier »", body: "TOD-7 · Carte c7\nTodoom" }]);
    const many = noticesFor(
      ["c1", "c2", "c3", "c4"].map((id) => ({ card: card(id, "fail"), board, column: "Echec" })),
      [{ card: card("c9", "doing"), board }, { card: card("c8", "doing"), board }],
    );
    expect(many.map((n) => n.title)).toEqual(["4 tickets ont changé de colonne", "2 échéances aujourd'hui"]);
  });
});

describe("notification settings", () => {
  it("are on by default and checked in settings.json", () => {
    expect(notifySettings({ background: null, backgroundDim: 0, language: null, updatedAt: "" })).toMatchObject({ enabled: true, due: true });
    expect(settingsProblem({ notifications: { enabled: false, columns: ["Echec"] } })).toBeNull();
    expect(settingsProblem({ notifications: { enabled: "no" } })).toEqual({ code: "bad_field", field: "notifications" });
  });
});
