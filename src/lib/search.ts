// Search across every board: short id, title, description, checklist,
// comments; archived cards included, trashed boards too (shown as such).

import type { Board, Card, CardComment } from "../types";
import { parseRef, refOf } from "./shortid";

export type MatchField = "ref" | "title" | "description" | "checklist" | "comment";

export interface SearchResult {
  card: Card;
  board: Board;
  /** Where the words were found first, and the text around them. */
  field: MatchField;
  snippet: string;
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const RANK: Record<MatchField, number> = { ref: 0, title: 1, description: 2, checklist: 3, comment: 4 };
const SNIPPET = 90;

/** A short piece of `text` around the first of `words`, on one line. */
function snippet(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const p = plain(flat);
  const at = Math.min(...words.map((w) => p.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at) || flat.length <= SNIPPET) return flat.slice(0, SNIPPET);
  const start = Math.max(0, at - 30);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + SNIPPET)}${start + SNIPPET < flat.length ? "…" : ""}`;
}

/**
 * Cards matching every word of `query` (case and accents ignored), each word
 * anywhere in the card. "SOL-42" (or "sol-42") finds that card first.
 * Best first: by where the words are (title before description…), cards on
 * the board before archived ones, then the most recently changed.
 */
export function searchCards(
  query: string,
  boards: Board[],
  cards: Record<string, Card[]>,
  comments: Record<string, CardComment[]>,
  limit = 50,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const ref = parseRef(q);
  const words = plain(q).split(/\s+/).filter(Boolean);
  const results: (SearchResult & { rank: number })[] = [];

  for (const board of boards) {
    for (const card of cards[board.id] ?? []) {
      const cardRef = refOf(board, card);
      if (ref && cardRef === `${ref.key}-${ref.number}`) {
        results.push({ card, board, field: "ref", snippet: card.title, rank: -1 });
        continue;
      }
      const fields: [MatchField, string][] = [
        ["title", `${cardRef ?? ""} ${card.title}`],
        ["description", card.description],
        ["checklist", card.checklist.map((i) => i.text).join(" · ")],
        ["comment", (comments[card.id] ?? []).map((c) => c.text).join(" · ")],
      ];
      const all = plain(fields.map(([, text]) => text).join("\n"));
      if (!words.every((w) => all.includes(w))) continue;
      // The first field holding one of the words says where the card was found.
      const [field, text] = fields.find(([, t]) => words.some((w) => plain(t).includes(w)))!;
      results.push({ card, board, field, snippet: field === "title" ? card.title : snippet(text, words), rank: RANK[field] });
    }
  }

  const off = (r: SearchResult) => Number(!!r.card.archivedAt || !!r.board.archivedAt);
  return results
    .sort((a, b) => a.rank - b.rank || off(a) - off(b) || b.card.updatedAt.localeCompare(a.card.updatedAt))
    .slice(0, limit)
    .map(({ rank: _rank, ...r }) => r);
}
