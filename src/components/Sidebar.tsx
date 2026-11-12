import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, Presence } from "../types";
import type { SyncStatus } from "../lib/store";

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
  onSettings: () => void;
  status: SyncStatus;
  error: string | null;
  dataDir: string;
  others: Presence[];
}

export function Sidebar({ boards, currentId, counts, onSelect, onCreate, onMove, onSettings, status, error, dataDir, others }: Props) {
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
      </footer>
    </aside>
  );
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
