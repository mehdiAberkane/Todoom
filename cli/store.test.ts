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

  it("updates only the fields given, and appends comments", () => {
    const a = store.create("Todoom", "Un", { description: "Début", labels: ["Bug"], due: "2026-12-01" });
    const u = store.update(a.id, { removeLabels: ["bug"], due: null });
    expect(u).toMatchObject({ title: "Un", description: "Début", labels: [], due: null });
    const c = store.comment(a.id, "Fait.", "PC-TEST");
    expect(c.description).toMatch(/^Début\n\n--- .+ · PC-TEST ---\nFait\.$/);
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
