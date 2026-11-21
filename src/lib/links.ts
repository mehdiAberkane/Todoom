// Links between cards, possibly on different boards. A link is stored on both
// cards, each with its own direction: "A depends on B" on A is "B blocks A" on B.

import type { Board, Card, CardLink, LinkType } from "../types";

export const LINK_TYPES: LinkType[] = ["dependsOn", "blocks", "duplicateOf", "duplicatedBy", "relatesTo"];

const INVERSE: Record<LinkType, LinkType> = {
  dependsOn: "blocks",
  blocks: "dependsOn",
  duplicateOf: "duplicatedBy",
  duplicatedBy: "duplicateOf",
  relatesTo: "relatesTo",
};

/** The same link seen from the other card; unknown types read as "related to". */
export const inverseOf = (type: string): LinkType => INVERSE[type as LinkType] ?? "relatesTo";

export const isLinkType = (type: string): type is LinkType => type in INVERSE;

/** `card` with its link to `targetId` set to `type`, replacing any other link between the two. */
export function withLink(card: Card, type: LinkType, targetId: string): Card {
  return { ...card, links: [...card.links.filter((l) => l.cardId !== targetId), { type, cardId: targetId }] };
}

export function withoutLink(card: Card, targetId: string): Card {
  return { ...card, links: card.links.filter((l) => l.cardId !== targetId) };
}

const DONE_NAMES = ["termine", "terminee", "fini", "fait", "done", "finished", "closed", "clos", "cloture"];
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * A card stops blocking once it is finished: archived, or in a column named
 * like « Terminé » or « Done ». Boards have no "done" flag on columns, so the
 * name is the signal.
 */
export function isFinished(card: Card, board: Board | undefined): boolean {
  if (card.archivedAt) return true;
  const column = board?.columns.find((c) => c.id === card.columnId);
  return !!column && DONE_NAMES.includes(plain(column.name));
}

export interface Located {
  card: Card;
  board: Board;
}

/** Every card by id, with its board, across all boards. */
export function indexCards(boards: Board[], cards: Record<string, Card[]>): Map<string, Located> {
  const index = new Map<string, Located>();
  for (const board of boards) for (const card of cards[board.id] ?? []) index.set(card.id, { card, board });
  return index;
}

/** Checklist items done: ticked, or turned into a card that is finished. */
export function checklistDone(card: Card, index: Map<string, Located>): number {
  return card.checklist.filter((i) => {
    const linked = i.cardId ? index.get(i.cardId) : undefined;
    return linked ? isFinished(linked.card, linked.board) : i.done;
  }).length;
}

/** The cards this one depends on that aren't finished yet. */
export function openBlockers(card: Card, index: Map<string, Located>): Located[] {
  return card.links
    .filter((l: CardLink) => l.type === "dependsOn")
    .map((l) => index.get(l.cardId))
    .filter((t): t is Located => !!t && !isFinished(t.card, t.board));
}
