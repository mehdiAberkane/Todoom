import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { conflicts, mergeEdits, rebase } from "./merge";

const card = (patch: Partial<Card> = {}): Card => ({
  id: "c1",
  boardId: "b1",
  columnId: "todo",
  order: 1,
  title: "Ticket",
  description: "",
  labels: [],
  priority: null,
  due: null,
  checklist: [],
  links: [],
  branch: null,
  mergeRequest: null,
  archivedAt: null,
  createdAt: "2026-11-16T10:00:00.000Z",
  updatedAt: "2026-11-16T10:00:00.000Z",
  ...patch,
});

describe("closing the card editor", () => {
  it("keeps a change made elsewhere when nothing was edited (audit B1)", () => {
    const opened = card();
    const agent = card({ columnId: "done", order: 9, description: "ajouté par l'agent", updatedAt: "2026-11-16T10:05:00.000Z" });
    // Nothing edited in the window: nothing to write, the agent's version stays.
    expect(mergeEdits(opened, opened, agent)).toBeNull();
  });

  it("applies only the edited fields on top of the latest version", () => {
    const opened = card();
    const draft = { ...opened, title: "Nouveau titre" };
    const agent = card({ columnId: "done", order: 9, updatedAt: "2026-11-16T10:05:00.000Z" });
    expect(mergeEdits(opened, draft, agent)).toEqual({ ...agent, title: "Nouveau titre" });
  });

  it("reports a field changed on both sides, and lets the user keep either version", () => {
    const opened = card();
    const draft = { ...opened, description: "ma version" };
    const other = card({ description: "leur version" });
    expect(conflicts(opened, draft, other)).toEqual(["description"]);
    expect(mergeEdits(opened, draft, other)?.description).toBe("ma version");
    expect(mergeEdits(opened, draft, other, new Set(["description"] as const))).toBeNull();
  });

  it("is not a conflict when both sides made the same change", () => {
    const opened = card();
    const draft = { ...opened, due: "2026-12-01" };
    expect(conflicts(opened, draft, card({ due: "2026-12-01" }))).toEqual([]);
  });

  it("shows external changes to untouched fields in the open editor", () => {
    const opened = card();
    const draft = { ...opened, title: "en cours d'écriture" };
    const latest = card({ columnId: "done", title: "titre changé ailleurs" });
    const r = rebase(opened, draft, latest);
    expect(r.incoming).toEqual(["columnId"]);
    expect(r.draft).toMatchObject({ columnId: "done", title: "en cours d'écriture" });
    // The title was edited here too: it is a conflict, not silently replaced.
    expect(conflicts(r.base, r.draft, latest)).toEqual(["title"]);
  });
});
