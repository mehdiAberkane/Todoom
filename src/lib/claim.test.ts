import { describe, expect, it } from "vitest";
import { claimLabel, mayClaim, newClaim, sameClaimant } from "./claim";
import { cardProblem } from "./validate";

describe("claims", () => {
  const me = { host: "PC-Main", agent: "Claude", conversation: "login" };

  it("tells claimants apart by computer, agent and conversation", () => {
    expect(sameClaimant(me, { ...me })).toBe(true);
    expect(sameClaimant(me, { ...me, conversation: "export" })).toBe(false);
    expect(sameClaimant(me, { host: "PC-Main", agent: "Claude" })).toBe(false);
    expect(sameClaimant({ host: "PC-Main" }, { host: "PC-Portable" })).toBe(false);
  });

  it("lets a free card or one's own be taken, someone else's only by force", () => {
    const held = newClaim(me, "2026-11-20T10:00:00Z");
    expect(mayClaim(null, me)).toBe(true);
    expect(mayClaim(held, me)).toBe(true);
    expect(mayClaim(held, { host: "PC-Main" })).toBe(false);
    expect(mayClaim(held, { host: "PC-Main" }, true)).toBe(true);
  });

  it("is labelled and checked when files are read", () => {
    expect(claimLabel(me)).toBe("PC-Main · Claude (login)");
    expect(claimLabel({ host: "PC-Main" })).toBe("PC-Main");
    expect(cardProblem({ id: "x", claimedBy: { host: "PC", at: "2026-11-20" } })).toBeNull();
    expect(cardProblem({ id: "x", claimedBy: { host: "PC" } })).toEqual({ code: "bad_field", field: "claimedBy" });
  });
});
