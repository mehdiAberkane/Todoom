import type { Board, Card } from "../types";
import { purgeDate, TRASH_DAYS } from "../lib/store";
import { formatDateTime } from "../lib/utils";
import { DangerButton, Modal } from "./ui";

interface Props {
  boards: Board[];
  cardsByBoard: Record<string, Card[]>;
  onRestore: (board: Board) => void;
  onPurge: (boardId: string) => void;
  onClose: () => void;
}

export function TrashModal({ boards, cardsByBoard, onRestore, onPurge, onClose }: Props) {
  const sorted = [...boards].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  return (
    <Modal onClose={onClose} className="trash-modal">
      <div className="modal-head">
        <h3>🗑 Corbeille</h3>
        <button className="icon-btn" onClick={onClose} title="Fermer (Échap)">
          ✕
        </button>
      </div>
      <p className="muted">
        Les tableaux restent ici {TRASH_DAYS} jours, avec toutes leurs cartes, puis sont supprimés définitivement.
      </p>
      {sorted.length === 0 ? (
        <p className="muted trash-empty">La corbeille est vide.</p>
      ) : (
        <ul className="trash-list">
          {sorted.map((board) => {
            const n = cardsByBoard[board.id]?.length ?? 0;
            const cards = `${n} carte${n > 1 ? "s" : ""}`;
            return (
              <li key={board.id}>
                <div className="trash-info">
                  <div className="trash-name">{board.name}</div>
                  <div className="muted">
                    {cards} · mis à la corbeille le {formatDateTime(board.archivedAt!)} · supprimé le{" "}
                    {purgeDate(board).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                  </div>
                </div>
                <button className="btn-ghost small" onClick={() => onRestore(board)}>
                  ↩ Restaurer
                </button>
                <DangerButton className="small" onConfirm={() => onPurge(board.id)} confirmLabel={`Supprimer ${cards} ?`}>
                  Supprimer définitivement
                </DangerButton>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
