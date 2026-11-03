import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { backend } from "./lib/backend";
import { useTodoom } from "./lib/store";
import { localGet, localSet } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { BoardView } from "./components/BoardView";
import { Setup } from "./components/Setup";

const PRESENCE_WINDOW_MS = 3 * 60_000;

export default function App() {
  const [dataDir, setDataDir] = useState<string | null | undefined>(undefined);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    backend.getDataDir().then(setDataDir, () => setDataDir(null));
  }, []);

  if (dataDir === undefined) return <div className="splash">💀</div>;
  if (!dataDir || settings) {
    return (
      <Setup
        current={dataDir}
        onDone={(dir) => {
          setDataDir(dir);
          setSettings(false);
        }}
        onCancel={dataDir ? () => setSettings(false) : undefined}
      />
    );
  }
  return <Workspace key={dataDir} dataDir={dataDir} onSettings={() => setSettings(true)} />;
}

function Workspace({ dataDir, onSettings }: { dataDir: string; onSettings: () => void }) {
  const { data, status, error, host, actions } = useTodoom(backend);
  const [boardId, setBoardId] = useState(() => localGet("todoom-board"));
  const board = data.boards.find((b) => b.id === boardId) ?? data.boards[0];

  useEffect(() => {
    if (board) localSet("todoom-board", board.id);
  }, [board?.id]);

  const counts = useMemo(
    () => Object.fromEntries(Object.entries(data.cards).map(([id, cards]) => [id, cards.length])),
    [data.cards],
  );
  const others = data.presence.filter((p) => p.host !== host && Date.now() - Date.parse(p.at) < PRESENCE_WINDOW_MS);

  return (
    <div className="app">
      <Sidebar
        boards={data.boards}
        currentId={board?.id}
        counts={counts}
        onSelect={setBoardId}
        onCreate={(name) => setBoardId(actions.createBoard(name).id)}
        onSettings={onSettings}
        status={status}
        error={error}
        dataDir={dataDir}
        others={others}
      />
      <main className="main">
        {board ? (
          <BoardView key={board.id} board={board} cards={data.cards[board.id] ?? []} actions={actions} />
        ) : status === "loading" ? (
          <div className="empty-state">Chargement…</div>
        ) : (
          <div className="empty-state">
            <div className="empty-skull">💀</div>
            <h2>Aucun tableau.</h2>
            <p>Le doom n'attend que toi.</p>
            <button className="btn-primary big" onClick={() => setBoardId(actions.createBoard("Mon premier tableau").id)}>
              Créer mon premier tableau
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
