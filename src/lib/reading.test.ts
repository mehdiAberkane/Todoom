import { beforeAll, describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { setLang } from "./i18n";
import { boardReading, readingChanges, readingFiles, readingName, todayReading } from "./reading";

beforeAll(() => setLang("fr"));

const board = (extra: Partial<Board> = {}) =>
  ({
    id: "b1",
    name: "Todoom",
    key: "TOD",
    columns: [
      { id: "todo", name: "À faire" },
      { id: "doing", name: "En cours" },
      { id: "done", name: "Terminé" },
    ],
    labels: [{ id: "bug", name: "Bug", color: "#f00" }],
    priorities: [{ id: "p1", name: "P1", color: "#f00" }],
    updatedAt: "2026-11-20T10:00:00.000Z",
    ...extra,
  }) as unknown as Board;
const card = (id: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: "b1", columnId: "todo", order: 0, title: id, description: "", labels: [], priority: null, due: null, checklist: [], links: [], branch: null, mergeRequest: null, claimedBy: null, archivedAt: null, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z", ...extra }) as Card;

describe("reading files", () => {
  it("name files as every system accepts, whatever the board is called", () => {
    expect(readingName("Projet: Été / 2026?")).toBe("Projet- Été - 2026-");
    expect(readingName("  ..caché  ")).toBe("caché");
    expect(readingName("***")).toBe("Tableau");
    expect(readingName("x".repeat(200))).toHaveLength(80);
  });

  it("write a board as plain text: no Markdown that only shows rendered", () => {
    const text = boardReading(board(), [
      card("a", {
        number: 3,
        priority: "p1",
        labels: ["bug"],
        due: "2026-11-28",
        description: "Voir **le log** et [la doc](https://ex.com/doc), `npm test`",
        checklist: [{ id: "i", text: "Reproduire", done: true }],
      }),
      card("b", { number: 4, columnId: "doing", mergeRequest: { url: "https://gitlab.com/g/p/-/merge_requests/2", state: "open" } }),
      card("z", { archivedAt: "x", title: "Archivée" }),
    ]);
    expect(text).toContain("TODOOM · Todoom");
    expect(text).toContain("2 cartes · mis à jour le");
    expect(text).toContain("== À faire (1) ==");
    expect(text).toContain("- TOD-3  a\n    P1 · Bug · échéance 28 nov. · checklist 1/1\n    Voir le log et la doc (https://ex.com/doc), npm test\n    [x] Reproduire");
    expect(text).toContain("- TOD-4  b\n    https://gitlab.com/g/p/-/merge_requests/2");
    expect(text).toContain("== Terminé (0) ==\n\n  (aucune carte)");
    expect(text).not.toContain("Archivée");
    expect(text).not.toMatch(/\*\*|\]\(|`/);
  });

  it("list what is late, due and in progress, every board", () => {
    const now = new Date(2026, 10, 22, 9);
    const text = todayReading(
      [board()],
      { b1: [card("late", { number: 1, due: "2026-11-19" }), card("now", { number: 2, due: "2026-11-22" }), card("wip", { number: 5, columnId: "doing" })] },
      ["En cours"],
      now,
    );
    expect(text).toContain("== En retard (1) ==\n\n- TOD-1  late\n    Todoom · 19 nov. · 3 jours de retard");
    expect(text).toContain("== Aujourd'hui (1) ==\n\n- TOD-2  now");
    expect(text).toContain("== 7 prochains jours (0) ==\n\n  (rien)");
    expect(text).toContain("== Mon travail ==\n\nTodoom · En cours\n- TOD-5  wip");
  });

  it("make one file per board on the list, a twin name told apart", () => {
    const files = readingFiles([board(), board({ id: "b2", key: "TOD2" }), board({ id: "b3", name: "Vieux", archivedAt: "x" })], {}, []);
    expect([...files.keys()]).toEqual(["0 - Aujourd'hui.md", "Todoom.md", "Todoom (TOD2).md"]);
  });

  it("write only what changed, remove the files of boards gone or renamed", () => {
    const next = new Map([["0 - Aujourd'hui.md", "a"], ["Todoom.md", "b"]]);
    const written = new Map([["0 - Aujourd'hui.md", "a"], ["Todoom.md", "old"]]);
    expect(readingChanges(next, written, ["0 - Aujourd'hui.md", "Todoom.md", "Ancien nom.md", "notes.txt"])).toEqual({
      write: [["Todoom.md", "b"]],
      remove: ["Ancien nom.md"],
    });
  });
});
