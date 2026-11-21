// A board as a report: Markdown (to paste or read) or CSV (for a spreadsheet).
// Cards on the board only, column by column; archived ones are left out.
import type { Board, Card } from "../types";
import { prioritiesOf } from "./priority";
import { refOf } from "./shortid";
import { claimLabel } from "./claim";
import { formatDue, toISODate } from "./utils";
import { locale, t, tn } from "./i18n";

const byOrder = (a: Card, b: Card) => a.order - b.order;
const labelNames = (board: Board, card: Card) => card.labels.map((id) => board.labels.find((l) => l.id === id)?.name).filter((n): n is string => !!n);
const priorityName = (board: Board, card: Card) => prioritiesOf(board).find((p) => p.id === card.priority)?.name ?? null;
const checklistDone = (card: Card) => card.checklist.filter((i) => i.done).length;

/** Cards on the board, column by column, in their order. */
function columnsWithCards(board: Board, cards: Card[]) {
  const live = cards.filter((c) => !c.archivedAt);
  return board.columns.map((column) => ({ column, cards: live.filter((c) => c.columnId === column.id).sort(byOrder) }));
}

/** A heading per column, a line per card with what it carries; descriptions and checklists below when asked. */
export function boardMarkdown(board: Board, cards: Card[], opts: { details?: boolean; at?: Date } = {}): string {
  const at = opts.at ?? new Date();
  const columns = columnsWithCards(board, cards);
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  const lines = [`# ${board.name}`, "", `_${tn("export.mdSubtitle", total, { date: at.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" })})}_`, ""];
  for (const { column, cards: list } of columns) {
    lines.push(`## ${column.name} (${list.length})`, "");
    if (!list.length) lines.push(`_${t("export.mdEmpty")}_`, "");
    for (const card of list) {
      const ref = refOf(board, card);
      const facts = [
        priorityName(board, card),
        labelNames(board, card).join(", ") || null,
        card.due ? t("export.mdDue", { date: formatDue(card.due) }) : null,
        card.checklist.length ? `☑ ${checklistDone(card)}/${card.checklist.length}` : null,
        card.claimedBy ? t("export.mdTakenBy", { who: claimLabel(card.claimedBy) }) : null,
        card.mergeRequest ? `[MR](${card.mergeRequest.url}) (${t(`mr.${card.mergeRequest.state}`)})` : card.branch ? `\`${card.branch}\`` : null,
      ].filter(Boolean);
      lines.push(`- ${ref ? `**${ref}** ` : ""}${card.title.trim() || t("export.untitled")}${facts.length ? ` — ${facts.join(" · ")}` : ""}`);
      if (opts.details) {
        const desc = card.description.trim();
        if (desc) lines.push(...desc.split("\n").map((l) => (l.trim() ? `  ${l}` : "")));
        for (const item of card.checklist) lines.push(`  - [${item.done ? "x" : " "}] ${item.text}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** A CSV cell: quoted when it holds the separator, a quote or a line break. */
function cell(value: string | number | null | undefined, sep: string): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A cell starting like a formula would be run by a spreadsheet: made plain text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return safe.includes(sep) || /["\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One line per card, with a header. French spreadsheets expect « ; » between
 * cells; the leading byte-order mark makes Excel read the accents right.
 */
export function boardCsv(board: Board, cards: Card[], sep = ";"): string {
  const header = ["ref", "title", "column", "priority", "labels", "due", "checklist", "takenBy", "branch", "mergeRequest", "created", "updated", "description"].map((k) => t(`export.csv.${k}` as "export.csv.ref"));
  const rows = [header];
  for (const { column, cards: list } of columnsWithCards(board, cards)) {
    for (const card of list) {
      rows.push([
        refOf(board, card) ?? "",
        card.title,
        column.name,
        priorityName(board, card) ?? "",
        labelNames(board, card).join(", "),
        card.due ?? "",
        card.checklist.length ? `${checklistDone(card)}/${card.checklist.length}` : "",
        card.claimedBy ? claimLabel(card.claimedBy) : "",
        card.branch ?? "",
        card.mergeRequest?.url ?? "",
        card.createdAt.slice(0, 10),
        card.updatedAt.slice(0, 10),
        card.description,
      ]);
    }
  }
  return "﻿" + rows.map((r) => r.map((v) => cell(v, sep)).join(sep)).join("\r\n") + "\r\n";
}

/** A file name from the board's name: letters, digits and dashes. */
export function exportFileName(board: Board, ext: "md" | "csv", at = new Date()): string {
  const base = board.name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "todoom";
  return `${base}-${toISODate(at)}.${ext}`;
}
