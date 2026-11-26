// Watches the repositories of the boards while Todoom runs (even minimized) and
// sends what changed to the PR/MR popup window: every 2 minutes while something
// can happen soon, every 10 otherwise, and at once on coming back to Todoom
// (nextLookDelay). One gh or glab launch per repository and per look.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { AppSettings, Board, Card } from "../types";
import { backend, isTauri } from "./backend";
import { openExternal } from "./open";
import { parseRepo, parseReviews, repoKey, sameUrl, type Release, type Review } from "./reviews";
import {
  allowed,
  BACK_LOOK_AFTER_MS,
  mergeOutcomes,
  nextLookDelay,
  noticesOf,
  reviewEvents,
  reviewNotifySettings,
  watchedRepos,
  type MergeOutcome,
  type NoticeEvent,
  type PrNotice,
  type Seen,
} from "./reviewWatch";

/** Main → popup: notices to show. Popup → main: ready, received (ids), open (address). */
export const PR_NOTICES = "todoom://pr-notices";
export const PR_READY = "todoom://pr-ready";
export const PR_ACK = "todoom://pr-ack";
export const PR_OPEN = "todoom://pr-open";
/** Popup → main: move a merged one's card, as offered (TOD-69). */
export const PR_MOVE = "todoom://pr-move";
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

/** What the watch asks the main window to write (TOD-69). */
export interface MergeHandlers {
  /** The cards whose PR/MR was merged or closed: their state, and the move when the board says so. */
  apply: (outcomes: (MergeOutcome & { board: Board })[]) => void;
  /** « Move to A verifier » clicked in the popup. */
  move: (boardId: string, cardId: string, columnId: string) => void;
}

export function usePrWatch(ready: boolean, boards: Board[], cards: Record<string, Card[]>, settings: AppSettings, merge?: MergeHandlers) {
  // Read at each look, so the 2 minute rhythm isn't restarted by every edit.
  const latest = useRef({ boards, cards, settings, merge });
  latest.current = { boards, cards, settings, merge };
  // Sent to the popup until it says it received them (it may still be loading).
  const pending = useRef<PrNotice[]>([]);
  // The open PR/MR and the release of each repository at the last look, by "forge:host/path", for « Mon travail ».
  const [openReviews, setOpenReviews] = useState<Record<string, Review[]>>({});
  const [releases, setReleases] = useState<Record<string, Release | null>>({});
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
      listen<{ boardId: string; cardId: string; columnId: string }>(PR_MOVE, (e) => latest.current.merge?.move(e.payload.boardId, e.payload.cardId, e.payload.columnId)),
    ];
    return () => offs.forEach((off) => off.then((f) => f()));
  }, []);

  useEffect(() => {
    if (!isTauri || !ready || !repoKeys) return;
    let busy = false;
    let stopped = false;
    let timer: number | undefined;
    let lastLook = 0;
    // The open ones and the release of each repository at its last successful look: they set the pace.
    const known: Record<string, Review[]> = {};
    const building: Record<string, boolean> = {};
    // Since when Todoom is not the application in front (null: it is).
    let awaySince: number | null = document.hasFocus() ? null : Date.now();
    const look = async () => {
      if (busy) return;
      busy = true;
      lastLook = Date.now();
      try {
        const { boards, cards, settings, merge } = latest.current;
        const seen = readSeen();
        const events: NoticeEvent[] = [];
        const read: Record<string, Review[]> = {};
        const readReleases: Record<string, Release | null> = {};
        // Hosts allowed on this computer, read at each look: an answer given in the panel counts at once.
        const choices = await backend.forgeHosts().catch(() => ({}));
        for (const w of watchedRepos(boards, choices)) {
          try {
            // One gh or glab launched per repository: the open ones, the recently merged ones and the release together.
            const sets = parseReviews(w.repo.forge, await backend.listReviews(w.repo.forge, w.repo.host, w.repo.path), Date.now(), w.repo.host);
            read[w.key] = sets.open;
            readReleases[w.key] = sets.release;
            known[w.key] = sets.open;
            building[w.key] = sets.release?.state === "running";
            const result = reviewEvents(seen[w.key], sets.open, sets.merged, sets.release);
            seen[w.key] = result.next;
            const boardCards = boards.flatMap((b) => cards[b.id] ?? []);
            // The cards of every board on this repository whose PR/MR was merged or closed.
            const outcomes = boards
              .filter((b) => !b.archivedAt && b.repo && parseRepo(b.repo) && repoKey(parseRepo(b.repo)!) === w.key)
              .flatMap((b) => {
                const own = cards[b.id] ?? [];
                const bottom = (columnId: string) => own.filter((c) => c.columnId === columnId && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1) + 1;
                return mergeOutcomes(b, own, sets.merged, sets.closed, bottom).map((o) => ({ ...o, board: b }));
              });
            if (outcomes.length) merge?.apply(outcomes);
            for (const e of allowed(result.events, reviewNotifySettings(settings))) {
              const m = "review" in e ? outcomes.find((o) => sameUrl(o.review.url, e.review.url)) : undefined;
              events.push({ ...e, repo: w.repo, board: m?.board ?? w.board, cards: boardCards, ...(m ? { merge: m } : {}) });
            }
          } catch {
            // gh or glab missing, signed out, offline: the panel says why; nothing is reported here.
          }
        }
        writeSeen(seen);
        if (Object.keys(read).length) {
          setOpenReviews((current) => ({ ...current, ...read }));
          setReleases((current) => ({ ...current, ...readReleases }));
        }
        if (!events.length) return;
        pending.current = [...pending.current, ...noticesOf(events, Date.now().toString(36))];
        await invoke("open_pr_popup").catch(() => {});
        sendPending(pending.current);
      } finally {
        busy = false;
      }
    };
    // Each look sets when the next one comes (nextLookDelay).
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(run, delay);
    };
    const run = async () => {
      await look();
      schedule(nextLookDelay(Object.values(known).flat(), awaySince, Date.now(), Object.values(building).some(Boolean)));
    };
    const onBack = () => {
      awaySince = null;
      if (Date.now() - lastLook >= BACK_LOOK_AFTER_MS) run();
    };
    const onAway = () => {
      awaySince ??= Date.now();
    };
    const onVisibility = () => (document.visibilityState === "visible" ? onBack() : onAway());
    window.addEventListener("focus", onBack);
    window.addEventListener("blur", onAway);
    document.addEventListener("visibilitychange", onVisibility);
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("blur", onAway);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, repoKeys]);
  return { openReviews, releases };
}
