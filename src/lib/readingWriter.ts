// Keeps the « lecture » folder in step with the data: what changed is written,
// the files of boards gone or renamed are removed. Runs a few seconds after
// the last change, so a burst of edits writes once.
import { useEffect, useRef } from "react";
import type { Board, Card, HistoryEvent } from "../types";
import { backend } from "./backend";
import { readingChanges, readingFiles } from "./reading";
import { isoWeek, lastWeek, oldWeeklyFiles, weeklyReading } from "./weekly";
import { mergedHistory } from "./activity";

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

/**
 * Last week's summary (TOD-71), on the first look of each week: written when its file
 * isn't there yet (another computer may have written it), and the weekly files past
 * the last WEEKS_KEPT removed. `tick` changes every hour, so Monday comes even with
 * the app left open.
 */
export function useWeeklyCopy(
  enabled: boolean,
  ready: boolean,
  boards: Board[],
  cards: Record<string, Card[]>,
  history: Record<string, Record<string, HistoryEvent[]>>,
  tick: number,
) {
  const latest = useRef({ boards, cards, history });
  latest.current = { boards, cards, history };
  // The week already seen to, on this run of the app.
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !ready) return;
    const now = new Date();
    const week = isoWeek(lastWeek(now).start);
    if (done.current === week) return;
    const id = window.setTimeout(async () => {
      try {
        const { boards, cards, history } = latest.current;
        const names = await backend.listReading();
        const file = weeklyReading(boards, cards, (cardId) => mergedHistory(history[cardId]), now);
        if (!names.includes(file.name)) await backend.writeReading(file.name, file.content);
        for (const old of oldWeeklyFiles(names, now)) await backend.removeReading(old);
        done.current = week;
      } catch (e) {
        console.warn("lecture (semaine)", e);
      }
    }, QUIET_MS);
    return () => window.clearTimeout(id);
  }, [enabled, ready, tick]);
}
