import { useEffect, useState } from "react";
import type { Board, Card } from "../types";
import { addDays, dueStatus, formatDateTime, formatDue, now, uid } from "../lib/utils";
import { conflicts, mergeEdits, rebase, type Field } from "../lib/merge";
import { t } from "../lib/i18n";

const fieldLabel = (f: Field) => t(`field.${f}`);
import { Modal } from "./ui";

interface Props {
  card: Card;
  board: Board;
  onSave: (card: Card) => void;
  onClose: () => void;
  onManageLabels: () => void;
}

/**
 * Edits a draft and saves once on close, so typing doesn't rewrite the file on
 * every keystroke. `card` follows reloads while the window is open: only the
 * fields edited here are written over it, so changes made elsewhere (another
 * PC, the agent) are kept.
 */
export function CardModal({ card, board, onSave, onClose, onManageLabels }: Props) {
  // The version the edits started from, moved forward as outside changes come in.
  const [base, setBase] = useState(card);
  const [draft, setDraft] = useState(card);
  const [incoming, setIncoming] = useState<Field[]>([]);
  const [resolving, setResolving] = useState<{ fields: Field[]; archive: boolean } | null>(null);
  const [keepTheirs, setKeepTheirs] = useState<Set<Field>>(new Set());
  const [newItem, setNewItem] = useState("");
  const set = (patch: Partial<Card>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const r = rebase(base, draft, card);
    if (!r.incoming.length) return;
    setBase(r.base);
    setDraft(r.draft);
    setIncoming((prev) => [...new Set([...prev, ...r.incoming])]);
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleaned = () => ({ ...draft, title: draft.title.trim() || base.title });
  const pending = conflicts(base, cleaned(), card);

  const finish = (archive: boolean, theirs: ReadonlySet<Field>) => {
    const merged = mergeEdits(base, cleaned(), card, theirs);
    if (archive) onSave({ ...(merged ?? card), archivedAt: now() });
    else if (merged) onSave(merged);
    onClose();
  };

  // Asks which version to keep when a field was also changed elsewhere.
  const leave = (archive: boolean) => {
    if (pending.length) {
      setKeepTheirs(new Set());
      setResolving({ fields: pending, archive });
    } else {
      finish(archive, new Set());
    }
  };
  const close = () => leave(false);
  // Keeps any pending edits; archiving is reversible, so no confirmation.
  const archive = () => leave(true);

  const toggleLabel = (id: string) =>
    set({ labels: draft.labels.includes(id) ? draft.labels.filter((l) => l !== id) : [...draft.labels, id] });

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    set({ checklist: [...draft.checklist, { id: uid(), text, done: false }] });
    setNewItem("");
  };

  const updateItem = (id: string, patch: { text?: string; done?: boolean }) =>
    set({ checklist: draft.checklist.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const done = draft.checklist.filter((i) => i.done).length;
  const total = draft.checklist.length;
  const due = dueStatus(draft.due);

  if (resolving) {
    const choose = (f: Field, theirs: boolean) =>
      setKeepTheirs((s) => {
        const next = new Set(s);
        if (theirs) next.add(f);
        else next.delete(f);
        return next;
      });
    return (
      <Modal onClose={() => setResolving(null)} className="conflict-modal">
        <div className="modal-head">
          <h3>{t("conflict.title")}</h3>
        </div>
        <p className="muted">{t("conflict.intro")}</p>
        {resolving.fields.map((f) => (
          <div key={f} className="conflict">
            <h4>{fieldLabel(f)}</h4>
            <label className={!keepTheirs.has(f) ? "on" : ""}>
              <input type="radio" checked={!keepTheirs.has(f)} onChange={() => choose(f, false)} />
              <span className="conflict-who">{t("conflict.mine")}</span>
              <span className="conflict-value">{describe(f, cleaned(), board)}</span>
            </label>
            <label className={keepTheirs.has(f) ? "on" : ""}>
              <input type="radio" checked={keepTheirs.has(f)} onChange={() => choose(f, true)} />
              <span className="conflict-who">{t("conflict.theirs")}</span>
              <span className="conflict-value">{describe(f, card, board)}</span>
            </label>
          </div>
        ))}
        <div className="conflict-actions">
          <button className="btn-ghost" onClick={() => setResolving(null)}>
            {t("conflict.back")}
          </button>
          <button className="btn-primary" onClick={() => finish(resolving.archive, keepTheirs)}>
            {resolving.archive ? t("conflict.saveArchive") : t("conflict.save")}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={close} className="card-modal">
      <div className="modal-head">
        <textarea
          className="modal-title"
          rows={1}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
          placeholder={t("cardModal.title")}
        />
        <button className="icon-btn" onClick={close} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>

      {(incoming.length > 0 || pending.length > 0) && (
        <div className="external-banner">
          {incoming.length > 0 && (
            <div>
              {t("cardModal.incoming", { fields: incoming.map(fieldLabel).join(", ") })}
            </div>
          )}
          {pending.length > 0 && (
            <div className="external-conflict">
              {t("cardModal.bothSides", { fields: pending.map(fieldLabel).join(", ") })}
            </div>
          )}
        </div>
      )}

      <div className="modal-body">
        <div className="modal-main">
          <h4>{t("field.description")}</h4>
          <textarea
            className="description"
            rows={6}
            placeholder={t("cardModal.descriptionPlaceholder")}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />

          <h4>
            {t("field.checklist")} {total > 0 && <span className="muted">{done}/{total}</span>}
          </h4>
          {total > 0 && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
          <ul className="checklist">
            {draft.checklist.map((item) => (
              <li key={item.id} className={item.done ? "done" : ""}>
                <input type="checkbox" checked={item.done} onChange={(e) => updateItem(item.id, { done: e.target.checked })} />
                <input className="check-text" value={item.text} onChange={(e) => updateItem(item.id, { text: e.target.value })} />
                <button
                  className="icon-btn"
                  title={t("cardModal.remove")}
                  onClick={() => set({ checklist: draft.checklist.filter((i) => i.id !== item.id) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="check-add">
            <input
              placeholder={t("cardModal.addItem")}
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
          </div>
        </div>

        <aside className="modal-side">
          <h4>{t("field.columnId")}</h4>
          <select value={draft.columnId} onChange={(e) => set({ columnId: e.target.value })}>
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <h4>
            {t("field.labels")}
            <button className="link" onClick={onManageLabels}>
              {t("cardModal.manageLabels")}
            </button>
          </h4>
          <div className="label-picker">
            {board.labels.map((l) => (
              <button
                key={l.id}
                className={`filter-chip ${draft.labels.includes(l.id) ? "on" : ""}`}
                style={{ "--chip": l.color } as React.CSSProperties}
                onClick={() => toggleLabel(l.id)}
              >
                {l.name}
              </button>
            ))}
            {board.labels.length === 0 && <span className="muted">{t("cardModal.noLabels")}</span>}
          </div>

          <h4>{t("field.due")}</h4>
          <input
            type="date"
            className={due ? `due-${due}` : ""}
            value={draft.due ?? ""}
            onChange={(e) => set({ due: e.target.value || null })}
          />
          <div className="due-shortcuts">
            <button className="btn-ghost small" onClick={() => set({ due: addDays(0) })}>{t("cardModal.today")}</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(1) })}>{t("cardModal.tomorrow")}</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(7) })}>{t("cardModal.nextWeek")}</button>
            {draft.due && (
              <button className="btn-ghost small" onClick={() => set({ due: null })}>{t("cardModal.remove")}</button>
            )}
          </div>

          <div className="meta">
            <div>{t("cardModal.created", { date: formatDateTime(card.createdAt) })}</div>
            {card.updatedAt && <div>{t("cardModal.updated", { date: formatDateTime(card.updatedAt) })}</div>}
          </div>

          <button className="btn-ghost full" onClick={archive} title={t("cardModal.archiveTitle")}>
            {t("cardModal.archive")}
          </button>
        </aside>
      </div>
    </Modal>
  );
}

/** One-line, human-readable value of a field, for the conflict choice. */
function describe(field: Field, card: Card, board: Board): string {
  switch (field) {
    case "columnId":
      return board.columns.find((c) => c.id === card.columnId)?.name ?? t("describe.deletedColumn");
    case "labels":
      return card.labels.map((id) => board.labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ") || t("describe.none");
    case "due":
      return card.due ? formatDue(card.due) : t("describe.none");
    case "checklist": {
      const done = card.checklist.filter((i) => i.done).length;
      return t("describe.checklist", { n: card.checklist.length, done, items: card.checklist.map((i) => i.text).join(" · ") });
    }
    default: {
      const text = card[field].trim();
      return text ? (text.length > 280 ? `${text.slice(0, 280)}…` : text) : t("describe.empty");
    }
  }
}
