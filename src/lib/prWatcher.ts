// Watches the repositories of the boards every 2 minutes while Todoom runs
// (even minimized) and sends what changed to the PR/MR popup window.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { AppSettings, Board, Card } from "../types";
import { backend, isTauri } from "./backend";
import { openExternal } from "./open";
import { parseReviews, recentlyMerged, type Review } from "./reviews";
import { allowed, noticesOf, reviewEvents, reviewNotifySettings, watchedRepos, type PrNotice, type Seen } from "./reviewWatch";

export const PR_WATCH_MS = 2 * 60_000;
/** Main → popup: notices to show. Popup → main: ready, received (ids), open (address). */
export const PR_NOTICES = "todoom://pr-notices";
export const PR_READY = "todoom://pr-ready";
export const PR_ACK = "todoom://pr-ack";
export const PR_OPEN = "todoom://pr-open";
const POPUP = "prpopup";

// What was last seen of each repository, on this computer only (not in Drive).
const SEEN_KEY = "todoom-pr-seen";
function readSeen(): Record<string, Seen> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function writeSeen(seen: Record<string, Seen>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* at worst, the next look starts over without reporting */
  }
}

/** Sent again until the popup acknowledges them: it may still be loading. */
function sendPending(notices: PrNotice[]) {
  if (notices.length) emitTo(POPUP, PR_NOTICES, notices).catch(() => {});
}

export function usePrWatch(ready: boolean, boards: Board[], cards: Record<string, Card[]>, settings: AppSettings) {
  // Read at each look, so the 2 minute rhythm isn't restarted by every edit.
  const latest = useRef({ boards, cards, settings });
  latest.current = { boards, cards, settings };
  // Sent to the popup until it says it received them (it may still be loading).
  const pending = useRef<PrNotice[]>([]);
  // The open PR/MR of each repository at the last look, by "forge:host/path", for « Mon travail ».
  const [openReviews, setOpenReviews] = useState<Record<string, Review[]>>({});
  const repoKeys = watchedRepos(boards)
    .map((w) => w.key)
    .join(" ");

  useEffect(() => {
    if (!isTauri) return;
    const offs = [
      listen(PR_READY, () => sendPending(pending.current)),
      listen<string[]>(PR_ACK, (e) => {
        pending.current = pending.current.filter((n) => !e.payload.includes(n.id));
      }),
      listen<string>(PR_OPEN, (e) => openExternal(e.payload)),
    ];
    return () => offs.forEach((off) => off.then((f) => f()));
  }, []);

  useEffect(() => {
    if (!isTauri || !ready || !repoKeys) return;
    let busy = false;
    const look = async () => {
      if (busy) return;
      busy = true;
      try {
        const { boards, cards, settings } = latest.current;
        const seen = readSeen();
        const events: Parameters<typeof noticesOf>[0] = [];
        const read: Record<string, Review[]> = {};
        // Hosts allowed on this computer, read at each look: an answer given in the panel counts at once.
        const choices = await backend.forgeHosts().catch(() => ({}));
        for (const w of watchedRepos(boards, choices)) {
          try {
            const [open, merged] = await Promise.all([
              backend.listReviews(w.repo.forge, w.repo.host, w.repo.path),
              backend.listReviews(w.repo.forge, w.repo.host, w.repo.path, true),
            ]);
            const openList = parseReviews(w.repo.forge, open);
            read[w.key] = openList;
            const result = reviewEvents(seen[w.key], openList, recentlyMerged(parseReviews(w.repo.forge, merged)));
            seen[w.key] = result.next;
            const boardCards = boards.flatMap((b) => cards[b.id] ?? []);
            for (const e of allowed(result.events, reviewNotifySettings(settings))) events.push({ ...e, repo: w.repo, board: w.board, cards: boardCards });
          } catch {
            // gh or glab missing, signed out, offline: the panel says why; nothing is reported here.
          }
        }
        writeSeen(seen);
        if (Object.keys(read).length) setOpenReviews((current) => ({ ...current, ...read }));
        if (!events.length) return;
        pending.current = [...pending.current, ...noticesOf(events, Date.now().toString(36))];
        await invoke("open_pr_popup").catch(() => {});
        sendPending(pending.current);
      } finally {
        busy = false;
      }
    };
    look();
    const id = window.setInterval(look, PR_WATCH_MS);
    return () => window.clearInterval(id);
  }, [ready, repoKeys]);
  return openReviews;
}
