import { beforeAll, describe, expect, it } from "vitest";
import type { Board, Card, HistoryEvent } from "../types";
import { setLang } from "./i18n";
import { datesOf, finishedPerWeek, formatDuration, staysOf, timeByColumn, weekOf } from "./timeline";

beforeAll(() => setLang("fr"));

const board = {
  id: "b",
  name: "Todoom",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
    { id: "review", name: "A verifier" },
    { id: "done", name: "Terminé" },
    { id: "later", name: "Backlog" },
  ],
} as unknown as Board;

const card = (columnId: string, extra: Partial<Card> = {}) =>
  ({ id: "c", boardId: "b", columnId, createdAt: "2026-11-02T09:00:00.000Z", archivedAt: null, ...extra }) as Card;

const by = { host: "PC" };
const created = (at: string, to: string): HistoryEvent => ({ at, by, field: "created", to });
const moved = (at: string, from: string, to: string): HistoryEvent => ({ at, by, field: "column", from, to });

const H = 3_600_000;

describe("a card's stays in columns", () => {
  const history = [
    created("2026-11-02T09:00:00.000Z", "À faire"),
    { at: "2026-11-02T09:30:00.000Z", by, field: "title", from: "a", to: "b" } as HistoryEvent,
    moved("2026-11-02T10:00:00.000Z", "À faire", "En cours"),
    moved("2026-11-02T13:00:00.000Z", "En cours", "A verifier"),
    moved("2026-11-02T14:00:00.000Z", "A verifier", "En cours"),
    moved("2026-11-02T15:00:00.000Z", "En cours", "Terminé"),
  ];

  it("gives start and end dates", () => {
    const c = card("done");
    expect(datesOf(c, board, staysOf(c, board, history))).toEqual({
      created: "2026-11-02T09:00:00.000Z",
      started: "2026-11-02T10:00:00.000Z",
      finished: "2026-11-02T15:00:00.000Z",
    });
  });

  it("adds up the time spent in each column, the current one up to now", () => {
    const c = card("done");
    const now = Date.parse("2026-11-02T16:00:00.000Z");
    expect(timeByColumn(c, staysOf(c, board, history), now)).toEqual([
      { column: "À faire", ms: H },
      { column: "En cours", ms: 4 * H },
      { column: "A verifier", ms: H },
      { column: "Terminé", ms: H },
    ]);
  });

  it("isn't finished once it left « Terminé », and the backlog doesn't start it", () => {
    const c = card("doing");
    const back = [...history, moved("2026-11-03T09:00:00.000Z", "Terminé", "En cours")];
    expect(datesOf(c, board, staysOf(c, board, back)).finished).toBeNull();
    const parked = [created("2026-11-02T09:00:00.000Z", "Backlog"), moved("2026-11-02T10:00:00.000Z", "Backlog", "À faire")];
    expect(datesOf(c, board, staysOf(c, board, parked)).started).toBeNull();
  });

  it("follows a move between boards", () => {
    const c = card("doing");
    const h = [created("2026-11-02T09:00:00.000Z", "À faire"), { at: "2026-11-02T11:00:00.000Z", by, field: "board", from: "Autre / À faire", to: "Todoom / En cours" } as HistoryEvent];
    expect(staysOf(c, board, h).map((s) => s.column)).toEqual(["À faire", "En cours"]);
  });

  it("invents nothing for a card older than its history", () => {
    const c = card("done");
    expect(datesOf(c, board, staysOf(c, board, []))).toMatchObject({ started: null, finished: null });
    expect(timeByColumn(c, staysOf(c, board, []))).toEqual([]);
    // History started midway: the time before the first known move is unknown.
    const partial = [moved("2026-11-04T10:00:00.000Z", "En cours", "Terminé")];
    const stays = staysOf(c, board, partial);
    expect(datesOf(c, board, stays)).toMatchObject({ started: null, finished: "2026-11-04T10:00:00.000Z" });
    expect(timeByColumn(c, stays, Date.parse("2026-11-04T12:00:00.000Z"))).toEqual([{ column: "Terminé", ms: 2 * H }]);
  });

  it("stops counting when the card is archived", () => {
    const c = card("done", { archivedAt: "2026-11-02T17:00:00.000Z" });
    const times = timeByColumn(c, staysOf(c, board, history), Date.parse("2026-11-20T00:00:00.000Z"));
    expect(times.find((x) => x.column === "Terminé")?.ms).toBe(2 * H);
  });
});

describe("cards finished per week", () => {
  it("counts by week starting on Monday", () => {
    expect(weekOf(new Date(2026, 10, 21))).toBe("2026-11-16"); // a Saturday
    expect(weekOf(new Date(2026, 10, 16))).toBe("2026-11-16"); // the Monday itself
    expect(weekOf(new Date(2026, 10, 22))).toBe("2026-11-16"); // the Sunday
    const cards = [card("done", { id: "a" }), card("done", { id: "b" }), card("doing", { id: "c" })];
    const finishedAt: Record<string, string> = { a: "2026-11-18T10:00:00", b: "2026-11-10T10:00:00", c: "2026-11-18T10:00:00" };
    const historyOf = (id: string) => [created("2026-11-01T10:00:00", "À faire"), moved(finishedAt[id], "À faire", id === "c" ? "En cours" : "Terminé")];
    expect(finishedPerWeek(board, cards, historyOf, 3, new Date(2026, 10, 21))).toEqual([
      { week: "2026-11-02", count: 0 },
      { week: "2026-11-09", count: 1 },
      { week: "2026-11-16", count: 1 },
    ]);
  });
});

describe("durations", () => {
  it("reads like a person would say them", () => {
    expect(formatDuration(30_000)).toBe("< 1 min");
    expect(formatDuration(5 * 60_000)).toBe("5 min");
    expect(formatDuration(2 * H + 10 * 60_000)).toBe("2 h 10 min");
    expect(formatDuration(3 * 24 * H + 4 * H + 59 * 60_000)).toBe("3 j 4 h");
  });
});
