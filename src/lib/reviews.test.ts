import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { cardOfReview, ciOfChecks, ciOfPipeline, githubReviews, gitlabReviews, parseRepo, parseReviews, recentlyMerged, reviewError } from "./reviews";

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
  it("reads gh pr list", () => {
    const out = JSON.stringify([
      {
        number: 5,
        title: "Bump typescript",
        url: "https://github.com/o/r/pull/5",
        isDraft: false,
        headRefName: "dependabot/npm/typescript",
        author: { login: "app/dependabot", is_bot: true },
        statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
        updatedAt: "2026-11-22T12:00:00Z",
      },
    ]);
    expect(githubReviews(out)).toEqual([
      { number: 5, title: "Bump typescript", url: "https://github.com/o/r/pull/5", draft: false, branch: "dependabot/npm/typescript", author: "dependabot", ci: "failure", updatedAt: "2026-11-22T12:00:00Z" },
    ]);
  });

  it("reads glab api graphql, and says when the project isn't there", () => {
    const out = JSON.stringify({
      data: {
        project: {
          mergeRequests: {
            nodes: [
              { iid: "12", title: "Export", webUrl: "https://gitlab.com/g/p/-/merge_requests/12", draft: true, sourceBranch: "feature/export", updatedAt: "2026-11-21T10:00:00Z", author: { username: "me" }, headPipeline: { status: "RUNNING" } },
              { iid: "13", title: "Fix", webUrl: "https://gitlab.com/g/p/-/merge_requests/13", draft: false, sourceBranch: "bugfix/x", updatedAt: "2026-11-22T10:00:00Z", author: { username: "me" }, headPipeline: null },
            ],
          },
        },
      },
    });
    expect(parseReviews("gitlab", out).map((r) => [r.number, r.draft, r.ci])).toEqual([
      [13, false, "none"],
      [12, true, "running"],
    ]);
    expect(() => gitlabReviews(JSON.stringify({ data: { project: null } }))).toThrow("notfound");
  });
});

describe("merged ones", () => {
  it("keeps those merged in the last 24 hours, latest first", () => {
    const out = JSON.stringify([
      { number: 31, title: "a", url: "u31", headRefName: "x", mergedAt: "2026-11-22T12:59:45Z", updatedAt: "2026-11-22T12:59:45Z" },
      { number: 30, title: "b", url: "u30", headRefName: "y", mergedAt: "2026-11-22T12:40:15Z", updatedAt: "2026-11-22T12:40:15Z" },
      { number: 20, title: "c", url: "u20", headRefName: "z", mergedAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z" },
    ]);
    const now = Date.parse("2026-11-22T14:00:00Z");
    expect(recentlyMerged(githubReviews(out), now).map((r) => r.number)).toEqual([31, 30]);
    expect(githubReviews(JSON.stringify([{ number: 1, title: "o" }]))[0].mergedAt).toBeUndefined();
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
    expect(reviewError("failed:boom: really")).toEqual({ code: "failed", message: "boom: really" });
    expect(reviewError(new Error("weird"))).toEqual({ code: "failed", message: "weird" });
  });
});
