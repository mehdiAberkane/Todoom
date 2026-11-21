import { useState } from "react";
import type { Board } from "../types";
import { t } from "../lib/i18n";
import { Modal } from "./ui";
import { Markdown } from "./Markdown";

/**
 * The board's context page: repository, working rules, vocabulary, what each
 * column means. Agents read it before taking a ticket. Saved when closed.
 */
export function BoardContext({ board, onSave, onClose }: { board: Board; onSave: (b: Board) => void; onClose: () => void }) {
  const [text, setText] = useState(board.description ?? "");
  const [preview, setPreview] = useState(false);

  const close = () => {
    const value = text.trim() ? text.replace(/\s+$/, "") : "";
    if (value !== (board.description ?? "")) onSave({ ...board, description: value });
    onClose();
  };

  const template = () =>
    setText(
      t("context.template", {
        columns: board.columns.map((c) => `- « ${c.name} » : …`).join("\n"),
      }),
    );

  return (
    <Modal onClose={close} className="context-modal">
      <div className="modal-head">
        <h3>{t("context.title", { name: board.name })}</h3>
        <button className="icon-btn" onClick={close} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>
      <p className="muted">{t("context.intro")}</p>
      {preview ? (
        <div className="context-preview">
          <Markdown text={text} />
        </div>
      ) : (
        <textarea className="context-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("context.placeholder")} autoFocus />
      )}
      <div className="modal-foot">
        {text.trim() && (
          <button className="btn-ghost" onClick={() => setPreview((p) => !p)}>
            {preview ? t("md.edit") : t("md.preview")}
          </button>
        )}
        {!text.trim() && (
          <button className="btn-ghost" onClick={template}>
            {t("context.useTemplate")}
          </button>
        )}
        <button className="btn-primary" onClick={close}>
          {t("cardModal.save")}
        </button>
      </div>
    </Modal>
  );
}

/** The first line of the context worth showing under the board's name. */
export function contextSummary(description: string | undefined): string | null {
  const lines = (description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  // A heading such as "## Dépôt" says little: the first line of text does.
  const line = lines.find((l) => !l.startsWith("#")) ?? lines[0];
  return line ? line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "") : null;
}
