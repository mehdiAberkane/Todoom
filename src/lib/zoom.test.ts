import { describe, expect, it } from "vitest";
import { stepZoom, ZOOM_LEVELS } from "./zoom";

describe("stepZoom", () => {
  it("moves one level up or down", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1, 3)).toBe(1.5);
  });
  it("stops at the ends", () => {
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -2)).toBe(0.5);
  });
  it("snaps an unknown level first", () => {
    expect(stepZoom(1.12, 0)).toBe(1.1);
    expect(stepZoom(1.12, 1)).toBe(1.25);
  });
  it("keeps 100 % among the levels", () => {
    expect(ZOOM_LEVELS).toContain(1);
  });
});
