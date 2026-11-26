import { useState } from "react";
import type { Board } from "../types";
import { t } from "../lib/i18n";
import { Modal } from "./ui";
import { Markdown } from "./Markdown";
import { branchName, DEFAULT_BRANCH_FORMAT } from "../lib/dev";
import { parseRepo } from "../lib/reviews";
import { mergeSetting, type MergeAction } from "../lib/reviewWatch";
import { isDoneName } from "../lib/links";

/**
 * The board's context page: repository, working rules, vocabulary, what each
 * column means. Agents read it before taking a ticket. Saved when closed.
 */
export function BoardContext({ board, onSave, onClose }: { board: Board; onSave: (b: Board) => void; onClose: () => void }) {
  const [text, setText] = useState(board.description ?? "");
  const [preview, setPreview] = useState(false);
  const [format, setFormat] = useState(board.branchFormat ?? "");
  const [repo, setRepo] = useState(board.repo ?? "");
  // When a card's PR/MR is merged (TOD-69): what to do, and to which column ("" : « A verifier »).
  const [mergeAction, setMergeAction] = useState<MergeAction>(board.onMerge?.action ?? "propose");
  const [mergeColumn, setMergeColumn] = useState(board.onMerge?.columnId ?? "");

  const close = () => {
    const value = text.trim() ? text.replace(/\s+$/, "") : "";
    // The default format is not written: the board keeps following it if it changes.
    const branchFormat = format.trim() && format.trim() !== DEFAULT_BRANCH_FORMAT ? format.trim() : undefined;
    const repoValue = repo.trim() || undefined;
    // The default (offer, to « A verifier ») is not written.
    const onMerge = mergeAction === "propose" && !mergeColumn ? undefined : { action: mergeAction, ...(mergeColumn ? { columnId: mergeColumn } : {}) };
    const mergeChanged = JSON.stringify(onMerge ?? null) !== JSON.stringify(board.onMerge ?? null);
    if (value !== (board.description ?? "") || branchFormat !== board.branchFormat || repoValue !== board.repo || mergeChanged) {
      const { branchFormat: _old, repo: _oldRepo, onMerge: _oldMerge, ...rest } = board;
      onSave({ ...rest, description: value, ...(branchFormat ? { branchFormat } : {}), ...(repoValue ? { repo: repoValue } : {}), ...(onMerge ? { onMerge } : {}) });
    }
    onClose();
  };
  // The column named « A verifier » (or alike), where merged ones go unless another is chosen.
  const defaultColumn = mergeSetting({ ...board, onMerge: undefined }).column?.name;
  // An example card of this board, to show what the format gives.
  const example = branchName(
    { id: "example", number: 51, title: t("context.branchExampleTitle"), labels: [] } as unknown as Parameters<typeof branchName>[0],
    board,
    format.trim() || DEFAULT_BRANCH_FORMAT,
  );

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
      <div className="branch-format">
        <label>
          {t("context.repo")}
          <input
            value={repo}
            placeholder="https://github.com/…/…"
            spellCheck={false}
            className={repo.trim() && !parseRepo(repo) ? "invalid" : ""}
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        <p className="hint">{repo.trim() && !parseRepo(repo) ? t("context.repoInvalid") : t("context.repoHint")}</p>
      </div>
      {repo.trim() && (
        <div className="branch-format merge-setting">
          <label>
            {t("context.onMerge")}
            <select value={mergeAction} onChange={(e) => setMergeAction(e.target.value as MergeAction)}>
              {(["none", "propose", "move"] as const).map((a) => (
                <option key={a} value={a}>
                  {t(`context.onMerge.${a}`)}
                </option>
              ))}
            </select>
            {mergeAction !== "none" && (
              <select value={mergeColumn} onChange={(e) => setMergeColumn(e.target.value)} aria-label={t("context.onMergeColumn")}>
                <option value="">{t("context.onMergeDefault", { column: defaultColumn ?? "—" })}</option>
                {board.columns
                  .filter((c) => !isDoneName(c.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </label>
          <p className="hint">{mergeAction !== "none" && !mergeColumn && !defaultColumn ? t("context.onMergeNoColumn") : t("context.onMergeHint")}</p>
        </div>
      )}
      <div className="branch-format">
        <label>
          {t("context.branchFormat")}
          <input value={format} placeholder={DEFAULT_BRANCH_FORMAT} spellCheck={false} onChange={(e) => setFormat(e.target.value)} />
        </label>
        <p className="hint">{t("context.branchFormatHint", { example })}</p>
      </div>
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
