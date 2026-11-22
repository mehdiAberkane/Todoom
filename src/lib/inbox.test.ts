import { describe, expect, it } from "vitest";
import { inboxCard, inboxCardId, inboxProblem, isInboxCandidate, INBOX_MAX_BYTES } from "./inbox";

describe("inbox", () => {
  it("makes a shared page a card titled after it, its address below", () => {
    // What Brave on Android writes with « Share › Save to Drive ».
    expect(inboxCard("singha - Brave Search", "https://search.brave.com/search?q=singha&source=android")).toEqual({
      title: "singha - Brave Search",
      description: "https://search.brave.com/search?q=singha&source=android",
    });
  });

  it("makes a note a card: its first line the title, the rest the description", () => {
    expect(inboxCard("note.txt", "# Appeler le plombier\r\n\r\nAvant jeudi\nFuite cuisine\n")).toEqual({
      title: "Appeler le plombier",
      description: "Avant jeudi\nFuite cuisine",
    });
    expect(inboxCard("Courses.md", "  ")).toEqual({ title: "Courses", description: "" });
    const long = "x".repeat(200);
    expect(inboxCard("n.txt", long)).toEqual({ title: `${"x".repeat(117)}…`, description: long });
  });

  it("gives the same card id on every computer, another for another file", () => {
    const a = inboxCardId("singha - Brave Search", "https://x");
    expect(a).toBe(inboxCardId("singha - Brave Search", "https://x"));
    expect(a).toMatch(/^in[0-9a-z]+$/);
    expect(a).not.toBe(inboxCardId("singha - Brave Search", "https://y"));
    expect(a).not.toBe(inboxCardId("autre", "https://x"));
  });

  it("leaves aside system files, half-downloaded ones, big or binary ones", () => {
    expect(["note.txt", "singha - Brave Search"].every(isInboxCandidate)).toBe(true);
    expect([".DS_Store", "desktop.ini", "~$note.docx", "a.tmp", "b.crdownload", ""].some(isInboxCandidate)).toBe(false);
    expect(inboxProblem({ name: "x", size: INBOX_MAX_BYTES + 1 })).toBe("tooBig");
    expect(inboxProblem({ name: "x", size: 10 }, "PNG\u0000\u0001")).toBe("notText");
    expect(inboxProblem({ name: "x", size: 10 }, "ok")).toBeNull();
  });
});
