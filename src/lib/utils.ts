export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const now = () => new Date().toISOString();

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
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
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

const EMPTY_COLUMN_LINES = [
  "Rien ici. Suspect.",
  "Le vide intersidéral.",
  "Zéro tâche, zéro drame.",
  "Calme plat… pour l'instant.",
  "Les tickets dorment ailleurs.",
];

export function emptyColumnLine(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return EMPTY_COLUMN_LINES[Math.abs(h) % EMPTY_COLUMN_LINES.length];
}
