// « Mon travail »: the followed columns side by side with the cards of every
// board mixed (latest change first), and per project a summary of what is
// going on: cards in progress, waiting for me, open PR/MR and their CI.

import type { Board, Card } from "../types";
import { parseRepo, repoKey, shownRelease, type Release, type Review } from "./reviews";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Column names, as boards name them in French and English. */
const DOING = ["en cours", "in progress", "doing"];
const REVIEW = ["a verifier", "to review", "review"];
const FAILED = ["echec", "failed", "failure"];

export interface WorkItem {
  board: Board;
  card: Card;
}

export interface WorkColumn {
  name: string;
  items: WorkItem[];
}

/**
 * The followed columns, in the order they were chosen, each with the cards of
 * every board (or of the boards given) in a column of that name, latest change first.
 */
export function workColumns(boards: Board[], cards: Record<string, Card[]>, chosen: string[], only?: Set<string>): WorkColumn[] {
  return chosen.map((name) => {
    const key = plain(name);
    const items: WorkItem[] = [];
    let label = name;
    for (const board of boards) {
      if (board.archivedAt || (only && only.size && !only.has(board.id))) continue;
      const columnIds = new Set(board.columns.filter((c) => plain(c.name) === key).map((c) => c.id));
      // The board's own spelling (« À vérifier ») rather than the setting's.
      const own = board.columns.find((c) => plain(c.name) === key);
      if (own && label === name) label = own.name;
      for (const card of cards[board.id] ?? []) if (columnIds.has(card.columnId) && !card.archivedAt) items.push({ board, card });
    }
    items.sort((a, b) => (b.card.updatedAt ?? "").localeCompare(a.card.updatedAt ?? ""));
    return { name: label, items };
  });
}

export type ProjectState = "attention" | "active" | "paused";

export interface ProjectSummary {
  board: Board;
  doing: number;
  /** Waiting for me: in « A verifier »… */
  review: number;
  /** …and in « Echec ». */
  failed: number;
  /** The open PR/MR of its repository, null when it has none set or they aren't read yet. */
  prs: { open: number; failing: number; running: number; passing: number } | null;
  /** Its release under way, or finished in the last day (TOD-78). */
  release: Release | null;
  state: ProjectState;
}

/**
 * Waiting for me (to review, failed, a red CI, a failed release), else something moving
 * (in progress, a running CI, an open PR, a release being built), else paused.
 */
export function projectSummaries(
  boards: Board[],
  cards: Record<string, Card[]>,
  reviews: Record<string, Review[]>,
  releases: Record<string, Release | null> = {},
  now = Date.now(),
): ProjectSummary[] {
  const order: Record<ProjectState, number> = { attention: 0, active: 1, paused: 2 };
  return boards
    .filter((b) => !b.archivedAt)
    .map((board) => {
      const inColumn = (names: string[]) => {
        const ids = new Set(board.columns.filter((c) => names.includes(plain(c.name))).map((c) => c.id));
        return (cards[board.id] ?? []).filter((c) => ids.has(c.columnId) && !c.archivedAt).length;
      };
      const repo = parseRepo(board.repo);
      const open = repo ? reviews[repoKey(repo)] : undefined;
      const prs = open
        ? {
            open: open.length,
            failing: open.filter((r) => r.ci === "failure").length,
            running: open.filter((r) => r.ci === "running").length,
            passing: open.filter((r) => r.ci === "success").length,
          }
        : null;
      const release = repo ? shownRelease(releases[repoKey(repo)], now) : null;
      const summary = { board, doing: inColumn(DOING), review: inColumn(REVIEW), failed: inColumn(FAILED), prs, release };
      const state: ProjectState =
        summary.review || summary.failed || prs?.failing || release?.state === "failure"
          ? "attention"
          : summary.doing || prs?.open || release?.state === "running"
            ? "active"
            : "paused";
      return { ...summary, state };
    })
    .sort((a, b) => order[a.state] - order[b.state] || (a.board.order ?? 0) - (b.board.order ?? 0));
}
