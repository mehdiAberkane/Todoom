// The boards in plain text, for the phone: the desktop app writes them into the
// data folder's « lecture » subfolder, which the Google Drive app opens as raw
// text. So no Markdown that only shows when rendered (bold, links, code):
// short headings, dashes, addresses written out.
import type { Board, Card } from "../types";
import { prioritiesOf } from "./priority";
import { refOf } from "./shortid";
import { claimLabel } from "./claim";
import { agenda, dueCards, type DueCard } from "./calendar";
import { myWork } from "../components/MyWork";
import { formatDue, toISODate } from "./utils";
import { locale, t, tn } from "./i18n";

export const READING_DIR = "lecture";
const TODAY_FILE = "0 - Aujourd'hui.md";

/** A file name from a board's name: what Windows, macOS and Drive all accept. */
export function readingName(name: string): string {
  const base = name
    // eslint-disable-next-line no-control-regex -- control characters are refused in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.]+$/g, "")
    .slice(0, 80)
    .trim();
  return base || "Tableau";
}

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const latest = (cards: Card[], fallback: string) => cards.reduce((m, c) => (c.updatedAt > m ? c.updatedAt : m), fallback);

/** What a card carries, on one line: priority, labels, due date, checklist, taker, branch or merge request. */
function facts(board: Board, card: Card): string {
  const labels = card.labels.map((id) => board.labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ");
  return [
    prioritiesOf(board).find((p) => p.id === card.priority)?.name,
    labels || null,
    card.due ? t("reading.due", { date: formatDue(card.due) }) : null,
    card.checklist.length ? t("reading.checklist", { done: card.checklist.filter((i) => i.done).length, n: card.checklist.length }) : null,
    card.claimedBy ? t("export.mdTakenBy", { who: claimLabel(card.claimedBy) }) : null,
    card.mergeRequest?.url ?? card.branch ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const line = (board: Board, card: Card) => `- ${[refOf(board, card), card.title.trim() || t("export.untitled")].filter(Boolean).join("  ")}`;
const indent = (text: string) => text.split("\n").map((l) => (l.trim() ? `    ${l.trimEnd()}` : ""));
/** Markdown marks that only mean something rendered: ** and __, `code`, [text](address) written as « text (address) ». */
const plainText = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");

/** One board: its columns in order, each card with what it carries, its description and checklist. */
export function boardReading(board: Board, cards: Card[]): string {
  const live = cards.filter((c) => !c.archivedAt);
  const out = [`TODOOM · ${board.name}`, `${tn("reading.cards", live.length)} · ${t("reading.updated", { when: when(latest(live, board.updatedAt)) })}`, ""];
  for (const column of board.columns) {
    const list = live.filter((c) => c.columnId === column.id).sort((a, b) => a.order - b.order);
    out.push(`== ${column.name} (${list.length}) ==`, "");
    for (const card of list) {
      out.push(line(board, card));
      const about = facts(board, card);
      if (about) out.push(`    ${about}`);
      const desc = plainText(card.description.trim());
      if (desc) out.push(...indent(desc));
      for (const item of card.checklist) out.push(`    [${item.done ? "x" : " "}] ${item.text}`);
      out.push("");
    }
    if (!list.length) out.push(`  (${t("export.mdEmpty")})`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Late, due today, due this week, and « my work », every board. */
export function todayReading(boards: Board[], cards: Record<string, Card[]>, myWorkColumns: string[], now = new Date()): string {
  const today = toISODate(now);
  const now7 = agenda(dueCards(boards, cards), today);
  const days = (from: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000);
  const item = (d: DueCard, late: boolean) =>
    `${line(d.board, d.card)}\n    ${d.board.name} · ${formatDue(d.due)}${late ? ` · ${tn("calendar.daysLate", days(d.due))}` : ""}`;
  const allCards = boards.flatMap((b) => cards[b.id] ?? []);
  const out = [`TODOOM · ${t("reading.todayTitle")}`, t("reading.updated", { when: when(latest(allCards, now.toISOString())) }), ""];
  const section = (title: string, list: DueCard[], late = false) => {
    out.push(`== ${title} (${list.length}) ==`, "");
    out.push(...(list.length ? list.map((d) => item(d, late)) : [`  (${t("reading.none")})`]), "");
  };
  section(t("calendar.overdue"), now7.overdue, true);
  section(t("calendar.today"), now7.today);
  section(t("calendar.soon"), now7.soon);
  const work = myWork(boards, cards, myWorkColumns);
  out.push(`== ${t("reading.myWork")} ==`, "");
  if (!work.length) out.push(`  (${t("reading.none")})`, "");
  for (const group of work)
    for (const column of group.columns) {
      out.push(`${group.board.name} · ${column.name}`);
      out.push(...column.cards.map((c) => line(group.board, c)), "");
    }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Every file of the « lecture » folder, by name: the today file, then one per board on the board list. */
export function readingFiles(boards: Board[], cards: Record<string, Card[]>, myWorkColumns: string[], now = new Date()): Map<string, string> {
  const live = boards.filter((b) => !b.archivedAt);
  const files = new Map<string, string>([[TODAY_FILE, todayReading(live, cards, myWorkColumns, now)]]);
  for (const board of live) {
    // Two boards with the same name: the second gets its key (or id) too.
    let name = `${readingName(board.name)}.md`;
    if (files.has(name)) name = `${readingName(board.name)} (${board.key ?? board.id.slice(0, 6)}).md`;
    files.set(name, boardReading(board, cards[board.id] ?? []));
  }
  return files;
}

/** What to write (new or changed since the last write) and what to remove (no board any more). */
export function readingChanges(next: Map<string, string>, written: Map<string, string>, existing: string[]) {
  return {
    write: [...next].filter(([name, content]) => written.get(name) !== content),
    remove: existing.filter((name) => name.endsWith(".md") && !next.has(name)),
  };
}
