// Copying a card, and moving one to another board.

import type { Board, Card } from "../types";
import { prioritiesOf } from "./priority";
import { uid } from "./ids";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Label and priority ids of `from` turned into those of `to` with the same names; the others are dropped. */
export function mapByName(card: Pick<Card, "labels" | "priority">, from: Board, to: Board): Pick<Card, "labels" | "priority"> {
  const labels = card.labels
    .map((id) => from.labels.find((l) => l.id === id)?.name)
    .map((name) => (name ? to.labels.find((l) => plain(l.name) === plain(name))?.id : undefined))
    .filter((id): id is string => !!id);
  const priorityName = prioritiesOf(from).find((p) => p.id === card.priority)?.name;
  const priority = priorityName ? (prioritiesOf(to).find((p) => plain(p.name) === plain(priorityName))?.id ?? null) : null;
  return { labels: [...new Set(labels)], priority };
}

/**
 * A copy of a card, in the same column: title, description, labels,
 * priority, due date and checklist (unticked items keep their state). Not its
 * links, comments, history, attachments, branch, merge request or taker.
 */
export function duplicateOf(card: Card, title: string, order: number, number: number, at = new Date().toISOString()): Card {
  return {
    ...card,
    id: uid(),
    number,
    title,
    order,
    checklist: card.checklist.map(({ cardId: _linked, ...i }) => ({ ...i, id: uid() })),
    links: [],
    branch: null,
    mergeRequest: null,
    claimedBy: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}
