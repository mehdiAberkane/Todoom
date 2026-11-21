import { describe as group, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { describe, undoPlan, withEntry, type UndoEntry, type UndoGroup } from "./undo";

const card = (id: string, extra: Partial<Card> = {}) =>
  ({ id, boardId: "b", columnId: "todo", order: 0, title: id, archivedAt: null, updatedAt: "1", ...extra }) as Card;
const board = (extra: Partial<Board> = {}) =>
  ({ id: "b", name: "B", columns: [{ id: "todo", name: "À faire" }, { id: "done", name: "Terminé" }], labels: [], updatedAt: "1", ...extra }) as Board;
const of = (entries: UndoEntry[]): UndoGroup => ({ id: 1, entries, deleted: {} });

group("what an action did", () => {
  it("names a drag, even when the cards around were reordered", () => {
    expect(describe(of([{ kind: "card", id: "a", before: card("a"), after: card("a", { columnId: "done", order: 3 }) }, { kind: "card", id: "b", before: card("b", { order: 1 }), after: card("b", { order: 2 }) }]))).toEqual({ key: "undo.moved", n: 1 });
    expect(describe(of([{ kind: "card", id: "b", before: card("b", { order: 1 }), after: card("b", { order: 2 }) }])).key).toBe("undo.moved");
  });

  it("names an archive, a restore, a deletion, a new card and an edit", () => {
    expect(describe(of([{ kind: "card", id: "a", before: card("a"), after: card("a", { archivedAt: "x" }) }])).key).toBe("undo.archived");
    expect(describe(of([{ kind: "card", id: "a", before: card("a", { archivedAt: "x" }), after: card("a") }])).key).toBe("undo.restored");
    expect(describe(of([{ kind: "card", id: "a", before: card("a"), after: null }])).key).toBe("undo.deleted");
    expect(describe(of([{ kind: "card", id: "a", before: null, after: card("a") }])).key).toBe("undo.created");
    expect(describe(of([{ kind: "card", id: "a", before: card("a"), after: card("a", { title: "New" }) }])).key).toBe("undo.edited");
    expect(describe(of([{ kind: "card", id: "a", before: card("a"), after: card("a", { archivedAt: "x" }) }, { kind: "card", id: "b", before: card("b"), after: card("b", { archivedAt: "x" }) }]))).toEqual({ key: "undo.archived", n: 2 });
  });

  it("names a column deleted with its cards archived", () => {
    const entries: UndoEntry[] = [
      { kind: "card", id: "a", before: card("a", { columnId: "done" }), after: card("a", { columnId: "done", archivedAt: "x" }) },
      { kind: "board", id: "b", before: board(), after: board({ columns: [{ id: "todo", name: "À faire" }] }) },
    ];
    expect(describe(of(entries)).key).toBe("undo.columnDeleted");
  });
});

group("grouping", () => {
  it("keeps the first state and the last one of a card changed twice", () => {
    let entries = withEntry([], { kind: "card", id: "a", before: card("a"), after: card("a", { title: "1" }) });
    entries = withEntry(entries, { kind: "card", id: "a", before: card("a", { title: "1" }), after: card("a", { title: "2" }) });
    expect(entries).toEqual([{ kind: "card", id: "a", before: card("a"), after: card("a", { title: "2" }) }]);
  });

  it("forgets a card made and deleted in the same action", () => {
    const entries = withEntry([{ kind: "card", id: "a", before: null, after: card("a") }], { kind: "card", id: "a", before: card("a"), after: null });
    expect(entries).toEqual([]);
  });
});

group("undoing", () => {
  const after = card("a", { columnId: "done", updatedAt: "5" });
  const entries: UndoEntry[] = [
    { kind: "card", id: "a", before: card("a"), after },
    { kind: "card", id: "new", before: null, after: card("new", { updatedAt: "5" }) },
    { kind: "card", id: "gone", before: card("gone"), after: null },
  ];

  it("writes back what the action changed", () => {
    const now: Record<string, Card> = { a: after, new: card("new", { updatedAt: "5" }) };
    const plan = undoPlan(of(entries), (id) => now[id], () => undefined);
    expect(plan.save).toEqual([card("a", { updatedAt: "5" })]);
    expect(plan.remove.map((c) => c.id)).toEqual(["new"]);
    expect(plan.recreate.map((c) => c.id)).toEqual(["gone"]);
    expect(plan.stale).toBe(0);
  });

  it("leaves alone what was changed since, here or elsewhere", () => {
    const now: Record<string, Card> = { a: { ...after, updatedAt: "6" }, new: card("new", { updatedAt: "5" }), gone: card("gone") };
    const plan = undoPlan(of(entries), (id) => now[id], () => undefined);
    expect(plan.save).toEqual([]);
    expect(plan.recreate).toEqual([]);
    expect(plan.stale).toBe(2);
  });

  it("puts a board back as it was, if unchanged since", () => {
    const g = of([{ kind: "board", id: "b", before: board(), after: board({ columns: [], updatedAt: "2" }) }]);
    expect(undoPlan(g, () => undefined, () => board({ columns: [], updatedAt: "2" })).boards).toEqual([board({ updatedAt: "2" })]);
    expect(undoPlan(g, () => undefined, () => board({ updatedAt: "3" })).stale).toBe(1);
  });
});
