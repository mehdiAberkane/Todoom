import { afterEach, describe, expect, it } from "vitest";
import { setLang, t, tn } from "./i18n";

describe("translations", () => {
  afterEach(() => setLang("fr"));

  it("switches language and fills placeholders", () => {
    setLang("fr");
    expect(t("trash.purgeQ", { cards: "2 cartes" })).toBe("Supprimer 2 cartes ?");
    setLang("en");
    expect(t("trash.purgeQ", { cards: "2 cards" })).toBe("Delete 2 cards?");
  });

  it("follows each language's plural rule", () => {
    setLang("fr");
    expect([0, 1, 2].map((n) => tn("board.cards", n))).toEqual(["0 carte", "1 carte", "2 cartes"]);
    setLang("en");
    expect([0, 1, 2].map((n) => tn("board.cards", n))).toEqual(["0 cards", "1 card", "2 cards"]);
  });

  it("leaves an unknown placeholder visible rather than blank", () => {
    setLang("en");
    expect(t("trash.purgeQ")).toBe("Delete {cards}?");
  });
});
