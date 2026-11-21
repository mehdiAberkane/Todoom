// Undo: each action of the user (a drag, a card saved, archived or deleted, a
// column removed…) is kept as the cards and boards it changed, before and
// after. Undoing writes the « before » back, unless the card or board was
// changed since (on another computer, by an agent): that part is left alone.
import type { Board, Card, CardComment, HistoryEvent } from "../types";

export type UndoEntry =
  /** `before` null: the card was made; `after` null: it was deleted. */
  | { kind: "card"; id: string; before: Card | null; after: Card | null }
  | { kind: "board"; id: string; before: Board; after: Board };

/** What a deleted card had besides itself, to put it back. */
export interface Deleted {
  comments: CardComment[];
  history: Record<string, HistoryEvent[]>;
}

export interface UndoGroup {
  id: number;
  entries: UndoEntry[];
  /** For deleted cards, by card id. */
  deleted: Record<string, Deleted>;
}

/** Adds a change to a group; a thing changed twice keeps its first « before » and its last « after ». */
export function withEntry(entries: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const i = entries.findIndex((e) => e.kind === entry.kind && e.id === entry.id);
  if (i < 0) return [...entries, entry];
  const merged = { ...entries[i], after: entry.after } as UndoEntry;
  // Made then deleted in the same action: nothing to undo.
  if (merged.kind === "card" && !merged.before && !merged.after) return entries.filter((_, j) => j !== i);
  return entries.map((e, j) => (j === i ? merged : e));
}

const orderOnly = (a: Card, b: Card) => {
  const { order: _a, updatedAt: _ua, ...x } = a;
  const { order: _b, updatedAt: _ub, ...y } = b;
  return JSON.stringify(x) === JSON.stringify(y);
};

/** The i18n key (and its count) saying what an action did, for the « Undo » banner. */
export function describe(group: UndoGroup): { key: string; n: number } {
  const cards = group.entries.filter((e): e is Extract<UndoEntry, { kind: "card" }> => e.kind === "card");
  const boards = group.entries.filter((e): e is Extract<UndoEntry, { kind: "board" }> => e.kind === "board");
  if (boards.some((b) => b.after.columns.length < b.before.columns.length)) return { key: "undo.columnDeleted", n: 1 };
  if (boards.some((b) => !b.before.archivedAt && b.after.archivedAt)) return { key: "undo.boardTrashed", n: 1 };
  if (!cards.length) return { key: "undo.board", n: boards.length };
  // A drag rewrites the order of the cards around: only the others say what happened.
  const real = cards.filter((e) => !e.before || !e.after || !orderOnly(e.before, e.after));
  if (!real.length) return { key: "undo.moved", n: 1 };
  const n = real.length;
  const all = (test: (e: (typeof real)[number]) => boolean) => real.every(test);
  if (all((e) => !e.before)) return { key: "undo.created", n };
  if (all((e) => !e.after)) return { key: "undo.deleted", n };
  if (all((e) => !!e.before && !!e.after && !e.before.archivedAt && !!e.after.archivedAt)) return { key: "undo.archived", n };
  if (all((e) => !!e.before && !!e.after && !!e.before.archivedAt && !e.after.archivedAt)) return { key: "undo.restored", n };
  if (all((e) => !!e.before && !!e.after && (e.before.columnId !== e.after.columnId || e.before.boardId !== e.after.boardId))) return { key: "undo.moved", n };
  return { key: "undo.edited", n };
}

export interface UndoPlan {
  /** Saved back as they were (the current updatedAt kept, so the save is newer). */
  save: Card[];
  /** Made by the action: deleted again. */
  remove: Card[];
  /** Deleted by the action: written back, with their comments and history. */
  recreate: Card[];
  boards: Board[];
  /** Changed since the action: left as they are. */
  stale: number;
}

/** What undoing a group writes, given the cards and boards as they are now. */
export function undoPlan(group: UndoGroup, cardNow: (id: string) => Card | undefined, boardNow: (id: string) => Board | undefined): UndoPlan {
  const plan: UndoPlan = { save: [], remove: [], recreate: [], boards: [], stale: 0 };
  for (const e of group.entries) {
    if (e.kind === "board") {
      const now = boardNow(e.id);
      if (now && now.updatedAt === e.after.updatedAt) plan.boards.push({ ...e.before, updatedAt: now.updatedAt });
      else plan.stale++;
      continue;
    }
    const now = cardNow(e.id);
    if (!e.after) {
      if (now) plan.stale++;
      else plan.recreate.push(e.before!);
    } else if (!now || now.updatedAt !== e.after.updatedAt) plan.stale++;
    else if (!e.before) plan.remove.push(now);
    else plan.save.push({ ...e.before, updatedAt: now.updatedAt });
  }
  return plan;
}
