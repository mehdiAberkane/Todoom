import { locale, t } from "./i18n";

export { nextUpdatedAt, now, uid } from "./ids";

/** Colors a card's band can take: bright enough on the dark and the light theme. */
export const CARD_COLORS = ["#ff4d2e", "#ff9f1c", "#ffd23f", "#3ddc84", "#2ec4b6", "#3a86ff", "#8338ec", "#ff5fa2", "#8d99ae"];

export const LABEL_COLORS = [
  "#ff4d2e", "#ff9f1c", "#ffd23f", "#3ddc84", "#2ec4b6",
  "#3a86ff", "#8338ec", "#ff5fa2", "#8d99ae", "#6b4f3a",
];

/** Position between two neighbours; `null` when they are too close and the column needs renumbering. */
export function orderBetween(prev?: number, next?: number): number | null {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  const mid = (prev + next) / 2;
  return mid > prev && mid < next ? mid : null;
}

/**
 * New positions once `movedId` sits at its place in `ids` (the whole list after
 * the drop). Usually only the moved item changes, to the midpoint of its
 * neighbours. When they are too close, or an item has no position yet, the list
 * is renumbered 0, 1, 2… and only the items whose position changes are returned.
 */
export function reorder(ids: string[], movedId: string, orderOf: (id: string) => number | undefined): [string, number][] {
  const i = ids.indexOf(movedId);
  if (i < 0) return [];
  if (ids.every((id) => orderOf(id) !== undefined)) {
    const order = orderBetween(i > 0 ? orderOf(ids[i - 1]) : undefined, i < ids.length - 1 ? orderOf(ids[i + 1]) : undefined);
    if (order !== null) return [[movedId, order]];
  }
  return ids.flatMap((id, index): [string, number][] => (orderOf(id) === index ? [] : [[id, index]]));
}

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export type DueStatus = "overdue" | "today" | "soon" | "later";

export function dueStatus(due: string | null): DueStatus | null {
  if (!due) return null;
  const today = toISODate(new Date());
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= addDays(3)) return "soon";
  return "later";
}

export function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

export function localGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function localSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* per-machine preference only */
  }
}

const EMPTY_COLUMN_LINES = ["emptyCol.1", "emptyCol.2", "emptyCol.3", "emptyCol.4", "emptyCol.5"] as const;

export function emptyColumnLine(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return t(EMPTY_COLUMN_LINES[Math.abs(h) % EMPTY_COLUMN_LINES.length]);
}
