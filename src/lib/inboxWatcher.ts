// Turns the inbox's files into cards (see inbox.ts), whenever the folder is
// read again (the file watcher sees the phone's file arrive) and every minute.
import { useEffect, useRef, useState } from "react";
import type { AppSettings, Board, Card } from "../types";
import { backend } from "./backend";
import { captureBoard, topOrder } from "./capture";
import { inboxCard, inboxCardId, inboxProblem, isInboxCandidate } from "./inbox";
import { notifySettings } from "./notify";
import { show } from "./notifier";
import { t } from "./i18n";

export interface InboxIssue {
  name: string;
  problem: "tooBig" | "notText" | "noBoard" | "unreadable";
}

interface Actions {
  draftCard: (board: Board, columnId: string, title: string, order: number) => Card;
  saveCard: (card: Card) => void;
  untracked: (change: () => void) => void;
}

export function useInbox(
  enabled: boolean,
  ready: boolean,
  boards: Board[],
  cards: Record<string, Card[]>,
  unsavedIds: Set<string>,
  settings: AppSettings,
  actions: Actions,
): InboxIssue[] {
  const [issues, setIssues] = useState<InboxIssue[]>([]);
  const [minute, setMinute] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!enabled || !ready) return;
    const id = window.setTimeout(async () => {
      if (running.current) return;
      running.current = true;
      try {
        const found: InboxIssue[] = [];
        const added: string[] = [];
        const known = new Map(Object.values(cards).flat().map((c) => [c.id, c]));
        // The top of each column as cards are added: two ideas of one pass don't share a place.
        const tops = new Map<string, number>();
        for (const file of (await backend.listInbox()).filter((f) => isInboxCandidate(f.name))) {
          const big = inboxProblem(file);
          if (big) {
            found.push({ name: file.name, problem: big });
            continue;
          }
          let content: string;
          try {
            content = await backend.readInbox(file.name);
          } catch {
            found.push({ name: file.name, problem: "unreadable" });
            continue;
          }
          const bad = inboxProblem(file, content);
          if (bad) {
            found.push({ name: file.name, problem: bad });
            continue;
          }
          const id = inboxCardId(file.name, content);
          // Its card is in the folder (written here or by the other computer): the file can go.
          if (known.has(id)) {
            if (!unsavedIds.has(id)) await backend.removeInbox(file.name);
            continue;
          }
          const board = captureBoard(boards, settings.captureBoard);
          const column = board?.columns[0];
          if (!board || !column) {
            found.push({ name: file.name, problem: "noBoard" });
            continue;
          }
          const { title, description } = inboxCard(file.name, content);
          const orders = (cards[board.id] ?? []).filter((c) => c.columnId === column.id && !c.archivedAt).map((c) => c.order);
          const order = tops.has(column.id) ? tops.get(column.id)! - 1 : topOrder(orders);
          tops.set(column.id, order);
          const card = { ...actions.draftCard(board, column.id, title, order), id, description };
          actions.untracked(() => actions.saveCard(card));
          known.set(id, card);
          added.push(title);
        }
        setIssues(found);
        if (added.length && notifySettings(settings).enabled) {
          show([{ title: t("inbox.notifyTitle"), body: added.length === 1 ? added[0] : t("inbox.notifyMany", { n: added.length }) }]).catch(() => {});
        }
      } catch (e) {
        console.warn("boîte de réception", e);
      } finally {
        running.current = false;
      }
    }, 1500);
    return () => window.clearTimeout(id);
  }, [enabled, ready, boards, cards, unsavedIds, settings, actions, minute]);

  return issues;
}
