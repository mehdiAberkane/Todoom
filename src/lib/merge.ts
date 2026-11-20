import type { Card } from "../types";

/** Fields the card editor can change. Everything else (order, dates…) always comes from the latest file. */
export const EDITABLE = ["title", "description", "columnId", "labels", "priority", "due", "checklist"] as const;
export type Field = (typeof EDITABLE)[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields that differ between two versions of a card. */
export function changedFields(from: Card, to: Card): Field[] {
  return EDITABLE.filter((f) => !same(from[f], to[f]));
}

/**
 * While the editor is open, takes in changes made elsewhere on the fields the
 * user has not touched, so the form shows them and they survive the save.
 * `base` is the version the edits started from; returns the new base and draft.
 */
export function rebase(base: Card, draft: Card, latest: Card): { base: Card; draft: Card; incoming: Field[] } {
  const incoming = changedFields(base, latest).filter((f) => same(draft[f], base[f]));
  if (!incoming.length) return { base, draft, incoming };
  const pick = Object.fromEntries(incoming.map((f) => [f, latest[f]]));
  return { base: { ...base, ...pick }, draft: { ...draft, ...pick }, incoming };
}

/** Fields edited in the window that were also changed elsewhere, to a different value. */
export function conflicts(base: Card, draft: Card, latest: Card): Field[] {
  return changedFields(base, draft).filter((f) => !same(latest[f], base[f]) && !same(latest[f], draft[f]));
}

/**
 * Applies only the fields edited in the window onto the latest version of the
 * card, except conflicting fields where the user chose to keep the other version.
 * Returns null when there is nothing to write.
 */
export function mergeEdits(base: Card, draft: Card, latest: Card, keepTheirs: ReadonlySet<Field> = new Set()): Card | null {
  const fields = changedFields(base, draft).filter((f) => !keepTheirs.has(f) && !same(latest[f], draft[f]));
  if (!fields.length) return null;
  return { ...latest, ...Object.fromEntries(fields.map((f) => [f, draft[f]])) };
}
