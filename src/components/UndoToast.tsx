import { useEffect, useRef, useState } from "react";
import { describe, type UndoGroup } from "../lib/undo";
import { isTyping, modalOpen } from "../lib/keys";
import { t, tn } from "../lib/i18n";

const SHOWN_MS = 8_000;

const label = (group: UndoGroup) => {
  const { key, n } = describe(group);
  return tn(key as "undo.moved", n);
};

/**
 * After an action, « Card moved · Undo » for a few seconds; Ctrl + Z (Cmd + Z)
 * undoes too, outside text fields and windows, as long as there is something to undo.
 */
export function UndoToast({ lastAction, onUndo }: { lastAction: UndoGroup | null; onUndo: () => { group: UndoGroup; stale: number } | null }) {
  const [shown, setShown] = useState<{ text: string; undoable: boolean } | null>(null);
  // The newest action shown: after an undo, the one before comes back as the last, but isn't new.
  const seen = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const show = (text: string, undoable: boolean) => {
    setShown({ text, undoable });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(null), SHOWN_MS);
  };

  // A new action: offer to undo it.
  useEffect(() => {
    if (!lastAction || lastAction.id <= seen.current) return;
    seen.current = lastAction.id;
    show(label(lastAction), true);
  }, [lastAction]);

  const undo = () => {
    const result = onUndo();
    if (!result) return show(t("undo.nothing"), false);
    const text = result.stale ? tn("undo.stale", result.stale, { what: label(result.group) }) : t("undo.done", { what: label(result.group) });
    show(text, false);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      // In a field, Ctrl + Z undoes the typing; with a window open, its own work.
      if (isTyping(e.target) || modalOpen()) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="undo-toast" role="status">
      <span>{shown.text}</span>
      {shown.undoable && (
        <button className="link" onClick={undo} title={t("undo.title")}>
          {t("undo.button")}
        </button>
      )}
      <button className="icon-btn" onClick={() => setShown(null)} title={t("common.closeEsc")}>
        ✕
      </button>
    </div>
  );
}
