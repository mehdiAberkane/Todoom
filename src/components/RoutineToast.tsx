import { useEffect, useState } from "react";
import type { Card } from "../types";
import { formatDue } from "../lib/utils";
import { t } from "../lib/i18n";

const SHOWN_MS = 10_000;

/** What a finished routine brought: its next card, and the column it comes to. */
export interface RoutineNotice {
  next: Card;
  column: string;
}

/**
 * « Routine « Audit » : the next one comes back on 22/12 · Stop the routine », just
 * after a routine is finished here (TOD-82): the card doesn't seem to come back for
 * nothing, and stopping it is one click (the next card goes to the archive).
 */
export function RoutineToast({ notice, onStop }: { notice: RoutineNotice | null; onStop: (next: Card) => void }) {
  const [shown, setShown] = useState<{ text: string; next: Card | null } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const { next, column } = notice;
    setShown({
      text: next.wakeOn ? t("repeat.next", { title: next.title, date: formatDue(next.due!) }) : t("repeat.nextNow", { title: next.title, column }),
      next,
    });
    const timer = window.setTimeout(() => setShown(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!shown) return null;
  return (
    <div className="undo-toast routine-toast" role="status">
      <span>{shown.text}</span>
      {shown.next && (
        <button
          className="link"
          onClick={() => {
            onStop(shown.next!);
            setShown({ text: t("repeat.stopped"), next: null });
          }}
        >
          {t("repeat.stop")}
        </button>
      )}
      <button className="icon-btn" onClick={() => setShown(null)} title={t("common.closeEsc")}>
        ✕
      </button>
    </div>
  );
}
