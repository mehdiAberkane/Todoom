import { useEffect, useState } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { useDragSensors } from "../lib/dnd";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, Card, Presence } from "../types";
import type { FileIssue, SyncStatus, WriteFailure } from "../lib/store";
import { Modal } from "./ui";
import { TrashModal } from "./TrashModal";
import type { UpdateState } from "../lib/updater";
import { t, tn } from "../lib/i18n";
import type { IssueReason } from "../lib/validate";

/** A loading problem, in the current language. */
export const issueText = (reason: IssueReason) => t(`issue.${reason.code}`, { field: reason.field ?? "" });

interface Props {
  boards: Board[];
  trashed: Board[];
  cardsByBoard: Record<string, Card[]>;
  onRestore: (board: Board) => void;
  onPurge: (boardId: string) => void;
  currentId?: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onMove: (movedId: string, ids: string[]) => void;
  settingsOpen: boolean;
  myWorkOpen: boolean;
  onOpenSearch: () => void;
  myWorkCount: number;
  onOpenMyWork: () => void;
  onOpenSettings: () => void;
  onSettings: () => void;
  status: SyncStatus;
  /** Reading the data folder failed. */
  error: string | null;
  unsavedCount: number;
  /** Files Google Drive hasn't downloaded yet. */
  pendingCount: number;
  /** The data folder is slow to answer. */
  slow: boolean;
  failures: WriteFailure[];
  nextRetry: number | null;
  onRetry: () => void;
  dataDir: string;
  others: Presence[];
  issues: FileIssue[];
  version: string | null;
  update: UpdateState;
  onInstallUpdate: () => void;
}

export function Sidebar(props: Props) {
  const { boards, currentId, counts, onSelect, onCreate, onMove, onSettings, status, error, dataDir, others } = props;
  const [showTrash, setShowTrash] = useState(false);
  const [name, setName] = useState("");
  // The distance threshold keeps a plain click selecting the board.
  const sensors = useDragSensors();

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = boards.map((b) => b.id);
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    onMove(String(active.id), moved);
  };

  const create = () => {
    const n = name.trim();
    if (!n) return;
    onCreate(n);
    setName("");
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-skull">💀</span>
        <span className="brand-name">TODOOM</span>
      </div>

      <button className="global-search-btn" onClick={props.onOpenSearch} title={t("search.openTitle")}>
        {t("search.open")}
      </button>
      <nav className="board-list">
        <button className={`board-link my-work-link ${props.myWorkOpen ? "active" : ""}`} onClick={props.onOpenMyWork} title={t("myWork.linkTitle")}>
          <span className="board-name">{t("myWork.link")}</span>
          {props.myWorkCount > 0 && <span className="count">{props.myWorkCount}</span>}
        </button>
        <div className="section-title">{t("sidebar.boards")}</div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={boards.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {boards.map((b) => (
              <BoardLink
                key={b.id}
                board={b}
                active={b.id === currentId}
                count={counts[b.id] ?? 0}
                onSelect={() => onSelect(b.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <input
          className="new-board"
          placeholder={t("sidebar.newBoard")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </nav>

      <footer className="sidebar-foot">
        <UpdateBanner state={props.update} onInstall={props.onInstallUpdate} />
        <FileIssues issues={props.issues} dataDir={dataDir} />
        {others.length > 0 && (
          <div className="presence" title={t("sidebar.presenceTitle")}>
            {t("sidebar.alsoOpenOn", { hosts: others.map((o) => o.host).join(", ") })}
          </div>
        )}
        {(props.pendingCount > 0 || props.slow) && (
          <div className="load-pending" title={t("load.pendingTitle")}>
            ⏳ {props.pendingCount > 0 ? tn("load.pending", props.pendingCount) : t("load.slow")}
          </div>
        )}
        {props.failures.length > 0 ? (
          <WriteFailures failures={props.failures} unsavedCount={props.unsavedCount} nextRetry={props.nextRetry} onRetry={props.onRetry} />
        ) : (
          <div className={`sync sync-${error ? "error" : status}`} title={error ?? undefined}>
            <span className="dot" /> {error ? t("status.readError") : t(`status.${status}`)}
          </div>
        )}
        <button className="data-dir" onClick={onSettings} title={t("sidebar.changeDataDir")}>
          📁 <span>{dataDir}</span>
        </button>
        {props.trashed.length > 0 && (
          <button className="settings-link" onClick={() => setShowTrash(true)}>
            {t("sidebar.trash", { n: props.trashed.length })}
          </button>
        )}
        {showTrash && (
          <TrashModal
            boards={props.trashed}
            cardsByBoard={props.cardsByBoard}
            onRestore={props.onRestore}
            onPurge={props.onPurge}
            onClose={() => setShowTrash(false)}
          />
        )}
        <button className={`settings-link ${props.settingsOpen ? "active" : ""}`} onClick={props.onOpenSettings}>
          {t("sidebar.settings")}
        </button>
        {props.version && <div className="app-version">Todoom v{props.version}</div>}
      </footer>
    </aside>
  );
}

/** Changes the disk refused: which file, which error, when the next attempt is. */
function WriteFailures({
  failures,
  unsavedCount,
  nextRetry,
  onRetry,
}: {
  failures: WriteFailure[];
  unsavedCount: number;
  nextRetry: number | null;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = nextRetry ? Math.max(0, Math.ceil((nextRetry - now) / 1000)) : null;
  const n = unsavedCount;
  return (
    <div className="write-failures">
      <div className="write-failures-title">
        {tn("failures.unsaved", n)}
      </div>
      <ul>
        {failures.slice(0, 3).map((f) => (
          <li key={f.path} title={`${f.path}\n${f.error}`}>
            <code>{f.path}</code>
            <span>{f.error}</span>
          </li>
        ))}
        {failures.length > 3 && <li className="muted">{t("failures.more", { n: failures.length - 3 })}</li>}
      </ul>
      <div className="write-failures-actions">
        <span className="muted">{seconds !== null && t("failures.retryIn", { s: seconds })}</span>
        <button className="btn-ghost small" onClick={onRetry}>
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}

function FileIssues({ issues, dataDir }: { issues: FileIssue[]; dataDir: string }) {
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  const n = issues.length;
  return (
    <>
      <button className="issues-btn" onClick={() => setOpen(true)} title={t("issues.buttonTitle")}>
        {tn("issues.count", n)}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} className="issues-modal">
          <div className="modal-head">
            <h3>{t("issues.title")}</h3>
            <button className="icon-btn" onClick={() => setOpen(false)} title={t("common.closeEsc")}>
              ✕
            </button>
          </div>
          <p className="muted">
            {t("issues.introBefore")} <code>{dataDir}</code> {t("issues.introAfter")}
          </p>
          <ul className="issues-list">
            {issues.map((i) => (
              <li key={i.path + i.reason.code}>
                <code>{i.path}</code>
                <span>{issueText(i.reason)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function UpdateBanner({ state, onInstall }: { state: UpdateState; onInstall: () => void }) {
  switch (state.kind) {
    case "available":
      return (
        <button className="update-btn" onClick={onInstall}>
          {t("update.available", { version: state.version })}
        </button>
      );
    case "installing":
      return (
        <div className="update-progress">
          {t("update.installing")}{state.progress !== null && ` ${Math.round(state.progress * 100)} %`}
        </div>
      );
    case "error":
      return (
        <button className="update-error" onClick={onInstall} title={state.message}>
          {t("update.failed")}
        </button>
      );
    default:
      return null;
  }
}

function BoardLink({ board, active, count, onSelect }: { board: Board; active: boolean; count: number; onSelect: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: board.id });

  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`board-link ${active ? "active" : ""} ${isDragging ? "dragging" : ""}`}
      {...attributes}
      {...listeners}
      onClick={onSelect}
    >
      <span className="board-link-name">{board.name}</span>
      <span className="count">{count}</span>
    </button>
  );
}
