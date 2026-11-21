import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { backend } from "./lib/backend";
import { expiredBoards, useTodoom } from "./lib/store";
import { indexCards } from "./lib/links";
import { deriveKey, numbering } from "./lib/shortid";
import { useUpdater } from "./lib/updater";
import { notifyChanges } from "./lib/notifier";
import { useCloseGuard } from "./lib/closeGuard";
import { getLang, setLang, systemLang, t } from "./lib/i18n";
import { localGet, localSet } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { BoardView } from "./components/BoardView";
import { Setup } from "./components/Setup";
import { SettingsPage } from "./components/SettingsPage";
import { defaultTemplate } from "./lib/templates";
import { useAppearance } from "./lib/theme";
import { veilOf } from "./lib/appearance";
import { MetricsPage } from "./components/MetricsPage";
import { MyWork, myWork, myWorkColumns } from "./components/MyWork";
import { GlobalSearch } from "./components/GlobalSearch";
import { CommandPalette, ShortcutsHelp, type Command } from "./components/CommandPalette";
import { isTyping, modalOpen } from "./lib/keys";

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
  const { data, status, error, host, actions, unsaved, unsavedIds, failures, nextRetry, retryNow, pending, slow } = useTodoom(backend, notifyChanges);
  // Automatic upkeep (numbers, keys, trash) waits for complete data: a card not downloaded yet
  // could take a number already used, a board not read yet could lose its key.
  const incomplete = status === "loading" || pending.length > 0;
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
  const [showMyWork, setShowMyWork] = useState(false);
  // The metrics page: "all", or the id of the board it shows; null when closed.
  const [metrics, setMetrics] = useState<string | null>(null);
  const openMetrics = (scope: string) => (setMetrics(scope), setShowSettings(false), setShowMyWork(false));
  const [showSearch, setShowSearch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // App-wide keys: Ctrl + Shift + F searches every board, Ctrl + K opens the palette
  // (Cmd on a Mac); ? shows the shortcuts and / searches, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((open) => !open);
      } else if (!mod && !e.altKey && !isTyping(e.target) && !modalOpen()) {
        if (e.key === "?") {
          e.preventDefault();
          setShowHelp(true);
        } else if (e.key === "/") {
          e.preventDefault();
          const field = document.querySelector<HTMLInputElement>(".board-tools .search");
          if (field) field.focus();
          else setShowSearch(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // A card to open once its board shows, after following a link from another board.
  const [linkedCard, setLinkedCard] = useState<string | null>(null);
  const activeBoards = useMemo(() => data.boards.filter((b) => !b.archivedAt), [data.boards]);
  const trashedBoards = useMemo(() => data.boards.filter((b) => b.archivedAt), [data.boards]);
  const board = activeBoards.find((b) => b.id === boardId) ?? activeBoards[0];

  // Boards left in the trash longer than TRASH_DAYS are deleted for good, once.
  const purged = useRef(new Set<string>());
  useEffect(() => {
    if (incomplete) return;
    for (const b of expiredBoards(data.boards)) {
      if (purged.current.has(b.id)) continue;
      purged.current.add(b.id);
      actions.purgeBoard(b.id);
    }
  }, [data.boards, incomplete, actions]);
  // Every board gets a key and every card a number (SOL-42). Same rules on every
  // computer, so two of them doing it at once write the same thing.
  useEffect(() => {
    if (incomplete) return;
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
  }, [data.boards, data.cards, incomplete, actions]);

  const openBoard = (id: string) => {
    setBoardId(id);
    setShowSettings(false);
    setShowMyWork(false);
    setMetrics(null);
  };
  const { background, backgroundDim } = data.settings;
  const theme = useAppearance(data.settings);
  const backgroundStyle = background ? { backgroundImage: `${veilOf(theme, backgroundDim)}, url("${background}")` } : undefined;

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

  const commands: Command[] = [
    ...(board && !showSettings && !showMyWork && !metrics
      ? [{ id: "new", label: t("palette.newCard"), hint: "N", run: () => window.dispatchEvent(new Event("todoom:new-card")) }]
      : []),
    { id: "search", label: t("palette.searchAll"), hint: "Ctrl + Maj + F", run: () => setShowSearch(true) },
    { id: "mywork", label: t("palette.myWork"), run: () => (setShowMyWork(true), setShowSettings(false), setMetrics(null)) },
    { id: "metrics", label: t("palette.metrics"), run: () => openMetrics(board && !showSettings && !showMyWork && !metrics ? board.id : "all") },
    ...activeBoards.map((b) => ({ id: `board:${b.id}`, label: t("palette.goTo", { name: b.name }), hint: b.key, run: () => openBoard(b.id) })),
    { id: "settings", label: t("palette.settings"), run: () => (setShowSettings(true), setShowMyWork(false), setMetrics(null)) },
    { id: "help", label: t("palette.help"), hint: "?", run: () => setShowHelp(true) },
  ];

  const myWorkCount = useMemo(
    () => myWork(activeBoards, data.cards, myWorkColumns(data.settings)).reduce((n, g) => n + g.columns.reduce((m, c) => m + c.cards.length, 0), 0),
    [activeBoards, data.cards, data.settings],
  );

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
        currentId={showSettings || showMyWork || metrics ? undefined : board?.id}
        counts={counts}
        onSelect={openBoard}
        onCreate={(name, template) => openBoard(actions.createBoard(name, data.boards, template).id)}
        defaultTemplate={defaultTemplate(data.settings.boardTemplate, activeBoards)}
        settingsOpen={showSettings}
        onOpenSettings={() => (setShowSettings(true), setShowMyWork(false), setMetrics(null))}
        myWorkOpen={showMyWork && !showSettings}
        metricsOpen={!!metrics && !showSettings && !showMyWork}
        onOpenMetrics={() => openMetrics("all")}
        myWorkCount={myWorkCount}
        onOpenMyWork={() => (setShowMyWork(true), setShowSettings(false), setMetrics(null))}
        onOpenSearch={() => setShowSearch(true)}
        onShowKeys={() => setShowHelp(true)}
        onMove={(movedId, ids) => actions.moveBoard(activeBoards, movedId, ids)}
        onSettings={onSettings}
        status={status}
        error={error}
        unsavedCount={unsaved.length}
        failures={failures}
        nextRetry={nextRetry}
        onRetry={retryNow}
        pendingCount={pending.length}
        slow={slow}
        dataDir={dataDir}
        others={others}
        issues={data.issues}
        version={updater.version}
        update={updater.state}
        onInstallUpdate={updater.install}
      />
      <main className="main">
        {metrics && !showSettings && !showMyWork ? (
          <MetricsPage
            boards={activeBoards}
            cards={data.cards}
            history={data.history}
            scope={metrics}
            onScope={setMetrics}
            onOpenCard={openElsewhere}
          />
        ) : showMyWork && !showSettings ? (
          <MyWork
            boards={activeBoards}
            cards={data.cards}
            settings={data.settings}
            onSaveSettings={actions.saveSettings}
            index={cardIndex}
            comments={data.comments}
            onOpen={openElsewhere}
          />
        ) : showSettings ? (
          <SettingsPage
            settings={data.settings}
            onSave={actions.saveSettings}
            boards={activeBoards}
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
            onOpenMetrics={() => openMetrics(board.id)}
            initialOpenCardId={linkedCard}
            comments={data.comments}
            agents={data.agents[board.id]}
            attachments={data.attachments}
            allBoards={activeBoards}
            history={data.history}
          />
        ) : status === "loading" || pending.length > 0 ? (
          <div className="empty-state">
            {t("common.loading")}
            {(slow || pending.length > 0) && <p className="muted load-hint">{t("load.slowHint")}</p>}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-skull">💀</div>
            <h2>{t("empty.title")}</h2>
            <p>{t("empty.tagline")}</p>
            <button className="btn-primary big" onClick={() => setBoardId(actions.createBoard(t("empty.firstBoard"), data.boards, defaultTemplate(data.settings.boardTemplate, activeBoards)).id)}>
              {t("empty.create")}
            </button>
          </div>
        )}
      </main>
      {showPalette && (
        <CommandPalette
          commands={commands}
          boards={data.boards}
          cards={data.cards}
          comments={data.comments}
          onOpenCard={openElsewhere}
          onClose={() => setShowPalette(false)}
        />
      )}
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      {showSearch && (
        <GlobalSearch boards={data.boards} cards={data.cards} comments={data.comments} onOpen={openElsewhere} onClose={() => setShowSearch(false)} />
      )}
    </div>
  );
}
