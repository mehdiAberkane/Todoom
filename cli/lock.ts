// A lock on this computer around each write of the todoom command and of its MCP
// server: two Claude conversations writing to the same data folder at the same
// moment take turns, instead of numbering two cards alike or both taking the
// same card. The lock file lives in Todoom's local settings folder, not in the
// synced folder: between two computers, Drive's delay makes it useless, and the
// app already settles what they do (a card numbered twice gets a new number).

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface LockOptions {
  /** Where the lock files go (Todoom's local settings folder). */
  dir: string;
  /** How long to wait for the lock before giving up. */
  waitMs?: number;
  /** Past this age a lock is taken over even if its process seems alive (hung). */
  staleMs?: number;
}

export class LockBusy extends Error {}

const WAIT_MS = 10_000;
const STALE_MS = 15_000;
/**
 * A write holds the lock a few milliseconds. A lock younger than this is never
 * judged abandoned: on Windows a lock just given back can still be seen for an
 * instant, and taking it then could delete the lock of whoever took it next.
 */
const SURELY_ABANDONED_MS = 2_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms: number) => Atomics.wait(sleeper, 0, 0, ms);

/** The lock file of a data folder: one per folder, named after its path. */
export function lockPath(dataDir: string, dir: string): string {
  const name = createHash("sha1").update(dataDir.toLowerCase()).digest("hex").slice(0, 16);
  return join(dir, "locks", `${name}.lock`);
}

/** Whether the process that wrote a lock is gone. */
function deadOwner(path: string): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(path, "utf8")) as { pid?: number };
    if (!pid) return false;
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Errors meaning « someone else has it right now »: on Windows, a file being deleted answers EPERM. */
const BUSY = new Set(["EEXIST", "EPERM", "EACCES", "EBUSY"]);

/**
 * Takes the lock of the data folder (waiting for it), returns the function that
 * gives it back. A lock left by a crashed process, or older than staleMs, is
 * taken over.
 */
export function acquireLock(dataDir: string, opts: LockOptions): () => void {
  const path = lockPath(dataDir, opts.dir);
  mkdirSync(join(opts.dir, "locks"), { recursive: true });
  const deadline = Date.now() + (opts.waitMs ?? WAIT_MS);
  let pause = 5;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          rmSync(path, { force: true });
        } catch {
          /* already being deleted */
        }
      };
    } catch (e) {
      if (!BUSY.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
    }
    let age: number;
    try {
      age = Date.now() - statSync(path).mtimeMs;
    } catch {
      age = -1; // gone meanwhile: try again
    }
    if (age > SURELY_ABANDONED_MS && (age > (opts.staleMs ?? STALE_MS) || deadOwner(path))) {
      // Taken over by renaming it: only one taker can rename a given file.
      const aside = `${path}.${process.pid}.stale`;
      try {
        renameSync(path, aside);
        rmSync(aside, { force: true });
      } catch {
        /* another taker was first */
      }
      continue;
    }
    if (age < 0) continue;
    if (Date.now() > deadline) throw new LockBusy(`Todoom est occupé par une autre écriture (${path}) : réessaie dans un instant.`);
    sleep(pause);
    pause = Math.min(pause * 2, 50);
  }
}
