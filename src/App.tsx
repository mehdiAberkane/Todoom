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
import { localGet, localSet, toISODate } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { BoardView } from "./components/BoardView";
import { Setup } from "./components/Setup";
import { SettingsPage } from "./components/SettingsPage";
import { defaultTemplate } from "./lib/templates";
import { useAppearance } from "./lib/theme";
import { veilOf } from "./lib/appearance";
import { MetricsPage } from "./components/MetricsPage";
import { CalendarPage } from "./components/CalendarPage";
import { UndoToast } from "./components/UndoToast";
import { dailySnapshot } from "./lib/snapshotter";
import { DEFAULT_KEEP } from "./lib/snapshots";
import { agenda, dueCards } from "./lib/calendar";
import { pendingRepeats, successorOf } from "./lib/recurring";
import { dueForArchive } from "./lib/autoArchive";
import { mergedHistory } from "./lib/activity";
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
  const { data, status, error, host, actions, unsaved, unsavedIds, failures, nextRetry, retryNow, pending, slow, lastAction, reload } = useTodoom(backend, notifyChanges);
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
  // The page shown in place of a board, if any; the metrics page carries its scope ("all" or a board id).
  const [page, setPage] = useState<null | "settings" | "myWork" | "calendar" | { metrics: string }>(null);
  const showSettings = page === "settings";
  const showMyWork = page === "myWork";
  const showCalendar = page === "calendar";
  const metrics = page && typeof page === "object" ? page.metrics : null;
  const openMetrics = (scope: string) => setPage({ metrics: scope });
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
  // Columns with a delay archive the cards that stayed in them that long; see autoArchive.ts.
  // Checked on every read of the folder, and every hour for an app left open.
  const [hourTick, setHourTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setHourTick((n) => n + 1), 3_600_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (incomplete) return;
    actions.untracked(() => {
      for (const board of activeBoards)
        for (const card of dueForArchive(board, data.cards[board.id] ?? [], (id) => mergedHistory(data.history[id]))) actions.archiveCard(card);
    });
  }, [activeBoards, data.cards, data.history, incomplete, actions, hourTick]);
  // Today's snapshot of the data folder, once the folder is read in full; checked again every hour.
  const snapshotKeep = data.settings.snapshotKeep;
  useEffect(() => {
    if (incomplete || error) return;
    dailySnapshot(snapshotKeep ?? DEFAULT_KEEP).catch((e) => console.warn("snapshot", e));
  }, [incomplete, error, hourTick, snapshotKeep]);
  // A routine finished (in a « done » column) brings its next card; see recurring.ts.
  useEffect(() => {
    if (incomplete) return;
    const today = toISODate(new Date());
    for (const { card, board } of pendingRepeats(activeBoards, data.cards)) {
      const column = board.columns[0];
      if (!column) continue;
      const cards = data.cards[board.id] ?? [];
      const last = cards.filter((c) => c.columnId === column.id && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1);
      const next = successorOf(card, board, today, last + 1);
      // Another computer may have made it already: then only the repetition is moved.
      actions.untracked(() => {
        if (!cards.some((c) => c.id === next.id)) actions.saveCard(next);
        actions.saveCard({ ...card, repeat: null });
      });
    }
  }, [activeBoards, data.cards, incomplete, actions]);
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
        actions.untracked(() => actions.saveBoard({ ...b, key }));
      }
      actions.untracked(() => {
        for (const { card, number } of numbering(data.cards[b.id] ?? [])) actions.saveCard({ ...card, number });
      });
    }
  }, [data.boards, data.cards, incomplete, actions]);

  const openBoard = (id: string) => {
    setBoardId(id);
    setPage(null);
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
    ...(board && !page
      ? [{ id: "new", label: t("palette.newCard"), hint: "N", run: () => window.dispatchEvent(new Event("todoom:new-card")) }]
      : []),
    { id: "search", label: t("palette.searchAll"), hint: "Ctrl + Maj + F", run: () => setShowSearch(true) },
    { id: "mywork", label: t("palette.myWork"), run: () => setPage("myWork") },
    { id: "calendar", label: t("palette.calendar"), run: () => setPage("calendar") },
    { id: "metrics", label: t("palette.metrics"), run: () => openMetrics(board && !page ? board.id : "all") },
    ...activeBoards.map((b) => ({ id: `board:${b.id}`, label: t("palette.goTo", { name: b.name }), hint: b.key, run: () => openBoard(b.id) })),
    { id: "settings", label: t("palette.settings"), run: () => setPage("settings") },
    { id: "help", label: t("palette.help"), hint: "?", run: () => setShowHelp(true) },
  ];

  const myWorkCount = useMemo(
    () => myWork(activeBoards, data.cards, myWorkColumns(data.settings)).reduce((n, g) => n + g.columns.reduce((m, c) => m + c.cards.length, 0), 0),
    [activeBoards, data.cards, data.settings],
  );

  // Late or due today, every board: shown next to the calendar link.
  const urgentCount = useMemo(() => {
    const now = agenda(dueCards(activeBoards, data.cards), toISODate(new Date()));
    return now.overdue.length + now.today.length;
  }, [activeBoards, data.cards]);

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
        currentId={page ? undefined : board?.id}
        counts={counts}
        onSelect={openBoard}
        onCreate={(name, template) => openBoard(actions.createBoard(name, data.boards, template).id)}
        defaultTemplate={defaultTemplate(data.settings.boardTemplate, activeBoards)}
        settingsOpen={showSettings}
        onOpenSettings={() => setPage("settings")}
        myWorkOpen={showMyWork}
        metricsOpen={!!metrics}
        calendarOpen={showCalendar}
        calendarCount={urgentCount}
        onOpenCalendar={() => setPage("calendar")}
        onOpenMetrics={() => openMetrics("all")}
        myWorkCount={myWorkCount}
        onOpenMyWork={() => setPage("myWork")}
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
        {showCalendar ? (
          <CalendarPage
            boards={activeBoards}
            cards={data.cards}
            onOpenCard={openElsewhere}
            onReschedule={(card, due) => actions.saveCard({ ...card, due })}
          />
        ) : metrics ? (
          <MetricsPage
            boards={activeBoards}
            cards={data.cards}
            history={data.history}
            scope={metrics}
            onScope={openMetrics}
            onOpenCard={openElsewhere}
          />
        ) : showMyWork ? (
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
            onRestored={reload}
            dataDir={dataDir}
            onChangeDataDir={onSettings}
            version={updater.version}
            update={updater.state}
            checkState={updater.checkState}
            onCheckUpdate={updater.checkNow}
            onInstallUpdate={updater.install}
            onBack={() => setPage(null)}
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
      <UndoToast lastAction={lastAction} onUndo={actions.undo} />
      {showSearch && (
        <GlobalSearch boards={data.boards} cards={data.cards} comments={data.comments} onOpen={openElsewhere} onClose={() => setShowSearch(false)} />
      )}
    </div>
  );
}
