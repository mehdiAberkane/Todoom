import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { cardOfReview, ciOfChecks, ciOfPipeline, githubReviews, gitlabReviews, parseRepo, parseReviews, recentlyMerged, repoKey, reviewError } from "./reviews";

describe("the repository of a board", () => {
  it("is read from the address one copies, web or clone", () => {
    const todoom = { forge: "github", host: "github.com", path: "mehdiAberkane/Todoom" };
    expect(parseRepo("https://github.com/mehdiAberkane/Todoom")).toEqual(todoom);
    expect(parseRepo("git@github.com:mehdiAberkane/Todoom.git")).toEqual(todoom);
    expect(parseRepo(" github.com/mehdiAberkane/Todoom/pulls ")).toEqual(todoom);
    expect(parseRepo("https://gitlab.com/g/sub/project/-/merge_requests")).toEqual({ forge: "gitlab", host: "gitlab.com", path: "g/sub/project" });
    expect(parseRepo("https://git.example.fr/team/app.git")).toEqual({ forge: "gitlab", host: "git.example.fr", path: "team/app" });
  });

  it("refuses what isn't a plain repository", () => {
    for (const bad of ["", "github.com/owner", "https://github.com/../x", "https://github.com/-x/y", "https://github.com/a b/c", "file:///etc/passwd", "gitlab.com/single"]) {
      expect(parseRepo(bad), bad).toBeNull();
    }
  });
});

describe("the CI state", () => {
  it("on GitHub: one failure wins, then what still runs", () => {
    const ok = { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" };
    expect(ciOfChecks([])).toBe("none");
    expect(ciOfChecks([ok, { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }])).toBe("success");
    expect(ciOfChecks([ok, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }])).toBe("running");
    expect(ciOfChecks([ok, { __typename: "StatusContext", state: "PENDING" }])).toBe("running");
    expect(ciOfChecks([{ __typename: "CheckRun", status: "IN_PROGRESS" }, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }])).toBe("failure");
  });

  it("on GitLab: the latest pipeline", () => {
    expect(ciOfPipeline("SUCCESS")).toBe("success");
    expect(ciOfPipeline("FAILED")).toBe("failure");
    expect(ciOfPipeline("RUNNING")).toBe("running");
    expect(ciOfPipeline(null)).toBe("none");
    expect(ciOfPipeline("CANCELED")).toBe("none");
  });
});

describe("what the tools return", () => {
  // As gh api graphql answers GITHUB_QUERY (shape taken from a real answer).
  const pr = (number: number, patch: Record<string, unknown> = {}) => ({
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    headRefName: `b${number}`,
    updatedAt: "2026-11-22T12:00:00Z",
    mergedAt: null,
    author: { __typename: "User", login: "me" },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }] } } } }] },
    ...patch,
  });
  const github = (open: unknown[], merged: unknown[]) => JSON.stringify({ data: { repository: { open: { nodes: open }, merged: { nodes: merged } } } });

  it("reads gh api graphql: the open ones and the merged ones in one answer", () => {
    const bot = pr(5, {
      title: "Bump typescript",
      headRefName: "dependabot/npm/typescript",
      author: { __typename: "Bot", login: "dependabot" },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }] } } } }] },
    });
    const sets = githubReviews(github([bot, pr(6, { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })], [pr(4, { mergedAt: "2026-11-22T11:00:00Z" })]));
    expect(sets.open).toEqual([
      { number: 5, title: "Bump typescript", url: "https://github.com/o/r/pull/5", draft: false, branch: "dependabot/npm/typescript", author: "dependabot", bot: true, ci: "failure", updatedAt: "2026-11-22T12:00:00Z" },
      { number: 6, title: "PR 6", url: "https://github.com/o/r/pull/6", draft: false, branch: "b6", author: "me", ci: "none", updatedAt: "2026-11-22T12:00:00Z" },
    ]);
    expect(sets.merged.map((r) => [r.number, r.mergedAt, r.ci])).toEqual([[4, "2026-11-22T11:00:00Z", "success"]]);
  });

  it("says when the repository isn't there, or GraphQL refused", () => {
    expect(() => githubReviews(JSON.stringify({ data: { repository: null } }))).toThrow("notfound");
    expect(() => githubReviews(JSON.stringify({ errors: [{ message: "Bad credentials" }] }))).toThrow("Bad credentials");
    expect(() => githubReviews("[]")).toThrow();
  });

  it("reads glab api graphql, and says when the project isn't there", () => {
    const mr = (iid: string, patch: Record<string, unknown>) => ({ iid, title: `MR ${iid}`, webUrl: `https://gitlab.com/g/p/-/merge_requests/${iid}`, draft: false, sourceBranch: `b${iid}`, updatedAt: "2026-11-22T10:00:00Z", mergedAt: null, author: { username: "me" }, headPipeline: null, ...patch });
    const out = JSON.stringify({
      data: {
        project: {
          open: { nodes: [mr("12", { draft: true, updatedAt: "2026-11-21T10:00:00Z", headPipeline: { status: "RUNNING" } }), mr("13", {})] },
          merged: { nodes: [mr("11", { mergedAt: "2026-11-22T09:00:00Z" })] },
        },
      },
    });
    const sets = parseReviews("gitlab", out, Date.parse("2026-11-22T14:00:00Z"));
    expect(sets.open.map((r) => [r.number, r.draft, r.ci])).toEqual([
      [13, false, "none"],
      [12, true, "running"],
    ]);
    expect(sets.merged.map((r) => r.number)).toEqual([11]);
    expect(() => gitlabReviews(JSON.stringify({ data: { project: null } }))).toThrow("notfound");
  });
});

describe("merged ones", () => {
  it("keeps those merged in the last 24 hours, latest first", () => {
    const merged = (number: number, at: string) => ({ number, title: "m", url: `u${number}`, headRefName: "x", mergedAt: at, updatedAt: at });
    const out = JSON.stringify({
      data: { repository: { open: { nodes: [] }, merged: { nodes: [merged(30, "2026-11-22T12:40:15Z"), merged(20, "2026-11-20T10:00:00Z"), merged(31, "2026-11-22T12:59:45Z")] } } },
    });
    const now = Date.parse("2026-11-22T14:00:00Z");
    expect(parseReviews("github", out, now).merged.map((r) => r.number)).toEqual([31, 30]);
    expect(recentlyMerged(githubReviews(out).merged, now).map((r) => r.number)).toEqual([31, 30]);
    expect(githubReviews(JSON.stringify({ data: { repository: { open: { nodes: [{ number: 1, title: "o" }] }, merged: { nodes: [] } } } })).open[0].mergedAt).toBeUndefined();
  });
});

describe("the name of a repository", () => {
  it("doesn't depend on the case, so two boards naming it differently share it", () => {
    expect(repoKey(parseRepo("https://github.com/mehdiAberkane/Todoom")!)).toBe(repoKey(parseRepo("github.com/mehdiaberkane/todoom")!));
  });
});

describe("the link with the cards", () => {
  const card = (id: string, patch: Partial<Card>) => ({ id, branch: null, mergeRequest: null, ...patch }) as Card;
  const review = { number: 5, title: "", url: "https://github.com/o/r/pull/5", draft: false, branch: "feature/x", author: "", ci: "none" as const, updatedAt: "" };

  it("finds the card with the review's address, else the one on its branch", () => {
    const byUrl = card("a", { mergeRequest: { url: "https://github.com/o/r/pull/5/", state: "open" } });
    const byBranch = card("b", { branch: "feature/x" });
    expect(cardOfReview(review, [byBranch, byUrl])?.id).toBe("a");
    expect(cardOfReview(review, [byBranch])?.id).toBe("b");
    expect(cardOfReview(review, [card("c", {})])).toBeUndefined();
  });
});

describe("errors", () => {
  it("turns the command's codes into what to explain", () => {
    expect(reviewError("missing:glab")).toEqual({ code: "missing", tool: "glab" });
    expect(reviewError("auth:gh")).toEqual({ code: "auth", tool: "gh" });
    expect(reviewError("notfound")).toEqual({ code: "notfound" });
    expect(reviewError("unapproved:evil.test")).toEqual({ code: "unapproved", host: "evil.test" });
    expect(reviewError(new Error("refused:evil.test"))).toEqual({ code: "refused", host: "evil.test" });
    expect(reviewError("failed:boom: really")).toEqual({ code: "failed", message: "boom: really" });
    expect(reviewError(new Error("weird"))).toEqual({ code: "failed", message: "weird" });
  });
});
