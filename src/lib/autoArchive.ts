// Automatic archiving: a column can archive the cards that stayed in it a
// number of days (« Terminé » after 14 days, say). The app does it when it
// reads the folder; archived cards can still be restored from the Archives.
import type { Board, Card, HistoryEvent } from "../types";
import { staysOf } from "./timeline";

const DAY_MS = 86_400_000;

/**
 * When the card entered the column it is in, from its history. Without a
 * history that says so, its last change: later than the truth, so a card is
 * archived late rather than early.
 */
export function enteredAt(card: Card, board: Board, history: HistoryEvent[]): string {
  const stays = staysOf(card, board, history);
  const stay = stays[stays.length - 1];
  const entered = stay && !stay.guessed ? stay.from : card.updatedAt || card.createdAt;
  // A card restored from the archives starts over: it isn't archived again at once.
  const restored = history.filter((e) => e.field === "archived" && !e.to).map((e) => e.at);
  return [entered, ...restored].reduce((a, b) => (b > a ? b : a));
}

/**
 * The cards to archive now: past their column's delay. Not the ones someone
 * is working on, nor a routine waiting for its next card (see recurring.ts).
 */
export function dueForArchive(board: Board, cards: Card[], historyOf: (cardId: string) => HistoryEvent[], now = Date.now()): Card[] {
  const delays = new Map(board.columns.filter((c) => c.archiveAfter && c.archiveAfter > 0).map((c) => [c.id, c.archiveAfter! * DAY_MS]));
  if (!delays.size) return [];
  return cards.filter((card) => {
    const delay = delays.get(card.columnId);
    if (delay === undefined || card.archivedAt || card.claimedBy || card.repeat) return false;
    return now - Date.parse(enteredAt(card, board, historyOf(card.id))) >= delay;
  });
}
