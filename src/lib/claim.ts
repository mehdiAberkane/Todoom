// Who is working on a card: a computer, and the agent or conversation on it.
// Taking a card is also a lock: an agent or a conversation doesn't take a card
// someone else holds. Drive takes a few seconds to carry a change between
// computers, so two of them taking the same card within that delay can both
// believe they have it; past it, the second one is refused.

import type { Author, Claim } from "../types";

/** Same computer, same agent, same conversation (an absent one only matches an absent one). */
export const sameClaimant = (a: Author, b: Author) =>
  a.host === b.host && (a.agent ?? null) === (b.agent ?? null) && (a.conversation ?? null) === (b.conversation ?? null);

/** "PC-Main", "PC-Main · Claude", "PC-Main · Claude (refonte login)". */
export const claimLabel = (c: Author) =>
  [c.host, c.agent].filter(Boolean).join(" · ") + (c.conversation ? ` (${c.conversation})` : "");

export function newClaim(who: Author, at = new Date().toISOString()): Claim {
  return { host: who.host, ...(who.agent ? { agent: who.agent } : {}), ...(who.conversation ? { conversation: who.conversation } : {}), at };
}

/** Whether `who` may take a card held by `current`: free, already theirs, or forced. */
export const mayClaim = (current: Claim | null | undefined, who: Author, force = false) =>
  !current || force || sameClaimant(current, who);
