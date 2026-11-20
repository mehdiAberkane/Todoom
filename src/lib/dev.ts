// The branch and merge request of a card, filled in by the agent (or by hand).

import type { MergeRequest, MergeRequestState } from "../types";

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
