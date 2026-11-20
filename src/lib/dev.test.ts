import { describe, expect, it } from "vitest";
import { branchUrl, mrLabel, webUrl } from "./dev";
import { cardProblem } from "./validate";

describe("branch and merge request", () => {
  it("keeps only web addresses", () => {
    expect(webUrl(" https://gitlab.com/g/p/-/merge_requests/3 ")).toBe("https://gitlab.com/g/p/-/merge_requests/3");
    expect(webUrl("javascript:alert(1)")).toBeNull();
    expect(webUrl("file:///C:/Windows")).toBeNull();
    expect(webUrl("pas une adresse")).toBeNull();
  });

  it("guesses the branch page from GitLab and GitHub addresses", () => {
    const gitlab = { url: "https://gitlab.com/g/sub/p/-/merge_requests/12", state: "open" as const };
    expect(branchUrl("feature/export csv", gitlab)).toBe("https://gitlab.com/g/sub/p/-/tree/feature/export%20csv");
    expect(branchUrl("fix/x", { url: "https://github.com/o/r/pull/3", state: "merged" })).toBe("https://github.com/o/r/tree/fix/x");
    expect(branchUrl("fix/x", { url: "https://example.com/review/3", state: "open" })).toBeNull();
    expect(branchUrl(null, gitlab)).toBeNull();
  });

  it("names a request by its number", () => {
    expect(mrLabel("https://gitlab.com/g/p/-/merge_requests/12")).toBe("!12");
    expect(mrLabel("https://github.com/o/r/pull/3")).toBe("#3");
  });

  it("is checked when files are read", () => {
    expect(cardProblem({ id: "x", branch: "feature/a", mergeRequest: { url: "https://x/-/merge_requests/1", state: "merged" } })).toBeNull();
    expect(cardProblem({ id: "x", mergeRequest: { url: "https://x", state: "done" } })).toEqual({ code: "bad_field", field: "mergeRequest" });
  });
});
