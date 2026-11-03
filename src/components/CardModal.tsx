import { useState } from "react";
import type { Board, Card } from "../types";
import { addDays, dueStatus, formatDateTime, uid } from "../lib/utils";
import { DangerButton, Modal } from "./ui";

interface Props {
  card: Card;
  board: Board;
  onSave: (card: Card) => void;
  onDelete: () => void;
  onClose: () => void;
  onManageLabels: () => void;
}

/** Edits a draft and saves once on close, so typing doesn't rewrite the file on every keystroke. */
export function CardModal({ card, board, onSave, onDelete, onClose, onManageLabels }: Props) {
  const [draft, setDraft] = useState(card);
  const [newItem, setNewItem] = useState("");
  const set = (patch: Partial<Card>) => setDraft((d) => ({ ...d, ...patch }));

  const close = () => {
    const cleaned = { ...draft, title: draft.title.trim() || card.title };
    if (JSON.stringify(cleaned) !== JSON.stringify(card)) onSave(cleaned);
    onClose();
  };

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

  return (
    <Modal onClose={close} className="card-modal">
      <div className="modal-head">
        <textarea
          className="modal-title"
          rows={1}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
          placeholder="Titre"
        />
        <button className="icon-btn" onClick={close} title="Fermer (Échap)">
          ✕
        </button>
      </div>

      <div className="modal-body">
        <div className="modal-main">
          <h4>Description</h4>
          <textarea
            className="description"
            rows={6}
            placeholder="Détails, liens, notes… "
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />

          <h4>
            Checklist {total > 0 && <span className="muted">{done}/{total}</span>}
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
                  title="Retirer"
                  onClick={() => set({ checklist: draft.checklist.filter((i) => i.id !== item.id) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="check-add">
            <input
              placeholder="+ Ajouter un élément"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
          </div>
        </div>

        <aside className="modal-side">
          <h4>Colonne</h4>
          <select value={draft.columnId} onChange={(e) => set({ columnId: e.target.value })}>
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <h4>
            Étiquettes
            <button className="link" onClick={onManageLabels}>
              gérer
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
            {board.labels.length === 0 && <span className="muted">Aucune étiquette</span>}
          </div>

          <h4>Échéance</h4>
          <input
            type="date"
            className={due ? `due-${due}` : ""}
            value={draft.due ?? ""}
            onChange={(e) => set({ due: e.target.value || null })}
          />
          <div className="due-shortcuts">
            <button className="btn-ghost small" onClick={() => set({ due: addDays(0) })}>Aujourd'hui</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(1) })}>Demain</button>
            <button className="btn-ghost small" onClick={() => set({ due: addDays(7) })}>+1 sem.</button>
            {draft.due && (
              <button className="btn-ghost small" onClick={() => set({ due: null })}>Retirer</button>
            )}
          </div>

          <div className="meta">
            <div>Créée le {formatDateTime(card.createdAt)}</div>
            {card.updatedAt && <div>Modifiée le {formatDateTime(card.updatedAt)}</div>}
          </div>

          <DangerButton className="full" onConfirm={onDelete} confirmLabel="Clique encore pour l'anéantir">
            🗑 Supprimer la carte
          </DangerButton>
        </aside>
      </div>
    </Modal>
  );
}
