import { describe, expect, it } from "vitest";
import type { Board, Card, CardComment, HistoryEvent } from "../types";
import { activityItems, filterActivity, kindOf, periodRange, sessions, staleClaims, toolOf, writerKey, writerLabel, writersOf } from "./activityFeed";

const board = (id: string, patch: Partial<Board> = {}) => ({ id, name: id.toUpperCase(), key: id.toUpperCase(), columns: [], labels: [], ...patch }) as unknown as Board;
const card = (id: string, boardId: string, patch: Partial<Card> = {}) => ({ id, boardId, number: 1, title: id, claimedBy: null, archivedAt: null, ...patch }) as unknown as Card;
const ev = (at: string, field: HistoryEvent["field"], by: HistoryEvent["by"] = { host: "PC" }, to: string | null = "x"): HistoryEvent => ({ at, by, field, from: null, to });
const comment = (id: string, cardId: string, createdAt: string, author = { host: "Mac", agent: "Claude" }): CardComment => ({ id, cardId, createdAt, author, text: "fait" });

const claude = { host: "PC-Main", agent: "Claude", conversation: "login" };
const boards = [board("a"), board("b"), board("old", { archivedAt: "2026-01-01T00:00:00Z" })];
const cards = { a: [card("c1", "a"), card("c2", "a")], b: [card("c3", "b")], old: [card("c9", "old")] };
const history = {
  c1: {
    "PC-Main-mcp": [ev("2026-11-26T21:10:00.000Z", "column", claude), ev("2026-11-26T21:05:00.000Z", "claimedBy", claude)],
    "PC-Main": [ev("2026-11-26T09:00:00.000Z", "created"), ev("2026-11-20T09:00:00.000Z", "title")],
  },
  c3: { "PC-Main-agent": [ev("2026-11-26T21:20:00.000Z", "archived", { host: "PC-Main", agent: "todoom-agent" })] },
  c9: { "PC-Main": [ev("2026-11-26T10:00:00.000Z", "created")] },
};
const comments = { c2: [comment("k1", "c2", "2026-11-26T21:15:00.000Z")] };

describe("the activity of a period", () => {
  const items = activityItems(boards, cards, history, comments, "2026-11-26T00:00:00.000Z", "2026-11-27T00:00:00.000Z");

  it("takes every board's history and comments in the period, newest first, not the trashed boards", () => {
    expect(items.map((i) => [i.at.slice(11, 16), i.card.id, i.kind, i.tool ?? "-"])).toEqual([
      ["21:20", "c3", "archive", "agent"],
      ["21:15", "c2", "comment", "-"],
      ["21:10", "c1", "moved", "mcp"],
      ["21:05", "c1", "claim", "mcp"],
      ["09:00", "c1", "created", "app"],
    ]);
  });

  it("tells the tool by the history file's name, and the kind by the field", () => {
    expect(["PC", "PC-cli", "PC-mcp", "PC-agent"].map(toolOf)).toEqual(["app", "cli", "mcp", "agent"]);
    expect((["created", "column", "board", "claimedBy", "archived", "due"] as const).map((f) => kindOf(ev("x", f)))).toEqual(["created", "moved", "moved", "claim", "archive", "other"]);
  });

  it("filters by writer, board and kind, and lists the writers most active first", () => {
    expect(writersOf(items).map((w) => [w.label, w.count])).toEqual([
      ["PC-Main · Claude (login)", 2],
      ["Mac · Claude", 1],
      ["PC", 1],
      ["PC-Main · todoom-agent", 1],
    ]);
    expect(filterActivity(items, { writer: writerKey(claude) }).map((i) => i.kind)).toEqual(["moved", "claim"]);
    expect(filterActivity(items, { board: "b" }).map((i) => i.card.id)).toEqual(["c3"]);
    expect(filterActivity(items, { kind: "comment" }).map((i) => i.card.id)).toEqual(["c2"]);
    expect(writerLabel({ host: "PC" })).toBe("PC");
  });

  it("groups what one writer did in a row within the same hour", () => {
    const s = sessions(filterActivity(items, {}));
    expect(s.map((x) => [x.label, x.items.length])).toEqual([
      ["PC-Main · todoom-agent", 1],
      ["Mac · Claude", 1],
      ["PC-Main · Claude (login)", 2],
      ["PC", 1],
    ]);
  });
});

describe("the period", () => {
  it("today, yesterday, or the last 7 days, in local days", () => {
    const now = new Date(2026, 10, 26, 15, 0);
    expect(periodRange("today", now)).toEqual({ since: new Date(2026, 10, 26).toISOString(), until: new Date(2026, 10, 27).toISOString() });
    expect(periodRange("yesterday", now)).toEqual({ since: new Date(2026, 10, 25).toISOString(), until: new Date(2026, 10, 26).toISOString() });
    expect(periodRange("week", now).since).toBe(new Date(2026, 10, 20).toISOString());
  });
});

describe("cards taken with nothing happening", () => {
  it("are those held for a day with nothing written on them since, oldest first", () => {
    const now = Date.parse("2026-11-27T12:00:00.000Z");
    const held = (at: string) => ({ host: "PC-Main", agent: "Claude", conversation: "x", at });
    const list = {
      a: [
        card("quiet", "a", { claimedBy: held("2026-11-25T08:00:00.000Z") }),
        card("busy", "a", { claimedBy: held("2026-11-25T08:00:00.000Z") }),
        card("fresh", "a", { claimedBy: held("2026-11-27T08:00:00.000Z") }),
        card("free", "a"),
      ],
    };
    const h = { busy: { "PC-Main-mcp": [ev("2026-11-27T10:00:00.000Z", "column")] } };
    const c = { quiet: [comment("k", "quiet", "2026-11-26T06:00:00.000Z")] };
    expect(staleClaims([board("a")], list, h, c, now).map((s) => [s.card.id, s.since])).toEqual([["quiet", "2026-11-26T06:00:00.000Z"]]);
  });
});
