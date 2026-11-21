import { describe, expect, it } from "vitest";
import type { Board } from "../types";
import { captureBoard, captureTitle, topOrder } from "./capture";

const board = (id: string, name: string, extra: Partial<Board> = {}) => ({ id, name, columns: [{ id: "c", name: "À faire" }], labels: [], ...extra }) as unknown as Board;

describe("quick capture", () => {
  const boards = [board("a", "Projet"), board("g", "Global "), board("t", "Corbeille", { archivedAt: "x" }), board("e", "Vide", { columns: [] })];

  it("goes to the chosen board, else one named Global, else the first", () => {
    expect(captureBoard(boards, "a")?.id).toBe("a");
    expect(captureBoard(boards, undefined)?.id).toBe("g");
    expect(captureBoard(boards, "gone")?.id).toBe("g");
    expect(captureBoard([board("a", "Projet")], undefined)?.id).toBe("a");
  });

  it("never goes to a trashed board or one without columns", () => {
    expect(captureBoard(boards, "t")?.id).toBe("g");
    expect(captureBoard(boards, "e")?.id).toBe("g");
    expect(captureBoard([board("t", "x", { archivedAt: "x" })], undefined)).toBeUndefined();
  });

  it("keeps one line, and nothing when there is nothing", () => {
    expect(captureTitle("  Appeler   le\nplombier ")).toBe("Appeler le plombier");
    expect(captureTitle(" \n ")).toBeNull();
    expect(captureTitle("x".repeat(600))).toHaveLength(500);
  });

  it("puts the card on top of its column", () => {
    expect(topOrder([3, 1, 2])).toBe(0);
    expect(topOrder([])).toBe(0);
    expect(topOrder([-2, 5])).toBe(-3);
  });
});
