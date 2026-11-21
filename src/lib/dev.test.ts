import { describe, expect, it } from "vitest";
import type { Board, Card } from "../types";
import { branchName, branchUrl, mrLabel, slugOf, webUrl } from "./dev";
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

describe("branch name", () => {
  const board = {
    id: "b",
    name: "Todoom",
    key: "TOD",
    columns: [],
    labels: [
      { id: "bug", name: "Bug", color: "" },
      { id: "feat", name: "Fonctionnalité", color: "" },
    ],
  } as unknown as Board;
  const card = (title: string, labels: string[] = [], number = 51) => ({ id: "c1234567890", number, title, labels }) as unknown as Card;

  it("is <type>/<ref>-<title> by default, like GitLab and Jira", () => {
    expect(branchName(card("Nom de branche et PR auto", ["feat"]), board)).toBe("feat/TOD-51-nom-de-branche-et-pr-auto");
    expect(branchName(card("L'export plante à l'ouverture !", ["bug"]), board)).toBe("fix/TOD-51-l-export-plante-a-l-ouverture");
  });

  it("follows the board's format", () => {
    expect(branchName(card("Thème clair"), { ...board, branchFormat: "{key}{number}_{slug}" })).toBe("TOD51_theme-clair");
    expect(branchName(card("Thème clair"), board, "users/me/{ref}")).toBe("users/me/TOD-51");
  });

  it("never gives a name git refuses", () => {
    expect(branchName(card("a b"), board, "{type} : {slug}?")).toBe("feat-a-b");
    expect(branchName(card("x"), board, "/{slug}..lock")).toBe("x");
    expect(branchName(card("???"), board)).toBe("feat/TOD-51");
  });

  it("uses the card's id on a board without short ids", () => {
    expect(branchName(card("Un"), { ...board, key: undefined })).toBe("feat/c1234567-un");
  });

  it("keeps the title short, cut on a word", () => {
    expect(slugOf("Afficher le nombre de tickets terminés par semaine dans le tableau")).toBe("afficher-le-nombre-de-tickets-termines");
    expect(slugOf("Anticonstitutionnellementissimementextraordinaire", 10)).toBe("anticonsti");
  });
});
