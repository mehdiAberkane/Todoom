import type { Board, Card } from "../types";
import { purgeDate, TRASH_DAYS } from "../lib/store";
import { formatDateTime } from "../lib/utils";
import { locale, t, tn } from "../lib/i18n";
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
        <h3>{t("trash.title")}</h3>
        <button className="icon-btn" onClick={onClose} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>
      <p className="muted">
        {t("trash.intro", { days: TRASH_DAYS })}
      </p>
      {sorted.length === 0 ? (
        <p className="muted trash-empty">{t("trash.empty")}</p>
      ) : (
        <ul className="trash-list">
          {sorted.map((board) => {
            const n = cardsByBoard[board.id]?.length ?? 0;
            const cards = tn("board.cards", n);
            return (
              <li key={board.id}>
                <div className="trash-info">
                  <div className="trash-name">{board.name}</div>
                  <div className="muted">
                    {t("trash.meta", {
                      cards,
                      trashed: formatDateTime(board.archivedAt!),
                      purge: purgeDate(board).toLocaleDateString(locale(), { day: "numeric", month: "long" }),
                    })}
                  </div>
                </div>
                <button className="btn-ghost small" onClick={() => onRestore(board)}>
                  {t("common.restore")}
                </button>
                <DangerButton className="small" onConfirm={() => onPurge(board.id)} confirmLabel={t("trash.purgeQ", { cards })}>
                  {t("trash.purge")}
                </DangerButton>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
