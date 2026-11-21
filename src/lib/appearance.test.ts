import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { resolveTheme, veilOf } from "./appearance";
import { mergeEdits } from "./merge";
import { cardProblem, settingsProblem } from "./validate";

describe("theme", () => {
  it("stays dark unless light is chosen, or the system is light and followed", () => {
    expect(resolveTheme(undefined, false)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("darkens a background image on the dark theme and lightens it on the light one", () => {
    expect(veilOf("dark", 0.4)).toBe("linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))");
    expect(veilOf("light", 0.4)).toBe("linear-gradient(rgba(255,255,255,0.4), rgba(255,255,255,0.4))");
  });

  it("accepts the appearance settings and refuses an unknown theme", () => {
    const base = { background: null, backgroundDim: 0.4, language: null, updatedAt: "" };
    expect(settingsProblem({ ...base, theme: "system", compact: true })).toBeNull();
    expect(settingsProblem({ ...base, theme: "sepia" })).not.toBeNull();
    expect(settingsProblem({ ...base, compact: "yes" })).not.toBeNull();
  });
});

describe("card color", () => {
  const card = { id: "c", boardId: "b", columnId: "x", order: 0, title: "T", description: "", labels: [], priority: null, due: null, checklist: [], links: [], branch: null, mergeRequest: null, claimedBy: null, archivedAt: null, createdAt: "", updatedAt: "" } as Card;

  it("is optional, a color or null", () => {
    expect(cardProblem(card)).toBeNull();
    expect(cardProblem({ ...card, color: "#3a86ff" })).toBeNull();
    expect(cardProblem({ ...card, color: null })).toBeNull();
    expect(cardProblem({ ...card, color: 3 })).not.toBeNull();
  });

  it("is saved with the other edits, on top of a change made elsewhere", () => {
    const elsewhere = { ...card, title: "Renamed elsewhere" };
    expect(mergeEdits(card, { ...card, color: "#3a86ff" }, elsewhere)).toEqual({ ...elsewhere, color: "#3a86ff" });
  });
});
