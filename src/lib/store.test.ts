import { describe, expect, it } from "vitest";
import { parse } from "./store";

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
    expect(data.issues).toEqual([{ path: "boards/b1/cards/c1.json", reason: "JSON invalide (fichier partiel ou corrompu)" }]);
  });

  it("rejects a field of the wrong type, which used to crash the board", () => {
    const data = parse(files({ "boards/b1/cards/c1.json": card({ labels: "urgent" }) }));
    expect(data.cards.b1).toEqual([]);
    expect(data.issues[0].reason).toBe("champ « labels » de type inattendu");
  });

  it("reports cards without an id, without a board, or in an unknown column", () => {
    const data = parse(
      files({
        "boards/b1/cards/a.json": JSON.stringify({ title: "sans id" }),
        "boards/b2/cards/b.json": card({ id: "c2" }),
        "boards/b1/cards/c.json": card({ id: "c3", columnId: "disparue" }),
      }),
    );
    expect(data.issues.map((i) => [i.path, i.reason])).toEqual([
      ["boards/b1/cards/a.json", "champ « id » manquant"],
      ["boards/b1/cards/c.json", "colonne inconnue : la carte est affichée dans la première colonne"],
      ["boards/b2/cards/b.json", "son tableau (board.json) est absent ou illisible"],
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
      expect(data.issues[0].reason).toBe("champ « background » de type inattendu");
    }
  });

  it("reports an unreadable settings file and keeps the defaults", () => {
    const data = parse(files({ "settings.json": JSON.stringify({ backgroundDim: "fort" }) }));
    expect(data.settings.background).toBeNull();
    expect(data.issues[0]).toEqual({ path: "settings.json", reason: "champ « backgroundDim » de type inattendu" });
  });
});
