import { useState } from "react";
import type { Board, Card, Label } from "../types";
import { formatDateTime } from "../lib/utils";
import { DangerButton, Modal } from "./ui";

interface Props {
  board: Board;
  /** Archived cards of the board. */
  cards: Card[];
  onRestore: (card: Card) => void;
  onDelete: (card: Card) => void;
  onClose: () => void;
}

export function ArchiveModal({ board, cards, onRestore, onDelete, onClose }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = cards
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  const columnName = (id: string) => board.columns.find((c) => c.id === id)?.name;

  return (
    <Modal onClose={onClose} className="archive-modal">
      <div className="modal-head">
        <h3>📦 Archives de « {board.name} »</h3>
        <button className="icon-btn" onClick={onClose} title="Fermer (Échap)">
          ✕
        </button>
      </div>

      {cards.length > 5 && (
        <input className="archive-search" placeholder="🔍 Rechercher dans les archives…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      {cards.length === 0 ? (
        <p className="muted archive-empty">Aucune carte archivée. Rien ne se perd, tout se range.</p>
      ) : (
        <ul className="archive-list">
          {shown.map((card) => {
            const labels = card.labels.map((id) => board.labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
            return (
              <li key={card.id}>
                <div className="archive-info">
                  <div className="archive-title">{card.title}</div>
                  <div className="archive-meta">
                    {labels.map((l) => (
                      <span key={l.id} className="card-label" style={{ background: l.color }}>
                        {l.name}
                      </span>
                    ))}
                    <span>{columnName(card.columnId) ?? "colonne supprimée"}</span>
                    {card.archivedAt && <span>· archivée le {formatDateTime(card.archivedAt)}</span>}
                  </div>
                </div>
                <button className="btn-ghost small" onClick={() => onRestore(card)} title="Remettre la carte en bas de sa colonne">
                  ↩ Restaurer
                </button>
                <DangerButton className="small" onConfirm={() => onDelete(card)} confirmLabel="Définitivement ?">
                  🗑
                </DangerButton>
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted">Aucune carte archivée ne correspond.</li>}
        </ul>
      )}
    </Modal>
  );
}
