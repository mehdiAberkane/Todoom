import { beforeAll, describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { setLang } from "./i18n";
import { boardCsv, boardMarkdown, exportFileName } from "./exporter";
import { fromGitlab, fromTrello, importFile, ImportError, parseCsv } from "./importer";

beforeAll(() => setLang("fr"));

const board = {
  id: "b",
  name: "Todoom",
  key: "TOD",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "done", name: "Terminé" },
  ],
  labels: [{ id: "bug", name: "Bug", color: "#f00" }],
  priorities: [{ id: "p1", name: "P1", color: "#f00" }],
} as unknown as Board;
const card = (extra: Partial<Card>) =>
  ({ id: "c", boardId: "b", columnId: "todo", order: 0, title: "T", description: "", labels: [], priority: null, due: null, checklist: [], links: [], branch: null, mergeRequest: null, claimedBy: null, archivedAt: null, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z", ...extra }) as Card;
const cards = [
  card({ id: "a", number: 2, order: 1, title: "Plantage au démarrage", labels: ["bug"], priority: "p1", due: "2026-11-28", description: "Constat\n\nLa fenêtre reste blanche", checklist: [{ id: "i", text: "Reproduire", done: true }, { id: "j", text: "Corriger", done: false }] }),
  card({ id: "b", number: 1, order: 0, title: '=SOMME(A1) ; "guillemets"' }),
  card({ id: "z", number: 3, title: "Archivée", archivedAt: "x" }),
];

describe("export", () => {
  it("writes Markdown column by column, archived cards left out", () => {
    const md = boardMarkdown(board, cards, { at: new Date(2026, 10, 22) });
    expect(md).toContain("# Todoom");
    expect(md).toContain("2 cartes");
    expect(md).toContain("## À faire (2)");
    expect(md.indexOf("**TOD-1**")).toBeLessThan(md.indexOf("**TOD-2**"));
    expect(md).toContain("- **TOD-2** Plantage au démarrage — P1 · Bug · échéance 28 nov. · ☑ 1/2");
    expect(md).toContain("## Terminé (0)");
    expect(md).not.toContain("Archivée");
    expect(md).not.toContain("La fenêtre");
    const details = boardMarkdown(board, cards, { details: true });
    expect(details).toContain("  La fenêtre reste blanche");
    expect(details).toContain("  - [x] Reproduire");
  });

  it("writes CSV a spreadsheet reads right, formulas made plain text", () => {
    const csv = boardCsv(board, cards);
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("TOD-1");
    expect(rows[1][1]).toBe(`'=SOMME(A1) ; "guillemets"`);
    expect(rows[2].slice(0, 7)).toEqual(["TOD-2", "Plantage au démarrage", "À faire", "P1", "Bug", "2026-11-28", "1/2"]);
    expect(rows[2][12]).toBe("Constat\n\nLa fenêtre reste blanche");
  });

  it("names the file after the board", () => {
    expect(exportFileName({ ...board, name: "Projet Été / 2026" }, "csv", new Date("2026-11-22T10:00:00Z"))).toBe("Projet-Ete-2026-2026-11-22.csv");
  });
});

describe("import", () => {
  const trello = {
    name: "Maison",
    lists: [
      { id: "l2", name: "Fait", pos: 2 },
      { id: "l1", name: "À faire", pos: 1 },
      { id: "l3", name: "Vieille liste", closed: true, pos: 3 },
    ],
    labels: [
      { id: "g", name: "", color: "green" },
      { id: "r", name: "Urgent", color: "red" },
    ],
    cards: [
      { id: "c1", name: "Peindre", desc: "Le salon", idList: "l1", idLabels: ["r", "g"], due: "2026-12-01T11:00:00.000Z", pos: 2 },
      { id: "c2", name: "Acheter", idList: "l2", closed: true, pos: 1 },
      { id: "c3", name: "Ancienne", idList: "l3", pos: 3 },
    ],
    checklists: [{ idCard: "c1", checkItems: [{ name: "Rouleau", state: "complete", pos: 2 }, { name: "Bâche", state: "incomplete", pos: 1 }] }],
    actions: [{ type: "commentCard", date: "2026-11-01T10:00:00Z", data: { card: { id: "c1" }, text: "Blanc cassé ?" }, memberCreator: { fullName: "Alex" } }],
  };

  it("reads a Trello board: lists in order, labels, due dates, checklists, comments", () => {
    const b = fromTrello(trello);
    expect(b.name).toBe("Maison");
    expect(b.columns).toEqual(["À faire", "Fait"]);
    expect(b.labels).toEqual([{ name: "green", color: "#3ddc84" }, { name: "Urgent", color: "#ff4d2e" }]);
    const [acheter, peindre, ancienne] = b.cards;
    expect(peindre).toMatchObject({ title: "Peindre", description: "Le salon", column: "À faire", labels: ["Urgent", "green"], due: "2026-12-01", archived: false });
    expect(peindre.checklist).toEqual([{ text: "Bâche", done: false }, { text: "Rouleau", done: true }]);
    expect(peindre.comments).toEqual([{ author: "Alex", date: "2026-11-01T10:00:00Z", text: "Blanc cassé ?" }]);
    expect(acheter.archived).toBe(true);
    // A card of an archived list: first column, archived.
    expect(ancienne).toMatchObject({ column: "À faire", archived: true });
  });

  it("reads GitLab issues from the CSV export, into the development columns", () => {
    const csv = [
      "Issue ID,URL,Title,State,Description,Author,Assignee,Labels,Due Date",
      '12,https://gitlab.com/g/p/-/issues/12,Login cassé,Open,"Ligne 1\nLigne 2",Moi,Toi,"bug, Doing",2026-12-01',
      "13,https://gitlab.com/g/p/-/issues/13,Doc,Closed,,Moi,,documentation,",
      "14,https://gitlab.com/g/p/-/issues/14,Thème,Open,,Moi,,,",
    ].join("\n");
    const b = fromGitlab(csv, "projet");
    expect(b.columns).toEqual(["À faire", "En cours", "A verifier", "Terminé"]);
    expect(b.labels.map((l) => l.name)).toEqual(["bug", "documentation"]);
    expect(b.cards.map((c) => [c.title, c.column, c.labels])).toEqual([
      ["Login cassé", "En cours", ["bug"]],
      ["Doc", "Terminé", ["documentation"]],
      ["Thème", "À faire", []],
    ]);
    expect(b.cards[0].description).toBe("Ligne 1\nLigne 2\n\n—\n#12 : https://gitlab.com/g/p/-/issues/12");
    expect(b.cards[0].due).toBe("2026-12-01");
  });

  it("reads GitLab issues from the API's JSON", () => {
    const json = JSON.stringify([{ iid: 3, title: "API", description: null, state: "opened", labels: ["workflow::review"], due_date: null, web_url: "https://g/3" }]);
    const b = importFile("issues.json", json);
    expect(b.source).toBe("gitlab");
    expect(b.cards[0]).toMatchObject({ title: "API", column: "A verifier", labels: [] });
  });

  it("refuses what it doesn't recognize", () => {
    expect(() => importFile("x.json", '{"foo":1}')).toThrow(ImportError);
    expect(() => importFile("x.csv", "a,b\n1,2")).toThrow(ImportError);
    expect(() => importFile("x.json", "{ broken")).toThrow(ImportError);
  });
});
