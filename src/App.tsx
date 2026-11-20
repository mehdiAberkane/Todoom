import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { backend } from "./lib/backend";
import { expiredBoards, useTodoom } from "./lib/store";
import { indexCards } from "./lib/links";
import { deriveKey, numbering } from "./lib/shortid";
import { useUpdater } from "./lib/updater";
import { useCloseGuard } from "./lib/closeGuard";
import { getLang, setLang, systemLang, t } from "./lib/i18n";
import { localGet, localSet } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { BoardView } from "./components/BoardView";
import { Setup } from "./components/Setup";
import { SettingsPage } from "./components/SettingsPage";

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
  const { data, status, error, host, actions, unsaved, unsavedIds, failures, nextRetry, retryNow } = useTodoom(backend);
  // Before the settings are read, keep the language last used here rather than flicker.
  const language = status === "loading" ? getLang() : (data.settings.language ?? systemLang());
  setLang(language);
  useEffect(() => {
    backend.setLanguage(language).catch(() => {});
  }, [language]);
  const updater = useUpdater();
  useCloseGuard(unsaved.length, retryNow);
  const [boardId, setBoardId] = useState(() => localGet("todoom-board"));
  const [showSettings, setShowSettings] = useState(false);
  // A card to open once its board shows, after following a link from another board.
  const [linkedCard, setLinkedCard] = useState<string | null>(null);
  const activeBoards = useMemo(() => data.boards.filter((b) => !b.archivedAt), [data.boards]);
  const trashedBoards = useMemo(() => data.boards.filter((b) => b.archivedAt), [data.boards]);
  const board = activeBoards.find((b) => b.id === boardId) ?? activeBoards[0];

  // Boards left in the trash longer than TRASH_DAYS are deleted for good, once.
  const purged = useRef(new Set<string>());
  useEffect(() => {
    if (status === "loading") return;
    for (const b of expiredBoards(data.boards)) {
      if (purged.current.has(b.id)) continue;
      purged.current.add(b.id);
      actions.purgeBoard(b.id);
    }
  }, [data.boards, status, actions]);
  // Every board gets a key and every card a number (SOL-42). Same rules on every
  // computer, so two of them doing it at once write the same thing.
  useEffect(() => {
    if (status === "loading") return;
    const taken = new Set(data.boards.map((b) => b.key).filter((k): k is string => !!k));
    for (const b of data.boards) {
      if (b.archivedAt) continue;
      if (!b.key) {
        const key = deriveKey(b.name, taken);
        taken.add(key);
        actions.saveBoard({ ...b, key });
      }
      for (const { card, number } of numbering(data.cards[b.id] ?? [])) actions.saveCard({ ...card, number });
    }
  }, [data.boards, data.cards, status, actions]);

  const openBoard = (id: string) => {
    setBoardId(id);
    setShowSettings(false);
  };
  const { background, backgroundDim } = data.settings;
  const backgroundStyle = background
    ? { backgroundImage: `linear-gradient(rgba(0,0,0,${backgroundDim}), rgba(0,0,0,${backgroundDim})), url("${background}")` }
    : undefined;

  useEffect(() => {
    if (board) localSet("todoom-board", board.id);
  }, [board?.id]);

  const cardIndex = useMemo(() => indexCards(data.boards, data.cards), [data.boards, data.cards]);
  const openElsewhere = (id: string, cardId: string) => {
    openBoard(id);
    setLinkedCard(cardId);
  };
  // The board read it when it mounted; don't open it again on a later visit.
  useEffect(() => {
    if (linkedCard) setLinkedCard(null);
  }, [linkedCard]);

  const counts = useMemo(
    () => Object.fromEntries(Object.entries(data.cards).map(([id, cards]) => [id, cards.filter((c) => !c.archivedAt).length])),
    [data.cards],
  );
  const others = data.presence.filter((p) => p.host !== host && Date.now() - Date.parse(p.at) < PRESENCE_WINDOW_MS);

  return (
    <div className={`app ${background ? "has-bg" : ""}`} style={backgroundStyle}>
      <Sidebar
        boards={activeBoards}
        trashed={trashedBoards}
        cardsByBoard={data.cards}
        onRestore={actions.restoreBoard}
        onPurge={actions.purgeBoard}
        currentId={showSettings ? undefined : board?.id}
        counts={counts}
        onSelect={openBoard}
        onCreate={(name) => openBoard(actions.createBoard(name, data.boards).id)}
        settingsOpen={showSettings}
        onOpenSettings={() => setShowSettings(true)}
        onMove={(movedId, ids) => actions.moveBoard(activeBoards, movedId, ids)}
        onSettings={onSettings}
        status={status}
        error={error}
        unsavedCount={unsaved.length}
        failures={failures}
        nextRetry={nextRetry}
        onRetry={retryNow}
        dataDir={dataDir}
        others={others}
        issues={data.issues}
        version={updater.version}
        update={updater.state}
        onInstallUpdate={updater.install}
      />
      <main className="main">
        {showSettings ? (
          <SettingsPage
            settings={data.settings}
            onSave={actions.saveSettings}
            dataDir={dataDir}
            onChangeDataDir={onSettings}
            version={updater.version}
            update={updater.state}
            checkState={updater.checkState}
            onCheckUpdate={updater.checkNow}
            onInstallUpdate={updater.install}
            onBack={() => setShowSettings(false)}
          />
        ) : board ? (
          <BoardView
            key={board.id}
            board={board}
            cards={data.cards[board.id] ?? []}
            actions={actions}
            unsavedIds={unsavedIds}
            index={cardIndex}
            otherKeys={data.boards.filter((b) => b.id !== board.id && b.key).map((b) => b.key!)}
            onOpenElsewhere={openElsewhere}
            initialOpenCardId={linkedCard}
          />
        ) : status === "loading" ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : (
          <div className="empty-state">
            <div className="empty-skull">💀</div>
            <h2>{t("empty.title")}</h2>
            <p>{t("empty.tagline")}</p>
            <button className="btn-primary big" onClick={() => setBoardId(actions.createBoard(t("empty.firstBoard"), data.boards).id)}>
              {t("empty.create")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
