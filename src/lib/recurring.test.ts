import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { isAsleep, nextDue, nextOfRoutine, pendingRepeats, successorId, successorOf, wakeOnFor } from "./recurring";
import { ID_PATTERN } from "./validate";

const board = {
  id: "b",
  name: "Maison",
  columns: [
    { id: "todo", name: "À faire" },
    { id: "done", name: "Terminé" },
  ],
  labels: [],
} as unknown as Board;
const card = (extra: Partial<Card> = {}) =>
  ({
    id: "c1",
    number: 7,
    boardId: "b",
    columnId: "done",
    order: 3,
    title: "Sortir les poubelles",
    description: "Le jaune aussi",
    labels: ["l"],
    priority: "p1",
    due: "2026-11-17",
    checklist: [{ id: "i", text: "Verre", done: true, cardId: "x" }],
    links: [{ type: "relatesTo", cardId: "z" }],
    branch: "feat/x",
    mergeRequest: null,
    claimedBy: { host: "PC", at: "" },
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    repeat: { every: "week" },
    color: "#3a86ff",
    ...extra,
  }) as Card;

describe("next due date", () => {
  it("comes one period after the last one", () => {
    expect(nextDue("2026-11-21", { every: "day" }, "2026-11-20")).toBe("2026-11-22");
    expect(nextDue("2026-11-23", { every: "week" }, "2026-11-21")).toBe("2026-11-30");
    expect(nextDue("2026-11-15", { every: "month" }, "2026-11-15")).toBe("2026-12-15");
  });

  it("skips the dates already past", () => {
    // Weekly on Tuesdays, done on Saturday 21: next Tuesday, the 24th.
    expect(nextDue("2026-11-10", { every: "week" }, "2026-11-21")).toBe("2026-11-24");
    expect(nextDue("2026-11-01", { every: "day" }, "2026-11-21")).toBe("2026-11-22");
  });

  it("keeps a month's day, or takes the month's last day", () => {
    expect(nextDue("2026-01-31", { every: "month" }, "2026-01-31")).toBe("2026-02-28");
    expect(nextDue("2026-01-31", { every: "month" }, "2026-02-28")).toBe("2026-03-31");
  });

  it("starts from today without a due date", () => {
    expect(nextDue(null, { every: "week" }, "2026-11-21")).toBe("2026-11-28");
  });
});

describe("the next card", () => {
  it("is waited for when a repeating card is in a done column, not archived", () => {
    const cards = { b: [card(), card({ id: "c2", columnId: "todo" }), card({ id: "c3", archivedAt: "x" }), card({ id: "c4", repeat: null })] };
    expect(pendingRepeats([board], cards).map((p) => p.card.id)).toEqual(["c1"]);
  });

  it("copies the routine, unticked, in the first column, due one period later", () => {
    const next = successorOf(card(), board, "2026-11-21", 5, "2026-11-21T09:00:00.000Z");
    expect(next).toMatchObject({
      id: "c1r20261124",
      columnId: "todo",
      order: 5,
      due: "2026-11-24",
      // Weekly: it comes on the board the day before.
      wakeOn: "2026-11-23",
      title: "Sortir les poubelles",
      description: "Le jaune aussi",
      labels: ["l"],
      priority: "p1",
      color: "#3a86ff",
      repeat: { every: "week" },
      links: [],
      branch: null,
      claimedBy: null,
      createdAt: "2026-11-21T09:00:00.000Z",
    });
    expect("number" in next).toBe(false);
    expect(next.checklist).toHaveLength(1);
    expect(next.checklist[0]).toMatchObject({ text: "Verre", done: false });
    expect(next.checklist[0].id).not.toBe("i");
    expect("cardId" in next.checklist[0]).toBe(false);
  });

  it("gets the same id on every computer", () => {
    expect(successorOf(card(), board, "2026-11-21", 0).id).toBe(successorId(card(), "2026-11-24"));
  });
});

describe("the next card waits off the board (TOD-82)", () => {
  it("until a few days before it is due: the same day, the day before, a week before", () => {
    expect(wakeOnFor("2026-11-27", "day", "2026-11-26")).toBe("2026-11-27");
    expect(wakeOnFor("2026-12-03", "week", "2026-11-26")).toBe("2026-12-02");
    expect(wakeOnFor("2026-12-22", "month", "2026-11-26")).toBe("2026-12-15");
    // Across a month's end.
    expect(wakeOnFor("2027-03-03", "month", "2026-11-26")).toBe("2027-02-24");
  });

  it("not at all when that day is already here", () => {
    expect(wakeOnFor("2026-11-27", "week", "2026-11-26")).toBeNull();
    expect(wakeOnFor("2026-12-01", "month", "2026-11-26")).toBeNull();
  });

  it("is asleep before its day, on the board from that day on", () => {
    expect(isAsleep({ wakeOn: "2026-12-15" }, "2026-12-14")).toBe(true);
    expect(isAsleep({ wakeOn: "2026-12-15" }, "2026-12-15")).toBe(false);
    expect(isAsleep({ wakeOn: null }, "2026-12-14")).toBe(false);
    expect(isAsleep({}, "2026-12-14")).toBe(false);
  });

  it("a monthly routine done today comes back a week before its next due date", () => {
    const monthly = card({ due: "2026-11-22", repeat: { every: "month" } });
    const next = successorOf(monthly, board, "2026-11-26", 0);
    expect(next).toMatchObject({ due: "2026-12-22", wakeOn: "2026-12-15" });
    expect(isAsleep(next, "2026-11-26")).toBe(true);
    expect(isAsleep(next, "2026-12-15")).toBe(false);
  });
});

describe("the next card's id stays short (TOD-83)", () => {
  it("is the routine's first id and the due date, never the previous id grown by one more date", () => {
    expect(successorId({ id: "mwrs948zev4ziy" }, "2026-12-22")).toBe("mwrs948zev4ziyr20261222");
    expect(successorId({ id: "mwrs948zev4ziyr20261222" }, "2027-01-22")).toBe("mwrs948zev4ziyr20270122");
    // The chains made before this fix shrink back at their next card.
    expect(successorId({ id: "mwrs948zev4ziyr20261222r20270122r20270222" }, "2027-03-22")).toBe("mwrs948zev4ziyr20270322");
    expect(successorId({ id: "mwrs948zev4ziyr20261222-2" }, "2027-01-22", 3)).toBe("mwrs948zev4ziyr20270122-3");
  });

  it("stays a valid id of the same length over a year of a daily routine", () => {
    let current = card({ id: "mwrs948zev4ziy", due: "2026-11-26", repeat: { every: "day" } });
    for (let i = 0; i < 400; i++) {
      const found = nextOfRoutine(current, board, current.due!, 0, []);
      expect(found?.made).toBe(true);
      current = found!.next;
      expect(ID_PATTERN.test(current.id)).toBe(true);
      expect(current.id).toHaveLength(23);
    }
    expect(current.due).toBe("2027-12-31");
  });

  it("an id that would be too long still fits in 128 characters", () => {
    const long = "x".repeat(128);
    expect(successorId({ id: long }, "2026-12-22", 99).length).toBeLessThanOrEqual(128);
    expect(ID_PATTERN.test(successorId({ id: long }, "2026-12-22", 99))).toBe(true);
  });
});

describe("the next card when its id is taken", () => {
  const today = "2026-11-21";
  const done = card();
  const nextId = successorId(done, "2026-11-24");

  it("is the one another computer made already, on the board: only the repetition moves", () => {
    const other = { ...successorOf(done, board, today, 0), title: "déjà là" };
    expect(nextOfRoutine(done, board, today, 0, [done, other])).toEqual({ next: other, made: false });
  });

  it("is a new one when an archived card of the routine has that date (its due date moved back by hand)", () => {
    const old = { ...successorOf(done, board, today, 0), archivedAt: "2026-11-01T00:00:00Z" };
    const found = nextOfRoutine(done, board, today, 0, [done, old]);
    expect(found).toMatchObject({ made: true, next: { id: `${nextId}-2`, due: "2026-11-24", archivedAt: null } });
  });

  it("is none when the card can't be valid: the finished card then keeps its repetition", () => {
    expect(nextOfRoutine(card({ title: "x".repeat(600) }), board, today, 0, [])).toBeNull();
  });
});
