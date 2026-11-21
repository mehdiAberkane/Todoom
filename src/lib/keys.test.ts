import { describe, expect, it } from "vitest";
import { nextCard } from "./keys";

describe("moving between cards with the arrows", () => {
  const columns = [["a1", "a2", "a3"], [], ["c1"], ["d1", "d2"]];

  it("starts on the first card when none is chosen", () => {
    expect(nextCard(columns, null, "ArrowDown")).toBe("a1");
    expect(nextCard([[], []], null, "ArrowDown")).toBeNull();
  });

  it("goes up and down in the column, stopping at its ends", () => {
    expect(nextCard(columns, "a1", "ArrowDown")).toBe("a2");
    expect(nextCard(columns, "a3", "ArrowDown")).toBe("a3");
    expect(nextCard(columns, "a1", "ArrowUp")).toBe("a1");
  });

  it("jumps over empty columns, to the same height or the last card", () => {
    expect(nextCard(columns, "a3", "ArrowRight")).toBe("c1");
    expect(nextCard(columns, "c1", "ArrowRight")).toBe("d1");
    expect(nextCard(columns, "d2", "ArrowLeft")).toBe("c1");
    expect(nextCard(columns, "d2", "ArrowRight")).toBe("d2");
  });
});
