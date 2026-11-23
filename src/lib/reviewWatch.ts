// What changed in a repository's pull/merge requests since the last look, for
// the PR/MR popups (see PrPopupWindow): a new one opened, a CI that went red,
// one merged. The last state seen is kept per repository on this computer.

import type { AppSettings, Board, Card } from "../types";
import { cardOfReview, hostAllowed, parseRepo, repoKey, type Repo, type Review } from "./reviews";
import { refOf } from "./shortid";

export type PrEventKind = "opened" | "ciFailed" | "merged";

/** What was seen of a repository at the last look. */
export interface Seen {
  /** Open ones by address, with their CI then. */
  open: Record<string, { ci: Review["ci"] }>;
  /** Addresses of the merged ones already reported (or there at the first look). */
  merged: string[];
}

export interface PrEvent {
  kind: PrEventKind;
  review: Review;
}

export interface ReviewNotifySettings {
  enabled: boolean;
  opened: boolean;
  ciFailed: boolean;
  merged: boolean;
}

/** A look every 2 minutes while something can happen soon. */
export const PR_WATCH_FAST_MS = 2 * 60_000;
/** Every 10 minutes when nothing is under way, or nobody is at Todoom. */
export const PR_WATCH_SLOW_MS = 10 * 60_000;
/** Away from Todoom (window minimized, or another application in front) this long: the slow pace. */
export const AWAY_LONG_MS = 30 * 60_000;
/** Back at Todoom: a look at once, unless the last one is this recent. */
export const BACK_LOOK_AFTER_MS = 30_000;

/**
 * When to look again. A CI running somewhere: soon, even when away (its failure is
 * what the popup is for). Otherwise away for long: slowly. Otherwise a pull/merge
 * request opened by a person (it may be merged or pushed to): soon. Nothing open,
 * or only robots' (they only report a red CI): slowly. A slower look only delays a
 * notice: what changed is found by comparing with what was seen, never missed.
 */
export function nextLookDelay(open: Review[], awaySince: number | null, now: number): number {
  if (open.some((r) => r.ci === "running")) return PR_WATCH_FAST_MS;
  if (awaySince !== null && now - awaySince >= AWAY_LONG_MS) return PR_WATCH_SLOW_MS;
  return open.some((r) => !isBot(r)) ? PR_WATCH_FAST_MS : PR_WATCH_SLOW_MS;
}

/** All on unless turned off in the settings. */
export function reviewNotifySettings(settings: AppSettings): ReviewNotifySettings {
  const n = settings.reviewNotifications;
  return { enabled: n?.enabled ?? true, opened: n?.opened ?? true, ciFailed: n?.ciFailed ?? true, merged: n?.merged ?? true };
}

/** Dependabot, Renovate, GitHub Apps, GitLab bot users. */
export const isBot = (review: Review) => review.bot === true || /bot\]?$|^(dependabot|renovate)|_bot_/i.test(review.author);

/**
 * The events between what was seen and what is there now. The first look
 * (nothing seen yet) reports nothing: it only records the state. Robots only
 * report a CI going red.
 */
export function reviewEvents(prev: Seen | undefined, open: Review[], merged: Review[]): { events: PrEvent[]; next: Seen } {
  const next: Seen = {
    open: Object.fromEntries(open.map((r) => [r.url, { ci: r.ci }])),
    // Kept while GitHub/GitLab still list them as recent, so none is reported twice.
    merged: [...new Set([...merged.map((r) => r.url), ...(prev?.merged ?? []).filter((u) => merged.some((r) => r.url === u))])],
  };
  if (!prev) return { events: [], next };
  const events: PrEvent[] = [];
  for (const r of open) {
    const before = prev.open[r.url];
    if (!before) {
      if (!isBot(r)) events.push({ kind: "opened", review: r });
      else if (r.ci === "failure") events.push({ kind: "ciFailed", review: r });
    } else if (r.ci === "failure" && before.ci !== "failure") {
      events.push({ kind: "ciFailed", review: r });
    }
  }
  for (const r of merged) {
    if (!prev.merged.includes(r.url) && !isBot(r)) events.push({ kind: "merged", review: r });
  }
  return { events, next };
}

/** The events the settings let through. */
export const allowed = (events: PrEvent[], s: ReviewNotifySettings) => (s.enabled ? events.filter((e) => s[e.kind]) : []);

/** What a popup shows. */
export interface PrNotice {
  id: string;
  kind: PrEventKind | "more";
  repo: string;
  /** #12 on GitHub, !12 on GitLab. */
  number: string;
  title: string;
  author: string;
  url: string;
  /** The card it belongs to (TOD-12), if any. */
  card: string | null;
  /** For "more": how many others. */
  count?: number;
}

export const MAX_POPUPS = 3;

/** One notice per event, at most MAX_POPUPS, then one saying how many more. */
export function noticesOf(events: (PrEvent & { repo: Repo; board: Board; cards: Card[] })[], stamp: string): PrNotice[] {
  const shown = events.slice(0, events.length > MAX_POPUPS ? MAX_POPUPS - 1 : MAX_POPUPS);
  const notices: PrNotice[] = shown.map((e, i) => {
    const card = cardOfReview(e.review, e.cards);
    return {
      id: `${stamp}-${i}`,
      kind: e.kind,
      repo: e.repo.path,
      number: `${e.repo.forge === "gitlab" ? "!" : "#"}${e.review.number}`,
      title: e.review.title,
      author: e.review.author,
      url: e.review.url,
      card: card ? (refOf(e.board, card) ?? card.title) : null,
    };
  });
  const rest = events.length - shown.length;
  if (rest > 0) notices.push({ id: `${stamp}-more`, kind: "more", repo: "", number: "", title: "", author: "", url: "", card: null, count: rest });
  return notices;
}

/**
 * The repositories to watch: each one once, from the boards not in the trash, with
 * the board it is shown on. A host other than github.com or gitlab.com only once
 * allowed on this computer (choices): the address comes from a synced file.
 */
export function watchedRepos(boards: Board[], choices: Record<string, boolean> = {}): { key: string; repo: Repo; board: Board }[] {
  const out = new Map<string, { key: string; repo: Repo; board: Board }>();
  for (const board of boards) {
    if (board.archivedAt) continue;
    const repo = parseRepo(board.repo);
    if (!repo || !hostAllowed(repo, choices)) continue;
    const key = repoKey(repo);
    if (!out.has(key)) out.set(key, { key, repo, board });
  }
  return [...out.values()];
}
