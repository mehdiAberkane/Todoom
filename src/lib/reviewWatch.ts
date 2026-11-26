// What changed in a repository's pull/merge requests since the last look, for
// the PR/MR popups (see PrPopupWindow): a new one opened, a CI that went red,
// one merged. The last state seen is kept per repository on this computer.

import type { AppSettings, Board, Card, Column } from "../types";
import { cardOfReview, hostAllowed, parseRepo, repoKey, sameUrl, type Release, type Repo, type Review } from "./reviews";
import { isDoneName } from "./links";
import { isReviewName } from "./sorting";
import { refOf } from "./shortid";
import { claimLabel } from "./claim";

export type PrEventKind = "opened" | "ciFailed" | "merged";
/** A release started, published, or failed (TOD-78). */
export type ReleaseEventKind = "releaseStarted" | "releasePublished" | "releaseFailed";

/** What was seen of a repository at the last look. */
export interface Seen {
  /** Open ones by address, with their CI then. */
  open: Record<string, { ci: Review["ci"] }>;
  /** Addresses of the merged ones already reported (or there at the first look). */
  merged: string[];
  /** The latest tag's release and its state; absent when not looked at yet (before TOD-78). */
  release?: { tag: string; state: Release["state"] } | null;
}

export type PrEvent = { kind: PrEventKind; review: Review } | { kind: ReleaseEventKind; release: Release };

export interface ReviewNotifySettings {
  enabled: boolean;
  opened: boolean;
  ciFailed: boolean;
  merged: boolean;
  releaseStarted: boolean;
  /** Published or failed. */
  releaseFinished: boolean;
}

/** The setting that lets an event through. */
const settingOf = (kind: PrEvent["kind"]): Exclude<keyof ReviewNotifySettings, "enabled"> =>
  kind === "releasePublished" || kind === "releaseFailed" ? "releaseFinished" : kind;

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
export function nextLookDelay(open: Review[], awaySince: number | null, now: number, releaseRunning = false): number {
  // A release being built: its end is what the popup is for, as a CI's failure.
  if (releaseRunning || open.some((r) => r.ci === "running")) return PR_WATCH_FAST_MS;
  if (awaySince !== null && now - awaySince >= AWAY_LONG_MS) return PR_WATCH_SLOW_MS;
  return open.some((r) => !isBot(r)) ? PR_WATCH_FAST_MS : PR_WATCH_SLOW_MS;
}

/** All on unless turned off in the settings. */
export function reviewNotifySettings(settings: AppSettings): ReviewNotifySettings {
  const n = settings.reviewNotifications;
  return {
    enabled: n?.enabled ?? true,
    opened: n?.opened ?? true,
    ciFailed: n?.ciFailed ?? true,
    merged: n?.merged ?? true,
    releaseStarted: n?.releaseStarted ?? true,
    releaseFinished: n?.releaseFinished ?? true,
  };
}

/** Dependabot, Renovate, GitHub Apps, GitLab bot users. */
export const isBot = (review: Review) => review.bot === true || /bot\]?$|^(dependabot|renovate)|_bot_/i.test(review.author);

/**
 * The events between what was seen and what is there now. The first look
 * (nothing seen yet) reports nothing: it only records the state. Robots only
 * report a CI going red.
 */
export function reviewEvents(prev: Seen | undefined, open: Review[], merged: Review[], release: Release | null = null): { events: PrEvent[]; next: Seen } {
  const next: Seen = {
    open: Object.fromEntries(open.map((r) => [r.url, { ci: r.ci }])),
    // Kept while GitHub/GitLab still list them as recent, so none is reported twice.
    merged: [...new Set([...merged.map((r) => r.url), ...(prev?.merged ?? []).filter((u) => merged.some((r) => r.url === u))])],
    release: release && { tag: release.tag, state: release.state },
  };
  if (!prev) return { events: [], next };
  const events: PrEvent[] = releaseEvents(prev, release);
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

/**
 * A release's events: started when a new tag is being built, or the tag seen being
 * built is no longer; published or failed when it ends. A new tag already finished
 * between two looks reports its end only. Nothing when the release was never
 * looked at before (the first look after TOD-78).
 */
function releaseEvents(prev: Seen, release: Release | null): PrEvent[] {
  if (!release || prev.release === undefined) return [];
  const before = prev.release && prev.release.tag === release.tag ? prev.release.state : null;
  if (before === release.state) return [];
  if (release.state === "running") return [{ kind: "releaseStarted", release }];
  // Ended: after running, as a new tag seen only once done, or re-run after a failure.
  return [{ kind: release.state === "success" ? "releasePublished" : "releaseFailed", release }];
}

/** The events the settings let through. */
export const allowed = (events: PrEvent[], s: ReviewNotifySettings) => (s.enabled ? events.filter((e) => s[settingOf(e.kind)]) : []);

/** What a popup shows. */
export interface PrNotice {
  id: string;
  kind: PrEvent["kind"] | "more";
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
  /**
   * A merged one's card (TOD-69): moved to `column`, to move at a click (propose),
   * or left where it is because someone has taken it (held, by `heldBy`).
   */
  merge?: { outcome: "moved" | "propose" | "held"; column: string; columnId: string; boardId: string; cardId: string; heldBy?: string };
}

export const MAX_POPUPS = 3;

/** A merged one's event, with what was done with its card. */
export type NoticeEvent = PrEvent & { repo: Repo; board: Board; cards: Card[]; merge?: MergeOutcome & { board: Board } };

/** One notice per event, at most MAX_POPUPS, then one saying how many more. */
export function noticesOf(events: NoticeEvent[], stamp: string): PrNotice[] {
  const shown = events.slice(0, events.length > MAX_POPUPS ? MAX_POPUPS - 1 : MAX_POPUPS);
  const notices: PrNotice[] = shown.map((e, i) => {
    // A release: its tag in place of a number, nobody's, no card.
    if (!("review" in e)) return { id: `${stamp}-${i}`, kind: e.kind, repo: e.repo.path, number: e.release.tag, title: "", author: "", url: e.release.url, card: null };
    const card = cardOfReview(e.review, e.cards);
    const m = e.merge;
    return {
      id: `${stamp}-${i}`,
      kind: e.kind,
      repo: e.repo.path,
      number: `${e.repo.forge === "gitlab" ? "!" : "#"}${e.review.number}`,
      title: e.review.title,
      author: e.review.author,
      url: e.review.url,
      card: card ? (refOf(e.board, card) ?? card.title) : null,
      ...(m && m.outcome !== "state" && m.column
        ? {
            merge: {
              outcome: m.outcome,
              column: m.column.name,
              columnId: m.column.id,
              boardId: m.board.id,
              cardId: m.card.id,
              ...(m.outcome === "held" && m.card.claimedBy ? { heldBy: claimLabel(m.card.claimedBy) } : {}),
            },
          }
        : {}),
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

// ---- A card's pull/merge request merged or closed (TOD-69) -------------------

export type MergeAction = "none" | "propose" | "move";

/**
 * What a board does when a card's PR/MR is merged, and where to: the column chosen,
 * else the one named « A verifier ». Never a done column: that step is the user's.
 */
export function mergeSetting(board: Board): { action: MergeAction; column: Column | null } {
  const action = board.onMerge?.action ?? "propose";
  // A done column chosen (the file is shared, anyone may write it) counts as none chosen.
  const chosen = board.onMerge?.columnId ? board.columns.find((c) => c.id === board.onMerge!.columnId && !isDoneName(c.name)) : undefined;
  return { action, column: chosen ?? board.columns.find((c) => isReviewName(c.name)) ?? null };
}

/** Whether a card can still go to that column: not there yet, not finished, not archived. */
export function mayMoveOnMerge(card: Card, board: Board, column: Column | null): column is Column {
  if (!column || card.archivedAt || card.columnId === column.id) return false;
  const current = board.columns.find((c) => c.id === card.columnId);
  return !current || !isDoneName(current.name);
}

export interface MergeOutcome {
  review: Review;
  /** The card as it is, and as it should be written. */
  card: Card;
  next: Card;
  /**
   * state: only its merge request's state changes. moved: it goes to the column too.
   * propose: it may go there, at the user's word. held: it should have moved, but
   * someone has taken it, so it stays and the popup says why.
   */
  outcome: "state" | "moved" | "propose" | "held";
  column: Column | null;
}

/**
 * The cards of a board whose PR/MR was just merged or closed, and what to do with
 * them. A merged one: its card is the one with its address, else the one on its
 * branch that has none; its state becomes merged, once (a card already merged is
 * left alone, so two computers, or a card moved back by hand, don't move it again).
 * A closed one: only the card with its address, state closed, never moved.
 * `bottom` gives the order at the bottom of a column.
 */
export function mergeOutcomes(board: Board, cards: Card[], merged: Review[], closed: Review[], bottom: (columnId: string) => number): MergeOutcome[] {
  const live = cards.filter((c) => !c.archivedAt);
  const { action, column } = mergeSetting(board);
  const out: MergeOutcome[] = [];
  const done = new Set<string>();
  for (const review of merged) {
    const card =
      live.find((c) => c.mergeRequest && sameUrl(c.mergeRequest.url, review.url)) ??
      (review.branch ? live.find((c) => !c.mergeRequest && c.branch === review.branch) : undefined);
    if (!card || done.has(card.id) || card.mergeRequest?.state === "merged") continue;
    done.add(card.id);
    const next: Card = { ...card, mergeRequest: { url: card.mergeRequest?.url ?? review.url, state: "merged" } };
    const movable = action !== "none" && mayMoveOnMerge(card, board, column);
    if (!movable) out.push({ review, card, next, outcome: "state", column });
    else if (action === "propose") out.push({ review, card, next, outcome: "propose", column });
    else if (card.claimedBy) out.push({ review, card, next, outcome: "held", column });
    else out.push({ review, card, next: { ...next, columnId: column.id, order: bottom(column.id) }, outcome: "moved", column });
  }
  for (const review of closed) {
    const card = live.find((c) => c.mergeRequest?.state === "open" && sameUrl(c.mergeRequest.url, review.url));
    if (!card || done.has(card.id)) continue;
    done.add(card.id);
    out.push({ review, card, next: { ...card, mergeRequest: { ...card.mergeRequest!, state: "closed" } }, outcome: "state", column: null });
  }
  return out;
}
