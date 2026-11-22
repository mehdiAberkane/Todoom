// Keeps the « lecture » folder in step with the data: what changed is written,
// the files of boards gone or renamed are removed. Runs a few seconds after
// the last change, so a burst of edits writes once.
import { useEffect, useRef } from "react";
import type { Board, Card } from "../types";
import { backend } from "./backend";
import { readingChanges, readingFiles } from "./reading";

const QUIET_MS = 4_000;

/** `tick` changes every hour: the « today » file follows the date even without a change. */
export function useReadingCopy(enabled: boolean, ready: boolean, boards: Board[], cards: Record<string, Card[]>, myWorkColumns: string[], tick: number) {
  // What this app wrote last, by name: what is already on disk isn't written again.
  const written = useRef(new Map<string, string>());
  const listed = useRef(false);
  useEffect(() => {
    if (!enabled || !ready) return;
    const id = window.setTimeout(async () => {
      try {
        const next = readingFiles(boards, cards, myWorkColumns);
        // The folder is listed once: removing the files of boards renamed while the app was closed.
        const existing = listed.current ? [...written.current.keys()] : await backend.listReading();
        listed.current = true;
        const { write, remove } = readingChanges(next, written.current, existing);
        for (const [name, content] of write) {
          await backend.writeReading(name, content);
          written.current.set(name, content);
        }
        for (const name of remove) {
          await backend.removeReading(name);
          written.current.delete(name);
        }
      } catch (e) {
        console.warn("lecture", e);
      }
    }, QUIET_MS);
    return () => window.clearTimeout(id);
  }, [enabled, ready, boards, cards, myWorkColumns, tick]);
}
