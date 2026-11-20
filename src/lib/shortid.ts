// Short ticket ids such as SOL-42: a prefix per board (its key) and a number
// per card, growing on each board. The number is stored on the card, the key
// on the board, so changing a key renames every id of the board at once.
//
// Two computers can create a card at the same moment and pick the same number.
// The rules below are deterministic: every computer looking at the same files
// fixes the clash the same way (the older card keeps the number, the newer one
// takes the next free one), so their writes agree instead of fighting.

import type { Board, Card } from "../types";

export const KEY_PATTERN = /^[A-Z][A-Z0-9]{0,5}$/;
const REF_PATTERN = /^([A-Za-z][A-Za-z0-9]{0,5})-(\d{1,6})$/;
const REFS_IN_TEXT = /\b([A-Z][A-Z0-9]{0,5})-(\d{1,6})\b/g;

const letters = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim();

/**
 * A key for a board from its name: the first three letters of a one-word name
 * (Solaris → SOL), the initials of a longer one (Mon projet perso → MPP); a
 * digit is added if another board already uses it.
 */
export function deriveKey(name: string, taken: Iterable<string>): string {
  const words = letters(name).split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "").slice(0, 3);
  if (!/^[A-Z]/.test(base)) base = `T${base}`.slice(0, 4);
  if (base.length < 2) base = `${base}X`;
  const used = new Set([...taken].map((k) => k.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** The key typed by the user, cleaned; null when it can't be one. */
export function cleanKey(input: string): string | null {
  const key = letters(input).replace(/\s+/g, "");
  return KEY_PATTERN.test(key) ? key : null;
}

const validNumber = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/** Number for a new card of a board: one more than the highest, archived cards included. */
export function nextNumber(cards: Pick<Card, "number">[]): number {
  return cards.reduce((max, c) => (validNumber(c.number) && c.number > max ? c.number : max), 0) + 1;
}

/**
 * Cards that need a (new) number: those without one, and the newer of two
 * cards sharing one. Oldest first, so the result is the same on every computer.
 */
export function numbering(cards: Card[]): { card: Card; number: number }[] {
  const ordered = [...cards].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const kept = new Set<number>();
  const missing: Card[] = [];
  for (const c of ordered) {
    if (validNumber(c.number) && !kept.has(c.number)) kept.add(c.number);
    else missing.push(c);
  }
  let next = Math.max(0, ...kept) + 1;
  return missing.map((card) => ({ card, number: next++ }));
}

/** SOL-42, or null while the card has no number yet. */
export function refOf(board: Pick<Board, "key">, card: Pick<Card, "number">): string | null {
  return board.key && validNumber(card.number) ? `${board.key}-${card.number}` : null;
}

/** "SOL-42" (any case) → { key: "SOL", number: 42 }. */
export function parseRef(text: string): { key: string; number: number } | null {
  const m = REF_PATTERN.exec(text.trim());
  return m ? { key: m[1].toUpperCase(), number: Number(m[2]) } : null;
}

/** Ids such as SOL-42 written in a text, each once, in order of appearance. */
export function refsIn(text: string): string[] {
  return [...new Set([...text.matchAll(REFS_IN_TEXT)].map((m) => `${m[1]}-${Number(m[2])}`))];
}
