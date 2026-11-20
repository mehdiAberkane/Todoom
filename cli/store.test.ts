import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardProblem } from "../src/lib/validate";
import { findDataDir, normalize, Store, TodoomError } from "./store";

let dir: string;
let store: Store;
const cardsDir = () => join(dir, "boards", "b1", "cards");
const onDisk = (id: string) => JSON.parse(readFileSync(join(cardsDir(), `${id}.json`), "utf8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "todoom-cli-"));
  mkdirSync(join(dir, "boards", "b1", "cards"), { recursive: true });
  writeFileSync(
    join(dir, "boards", "b1", "board.json"),
    JSON.stringify({
      id: "b1",
      name: "Todoom",
      columns: [
        { id: "todo", name: "À faire" },
        { id: "doing", name: "En cours" },
        { id: "check", name: "A verifier" },
      ],
      labels: [{ id: "l1", name: "Bug", color: "#f00" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  store = new Store(dir);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("names", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(normalize("  À   FAIRE ")).toBe("a faire");
  });

  it("finds boards and columns by name or unique start", () => {
    const board = store.board("todoom");
    expect(store.column(board, "a faire").id).toBe("todo");
    expect(store.column(board, "en c").id).toBe("doing");
    expect(() => store.column(board, "a")).toThrow(/plusieurs/);
    expect(() => store.column(board, "Terminé")).toThrow(/introuvable.*À faire/);
  });
});

describe("writes", () => {
  it("creates a valid card at the bottom of the first column", () => {
    const a = store.create("Todoom", "Un");
    const b = store.create("Todoom", "Deux", { labels: ["bug"], due: "2026-12-01" });
    expect(a.column).toBe("À faire");
    expect(b.order).toBeGreaterThan(a.order);
    expect(b.labels).toEqual(["Bug"]);
    expect(cardProblem(onDisk(b.id))).toBeNull();
    expect(onDisk(b.id).labels).toEqual(["l1"]);
  });

  it("moves to the bottom or the top of a column", () => {
    const a = store.create("Todoom", "Un", { column: "En cours" });
    const b = store.create("Todoom", "Deux");
    expect(store.move(b.id, "en cours").order).toBeGreaterThan(a.order);
    expect(store.move(b.id, "en cours", "top").order).toBeLessThan(a.order);
  });

  it("finds a card by the start of its id", () => {
    const a = store.create("Todoom", "Un");
    expect(store.card(a.id.slice(0, 8)).card.title).toBe("Un");
    expect(() => store.card("../../x")).toThrow(TodoomError);
  });

  it("keeps updatedAt moving forward, even past a clock in the future", () => {
    const a = store.create("Todoom", "Un");
    const future = "2099-01-01T00:00:00.000Z";
    writeFileSync(join(cardsDir(), `${a.id}.json`), JSON.stringify({ ...onDisk(a.id), updatedAt: future }));
    expect(Date.parse(store.update(a.id, { title: "Un bis" }).updatedAt)).toBeGreaterThan(Date.parse(future));
  });

  it("updates only the fields given", () => {
    const a = store.create("Todoom", "Un", { description: "Début", labels: ["Bug"], due: "2026-12-01" });
    const u = store.update(a.id, { removeLabels: ["bug"], due: null });
    expect(u).toMatchObject({ title: "Un", description: "Début", labels: [], due: null });
  });

  it("comments in files of their own and records the history, signed", () => {
    const agent = new Store(dir, { tool: "cli", author: { host: "PC-TEST", agent: "Claude" } });
    const a = agent.create("Todoom", "Un", { description: "Début" });
    const c = agent.comment(a.id, "  Fait.  ");
    expect(c).toMatchObject({ cardId: a.id, text: "Fait.", author: { host: "PC-TEST", agent: "Claude" } });
    expect(readdirSync(join(dir, "boards", "b1", "comments", a.id))).toEqual([`${c.id}.json`]);
    agent.move(a.id, "en cours");
    agent.update(a.id, { title: "Un bis" });
    const shown = agent.detail(agent.card(a.id).card, agent.board("Todoom"));
    expect(shown.description).toBe("Début");
    expect(shown.comments.map((x) => x.text)).toEqual(["Fait."]);
    expect(shown.history.map((e) => [e.field, e.from ?? null, e.to ?? null])).toEqual([
      ["created", null, "À faire"],
      ["column", "À faire", "En cours"],
      ["title", "Un", "Un bis"],
    ]);
    expect(readdirSync(join(dir, "boards", "b1", "history", a.id))).toEqual(["PC-TEST-cli.json"]);
    expect(() => agent.comment(a.id, "   ")).toThrow(/vide/);
  });

  it("sets and clears a priority by name, default levels included", () => {
    const a = store.create("Todoom", "Un", { priority: "p2" });
    expect(a.priority).toBe("P2");
    expect(onDisk(a.id).priority).toBe("p2");
    expect(store.update(a.id, { priority: null }).priority).toBeNull();
    expect(() => store.update(a.id, { priority: "P9" })).toThrow(/Priorité.*P1/);
  });

  it("links two cards on both sides, across boards, and unlinks both", () => {
    mkdirSync(join(dir, "boards", "b2", "cards"), { recursive: true });
    writeFileSync(
      join(dir, "boards", "b2", "board.json"),
      JSON.stringify({ id: "b2", name: "Nyx", columns: [{ id: "n0", name: "À faire" }, { id: "n1", name: "Terminé" }], labels: [] }),
    );
    const a = store.create("Todoom", "Un");
    const b = store.create("Nyx", "Autre");
    const linked = store.link(a.id, "depends-on", b.id);
    expect(linked.links).toEqual([{ type: "dependsOn", cardId: b.id, ref: "NYX-1", title: "Autre", board: "Nyx", column: "À faire", finished: false }]);
    expect(store.card(b.id).card.links).toEqual([{ type: "blocks", cardId: a.id }]);
    store.move(b.id, "terminé");
    expect(store.detail(store.card(a.id).card, store.board("Todoom")).links[0]).toMatchObject({ finished: true });
    expect(store.unlink(a.id, b.id).links).toEqual([]);
    expect(store.card(b.id).card.links).toEqual([]);
    expect(() => store.link(a.id, "depends-on", a.id)).toThrow(/elle-même/);
    expect(() => store.link(a.id, "parent", b.id)).toThrow(/Type de lien/);
  });

  it("gives the board a key and each new card the next number, found by its short id", () => {
    const a = store.create("Todoom", "Un");
    const b = store.create("Todoom", "Deux");
    expect([a.ref, b.ref]).toEqual(["TOD-1", "TOD-2"]);
    expect(JSON.parse(readFileSync(join(dir, "boards", "b1", "board.json"), "utf8")).key).toBe("TOD");
    store.archive(b.id);
    expect(store.create("Todoom", "Trois").ref).toBe("TOD-3");
    expect(store.card("tod-2").card.title).toBe("Deux");
    expect(() => store.card("TOD-99")).toThrow(/introuvable/);
  });

  it("sets the branch and the merge request, which keeps its state when its address changes", () => {
    const a = store.create("Todoom", "Un");
    const url = "https://gitlab.com/g/p/-/merge_requests/4";
    expect(store.update(a.id, { branch: " feature/x ", mrUrl: url })).toMatchObject({ branch: "feature/x", mergeRequest: { url, state: "open" } });
    expect(store.update(a.id, { mrState: "merged" }).mergeRequest).toEqual({ url, state: "merged" });
    expect(store.update(a.id, { mrUrl: url + "0" }).mergeRequest?.state).toBe("merged");
    expect(() => store.update(a.id, { mrUrl: "javascript:alert(1)" })).toThrow(/invalide/);
    expect(() => store.update(a.id, { mrState: "done" })).toThrow(/inconnu/);
    expect(store.update(a.id, { branch: null, mrUrl: null })).toMatchObject({ branch: null, mergeRequest: null });
    const b = store.create("Todoom", "Deux");
    expect(() => store.update(b.id, { mrState: "merged" })).toThrow(/adresse/);
  });

  it("takes a card as a lock, moves it on the way, and releases it", () => {
    const claude = new Store(dir, { tool: "mcp", author: { host: "PC-Main", agent: "Claude" } });
    const other = new Store(dir, { tool: "cli", author: { host: "PC-Portable" } });
    const a = claude.create("Todoom", "Un");
    const taken = claude.claim(a.id, { column: "en cours", conversation: "login" });
    expect(taken).toMatchObject({ column: "En cours", claimedBy: { host: "PC-Main", agent: "Claude", conversation: "login" } });
    expect(() => other.claim(a.id)).toThrow("déjà pris par PC-Main · Claude (login)");
    expect(() => claude.claim(a.id, { conversation: "export" })).toThrow(/déjà pris/);
    expect(() => other.release(a.id)).toThrow(/pas par toi/);
    expect(claude.claim(a.id, { conversation: "login" }).claimedBy?.conversation).toBe("login");
    expect(claude.release(a.id, { conversation: "login" }).claimedBy).toBeNull();
    expect(other.claim(a.id).claimedBy?.host).toBe("PC-Portable");
    expect(claude.claim(a.id, { force: true }).claimedBy?.agent).toBe("Claude");
    const history = claude.history(claude.board("Todoom"), a.id).filter((e) => e.field === "claimedBy");
    expect(history.map((e) => e.to ?? null)).toEqual(["PC-Main · Claude (login)", null, "PC-Portable", "PC-Main · Claude"]);
  });

  it("archives and restores at the bottom of the column", () => {
    const a = store.create("Todoom", "Un");
    const b = store.create("Todoom", "Deux");
    expect(store.archive(a.id).archived).toBe(true);
    const r = store.restore(a.id);
    expect(r.archived).toBe(false);
    expect(r.order).toBeGreaterThan(b.order);
  });

  it("refuses bad input without writing anything", () => {
    const a = store.create("Todoom", "Un");
    const before = readFileSync(join(cardsDir(), `${a.id}.json`), "utf8");
    expect(() => store.update(a.id, { due: "demain" })).toThrow(/Échéance/);
    expect(() => store.update(a.id, { title: "  " })).toThrow(/titre/);
    expect(() => store.update(a.id, { addLabels: ["Nope"] })).toThrow(/Étiquette/);
    expect(readFileSync(join(cardsDir(), `${a.id}.json`), "utf8")).toBe(before);
    expect(readdirSync(cardsDir()).filter((f) => f.includes("tmp"))).toEqual([]);
  });

  it("skips broken card files instead of failing", () => {
    store.create("Todoom", "Un");
    writeFileSync(join(cardsDir(), "broken.json"), "{ not json");
    writeFileSync(join(cardsDir(), "wrong.json"), JSON.stringify({ id: "wrong", title: 42 }));
    expect(store.cards(store.board("Todoom")).map((c) => c.title)).toEqual(["Un"]);
  });
});

describe("data folder", () => {
  it("takes TODOOM_DIR and refuses a folder without boards", () => {
    const saved = process.env.TODOOM_DIR;
    process.env.TODOOM_DIR = dir;
    try {
      expect(findDataDir()).toBe(dir);
      expect(() => findDataDir(tmpdir())).toThrow(/boards/);
    } finally {
      if (saved === undefined) delete process.env.TODOOM_DIR;
      else process.env.TODOOM_DIR = saved;
    }
  });
});
