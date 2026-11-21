// The branch and merge request of a card, filled in by the agent (or by hand).

import type { Board, Card, MergeRequest, MergeRequestState } from "../types";
import { refOf } from "./shortid";

export const MR_STATES: MergeRequestState[] = ["open", "merged", "closed"];

/** Only web addresses are opened or stored: no file:, javascript: or custom schemes. */
export function webUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The branch's page, guessed from the merge request's address: GitLab
 * …/group/project/-/merge_requests/12 → …/group/project/-/tree/<branch>,
 * GitHub …/owner/repo/pull/3 → …/owner/repo/tree/<branch>.
 */
export function branchUrl(branch: string | null, mr: MergeRequest | null): string | null {
  if (!branch || !mr) return null;
  const gitlab = mr.url.match(/^(https?:\/\/.+?)\/-\/merge_requests\/\d+/);
  if (gitlab) return `${gitlab[1]}/-/tree/${encodeURIComponent(branch).replace(/%2F/g, "/")}`;
  const github = mr.url.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+/);
  if (github) return `${github[1]}/tree/${encodeURIComponent(branch).replace(/%2F/g, "/")}`;
  return null;
}

/** "!12" for GitLab, "#3" for GitHub, else the address. */
export function mrLabel(url: string): string {
  const m = url.match(/\/-\/merge_requests\/(\d+)/) ?? url.match(/\/pull\/(\d+)/);
  return m ? (url.includes("/-/merge_requests/") ? `!${m[1]}` : `#${m[1]}`) : url;
}

/** How a card's branch is named when the board doesn't say otherwise, as GitLab and Jira do. */
export const DEFAULT_BRANCH_FORMAT = "{type}/{ref}-{slug}";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
/** Labels that make a card a fix rather than a feature, any language. */
const FIX_LABELS = ["bug", "correctif", "fix", "hotfix", "regression"];

/** "fix" for a card labelled as a bug, else "feat". */
export function branchType(card: Card, board: Board): "fix" | "feat" {
  const names = card.labels.map((id) => plain(board.labels.find((l) => l.id === id)?.name ?? ""));
  return names.some((n) => FIX_LABELS.includes(n)) ? "fix" : "feat";
}

/** The title in a few lowercase words joined by dashes, cut on a word, accents dropped. */
export function slugOf(title: string, max = 40): string {
  const words = plain(title).split(/[^a-z0-9]+/).filter(Boolean);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > max) break;
    slug = next;
  }
  return slug || words[0]?.slice(0, max) || "";
}

/**
 * The branch name the card's work should use, from the board's format:
 * {type} (feat or fix), {ref} (TOD-51), {key} (TOD), {number} (51), {slug}.
 * Whatever git refuses in a branch name is dropped.
 */
export function branchName(card: Card, board: Board, format = board.branchFormat?.trim() || DEFAULT_BRANCH_FORMAT): string {
  const ref = refOf(board, card) ?? card.id.slice(0, 8);
  const parsed = ref.match(/^(.+)-(\d+)$/);
  const values: Record<string, string> = {
    type: branchType(card, board),
    ref,
    key: parsed?.[1] ?? ref,
    number: parsed?.[2] ?? ref,
    slug: slugOf(card.title),
  };
  return format
    .replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all)
    .replace(/[\s~^:?*[\]\\@{}]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\.lock(?=\/|$)/g, "")
    .replace(/(^|\/)[-.]+|[-.]+(?=\/|$)/g, "$1")
    .replace(/^\/+|\/+$/g, "");
}
