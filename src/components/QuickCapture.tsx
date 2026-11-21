import { useEffect, useRef, useState } from "react";
import { captureTitle, type CaptureTarget } from "../lib/capture";
import { t } from "../lib/i18n";

/** A line to note an idea and the board it goes to; Enter adds it, Escape gives up. */
export function CaptureForm({ target, onSubmit, onCancel }: { target: CaptureTarget | null; onSubmit: (boardId: string, title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [boardId, setBoardId] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const board = boardId ?? target?.boardId ?? null;
  const send = () => {
    const title = captureTitle(text);
    if (title && board) onSubmit(board, title);
  };
  return (
    <div className="capture-form" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <input
        ref={field}
        className="capture-input"
        value={text}
        placeholder={t("capture.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        maxLength={500}
      />
      <div className="capture-row">
        {target ? (
          <select value={board ?? ""} onChange={(e) => setBoardId(e.target.value)} title={t("capture.boardTitle")}>
            {target.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">{t("capture.loading")}</span>
        )}
        <span className="muted capture-hint">{t("capture.hint")}</span>
        <button className="btn-primary small" disabled={!captureTitle(text) || !board} onClick={send}>
          {t("capture.add")}
        </button>
      </div>
    </div>
  );
}
