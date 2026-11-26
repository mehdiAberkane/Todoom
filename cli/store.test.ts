import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardProblem } from "../src/lib/validate";
import { findDataDir, listed, normalize, Store, TodoomError } from "./store";
import { acquireLock, LockBusy, lockPath } from "./lock";

// The lock files of these tests stay in a temporary folder, not in Todoom's settings.
process.env.TODOOM_LOCK_DIR = mkdtempSync(join(tmpdir(), "todoom-locks-"));

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

describe("order", () => {
  it("lists each column as the app shows it: « À faire » by priority, a late card first, « A verifier » by hand", () => {
    const low = store.create("Todoom", "Basse", { priority: "P3" });
    const high = store.create("Todoom", "Haute", { priority: "P1" });
    const late = store.create("Todoom", "En retard", { priority: "P3", due: "2020-01-01" });
    const none = store.create("Todoom", "Sans priorité");
    const first = store.create("Todoom", "Arrivée d'abord", { priority: "P3", column: "A verifier" });
    const second = store.create("Todoom", "Arrivée ensuite", { priority: "P1", column: "A verifier" });
    const board = store.board("Todoom");
    expect(store.cards(board).map((c) => c.id)).toEqual([late.id, high.id, low.id, none.id, first.id, second.id]);
  });

  it("keeps a column by hand once that is chosen", () => {
    const raw = JSON.parse(readFileSync(join(dir, "boards", "b1", "board.json"), "utf8"));
    raw.columns[0].sort = "manual";
    writeFileSync(join(dir, "boards", "b1", "board.json"), JSON.stringify(raw));
    const low = store.create("Todoom", "Basse", { priority: "P3" });
    const high = store.create("Todoom", "Haute", { priority: "P1" });
    expect(store.cards(store.board("Todoom")).map((c) => c.id)).toEqual([low.id, high.id]);
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

  it("makes a card a routine, and stops it", () => {
    const a = store.create("Todoom", "Audit");
    expect(store.update(a.id, { repeat: "month" }).repeat).toBe("month");
    expect(onDisk(a.id).repeat).toEqual({ every: "month" });
    expect(store.update(a.id, { repeat: null }).repeat).toBeNull();
    expect(onDisk(a.id).repeat).toBeNull();
    expect(() => store.update(a.id, { repeat: "yearly" })).toThrow(/Répétition inconnue/);
  });

  it("leaves a routine's next card out of the listing until its day, and brings it when moved by hand (TOD-82)", () => {
    const a = store.create("Todoom", "Audit");
    const b = store.create("Todoom", "Autre");
    writeFileSync(join(cardsDir(), `${a.id}.json`), JSON.stringify({ ...onDisk(a.id), wakeOn: "2026-12-15" }));
    const cards = store.cards(store.board("Todoom"));
    const ids = (wanted: { archived?: boolean; waiting?: boolean }, today: string) => cards.filter((c) => listed(c, wanted, today)).map((c) => c.id);
    expect(ids({}, "2026-11-26")).toEqual([b.id]);
    expect(ids({ waiting: true }, "2026-11-26")).toEqual([a.id]);
    expect(ids({}, "2026-12-15").sort()).toEqual([a.id, b.id].sort());
    expect(store.card(a.id).card.wakeOn).toBe("2026-12-15");
    expect(store.view(store.card(a.id).card, store.board("Todoom")).wakeOn).toBe("2026-12-15");
    const moved = store.move(a.id, "À faire");
    expect(moved.wakeOn).toBeUndefined();
    expect(onDisk(a.id).wakeOn).toBeNull();
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

  it("suggests the branch from the board's format until one is set, and can record it", () => {
    const a = store.create("Todoom", "Thème clair", { labels: ["bug"] });
    expect(a.suggestedBranch).toBe("fix/TOD-1-theme-clair");
    expect(store.branch(a.id)).toBe("fix/TOD-1-theme-clair");
    expect(onDisk(a.id).branch).toBeNull();
    expect(store.branch(a.id, { save: true })).toBe("fix/TOD-1-theme-clair");
    expect(onDisk(a.id).branch).toBe("fix/TOD-1-theme-clair");
    const shown = store.detail(store.card(a.id).card, store.board("Todoom"));
    expect(shown).toMatchObject({ branch: "fix/TOD-1-theme-clair" });
    expect("suggestedBranch" in shown).toBe(false);
    // A branch named otherwise is kept.
    store.update(a.id, { branch: "hotfix/theme" });
    expect(store.branch(a.id, { save: true })).toBe("hotfix/theme");
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

  it("reads and writes the board's context, keeping its other fields", () => {
    expect(store.boardDetail("todoom")).toMatchObject({ name: "Todoom", description: "", columns: ["À faire", "En cours", "A verifier"] });
    const done = store.setBoardDescription("todoom", "## Dépôt\nC:/projets/todoom\n\n");
    expect(done.description).toBe("## Dépôt\nC:/projets/todoom");
    const raw = JSON.parse(readFileSync(join(dir, "boards", "b1", "board.json"), "utf8"));
    expect(raw.labels).toEqual([{ id: "l1", name: "Bug", color: "#f00" }]);
    expect(raw.description).toBe("## Dépôt\nC:/projets/todoom");
  });

  it("moves a card to another board with its comments, labels matched by name, a new number", () => {
    mkdirSync(join(dir, "boards", "b2", "cards"), { recursive: true });
    writeFileSync(
      join(dir, "boards", "b2", "board.json"),
      JSON.stringify({ id: "b2", name: "Nyx", key: "NYX", columns: [{ id: "n0", name: "Backlog" }, { id: "n1", name: "En cours" }], labels: [{ id: "nb", name: "bug", color: "#f00" }] }),
    );
    const a = store.create("Todoom", "Un", { labels: ["Bug"] });
    store.comment(a.id, "Avant le déplacement");
    const moved = store.moveToBoard(a.id, "nyx", "en cours");
    expect(moved).toMatchObject({ id: a.id, board: "Nyx", column: "En cours", labels: ["bug"], ref: "NYX-1" });
    expect(existsSync(join(dir, "boards", "b1", "cards", `${a.id}.json`))).toBe(false);
    expect(existsSync(join(dir, "boards", "b1", "comments", a.id))).toBe(false);
    const shown = store.detail(store.card(a.id).card, store.board("Nyx"));
    expect(shown.comments.map((c) => c.text)).toEqual(["Avant le déplacement"]);
    expect(shown.history.at(-1)).toMatchObject({ field: "board", from: "Todoom / À faire", to: "Nyx / En cours" });
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

describe("files written by someone else in the synced folder", () => {
  it("never follows a card or board id out of the data folder", () => {
    const outside = `${dir}-outside`;
    mkdirSync(outside, { recursive: true });
    try {
      // From boards/b1/cards: four levels up is the data folder's parent.
      const sneaky = `../../../../${basename(outside)}/pwned`;
      writeFileSync(join(cardsDir(), "x.json"), JSON.stringify({ id: sneaky, number: 7, columnId: "todo", title: "t", updatedAt: "1" }));
      // An id that differs from its file name is skipped, whatever it holds.
      writeFileSync(join(cardsDir(), "other.json"), JSON.stringify({ id: "c2", number: 8, columnId: "todo", title: "t", updatedAt: "1" }));
      expect(store.cards(store.board("Todoom"))).toEqual([]);
      expect(() => store.card(`${store.board("Todoom").key ?? "TOD"}-7`)).toThrow(TodoomError);
      expect(() => store.card("other")).toThrow(TodoomError);
      expect(readdirSync(outside)).toEqual([]);
      // A board whose content id isn't its folder name is skipped too.
      mkdirSync(join(dir, "boards", "b2"));
      writeFileSync(join(dir, "boards", "b2", "board.json"), JSON.stringify({ id: "../b1", name: "Piège", columns: [], updatedAt: "1" }));
      expect(store.boards().map((b) => b.id)).toEqual(["b1"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("a new board", () => {
  it("is made like in the app: template, key, last in the sidebar, context and repository", () => {
    const made = store.createBoard("Ongaku", { repo: "https://github.com/me/ongaku", description: "## Dépôt\nongaku" });
    expect(made).toMatchObject({ name: "Ongaku", key: "ONG", repo: "https://github.com/me/ongaku", description: "## Dépôt\nongaku" });
    expect(made.columns).toEqual(["À faire", "En cours", "A verifier", "Terminé", "Backlog"]);
    expect(made.labels).toContain("Bug");
    expect(readdirSync(join(dir, "boards", made.id))).toEqual(["board.json", "cards"]);
    // Its cards get the key at once.
    expect(store.create("Ongaku", "Premier ticket").ref).toBe("ONG-1");
  });

  it("copies the set-up of a board, or takes the simple one", () => {
    expect(store.createBoard("Copie", { template: "todoom" }).columns).toEqual(["À faire", "En cours", "A verifier"]);
    expect(store.createBoard("Courses", { template: "simple" }).columns).toEqual(["À faire", "En cours", "Terminé"]);
  });

  it("refuses an existing name, an empty one, or an address that isn't a repository", () => {
    expect(() => store.createBoard(" todoom ")).toThrow(/existe déjà/);
    expect(() => store.createBoard("  ")).toThrow(TodoomError);
    expect(() => store.createBoard("X", { repo: "file:///etc" })).toThrow(/dépôt/);
    expect(store.boards().map((b) => b.name)).toEqual(["Todoom"]);
  });
});

describe("two writers on the same computer", () => {
  // The app writes without this lock: what it writes between our reading and our writing is kept.
  const appWrites = (id: string, patch: Record<string, unknown>) => {
    const file = join(cardsDir(), `${id}.json`);
    const card = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...card, ...patch, updatedAt: new Date(Date.parse(card.updatedAt) + 1000).toISOString() }));
  };
  const someoneElse = (conversation: string) => ({ host: "PC-Main", agent: "Claude", conversation, at: "2026-11-23T10:00:00.000Z" });

  it("a card changed underneath is written again from the fresh version", () => {
    const a = store.create("Todoom", "Carte");
    let once = true;
    // Between the reading and the writing of the update, the card is taken elsewhere.
    store.beforeWrite = () => {
      if (!once) return;
      once = false;
      appWrites(a.id, { claimedBy: someoneElse("autre") });
    };
    const updated = store.update(a.id, { title: "Carte renommée" });
    expect(updated.title).toBe("Carte renommée");
    // The other one's claim was not lost.
    expect(onDisk(a.id).claimedBy?.conversation).toBe("autre");
  });

  it("a claim made underneath wins: the second one is refused", () => {
    const a = store.create("Todoom", "Carte");
    let once = true;
    store.beforeWrite = () => {
      if (!once) return;
      once = false;
      appWrites(a.id, { claimedBy: someoneElse("première") });
    };
    expect(() => store.claim(a.id, { conversation: "seconde" })).toThrow(/déjà pris/);
    expect(onDisk(a.id).claimedBy.conversation).toBe("première");
  });

  it("waits for the lock, takes over one left by a dead process", () => {
    const lockDir = mkdtempSync(join(tmpdir(), "todoom-lock-"));
    const release = acquireLock(dir, { dir: lockDir });
    // Held by this live process: another taker waits, then gives up.
    expect(() => acquireLock(dir, { dir: lockDir, waitMs: 50 })).toThrow(LockBusy);
    release();
    acquireLock(dir, { dir: lockDir })();
    // Left by a process that no longer exists, a while ago: taken over at once.
    const abandoned = lockPath(dir, lockDir);
    writeFileSync(abandoned, JSON.stringify({ pid: 999999, at: "2026-01-01T00:00:00Z" }));
    const old = new Date(Date.now() - 5000);
    utimesSync(abandoned, old, old);
    acquireLock(dir, { dir: lockDir, waitMs: 50 })();
    // Just written by a process gone at once: not judged abandoned yet (Windows may still show a lock just given back).
    writeFileSync(abandoned, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
    expect(() => acquireLock(dir, { dir: lockDir, waitMs: 50 })).toThrow(LockBusy);
    rmSync(lockDir, { recursive: true, force: true });
  });

});

describe("sizes", () => {
  it("refuses a field longer than the app allows, with a clear message, and writes nothing", () => {
    const a = store.create("Todoom", "Carte");
    const before = readFileSync(join(cardsDir(), `${a.id}.json`), "utf8");
    expect(() => store.update(a.id, { description: "x".repeat(100_001) })).toThrow(/« description » est trop long/);
    expect(() => store.create("Todoom", "t".repeat(501))).toThrow(/« title » est trop long/);
    expect(readFileSync(join(cardsDir(), `${a.id}.json`), "utf8")).toBe(before);
  });

  it("skips a card file over 5 MB without reading it, as the app does", () => {
    store.create("Todoom", "Normale");
    const huge = join(cardsDir(), "huge.json");
    writeFileSync(huge, "");
    truncateSync(huge, 5 * 1024 * 1024 + 1);
    expect(store.cards(store.board("Todoom")).map((c) => c.title)).toEqual(["Normale"]);
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
