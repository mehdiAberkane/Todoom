// The week in review, for the phone (TOD-71): one plain text file per week in the
// « lecture » folder, written by the app on the first opening of the next week. Built
// from the cards' history (the app, the CLI and the agents record every move), so it
// tells what happened, where the board files only tell how things are now.
import type { Board, Card, HistoryEvent } from "../types";
import { isDoneName } from "./links";
import { isReviewName } from "./sorting";
import { refOf } from "./shortid";
import { staysOf } from "./timeline";
import { formatDue, toISODate } from "./utils";
import { t, tn } from "./i18n";

/** Weekly files kept in « lecture »; older ones (by their name) are removed. */
export const WEEKS_KEPT = 12;
/** In progress longer than this, a card is said to linger. */
export const LINGER_DAYS = 7;

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const DOING_NAMES = ["en cours", "in progress", "doing"];
const isDoingName = (name: string) => DOING_NAMES.includes(plain(name));
/** "Board / Column" in a move between boards: the column is after the last " / ". */
const columnOf = (value: string | null | undefined) => (value ?? "").split(" / ").pop()!.trim();
const DAY = 86_400_000;

/** The ISO week of a date (weeks start on Monday; week 1 holds the year's first Thursday), as "2026-47". */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-${String(week).padStart(2, "0")}`;
}

/** The file of a week: « Semaine 2026-47.md », the same name in every language, so it is found again. */
export const weeklyName = (week: string) => `Semaine ${week}.md`;
const WEEKLY_NAME = /^Semaine (\d{4})-(\d{2})\.md$/;
/** Whether a file of « lecture » is one of these weekly files (only those are ever removed by their age). */
export const isWeeklyName = (name: string) => WEEKLY_NAME.test(name);

/** Monday 00:00 of the week before `now`'s, and the Monday after it (local time): the week to sum up. */
export function lastWeek(now: Date): { start: Date; end: Date } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return { start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7), end };
}

export interface WeekOfBoard {
  board: Board;
  /** Moved into a « done » column during the week. */
  finished: Card[];
  /** Moved into « A verifier » during the week, and still there. */
  toReview: Card[];
  created: Card[];
  /** Not finished, due before the week's end. */
  overdue: Card[];
  /** In « En cours » since more than LINGER_DAYS days at the week's end. */
  lingering: { card: Card; days: number }[];
  /** Their merge request became merged during the week. */
  merged: Card[];
}

/** What happened on a board between `start` (included) and `end` (excluded). */
export function weekOfBoard(board: Board, cards: Card[], historyOf: (cardId: string) => HistoryEvent[], start: Date, end: Date): WeekOfBoard {
  const from = start.toISOString();
  const to = end.toISOString();
  const within = (at: string | undefined) => !!at && at >= from && at < to;
  const columnName = (card: Card) => board.columns.find((c) => c.id === card.columnId)?.name ?? "";
  const out: WeekOfBoard = { board, finished: [], toReview: [], created: [], overdue: [], lingering: [], merged: [] };
  for (const card of cards) {
    const history = historyOf(card.id);
    const moves = history.filter((e) => e.field === "column" || e.field === "board");
    const movedInto = (test: (name: string) => boolean) => moves.some((e) => within(e.at) && test(columnOf(e.to)));
    const created = history.find((e) => e.field === "created")?.at ?? card.createdAt;
    if (within(created)) out.created.push(card);
    if (movedInto(isDoneName)) out.finished.push(card);
    if (!card.archivedAt && isReviewName(columnName(card)) && movedInto(isReviewName)) out.toReview.push(card);
    if (history.some((e) => e.field === "mergeRequest" && within(e.at) && (e.to ?? "").startsWith("merged ") && !(e.from ?? "").startsWith("merged "))) out.merged.push(card);
    if (card.archivedAt || isDoneName(columnName(card))) continue;
    if (card.due && card.due < toISODate(end)) out.overdue.push(card);
    if (isDoingName(columnName(card))) {
      const stay = staysOf(card, board, history).pop();
      const days = stay && !stay.guessed ? Math.floor((end.getTime() - Date.parse(stay.from)) / DAY) : 0;
      if (days > LINGER_DAYS) out.lingering.push({ card, days });
    }
  }
  out.overdue.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  out.lingering.sort((a, b) => b.days - a.days);
  return out;
}

const KINDS = ["finished", "toReview", "created", "overdue", "lingering", "merged"] as const;
type Kind = (typeof KINDS)[number];
const count = (w: WeekOfBoard, kind: Kind) => w[kind].length;

const line = (board: Board, card: Card, more?: string) =>
  `- ${[refOf(board, card), card.title.trim() || t("export.untitled")].filter(Boolean).join("  ")}${more ? ` · ${more}` : ""}`;

/**
 * The week's file: a total for every board at the top, then each board where
 * something happened, a section per kind. Plain text, as the other files of
 * « lecture » (the Drive app shows it raw).
 */
export function weeklyReading(
  boards: Board[],
  cards: Record<string, Card[]>,
  historyOf: (cardId: string) => HistoryEvent[],
  now = new Date(),
): { name: string; content: string } {
  const { start, end } = lastWeek(now);
  const week = isoWeek(start);
  const last = new Date(end.getTime() - DAY);
  const weeks = boards.filter((b) => !b.archivedAt).map((b) => weekOfBoard(b, cards[b.id] ?? [], historyOf, start, end));
  const total = (kind: Kind) => weeks.reduce((n, w) => n + count(w, kind), 0);
  const out = [
    `TODOOM · ${t("weekly.title", { week })}`,
    t("weekly.span", { from: formatDue(toISODate(start)), to: formatDue(toISODate(last)) }),
    "",
    `== ${t("weekly.total")} ==`,
    "",
    ...KINDS.map((kind) => `- ${tn(`weekly.${kind}`, total(kind))}`),
    "",
  ];
  const busy = weeks.filter((w) => KINDS.some((kind) => count(w, kind)));
  if (!busy.length) out.push(`  (${t("weekly.nothing")})`, "");
  for (const w of busy) {
    out.push(`== ${w.board.name} ==`, "");
    for (const kind of KINDS) {
      if (!count(w, kind)) continue;
      out.push(tn(`weekly.${kind}`, count(w, kind)));
      if (kind === "lingering") out.push(...w.lingering.map((l) => line(w.board, l.card, tn("weekly.days", l.days))));
      else if (kind === "overdue") out.push(...w.overdue.map((c) => line(w.board, c, formatDue(c.due!))));
      else out.push(...w[kind].map((c) => line(w.board, c)));
      out.push("");
    }
  }
  return { name: weeklyName(week), content: out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n" };
}

/** The weekly files to remove: those of Todoom (by their name) older than the WEEKS_KEPT latest weeks. */
export function oldWeeklyFiles(names: string[], now = new Date()): string[] {
  const oldest = isoWeek(new Date(lastWeek(now).start.getTime() - (WEEKS_KEPT - 1) * 7 * DAY));
  return names.filter((n) => {
    const m = n.match(WEEKLY_NAME);
    return !!m && `${m[1]}-${m[2]}` < oldest;
  });
}
