// The « Activité » page (TOD-72): every change and comment of every board, newest
// first, to see what the agents and the other computers did. Read from what is
// already recorded (history files, comments), nothing new written. Here: picking,
// sorting and grouping, pure; ActivityPage shows them.
import type { Author, Board, Card, CardComment, HistoryEvent } from "../types";
import { toISODate } from "./utils";

/** What a change is, for the filter. */
export type ActivityKind = "created" | "moved" | "claim" | "comment" | "archive" | "other";
export const ACTIVITY_KINDS: ActivityKind[] = ["created", "moved", "claim", "comment", "archive", "other"];

/** The tool that wrote a history file, from its name (see writerName): the app, the command, the MCP server, the agent. */
export type Tool = "app" | "cli" | "mcp" | "agent";

export interface ActivityItem {
  at: string;
  by: Author;
  /** Known for history (by its file's name); not for a comment. */
  tool?: Tool;
  kind: ActivityKind;
  board: Board;
  card: Card;
  event?: HistoryEvent;
  comment?: CardComment;
}

export type Period = "today" | "yesterday" | "week";
export const PERIODS: Period[] = ["today", "yesterday", "week"];

/** The period's start (included) and end (excluded), in local days. */
export function periodRange(period: Period, now = new Date()): { since: string; until: string } {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).toISOString();
  if (period === "today") return { since: day(0), until: day(1) };
  if (period === "yesterday") return { since: day(-1), until: day(0) };
  return { since: day(-6), until: day(1) };
}

export const toolOf = (writer: string): Tool => (writer.endsWith("-cli") ? "cli" : writer.endsWith("-mcp") ? "mcp" : writer.endsWith("-agent") ? "agent" : "app");

export function kindOf(e: HistoryEvent): ActivityKind {
  if (e.field === "created") return "created";
  if (e.field === "column" || e.field === "board") return "moved";
  if (e.field === "claimedBy") return "claim";
  if (e.field === "archived") return "archive";
  return "other";
}

/** Who wrote it: a computer, and the agent and conversation on it. */
export const writerKey = (by: Author) => [by.host, by.agent ?? "", by.conversation ?? ""].join("|");
export const writerLabel = (by: Author) => [by.host, by.agent].filter(Boolean).join(" · ") + (by.conversation ? ` (${by.conversation})` : "");

/**
 * Everything written between `since` and `until`, newest first: the history of every
 * card (each writer's file) and the comments, on the boards given (not in the trash).
 * The period is applied before anything else, so a long history costs little.
 */
export function activityItems(
  boards: Board[],
  cards: Record<string, Card[]>,
  history: Record<string, Record<string, HistoryEvent[]>>,
  comments: Record<string, CardComment[]>,
  since: string,
  until: string,
): ActivityItem[] {
  const within = (at: string) => at >= since && at < until;
  const items: ActivityItem[] = [];
  for (const board of boards) {
    if (board.archivedAt) continue;
    for (const card of cards[board.id] ?? []) {
      for (const [writer, events] of Object.entries(history[card.id] ?? {}))
        for (const event of events) if (within(event.at)) items.push({ at: event.at, by: event.by, tool: toolOf(writer), kind: kindOf(event), board, card, event });
      for (const comment of comments[card.id] ?? []) if (within(comment.createdAt)) items.push({ at: comment.createdAt, by: comment.author, kind: "comment", board, card, comment });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export interface ActivityFilter {
  writer?: string;
  board?: string;
  kind?: ActivityKind;
}

export const filterActivity = (items: ActivityItem[], f: ActivityFilter) =>
  items.filter((i) => (!f.writer || writerKey(i.by) === f.writer) && (!f.board || i.board.id === f.board) && (!f.kind || i.kind === f.kind));

/** The writers seen, most active first, for the filter. */
export function writersOf(items: ActivityItem[]): { key: string; label: string; count: number }[] {
  const out = new Map<string, { key: string; label: string; count: number }>();
  for (const i of items) {
    const key = writerKey(i.by);
    const entry = out.get(key) ?? { key, label: writerLabel(i.by), count: 0 };
    entry.count++;
    out.set(key, entry);
  }
  return [...out.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface Session {
  writer: string;
  label: string;
  /** Local day and hour, "2026-11-26 21". */
  hour: string;
  items: ActivityItem[];
}

const hourOf = (at: string) => {
  const d = new Date(at);
  return `${toISODate(d)} ${String(d.getHours()).padStart(2, "0")}`;
};

/** Items in a row by the same writer in the same hour: an agent's session reads at a glance. */
export function sessions(items: ActivityItem[]): Session[] {
  const out: Session[] = [];
  for (const item of items) {
    const writer = writerKey(item.by);
    const hour = hourOf(item.at);
    const last = out[out.length - 1];
    if (last && last.writer === writer && last.hour === hour) last.items.push(item);
    else out.push({ writer, label: writerLabel(item.by), hour, items: [item] });
  }
  return out;
}

/** Taken without anything happening on it for this long: maybe a lock left by a closed conversation. */
export const STALE_CLAIM_HOURS = 24;

/**
 * Cards someone holds with nothing written on them (history, comment) since the
 * claim or for STALE_CLAIM_HOURS, oldest first. Over the whole history, not the
 * period shown.
 */
export function staleClaims(
  boards: Board[],
  cards: Record<string, Card[]>,
  history: Record<string, Record<string, HistoryEvent[]>>,
  comments: Record<string, CardComment[]>,
  now = Date.now(),
): { board: Board; card: Card; since: string }[] {
  const out: { board: Board; card: Card; since: string }[] = [];
  for (const board of boards) {
    if (board.archivedAt) continue;
    for (const card of cards[board.id] ?? []) {
      if (!card.claimedBy || card.archivedAt) continue;
      const dates = [card.claimedBy.at, ...Object.values(history[card.id] ?? {}).flat().map((e) => e.at), ...(comments[card.id] ?? []).map((c) => c.createdAt)];
      const last = dates.filter(Boolean).sort().pop()!;
      if (now - Date.parse(last) >= STALE_CLAIM_HOURS * 3_600_000) out.push({ board, card, since: last });
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}
