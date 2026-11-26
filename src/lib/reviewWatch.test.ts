import { describe, expect, it } from "vitest";
import type { AppSettings, Board, Card } from "../types";
import type { Release, Repo, Review } from "./reviews";
import { allowed, AWAY_LONG_MS, isBot, MAX_POPUPS, mayMoveOnMerge, mergeOutcomes, mergeSetting, nextLookDelay, noticesOf, PR_WATCH_FAST_MS, PR_WATCH_SLOW_MS, reviewEvents, reviewNotifySettings, watchedRepos, type Seen } from "./reviewWatch";

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
const kinds = (r: ReturnType<typeof reviewEvents>) => r.events.map((e) => `${e.kind} ${"review" in e ? e.review.number : e.release.tag}`);
const release = (tag: string, state: Release["state"]): Release => ({ tag, state, url: `https://github.com/o/r/actions/runs/${tag}`, startedAt: "2026-11-26T17:09:58Z", updatedAt: "2026-11-26T17:20:00Z" });

describe("what changed since the last look", () => {
  it("reports nothing at the first look, only records the state", () => {
    const r = reviewEvents(undefined, [pr(1, { ci: "failure" })], [pr(9, { mergedAt: "2026-11-22T09:00:00Z" })]);
    expect(r.events).toEqual([]);
    expect(r.next).toEqual({ open: { [pr(1).url]: { ci: "failure" } }, merged: [pr(9).url], release: null });
  });

  it("follows a release: started, then published or failed, each once (TOD-78)", () => {
    const start = { ...seen([]), release: null };
    const started = reviewEvents(start, [], [], release("v1.2.0", "running"));
    expect(kinds(started)).toEqual(["releaseStarted v1.2.0"]);
    expect(started.next.release).toEqual({ tag: "v1.2.0", state: "running" });
    // Still building: nothing new.
    expect(reviewEvents(started.next, [], [], release("v1.2.0", "running")).events).toEqual([]);
    const done = reviewEvents(started.next, [], [], release("v1.2.0", "success"));
    expect(kinds(done)).toEqual(["releasePublished v1.2.0"]);
    expect(reviewEvents(done.next, [], [], release("v1.2.0", "success")).events).toEqual([]);
    expect(kinds(reviewEvents(started.next, [], [], release("v1.2.0", "failure")))).toEqual(["releaseFailed v1.2.0"]);
  });

  it("reports the end of a release built between two looks, and nothing the first time releases are looked at", () => {
    const before = { ...seen([]), release: { tag: "v1.1.0", state: "success" as const } };
    expect(kinds(reviewEvents(before, [], [], release("v1.2.0", "success")))).toEqual(["releasePublished v1.2.0"]);
    // Seen before TOD-78 (no release recorded): the current release is only recorded.
    const old = reviewEvents(seen([]), [], [], release("v1.2.0", "running"));
    expect(old.events).toEqual([]);
    expect(old.next.release).toEqual({ tag: "v1.2.0", state: "running" });
    // No tag, or a tag that set nothing off: nothing.
    expect(reviewEvents(before, [], [], null).events).toEqual([]);
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

  it("a release's popup: its tag, its build or release page, no card", () => {
    const [notice] = noticesOf([{ kind: "releaseFailed" as const, release: release("v1.2.0", "failure"), repo, board, cards }], "t");
    expect(notice).toEqual({ id: "t-0", kind: "releaseFailed", repo: "o/r", number: "v1.2.0", title: "", author: "", url: "https://github.com/o/r/actions/runs/v1.2.0", card: null });
  });

  it("follows the settings, all on by default", () => {
    const s = reviewNotifySettings({} as AppSettings);
    expect(s).toEqual({ enabled: true, opened: true, ciFailed: true, merged: true, releaseStarted: true, releaseFinished: true });
    const events = [{ kind: "opened" as const, review: pr(1) }, { kind: "merged" as const, review: pr(2) }];
    expect(allowed(events, { ...s, merged: false }).map((e) => e.kind)).toEqual(["opened"]);
    // A release's start and end have a setting each; the end covers published and failed.
    const r = release("v1", "success");
    const ends = [{ kind: "releaseStarted" as const, release: r }, { kind: "releasePublished" as const, release: r }, { kind: "releaseFailed" as const, release: r }];
    expect(allowed(ends, { ...s, releaseFinished: false }).map((e) => e.kind)).toEqual(["releaseStarted"]);
    expect(allowed(ends, { ...s, releaseStarted: false }).map((e) => e.kind)).toEqual(["releasePublished", "releaseFailed"]);
    expect(allowed(events, { ...s, enabled: false })).toEqual([]);
  });

  it("only watches a host other than github.com and gitlab.com once allowed on this computer", () => {
    const boards = [{ id: "a", repo: "https://evil.test/g/p" }, { id: "b", repo: "https://git.example.fr/g/p" }, { id: "c", repo: "https://gitlab.com/g/p" }] as Board[];
    expect(watchedRepos(boards).map((w) => w.board.id)).toEqual(["c"]);
    expect(watchedRepos(boards, { "evil.test": false, "git.example.fr": true }).map((w) => w.board.id)).toEqual(["b", "c"]);
  });

  it("watches each repository once, not those of boards in the trash", () => {
    const boards = [
      { id: "a", repo: "https://github.com/o/r" },
      { id: "b", repo: "git@github.com:o/r.git" },
      { id: "e", repo: "https://github.com/O/R" },
      { id: "c", repo: "https://gitlab.com/g/p", archivedAt: "x" },
      { id: "d" },
    ] as Board[];
    expect(watchedRepos(boards).map((w) => [w.key, w.board.id])).toEqual([["github:github.com/o/r", "a"]]);
  });
});

describe("when to look again", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const done = (n: number, patch: Partial<Review> = {}) => pr(n, { ci: "success", ...patch });

  it("soon while a CI runs, even away from Todoom for long", () => {
    expect(nextLookDelay([done(1), pr(2)], null, now)).toBe(PR_WATCH_FAST_MS);
    expect(nextLookDelay([pr(2, { author: "dependabot" })], now - 3 * AWAY_LONG_MS, now)).toBe(PR_WATCH_FAST_MS);
  });

  it("soon while a release is being built, even with nothing open and away for long", () => {
    expect(nextLookDelay([], now - 3 * AWAY_LONG_MS, now, true)).toBe(PR_WATCH_FAST_MS);
    expect(nextLookDelay([], now - 3 * AWAY_LONG_MS, now, false)).toBe(PR_WATCH_SLOW_MS);
  });

  it("soon while a person's pull request is open, unless away for long", () => {
    expect(nextLookDelay([done(1)], null, now)).toBe(PR_WATCH_FAST_MS);
    expect(nextLookDelay([done(1)], now - AWAY_LONG_MS + 1000, now)).toBe(PR_WATCH_FAST_MS);
    expect(nextLookDelay([done(1)], now - AWAY_LONG_MS, now)).toBe(PR_WATCH_SLOW_MS);
  });

  it("slowly when nothing is open, or only robots' with their CI done", () => {
    expect(nextLookDelay([], null, now)).toBe(PR_WATCH_SLOW_MS);
    expect(nextLookDelay([done(3, { author: "dependabot" }), done(4, { author: "renovate[bot]", ci: "failure" })], null, now)).toBe(PR_WATCH_SLOW_MS);
  });
});

describe("a card's PR/MR merged or closed (TOD-69)", () => {
  const columns = [
    { id: "todo", name: "À faire" },
    { id: "doing", name: "En cours" },
    { id: "check", name: "À vérifier" },
    { id: "done", name: "Terminé" },
  ];
  const board = (onMerge?: Board["onMerge"]) => ({ id: "b", name: "Todoom", key: "TOD", columns, labels: [], ...(onMerge ? { onMerge } : {}) }) as unknown as Board;
  const card = (id: string, patch: Partial<Card> = {}): Card =>
    ({ id, boardId: "b", columnId: "doing", order: 0, title: id, branch: null, mergeRequest: null, claimedBy: null, archivedAt: null, updatedAt: "2026-11-26T10:00:00Z", ...patch }) as unknown as Card;
  const url = (n: number) => `https://github.com/o/r/pull/${n}`;
  const bottom = () => 7;
  const outcomes = (b: Board, cards: Card[], merged: Review[], closed: Review[] = []) =>
    mergeOutcomes(b, cards, merged, closed, bottom).map((o) => [o.card.id, o.outcome, o.next.columnId, o.next.mergeRequest?.state]);

  it("offers to move by default, to the column named « A verifier », never to a done one", () => {
    expect(mergeSetting(board())).toMatchObject({ action: "propose", column: { id: "check" } });
    expect(mergeSetting(board({ action: "move", columnId: "todo" })).column?.id).toBe("todo");
    expect(mergeSetting(board({ action: "move", columnId: "done" })).column?.id).toBe("check");
    const noReview = { ...board(), columns: columns.filter((c) => c.id !== "check") } as Board;
    expect(mergeSetting(noReview).column).toBeNull();
  });

  it("finds the card by its PR/MR's address, else by its branch when it has none", () => {
    const cards = [card("a", { mergeRequest: { url: url(1) + "/", state: "open" } }), card("b", { branch: "feature/2" }), card("c", { branch: "feature/3", mergeRequest: { url: url(9), state: "open" } })];
    const merged = [pr(1, { url: url(1) }), pr(2, { url: url(2) }), pr(3, { url: url(3) })];
    expect(outcomes(board(), cards, merged)).toEqual([
      ["a", "propose", "doing", "merged"],
      ["b", "propose", "doing", "merged"],
    ]);
    // Found by its branch: the card gets the PR's address.
    expect(mergeOutcomes(board(), cards, merged, [], bottom)[1].next.mergeRequest).toEqual({ url: url(2), state: "merged" });
  });

  it("moves it when the board says so, at the bottom of the column, unless someone has taken it", () => {
    const cards = [card("a", { mergeRequest: { url: url(1), state: "open" } }), card("b", { mergeRequest: { url: url(2), state: "open" }, claimedBy: { host: "PC", agent: "Claude", at: "x" } })];
    const o = mergeOutcomes(board({ action: "move" }), cards, [pr(1, { url: url(1) }), pr(2, { url: url(2) })], [], bottom);
    expect(o.map((x) => [x.card.id, x.outcome, x.next.columnId, x.next.order])).toEqual([
      ["a", "moved", "check", 7],
      ["b", "held", "doing", 0],
    ]);
  });

  it("only changes the state of a card already there, finished, or on a board that does nothing", () => {
    const merged = [pr(1, { url: url(1) })];
    const at = (columnId: string) => [card("a", { columnId, mergeRequest: { url: url(1), state: "open" } })];
    expect(outcomes(board({ action: "move" }), at("check"), merged)).toEqual([["a", "state", "check", "merged"]]);
    expect(outcomes(board({ action: "move" }), at("done"), merged)).toEqual([["a", "state", "done", "merged"]]);
    expect(outcomes(board({ action: "none" }), at("doing"), merged)).toEqual([["a", "state", "doing", "merged"]]);
  });

  it("does it once: a card already merged, or archived, is left alone", () => {
    const merged = [pr(1, { url: url(1) })];
    expect(outcomes(board({ action: "move" }), [card("a", { mergeRequest: { url: url(1), state: "merged" } })], merged)).toEqual([]);
    expect(outcomes(board({ action: "move" }), [card("a", { mergeRequest: { url: url(1), state: "open" }, archivedAt: "x" })], merged)).toEqual([]);
  });

  it("marks a PR/MR closed without merging as closed, by its address only, never moving the card", () => {
    const cards = [card("a", { mergeRequest: { url: url(1), state: "open" } }), card("b", { branch: "feature/2" })];
    expect(outcomes(board({ action: "move" }), cards, [], [pr(1, { url: url(1) }), pr(2, { url: url(2) })])).toEqual([["a", "state", "doing", "closed"]]);
  });

  it("says in the popup what became of the card", () => {
    const repo: Repo = { forge: "github", host: "github.com", path: "o/r" };
    const b = board({ action: "move" });
    const cards = [card("a", { number: 4, mergeRequest: { url: url(1), state: "open" } }), card("b", { number: 5, mergeRequest: { url: url(2), state: "open" }, claimedBy: { host: "PC", agent: "Claude", at: "x" } })];
    const merged = [pr(1, { url: url(1) }), pr(2, { url: url(2) })];
    const o = mergeOutcomes(b, cards, merged, [], bottom);
    const notices = noticesOf(
      merged.map((r, i) => ({ kind: "merged" as const, review: r, repo, board: b, cards, merge: { ...o[i], board: b } })),
      "t",
    );
    expect(notices.map((n) => n.merge)).toEqual([
      { outcome: "moved", column: "À vérifier", columnId: "check", boardId: "b", cardId: "a" },
      { outcome: "held", column: "À vérifier", columnId: "check", boardId: "b", cardId: "b", heldBy: "PC · Claude" },
    ]);
    expect(mayMoveOnMerge(cards[0], b, mergeSetting(b).column)).toBe(true);
    expect(mayMoveOnMerge({ ...cards[0], columnId: "done" }, b, mergeSetting(b).column)).toBe(false);
  });
});
