import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, toggleTask } from "./markdown";

describe("inline Markdown", () => {
  it("reads code, bold, italics, links and file paths", () => {
    expect(parseInline("Voir `npm test` et **très** *important* dans src/lib/store.ts")).toEqual([
      { t: "text", v: "Voir " },
      { t: "code", v: "npm test" },
      { t: "text", v: " et " },
      { t: "strong", c: [{ t: "text", v: "très" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "important" }] },
      { t: "text", v: " dans " },
      { t: "path", v: "src/lib/store.ts" },
    ]);
    expect(parseInline("[la MR](https://gitlab.com/g/p/-/merge_requests/3).")).toEqual([
      { t: "link", href: "https://gitlab.com/g/p/-/merge_requests/3", c: [{ t: "text", v: "la MR" }] },
      { t: "text", v: "." },
    ]);
    expect(parseInline("Fichier C:\\xampp\\htdocs\\Todoom\\README.md ici")[1]).toEqual({ t: "path", v: "C:\\xampp\\htdocs\\Todoom\\README.md" });
  });

  it("only links web addresses, and leaves snake_case and stray stars alone", () => {
    expect(parseInline("[x](javascript:alert(1))").every((n) => n.t !== "link")).toBe(true);
    expect(parseInline("ouvre https://example.com/page, puis")[1]).toEqual({
      t: "link",
      href: "https://example.com/page",
      c: [{ t: "text", v: "https://example.com/page" }],
    });
    expect(parseInline("board_dir et 2 * 3 * 4")).toEqual([{ t: "text", v: "board_dir et 2 * 3 * 4" }]);
  });
});

describe("block Markdown", () => {
  const text = [
    "## Contexte",
    "Une ligne",
    "et la suite",
    "",
    "- [ ] écrire le test",
    "- [x] corriger",
    "  - détail",
    "",
    "1. un",
    "2. deux",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "> citation",
    "---",
  ].join("\n");

  it("reads headings, paragraphs, task lists, numbered lists, code, quotes and rules", () => {
    expect(parseMarkdown(text).map((b) => b.t)).toEqual(["h", "p", "list", "list", "code", "quote", "hr"]);
    const [, para, tasks, numbered, code] = parseMarkdown(text);
    expect(para).toMatchObject({ lines: [[{ v: "Une ligne" }], [{ v: "et la suite" }]] });
    expect(tasks).toMatchObject({ ordered: false, items: [{ task: false, line: 4 }, { task: true, line: 5 }, { task: null, level: 1 }] });
    expect(numbered).toMatchObject({ ordered: true, items: [{ line: 8 }, { line: 9 }] });
    expect(code).toEqual({ t: "code", lang: "ts", v: "const a = 1;" });
  });

  it("ticks and unticks a checkbox in the source", () => {
    const ticked = toggleTask(text, 4);
    expect(ticked.split("\n")[4]).toBe("- [x] écrire le test");
    expect(toggleTask(ticked, 4)).toBe(text);
    expect(toggleTask(text, 0)).toBe(text);
  });
});
