import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, Presence } from "../types";
import type { FileIssue, SyncStatus } from "../lib/store";
import { Modal } from "./ui";
import type { UpdateState } from "../lib/updater";

const STATUS_TEXT: Record<SyncStatus, string> = {
  loading: "Chargement…",
  synced: "Synchronisé",
  saving: "Enregistrement…",
  error: "Erreur",
};

interface Props {
  boards: Board[];
  currentId?: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onMove: (movedId: string, ids: string[]) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onSettings: () => void;
  status: SyncStatus;
  error: string | null;
  dataDir: string;
  others: Presence[];
  issues: FileIssue[];
  version: string | null;
  update: UpdateState;
  onInstallUpdate: () => void;
}

export function Sidebar(props: Props) {
  const { boards, currentId, counts, onSelect, onCreate, onMove, onSettings, status, error, dataDir, others } = props;
  const [name, setName] = useState("");
  // The distance threshold keeps a plain click selecting the board.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

      <nav className="board-list">
        <div className="section-title">Tableaux</div>
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
          placeholder="+ Nouveau tableau"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </nav>

      <footer className="sidebar-foot">
        <UpdateBanner state={props.update} onInstall={props.onInstallUpdate} />
        <FileIssues issues={props.issues} dataDir={dataDir} />
        {others.length > 0 && (
          <div className="presence" title="Ces machines ont Todoom ouvert en ce moment">
            👀 Aussi ouvert sur {others.map((o) => o.host).join(", ")}
          </div>
        )}
        <div className={`sync sync-${error ? "error" : status}`} title={error ?? undefined}>
          <span className="dot" /> {error ? "Erreur d'écriture" : STATUS_TEXT[status]}
        </div>
        <button className="data-dir" onClick={onSettings} title="Changer de dossier de données">
          📁 <span>{dataDir}</span>
        </button>
        <button className={`settings-link ${props.settingsOpen ? "active" : ""}`} onClick={props.onOpenSettings}>
          ⚙ Paramètres
        </button>
        {props.version && <div className="app-version">Todoom v{props.version}</div>}
      </footer>
    </aside>
  );
}

function FileIssues({ issues, dataDir }: { issues: FileIssue[]; dataDir: string }) {
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  const n = issues.length;
  return (
    <>
      <button className="issues-btn" onClick={() => setOpen(true)} title="Fichiers de données que Todoom n'a pas pu charger">
        ⚠ {n} fichier{n > 1 ? "s" : ""} ignoré{n > 1 ? "s" : ""}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} className="issues-modal">
          <div className="modal-head">
            <h3>⚠ Fichiers non chargés</h3>
            <button className="icon-btn" onClick={() => setOpen(false)} title="Fermer (Échap)">
              ✕
            </button>
          </div>
          <p className="muted">
            Ces fichiers de <code>{dataDir}</code> n'ont pas pu être chargés. Todoom ne les écrase jamais : répare-les ou
            supprime-les à la main. Un fichier en cours de synchronisation par Drive peut apparaître ici un instant.
          </p>
          <ul className="issues-list">
            {issues.map((i) => (
              <li key={i.path + i.reason}>
                <code>{i.path}</code>
                <span>{i.reason}</span>
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
          ⬆ Mettre à jour vers {state.version}
        </button>
      );
    case "installing":
      return (
        <div className="update-progress">
          Installation…{state.progress !== null && ` ${Math.round(state.progress * 100)} %`}
        </div>
      );
    case "error":
      return (
        <button className="update-error" onClick={onInstall} title={state.message}>
          Échec de la mise à jour, réessayer
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
