// The open pull requests (GitHub) and merge requests (GitLab) of a board's
// repository, with their CI state, read through the gh and glab tools of the
// computer (see list_reviews on the Rust side). Here: which repository a
// board names, and what the tools' JSON says.

import type { Card } from "../types";

export type Forge = "github" | "gitlab";
export type CiState = "running" | "success" | "failure" | "none";

export interface Repo {
  forge: Forge;
  host: string;
  /** owner/repo on GitHub, group/…/project on GitLab. */
  path: string;
}

export interface Review {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  branch: string;
  author: string;
  ci: CiState;
  updatedAt: string;
  /** When it was merged; absent while open. */
  mergedAt?: string;
  /** Opened by a robot (GitHub says so; on GitLab, guessed from the name). */
  bot?: boolean;
}

/** Merged ones are shown for a day. */
export const MERGED_WINDOW_MS = 24 * 60 * 60 * 1000;

const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

/**
 * The repository a board names, from what one copies: its web address
 * (https://github.com/owner/repo, https://gitlab.com/group/sub/project) or
 * its clone address (git@github.com:owner/repo.git). github.com is GitHub;
 * any other host is taken for a GitLab. The same rules as is_forge_path in Rust.
 */
export function parseRepo(text: string | undefined): Repo | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(?:https?:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[/:](.+)$/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  // GitLab's own pages (…/-/merge_requests) and a trailing .git or slash aren't part of the path.
  const path = m[2].split("/-/")[0].replace(/\.git$/i, "").replace(/\/+$/, "");
  const forge: Forge = host === "github.com" || host === "www.github.com" ? "github" : "gitlab";
  const parts = path.split("/");
  if (!HOST.test(host) || parts.some((p) => !SEGMENT.test(p))) return null;
  if (forge === "github" ? parts.length < 2 : parts.length < 2 || parts.length > 20) return null;
  // On GitHub, owner/repo then pages (…/pulls): only the first two count.
  return { forge, host: forge === "github" ? "github.com" : host, path: (forge === "github" ? parts.slice(0, 2) : parts).join("/") };
}

/**
 * The name a repository is known by (what was seen, the open ones of « Mon travail »):
 * GitHub and GitLab don't mind the case of a path, so two boards naming the same
 * repository differently share it, and it is read once.
 */
export const repoKey = (repo: Repo) => `${repo.forge}:${repo.host}/${repo.path}`.toLowerCase();

/** The repository's web page, for a link next to the list. */
export const repoUrl = (repo: Repo) => `https://${repo.host}/${repo.path}`;

interface GhCheck {
  __typename?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}

/** GitHub: checks and statuses together. One failure wins, then anything still running. */
export function ciOfChecks(checks: GhCheck[] | null | undefined): CiState {
  if (!checks?.length) return "none";
  const states = checks.map((c) => {
    const value = (c.__typename === "StatusContext" ? c.state : c.status === "COMPLETED" ? c.conclusion : "PENDING") ?? "PENDING";
    return value.toUpperCase();
  });
  if (states.some((s) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s))) return "failure";
  if (states.some((s) => !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s))) return "running";
  return "success";
}

/** GitLab: the status of the merge request's latest pipeline. */
export function ciOfPipeline(status: string | null | undefined): CiState {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILED":
      return "failure";
    case "CREATED":
    case "WAITING_FOR_RESOURCE":
    case "WAITING_FOR_CALLBACK":
    case "PREPARING":
    case "PENDING":
    case "RUNNING":
    case "SCHEDULED":
      return "running";
    default:
      // No pipeline, canceled, skipped, manual: nothing to report.
      return "none";
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What one look at a repository brings: its open ones and its latest merged ones. */
export interface ReviewSets {
  open: Review[];
  merged: Review[];
}

/** The open and merged lists of a GraphQL answer ({ data: { <root>: { open, merged } } }). */
function graphqlSets(output: string, root: "repository" | "project"): { open: unknown[]; merged: unknown[] } {
  const data = JSON.parse(output);
  if (data?.errors?.length) throw new Error(str(data.errors[0]?.message) || "GraphQL error");
  const found = data?.data?.[root];
  if (!found) throw new Error("notfound");
  const open: unknown = found.open?.nodes;
  const merged: unknown = found.merged?.nodes;
  if (!Array.isArray(open) || !Array.isArray(merged)) throw new Error("unexpected output");
  return { open, merged };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node of the tool's JSON, read field by field
function githubReview(p: any): Review {
  const checks = p?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
  return {
    number: Number(p?.number) || 0,
    title: str(p?.title),
    url: str(p?.url),
    draft: p?.isDraft === true,
    branch: str(p?.headRefName),
    author: str(p?.author?.login),
    ...(p?.author?.__typename === "Bot" ? { bot: true } : {}),
    ci: ciOfChecks(Array.isArray(checks) ? checks : []),
    updatedAt: str(p?.updatedAt),
    ...(str(p?.mergedAt) ? { mergedAt: str(p.mergedAt) } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node of the tool's JSON, read field by field
function gitlabReview(m: any): Review {
  return {
    number: Number(m?.iid) || 0,
    title: str(m?.title),
    url: str(m?.webUrl),
    draft: m?.draft === true,
    branch: str(m?.sourceBranch),
    author: str(m?.author?.username),
    ci: ciOfPipeline(m?.headPipeline?.status),
    updatedAt: str(m?.updatedAt),
    ...(str(m?.mergedAt) ? { mergedAt: str(m.mergedAt) } : {}),
  };
}

/** gh api graphql: repository.open / repository.merged (see GITHUB_QUERY in Rust). */
export function githubReviews(output: string): ReviewSets {
  const sets = graphqlSets(output, "repository");
  return { open: sets.open.map(githubReview), merged: sets.merged.map(githubReview) };
}

/** glab api graphql: project.open / project.merged (see GITLAB_QUERY in Rust). */
export function gitlabReviews(output: string): ReviewSets {
  const sets = graphqlSets(output, "project");
  return { open: sets.open.map(gitlabReview), merged: sets.merged.map(gitlabReview) };
}

/**
 * The lists from a tool's output: the open ones newest first, and those merged
 * in the last 24 hours, latest first.
 */
export function parseReviews(forge: Forge, output: string, now = Date.now()): ReviewSets {
  const sets = forge === "github" ? githubReviews(output) : gitlabReviews(output);
  return { open: sets.open.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), merged: recentlyMerged(sets.merged, now) };
}

/** The merged ones of the last 24 hours, latest first. */
export function recentlyMerged(list: Review[], now = Date.now()): Review[] {
  return list
    .filter((r) => r.mergedAt && now - Date.parse(r.mergedAt) <= MERGED_WINDOW_MS)
    .sort((a, b) => b.mergedAt!.localeCompare(a.mergedAt!));
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/** The card a review belongs to: the one with its address, else the one on its branch. */
export function cardOfReview(review: Review, cards: Card[]): Card | undefined {
  return (
    cards.find((c) => c.mergeRequest && sameUrl(c.mergeRequest.url, review.url)) ??
    (review.branch ? cards.find((c) => c.branch === review.branch) : undefined)
  );
}

export type ReviewError =
  | { code: "missing" | "auth"; tool: "gh" | "glab" }
  | { code: "unapproved" | "refused"; host: string }
  | { code: "notfound" | "badrepo" | "desktop" }
  | { code: "failed"; message: string };

/** The hosts each tool talks to by default; another one must be allowed on this computer (see forge_host_allowed in Rust). */
export const DEFAULT_FORGE_HOSTS = ["github.com", "gitlab.com"];

/** Whether the PR/MR of this repository may be read: its host is a default one, or allowed here. */
export const hostAllowed = (repo: Repo, choices: Record<string, boolean>) =>
  DEFAULT_FORGE_HOSTS.includes(repo.host) || choices[repo.host] === true;

/** The error code list_reviews returns, as something the interface can explain. */
export function reviewError(raw: unknown): ReviewError {
  const text = raw instanceof Error ? raw.message : String(raw);
  const [code, ...rest] = text.split(":");
  const detail = rest.join(":");
  if ((code === "missing" || code === "auth") && (detail === "gh" || detail === "glab")) return { code, tool: detail };
  if ((code === "unapproved" || code === "refused") && detail) return { code, host: detail };
  if (code === "notfound" || code === "badrepo" || code === "desktop") return { code };
  return { code: "failed", message: code === "failed" ? detail : text };
}
