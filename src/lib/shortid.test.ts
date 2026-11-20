import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { cleanKey, deriveKey, nextNumber, numbering, parseRef, refOf, refsIn } from "./shortid";
import { boardProblem, cardProblem } from "./validate";

const card = (id: string, createdAt: string, number?: number) => ({ id, createdAt, number }) as Card;

describe("board keys", () => {
  it("comes from the name", () => {
    expect(deriveKey("Solaris", [])).toBe("SOL");
    expect(deriveKey("Énergie", [])).toBe("ENE");
    expect(deriveKey("Mon projet perso", [])).toBe("MPP");
    expect(deriveKey("42 choses", [])).toBe("T4C");
    expect(deriveKey("X", [])).toBe("XX");
  });

  it("stays unique across boards", () => {
    expect(deriveKey("Solaris", ["SOL"])).toBe("SOL2");
    expect(deriveKey("Solstice", ["sol", "SOL2"])).toBe("SOL3");
  });

  it("cleans what the user types", () => {
    expect(cleanKey(" nyx ")).toBe("NYX");
    expect(cleanKey("a-b")).toBe("AB");
    expect(cleanKey("1AB")).toBeNull();
    expect(cleanKey("TOOLONGKEY")).toBeNull();
  });
});

describe("numbers", () => {
  it("continues after the highest, archived cards included", () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([{ number: 3 }, { number: 7 }, {}])).toBe(8);
  });

  it("numbers cards without one, oldest first, after the existing ones", () => {
    const fixes = numbering([card("b", "2026-01-02"), card("a", "2026-01-01"), card("c", "2026-01-03", 5)]);
    expect(fixes.map((f) => [f.card.id, f.number])).toEqual([["a", 6], ["b", 7]]);
  });

  it("gives a clash to the newer card, the same way everywhere", () => {
    const one = [card("x", "2026-01-01T10:00:00Z", 4), card("y", "2026-01-01T10:00:01Z", 4), card("z", "2026-01-01", 2)];
    const other = [...one].reverse();
    expect(numbering(one)).toEqual([{ card: one[1], number: 5 }]);
    expect(numbering(other).map((f) => [f.card.id, f.number])).toEqual([["y", 5]]);
    expect(numbering([card("a", "2026-01-01", 1), card("b", "2026-01-02", 2)])).toEqual([]);
  });
});

describe("refs", () => {
  it("formats, parses and finds them", () => {
    expect(refOf({ key: "SOL" }, { number: 42 })).toBe("SOL-42");
    expect(refOf({}, { number: 42 })).toBeNull();
    expect(parseRef(" sol-042 ")).toEqual({ key: "SOL", number: 42 });
    expect(parseRef("SOL 42")).toBeNull();
    expect(refsIn("Voir SOL-42, puis NYX-3 et SOL-42 ; pas e-mail-2 ni sol-1")).toEqual(["SOL-42", "NYX-3"]);
  });

  it("is checked when files are read", () => {
    expect(cardProblem({ id: "x", number: 3 })).toBeNull();
    expect(cardProblem({ id: "x", number: "3" })).toEqual({ code: "bad_field", field: "number" });
    expect(boardProblem({ id: "b", key: "SOL" })).toBeNull();
    expect(boardProblem({ id: "b", key: 1 })).toEqual({ code: "bad_field", field: "key" });
  });
});
