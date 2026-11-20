import { describe, expect, it } from "vitest";
import { expiredBoards, idOfPath, overlay, parse, type PendingOp } from "./store";

const board = { id: "b1", name: "Tableau", columns: [{ id: "todo", name: "À faire" }], labels: [], updatedAt: "1" };
const card = (patch: Record<string, unknown> = {}) => JSON.stringify({ id: "c1", columnId: "todo", title: "Carte", updatedAt: "1", ...patch });
const files = (extra: Record<string, string>) =>
  Object.entries({ "boards/b1/board.json": JSON.stringify(board), ...extra }).map(([path, content]) => ({ path, content }));

describe("loading the data folder", () => {
  it("loads valid files without issues", () => {
    const data = parse(files({ "boards/b1/cards/c1.json": card() }));
    expect(data.cards.b1.map((c) => c.title)).toEqual(["Carte"]);
    expect(data.issues).toEqual([]);
  });

  it("keeps the most recent of the Drive conflict copies of a card and a board", () => {
    const data = parse(
      files({
        "boards/b1/cards/c1.json": card({ title: "ancienne", updatedAt: "2026-11-01T10:00:00Z" }),
        "boards/b1/cards/c1 (1).json": card({ title: "récente", updatedAt: "2026-11-02T10:00:00Z" }),
        "boards/b1/board (1).json": JSON.stringify({ ...board, name: "Renommé", updatedAt: "2" }),
      }),
    );
    expect(data.cards.b1.map((c) => c.title)).toEqual(["récente"]);
    expect(data.boards.map((b) => b.name)).toEqual(["Renommé"]);
    expect(data.issues).toEqual([]);
  });

  it("reports a half-synced file instead of dropping it silently", () => {
    const data = parse(files({ "boards/b1/cards/c1.json": '{"id":"c1","title":"Car' }));
    expect(data.cards.b1).toEqual([]);
    expect(data.issues).toEqual([{ path: "boards/b1/cards/c1.json", reason: { code: "invalid_json" } }]);
  });

  it("rejects a field of the wrong type, which used to crash the board", () => {
    const data = parse(files({ "boards/b1/cards/c1.json": card({ labels: "urgent" }) }));
    expect(data.cards.b1).toEqual([]);
    expect(data.issues[0].reason).toEqual({ code: "bad_field", field: "labels" });
  });

  it("reports cards without an id, without a board, or in an unknown column", () => {
    const data = parse(
      files({
        "boards/b1/cards/a.json": JSON.stringify({ title: "sans id" }),
        "boards/b2/cards/b.json": card({ id: "c2" }),
        "boards/b1/cards/c.json": card({ id: "c3", columnId: "disparue" }),
      }),
    );
    expect(data.issues.map((i) => [i.path, i.reason.code])).toEqual([
      ["boards/b1/cards/a.json", "missing_id"],
      ["boards/b1/cards/c.json", "unknown_column"],
      ["boards/b2/cards/b.json", "missing_board"],
    ]);
    // The unknown-column card is still shown, the others are not.
    expect(data.cards.b1.map((c) => c.id)).toEqual(["c3"]);
  });

  it("accepts missing optional fields and ignores files Todoom doesn't own", () => {
    const data = parse(
      files({
        "boards/b1/cards/c1.json": JSON.stringify({ id: "c1", columnId: "todo" }),
        "notes.json": "pas du json",
        ".presence/PC.json": "{coupé",
      }),
    );
    expect(data.cards.b1[0]).toMatchObject({ id: "c1", title: "", labels: [], archivedAt: null });
    expect(data.issues).toEqual([]);
  });

  it("only accepts a base64 image as background, so nothing can break out of url()", () => {
    const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    expect(parse(files({ "settings.json": JSON.stringify({ background: ok, updatedAt: "1" }) })).settings.background).toBe(ok);
    for (const trap of [
      'data:image/png;base64,AAAA"), url("https://evil.example/x.png',
      "https://evil.example/tracker.png",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      const data = parse(files({ "settings.json": JSON.stringify({ background: trap, updatedAt: "1" }) }));
      expect(data.settings.background).toBeNull();
      expect(data.issues[0].reason).toEqual({ code: "bad_field", field: "background" });
    }
  });

  it("reports an unreadable settings file and keeps the defaults", () => {
    const data = parse(files({ "settings.json": JSON.stringify({ backgroundDim: "fort" }) }));
    expect(data.settings.background).toBeNull();
    expect(data.issues[0]).toEqual({ path: "settings.json", reason: { code: "bad_field", field: "backgroundDim" } });
  });
});

describe("changes the disk hasn't accepted yet", () => {
  const disk = [
    { path: "boards/b1/board.json", content: "board" },
    { path: "boards/b1/cards/c1.json", content: "ancienne" },
    { path: "boards/b2/board.json", content: "b2" },
    { path: "boards/b2/cards/c9.json", content: "c9" },
  ];
  const view = (queue: [string, PendingOp][]) =>
    Object.fromEntries(overlay(disk, new Map(queue)).map((f) => [f.path, f.content]));

  it("stay on screen over what the disk still holds, instead of reverting on reload", () => {
    const shown = view([
      ["boards/b1/cards/c1.json", { kind: "write", content: "modifiée" }],
      ["boards/b1/cards/c2.json", { kind: "write", content: "nouvelle" }],
    ]);
    expect(shown["boards/b1/cards/c1.json"]).toBe("modifiée");
    expect(shown["boards/b1/cards/c2.json"]).toBe("nouvelle");
    expect(shown["boards/b2/cards/c9.json"]).toBe("c9");
  });

  it("hide a card or a whole board whose removal is still pending", () => {
    const shown = view([
      ["boards/b1/cards/c1.json", { kind: "remove" }],
      ["boards/b2", { kind: "remove" }],
    ]);
    expect(Object.keys(shown)).toEqual(["boards/b1/board.json"]);
  });

  it("map a pending path to the card or board it marks as unsaved", () => {
    expect(idOfPath("boards/b1/cards/c1.json")).toBe("c1");
    expect(idOfPath("boards/b1/board.json")).toBe("b1");
    expect(idOfPath("boards/b1")).toBe("b1");
    expect(idOfPath("settings.json")).toBeNull();
    expect(idOfPath(".presence/PC.json")).toBeNull();
  });
});

describe("the trash of boards", () => {
  const trashed = (archivedAt: string | null) => ({ ...board, id: archivedAt ?? "active", archivedAt, createdAt: "1", updatedAt: "1" });

  it("deletes for good only the boards trashed more than 30 days ago", () => {
    const now = Date.parse("2026-12-31T12:00:00Z");
    const boards = [trashed(null), trashed("2026-12-01T13:00:00Z"), trashed("2026-12-01T11:00:00Z"), trashed("2026-10-01T00:00:00Z")];
    expect(expiredBoards(boards, now).map((b) => b.id)).toEqual(["2026-12-01T11:00:00Z", "2026-10-01T00:00:00Z"]);
  });

  it("loads a trashed board with its date, and rejects a malformed one", () => {
    const ok = parse([{ path: "boards/b1/board.json", content: JSON.stringify({ ...board, archivedAt: "2026-11-20T10:00:00Z" }) }]);
    expect(ok.boards[0].archivedAt).toBe("2026-11-20T10:00:00Z");
    const bad = parse([{ path: "boards/b1/board.json", content: JSON.stringify({ ...board, archivedAt: true }) }]);
    expect(bad.issues[0].reason).toEqual({ code: "bad_field", field: "archivedAt" });
  });
});
