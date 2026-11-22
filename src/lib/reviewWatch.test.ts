import { describe, expect, it } from "vitest";
import type { AppSettings, Board, Card } from "../types";
import type { Repo, Review } from "./reviews";
import { allowed, isBot, MAX_POPUPS, noticesOf, reviewEvents, reviewNotifySettings, watchedRepos, type Seen } from "./reviewWatch";

const pr = (number: number, patch: Partial<Review> = {}): Review => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  draft: false,
  branch: `feature/${number}`,
  author: "me",
  ci: "running",
  updatedAt: "2026-11-22T10:00:00Z",
  ...patch,
});
const seen = (open: Review[], merged: string[] = []): Seen => ({ open: Object.fromEntries(open.map((r) => [r.url, { ci: r.ci }])), merged });
const kinds = (r: ReturnType<typeof reviewEvents>) => r.events.map((e) => `${e.kind} ${e.review.number}`);

describe("what changed since the last look", () => {
  it("reports nothing at the first look, only records the state", () => {
    const r = reviewEvents(undefined, [pr(1, { ci: "failure" })], [pr(9, { mergedAt: "2026-11-22T09:00:00Z" })]);
    expect(r.events).toEqual([]);
    expect(r.next).toEqual({ open: { [pr(1).url]: { ci: "failure" } }, merged: [pr(9).url] });
  });

  it("reports a new one, a CI that turns red once, and a merge", () => {
    const before = seen([pr(1), pr(2, { ci: "failure" })]);
    const now = [pr(1, { ci: "failure" }), pr(2, { ci: "failure" }), pr(3)];
    const merged = [pr(4, { mergedAt: "2026-11-22T11:00:00Z" })];
    const r = reviewEvents(before, now, merged);
    expect(kinds(r)).toEqual(["ciFailed 1", "opened 3", "merged 4"]);
    // The next look, nothing new: nothing reported again.
    expect(reviewEvents(r.next, now, merged).events).toEqual([]);
  });

  it("only reports a robot's PR when its CI fails", () => {
    const bot = (n: number, patch: Partial<Review> = {}) => pr(n, { author: "dependabot", bot: true, ...patch });
    const r = reviewEvents(seen([bot(1)]), [bot(1, { ci: "failure" }), bot(2), bot(3, { ci: "failure" })], [bot(4, { mergedAt: "x" })]);
    expect(kinds(r)).toEqual(["ciFailed 1", "ciFailed 3"]);
  });

  it("tells robots by GitHub's flag or their name", () => {
    expect([pr(1, { bot: true }), pr(2, { author: "renovate" }), pr(3, { author: "github-actions[bot]" }), pr(4, { author: "project_12_bot_abc" })].every(isBot)).toBe(true);
    expect([pr(5, { author: "robert" }), pr(6, { author: "botanist" })].some(isBot)).toBe(false);
  });
});

describe("what is shown", () => {
  const repo: Repo = { forge: "github", host: "github.com", path: "o/r" };
  const board = { id: "b", key: "TOD" } as Board;
  const cards = [{ id: "c", number: 12, branch: "feature/3", mergeRequest: null } as unknown as Card];

  it("one popup per event, its card if any, then « +N more » past three", () => {
    const events = [1, 2, 3, 4, 5].map((n) => ({ kind: "opened" as const, review: pr(n), repo, board, cards }));
    const notices = noticesOf(events, "t");
    expect(notices).toHaveLength(MAX_POPUPS);
    expect(notices.map((n) => n.kind)).toEqual(["opened", "opened", "more"]);
    expect(notices[2].count).toBe(3);
    expect(noticesOf(events.slice(2, 3), "t")[0]).toMatchObject({ number: "#3", card: "TOD-12", repo: "o/r" });
  });

  it("follows the settings, all on by default", () => {
    const s = reviewNotifySettings({} as AppSettings);
    expect(s).toEqual({ enabled: true, opened: true, ciFailed: true, merged: true });
    const events = [{ kind: "opened" as const, review: pr(1) }, { kind: "merged" as const, review: pr(2) }];
    expect(allowed(events, { ...s, merged: false }).map((e) => e.kind)).toEqual(["opened"]);
    expect(allowed(events, { ...s, enabled: false })).toEqual([]);
  });

  it("watches each repository once, not those of boards in the trash", () => {
    const boards = [
      { id: "a", repo: "https://github.com/o/r" },
      { id: "b", repo: "git@github.com:o/r.git" },
      { id: "c", repo: "https://gitlab.com/g/p", archivedAt: "x" },
      { id: "d" },
    ] as Board[];
    expect(watchedRepos(boards).map((w) => [w.key, w.board.id])).toEqual([["github:github.com/o/r", "a"]]);
  });
});
