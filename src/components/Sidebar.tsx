import { useState } from "react";
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
  onSettings: () => void;
  status: SyncStatus;
  error: string | null;
  dataDir: string;
  others: Presence[];
}

export function Sidebar({ boards, currentId, counts, onSelect, onCreate, onSettings, status, error, dataDir, others }: Props) {
  const [name, setName] = useState("");

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
        {boards.map((b) => (
          <button key={b.id} className={`board-link ${b.id === currentId ? "active" : ""}`} onClick={() => onSelect(b.id)}>
            <span className="board-link-name">{b.name}</span>
            <span className="count">{counts[b.id] ?? 0}</span>
          </button>
        ))}
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
