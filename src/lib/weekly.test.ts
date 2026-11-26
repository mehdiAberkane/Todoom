import { beforeAll, describe, expect, it } from "vitest";
import type { Board, Card, HistoryEvent } from "../types";
import { isoWeek, isWeeklyName, lastWeek, oldWeeklyFiles, weekOfBoard, weeklyName, weeklyReading } from "./weekly";
import { readingChanges } from "./reading";
import { setLang } from "./i18n";

// The texts checked below are the French ones, whatever the language of the machine running the tests.
beforeAll(() => setLang("fr"));

const board = {
  id: "b",
  name: "Todoom",
  key: "TOD",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
    { id: "check", name: "A verifier" },
    { id: "done", name: "Terminé" },
  ],
  labels: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as Board;
let n = 0;
const card = (id: string, patch: Partial<Card> = {}): Card =>
  ({ id, number: ++n, boardId: "b", columnId: "todo", order: 0, title: id, description: "", labels: [], priority: null, due: null, checklist: [], links: [], branch: null, mergeRequest: null, claimedBy: null, archivedAt: null, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...patch }) as Card;
const ev = (at: string, field: HistoryEvent["field"], from: string | null, to: string | null): HistoryEvent => ({ at, by: { host: "PC" }, field, from, to });

// The week of Monday 16 to Sunday 22 November 2026 (ISO week 47), summed up on Thursday 26.
const now = new Date(2026, 10, 26, 10, 0);
const { start, end } = lastWeek(now);
const inWeek = new Date(2026, 10, 18, 12, 0).toISOString();
const before = new Date(2026, 10, 10, 12, 0).toISOString();
const after = new Date(2026, 10, 24, 12, 0).toISOString();

describe("the week", () => {
  it("is the one before, Monday to Monday, named by its ISO number", () => {
    expect(start).toEqual(new Date(2026, 10, 16));
    expect(end).toEqual(new Date(2026, 10, 23));
    expect(isoWeek(start)).toBe("2026-47");
    // Monday itself sums up the week just ended.
    expect(isoWeek(lastWeek(new Date(2026, 10, 23, 8, 0)).start)).toBe("2026-47");
    // ISO weeks across a year's end: 1 January 2027 is in 2026's week 53.
    expect(isoWeek(new Date(2027, 0, 1))).toBe("2026-53");
    expect(isoWeek(new Date(2027, 0, 4))).toBe("2027-01");
  });

  it("has a file name Todoom recognizes as its own, and only that", () => {
    expect(weeklyName("2026-47")).toBe("Semaine 2026-47.md");
    expect(isWeeklyName("Semaine 2026-47.md")).toBe(true);
    expect(isWeeklyName("Semaine 2026-47 (1).md")).toBe(false);
    expect(isWeeklyName("Ma semaine.md")).toBe(false);
  });
});

describe("what happened on a board", () => {
  const history: Record<string, HistoryEvent[]> = {
    done: [ev(before, "created", null, "À faire"), ev(inWeek, "column", "En cours", "Terminé")],
    doneBefore: [ev(before, "column", "En cours", "Terminé")],
    review: [ev(inWeek, "column", "En cours", "A verifier")],
    reviewLeft: [ev(inWeek, "column", "En cours", "A verifier"), ev(after, "column", "A verifier", "En cours")],
    created: [ev(inWeek, "created", null, "À faire")],
    linger: [ev(before, "column", "À faire", "En cours")],
    fresh: [ev(inWeek, "column", "À faire", "En cours")],
    merged: [ev(inWeek, "mergeRequest", "open https://x/1", "merged https://x/1")],
    mergedAgain: [ev(inWeek, "mergeRequest", "merged https://x/2", "merged https://x/3")],
  };
  const cards = [
    card("done", { columnId: "done" }),
    card("doneBefore", { columnId: "done" }),
    card("review", { columnId: "check" }),
    card("reviewLeft", { columnId: "doing" }),
    card("created", { createdAt: inWeek }),
    card("linger", { columnId: "doing" }),
    card("fresh", { columnId: "doing" }),
    card("merged", { columnId: "check" }),
    card("mergedAgain"),
    card("late", { due: "2026-11-20" }),
    card("lateDone", { due: "2026-11-20", columnId: "done" }),
    card("lateArchived", { due: "2026-11-20", archivedAt: inWeek }),
    card("dueAfter", { due: "2026-11-23" }),
  ];
  const w = weekOfBoard(board, cards, (id) => history[id] ?? [], start, end);
  const ids = (list: Card[]) => list.map((c) => c.id);

  it("finished, moved to review and still waiting, created, merged: from the history, within the week", () => {
    expect(ids(w.finished)).toEqual(["done"]);
    expect(ids(w.toReview)).toEqual(["review"]);
    expect(ids(w.created)).toEqual(["created"]);
    expect(ids(w.merged)).toEqual(["merged"]);
  });

  it("overdue at the week's end, and in progress for over a week: not finished, not archived", () => {
    expect(ids(w.overdue)).toEqual(["late"]);
    expect(w.lingering.map((l) => [l.card.id, l.days])).toEqual([["linger", 12]]);
  });

  it("writes it as plain text: a total for every board first, then each board with something", () => {
    const quiet = { ...board, id: "q", name: "Calme" } as Board;
    const { name, content } = weeklyReading([board, quiet], { b: cards, q: [card("x", { boardId: "q" })] }, (id) => history[id] ?? [], now);
    expect(name).toBe("Semaine 2026-47.md");
    expect(content).toContain("TODOOM · Semaine 2026-47");
    expect(content).toContain("== Tous les tableaux ==\n\n- 1 carte terminée\n- 1 carte arrivée en « A verifier », qui y attend\n- 1 carte créée\n- 1 carte en retard\n- 1 carte en cours depuis plus d'une semaine\n- 1 PR/MR fusionnée");
    expect(content).toContain("== Todoom ==");
    expect(content).not.toContain("== Calme ==");
    expect(content).toMatch(/TOD-\d+ {2}linger · 12 jours/);
    expect(content).not.toMatch(/\*\*|`/);
  });

  it("says so when nothing happened", () => {
    expect(weeklyReading([board], { b: [] }, () => [], now).content).toContain("(rien cette semaine)");
  });
});

describe("the files kept", () => {
  it("removes Todoom's weekly files older than the last twelve weeks, nothing else", () => {
    const names = ["Semaine 2026-47.md", "Semaine 2026-36.md", "Semaine 2026-35.md", "Semaine 2025-50.md", "Todoom.md", "Semaine 2026-30 (1).md"];
    expect(oldWeeklyFiles(names, now)).toEqual(["Semaine 2026-35.md", "Semaine 2025-50.md"]);
  });

  it("keeps them when the board summaries are brought up to date", () => {
    const { remove } = readingChanges(new Map([["Todoom.md", "x"]]), new Map(), ["Todoom.md", "Ancien.md", "Semaine 2026-47.md"]);
    expect(remove).toEqual(["Ancien.md"]);
  });
});
