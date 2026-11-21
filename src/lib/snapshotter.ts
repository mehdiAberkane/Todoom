// Taking and restoring snapshots through the backend; the rules are in snapshots.ts.
import { backend } from "./backend";
import { needsDaily, snapshotName, snapshotOf, toPrune, type SnapshotKind } from "./snapshots";
import { toISODate } from "./utils";

/** Copies the data files now; null when some aren't downloaded yet (the copy would miss them). */
export async function takeSnapshot(kind: SnapshotKind, keep: number): Promise<string | null> {
  const { files, pending } = await backend.loadAll();
  if (pending.length) return null;
  const name = snapshotName(kind);
  await backend.saveSnapshot(name, JSON.stringify(snapshotOf(files, await backend.hostname())));
  await prune(keep);
  return name;
}

export async function prune(keep: number) {
  const names = (await backend.listSnapshots()).map((s) => s.name);
  for (const name of toPrune(names, keep)) await backend.deleteSnapshot(name);
}

/** Today's snapshot, if this computer hasn't made it yet. */
export async function dailySnapshot(keep: number): Promise<string | null> {
  const names = (await backend.listSnapshots()).map((s) => s.name);
  return needsDaily(names, toISODate(new Date())) ? takeSnapshot("daily", keep) : null;
}

/** Restores a snapshot, after keeping the current state in another one (so a restore can be undone). */
export async function restoreSnapshot(name: string, keep: number) {
  const before = await takeSnapshot("before-restore", keep);
  const result = await backend.restoreSnapshot(name);
  return { ...result, before };
}
