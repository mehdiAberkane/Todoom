// Snapshots of the data folder: every day, each computer keeps a dated copy of
// the data files on its own disk, outside the synced folder (see the backend's
// list/save/restore_snapshot). The last N daily ones are kept; one is also
// made before each restore, and on demand.
import type { FileEntry } from "./backend";
import { toISODate } from "./utils";

export const DEFAULT_KEEP = 14;
/** Snapshots made by hand or before a restore: the last ones kept, apart from the daily ones. */
const KEEP_OTHERS = 5;

export type SnapshotKind = "daily" | "manual" | "before-restore";

export interface SnapshotInfo {
  name: string;
  size: number;
}

export interface Snapshot {
  version: 1;
  createdAt: string;
  host: string;
  files: Record<string, string>;
}

/** The files a snapshot holds: the board, card, comment, history and attachment descriptions, and the settings. */
export const isSnapshotData = (path: string) => path.endsWith(".json") && (path === "settings.json" || path.startsWith("boards/"));

/** A snapshot of the files read; those that aren't valid JSON are left out (they would be restored broken). */
export function snapshotOf(files: FileEntry[], host: string, at = new Date()): Snapshot {
  const kept: Record<string, string> = {};
  for (const f of files) {
    if (!isSnapshotData(f.path)) continue;
    try {
      JSON.parse(f.content);
      kept[f.path] = f.content;
    } catch {
      // Damaged: the last good copy is in an earlier snapshot.
    }
  }
  return { version: 1, createdAt: at.toISOString(), host, files: kept };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-22" for the day's snapshot; "2026-11-22_09-30-00_manual" for the others. */
export function snapshotName(kind: SnapshotKind, at = new Date()): string {
  const day = toISODate(at);
  if (kind === "daily") return day;
  return `${day}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}_${kind}`;
}

/** What a name says: its kind, and its date (with the time for the others), to show. */
export function parseName(name: string): { kind: SnapshotKind; day: string; time: string | null } {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})(?:_(\d{2})-(\d{2})-(\d{2})_(manual|before-restore))?$/);
  if (!m) return { kind: "manual", day: name, time: null };
  return { kind: (m[5] as SnapshotKind | undefined) ?? "daily", day: m[1], time: m[2] ? `${m[2]}:${m[3]}` : null };
}

/** Whether today's snapshot is still to make. */
export const needsDaily = (names: string[], today: string) => !names.includes(today);

/** The snapshots to delete: past the last `keep` daily ones, and past the last few others. */
export function toPrune(names: string[], keep = DEFAULT_KEEP): string[] {
  const newestFirst = [...names].sort().reverse();
  const daily = newestFirst.filter((n) => parseName(n).kind === "daily");
  const others = newestFirst.filter((n) => parseName(n).kind !== "daily");
  return [...daily.slice(Math.max(1, keep)), ...others.slice(KEEP_OTHERS)];
}

/** What a restore does to the data files: written back, and those made since removed. */
export function restorePlan(snapshot: Pick<Snapshot, "files">, current: string[]): { write: [string, string][]; remove: string[] } {
  return {
    write: Object.entries(snapshot.files),
    remove: current.filter((p) => isSnapshotData(p) && !(p in snapshot.files)),
  };
}
