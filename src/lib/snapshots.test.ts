import { describe, expect, it } from "vitest";
import { needsDaily, parseName, restorePlan, snapshotName, snapshotOf, toPrune } from "./snapshots";

describe("snapshots", () => {
  it("keep the data files that read well, not presence nor broken ones", () => {
    const s = snapshotOf(
      [
        { path: "settings.json", content: "{}" },
        { path: "boards/b/board.json", content: '{"id":"b"}' },
        { path: "boards/b/cards/c.json", content: "{ broken" },
        { path: ".presence/PC.json", content: "{}" },
      ],
      "PC",
      new Date("2026-11-22T08:00:00Z"),
    );
    expect(Object.keys(s.files)).toEqual(["settings.json", "boards/b/board.json"]);
    expect(s).toMatchObject({ version: 1, host: "PC", createdAt: "2026-11-22T08:00:00.000Z" });
  });

  it("are named by day, or by time with their kind", () => {
    const at = new Date(2026, 10, 22, 9, 5, 7);
    expect(snapshotName("daily", at)).toBe("2026-11-22");
    expect(snapshotName("manual", at)).toBe("2026-11-22_09-05-07_manual");
    expect(parseName("2026-11-22_09-05-07_before-restore")).toEqual({ kind: "before-restore", day: "2026-11-22", time: "09:05" });
    expect(parseName("2026-11-22")).toEqual({ kind: "daily", day: "2026-11-22", time: null });
    expect(needsDaily(["2026-11-21", "2026-11-22_09-05-07_manual"], "2026-11-22")).toBe(true);
    expect(needsDaily(["2026-11-22"], "2026-11-22")).toBe(false);
  });

  it("keep the last N daily ones, and a few of the others", () => {
    const daily = Array.from({ length: 5 }, (_, i) => `2026-11-1${i}`);
    const manual = Array.from({ length: 7 }, (_, i) => `2026-11-1${i}_10-00-00_manual`);
    expect(toPrune([...daily, ...manual], 3)).toEqual(["2026-11-11", "2026-11-10", "2026-11-11_10-00-00_manual", "2026-11-10_10-00-00_manual"]);
    expect(toPrune(daily, 0)).toHaveLength(4); // always the last one at least
  });

  it("restore the files, and remove the data files made since", () => {
    const plan = restorePlan({ files: { "settings.json": "{}", "boards/b/cards/old.json": "{}" } }, [
      "settings.json",
      "boards/b/cards/new.json",
      ".presence/PC.json",
    ]);
    expect(plan.write.map(([p]) => p)).toEqual(["settings.json", "boards/b/cards/old.json"]);
    expect(plan.remove).toEqual(["boards/b/cards/new.json"]);
  });
});
