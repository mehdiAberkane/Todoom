// Keyboard helpers shared by the board and the app.

/** True while the user types in a field: one-letter shortcuts must not steal the key. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** A window is open (card editor, search…): board shortcuts wait. */
export const modalOpen = () => !!document.querySelector(".modal");

/** The card that has the keyboard focus, if any. */
export function focusedCardId(): string | null {
  const el = document.activeElement as HTMLElement | null;
  return el?.closest?.("[data-card-id]")?.getAttribute("data-card-id") ?? null;
}

export function focusCard(id: string | null | undefined) {
  if (id) (document.querySelector(`[data-card-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
}

/**
 * The card an arrow key leads to. `columns` are the visible card ids, column
 * by column. Up and down stay in the column; left and right jump to the
 * nearest column holding cards, at the same height or its last card.
 * With nothing focused, the first card of the board.
 */
export function nextCard(columns: string[][], current: string | null, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): string | null {
  const col = current ? columns.findIndex((c) => c.includes(current)) : -1;
  if (col < 0) return columns.find((c) => c.length)?.[0] ?? null;
  const row = columns[col].indexOf(current!);
  if (key === "ArrowUp") return columns[col][Math.max(0, row - 1)];
  if (key === "ArrowDown") return columns[col][Math.min(columns[col].length - 1, row + 1)];
  const step = key === "ArrowRight" ? 1 : -1;
  for (let i = col + step; i >= 0 && i < columns.length; i += step) {
    if (columns[i].length) return columns[i][Math.min(row, columns[i].length - 1)];
  }
  return current;
}

/** The shortcuts, as listed in the help (key, description key). */
export const SHORTCUTS: [string, string][] = [
  ["Ctrl + K", "keys.palette"],
  ["Ctrl + Maj + F", "keys.searchAll"],
  ["/", "keys.search"],
  ["N", "keys.newCard"],
  ["← ↑ → ↓", "keys.arrows"],
  ["E, Entrée", "keys.edit"],
  ["A", "keys.archive"],
  ["Ctrl + Z", "keys.undo"],
  ["Ctrl + clic, Maj + clic", "keys.select"],
  ["Ctrl + Entrée", "keys.save"],
  ["Échap", "keys.escape"],
  ["?", "keys.help"],
];
