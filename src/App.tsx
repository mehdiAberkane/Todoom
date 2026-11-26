import { useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "./types";
import "./App.css";
import { backend, isTauri } from "./lib/backend";
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
import { ActivityPage } from "./components/ActivityPage";
import { RoutineToast, type RoutineNotice } from "./components/RoutineToast";
import { CaptureForm } from "./components/QuickCapture";
import { Modal } from "./components/ui";
import { CAPTURE_BOARDS, CAPTURE_HELLO, CAPTURE_SEND, captureBoard, captureTitle, topOrder, type CaptureTarget } from "./lib/capture";
import { emitTo, listen } from "@tauri-apps/api/event";
import { dailySnapshot } from "./lib/snapshotter";
import { useReadingCopy, useWeeklyCopy } from "./lib/readingWriter";
import { useInbox } from "./lib/inboxWatcher";
import { usePrWatch, type MergeHandlers } from "./lib/prWatcher";
import { mayMoveOnMerge } from "./lib/reviewWatch";
import { DEFAULT_KEEP } from "./lib/snapshots";
import { agenda, dueCards } from "./lib/calendar";
import { isAsleep, nextOfRoutine, pendingRepeats } from "./lib/recurring";
import { dueForArchive } from "./lib/autoArchive";
import { mergedHistory } from "./lib/activity";
import { MyWork, myWork, myWorkColumns } from "./components/MyWork";
import { GlobalSearch } from "./components/GlobalSearch";
import { CommandPalette, ShortcutsHelp, type Command } from "./components/CommandPalette";
import { isTyping, modalOpen } from "./lib/keys";

const PRESENCE_WINDOW_MS = 3 * 60_000;
/** A routine finished less than this long ago gets its « comes back on… » notice here. */
const ROUTINE_NOTICE_MS = 2 * 60_000;
/** Who signs, in a card's history, what Todoom did on its own (a merged PR/MR's card moved). */
const MERGE_AGENT = "Todoom";

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
  const [page, setPage] = useState<null | "settings" | "myWork" | "calendar" | "activity" | { metrics: string }>(null);
  const showSettings = page === "settings";
  const showMyWork = page === "myWork";
  const showCalendar = page === "calendar";
  const showActivity = page === "activity";
  const metrics = page && typeof page === "object" ? page.metrics : null;
  const openMetrics = (scope: string) => setPage({ metrics: scope });
  const [showSearch, setShowSearch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCapture, setShowCapture] = useState(false);

  // App-wide keys: Ctrl + Shift + F searches every board, Ctrl + K opens the palette
  // (Cmd on a Mac); ? shows the shortcuts and / searches, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        // Quick capture, inside the app (outside it, the same keys open the capture window).
        e.preventDefault();
        setShowCapture(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
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
  // Quick capture: an idea becomes a card at the top of the first column of the chosen board.
  const target = captureBoard(activeBoards, data.settings.captureBoard);
  const captureTarget: CaptureTarget = { boards: activeBoards.filter((b) => b.columns.length).map((b) => ({ id: b.id, name: b.name })), boardId: target?.id ?? null };
  const capture = (boardId: string, title: string) => {
    const b = activeBoards.find((x) => x.id === boardId);
    const column = b?.columns[0];
    if (!b || !column) return;
    const orders = (data.cards[b.id] ?? []).filter((c) => c.columnId === column.id && !c.archivedAt).map((c) => c.order);
    actions.newCard(b, column.id, title, topOrder(orders));
  };
  // The capture window asks for the boards, then sends the idea.
  const captureRef = useRef({ target: captureTarget, capture });
  captureRef.current = { target: captureTarget, capture };
  useEffect(() => {
    if (!isTauri || incomplete) return;
    const offs = [
      listen(CAPTURE_HELLO, () => emitTo("capture", CAPTURE_BOARDS, captureRef.current.target).catch(() => {})),
      listen<{ boardId: string; title: string }>(CAPTURE_SEND, (e) => {
        const title = captureTitle(e.payload.title);
        if (title) captureRef.current.capture(e.payload.boardId, title);
      }),
    ];
    return () => offs.forEach((off) => off.then((f) => f()));
  }, [incomplete]);
  // Plain text summaries for the phone, in the « lecture » folder.
  const workColumns = useMemo(() => myWorkColumns(data.settings), [data.settings]);
  useReadingCopy(data.settings.readingCopy !== false, !incomplete && !error, data.boards, data.cards, workColumns, hourTick);
  // Last week in review, once a week, beside them (TOD-71).
  useWeeklyCopy(data.settings.readingCopy !== false && data.settings.weeklySummary !== false, !incomplete && !error, activeBoards, data.cards, data.history, hourTick);
  // Ideas dropped from the phone into the inbox become cards.
  const inboxIssues = useInbox(data.settings.inbox !== false, !incomplete && !error, activeBoards, data.cards, unsavedIds, data.settings, actions);
  // PR/MR of the boards' repositories: what changed goes to the popup.
  // A card's PR/MR merged or closed (TOD-69): its state, and the move its board asks for,
  // written as « Todoom » in its history; a move can be undone (Ctrl + Z).
  const current = (boardId: string, cardId: string) => (data.cards[boardId] ?? []).find((c) => c.id === cardId);
  const mergeHandlers: MergeHandlers = {
    apply: (outcomes) => {
      for (const o of outcomes) {
        // Changed since the look (here or elsewhere): the next look sees it as it is now.
        if (current(o.board.id, o.card.id)?.updatedAt !== o.card.updatedAt) continue;
        if (o.outcome === "moved") actions.saveCard(o.next, MERGE_AGENT);
        else actions.untracked(() => actions.saveCard(o.next, MERGE_AGENT));
      }
    },
    move: (boardId, cardId, columnId) => {
      const board = activeBoards.find((b) => b.id === boardId);
      const card = current(boardId, cardId);
      const column = board?.columns.find((c) => c.id === columnId) ?? null;
      if (!board || !card || !mayMoveOnMerge(card, board, column)) return;
      const order = (data.cards[boardId] ?? []).filter((c) => c.columnId === columnId && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1) + 1;
      actions.saveCard({ ...card, columnId, order });
    },
  };
  const { openReviews, releases } = usePrWatch(!incomplete && !error, activeBoards, data.cards, data.settings, mergeHandlers);
  // Today's snapshot of the data folder, once the folder is read in full; checked again every hour.
  const snapshotKeep = data.settings.snapshotKeep;
  useEffect(() => {
    if (incomplete || error) return;
    dailySnapshot(snapshotKeep ?? DEFAULT_KEEP).catch((e) => console.warn("snapshot", e));
  }, [incomplete, error, hourTick, snapshotKeep]);
  const [routineNotice, setRoutineNotice] = useState<RoutineNotice | null>(null);
  // A routine finished (in a « done » column) brings its next card; see recurring.ts.
  useEffect(() => {
    if (incomplete) return;
    const today = toISODate(new Date());
    for (const { card, board } of pendingRepeats(activeBoards, data.cards)) {
      const column = board.columns[0];
      if (!column) continue;
      const cards = data.cards[board.id] ?? [];
      const last = cards.filter((c) => c.columnId === column.id && !c.archivedAt).reduce((m, c) => Math.max(m, c.order), -1);
      // Another computer may have made it already: then only the repetition is moved.
      const found = nextOfRoutine(card, board, today, last + 1, cards);
      // No valid next card: the finished one keeps its repetition rather than losing the routine (TOD-83).
      if (!found) {
        console.warn("routine : carte suivante impossible", card.id);
        continue;
      }
      const { next, made } = found;
      actions.untracked(() => {
        if (made) actions.saveCard(next);
        actions.saveCard({ ...card, repeat: null });
      });
      // Finished just now (not long ago, on another computer): say when it comes back.
      if (made && Date.now() - Date.parse(card.updatedAt) < ROUTINE_NOTICE_MS) setRoutineNotice({ next, column: column.name });
    }
  }, [activeBoards, data.cards, incomplete, actions]);
  // « Stop the routine »: its next card goes to the archive, as it is now.
  const stopRoutine = (next: Card) => {
    const latest = (data.cards[next.boardId] ?? []).find((c) => c.id === next.id) ?? next;
    if (!latest.archivedAt) actions.archiveCard(latest);
  };
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
    // Only when the board changes, not on each edit of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    { id: "capture", label: t("palette.capture"), hint: "Ctrl + Alt + N", run: () => setShowCapture(true) },
    { id: "mywork", label: t("palette.myWork"), run: () => setPage("myWork") },
    { id: "calendar", label: t("palette.calendar"), run: () => setPage("calendar") },
    { id: "activity", label: t("palette.activity"), run: () => setPage("activity") },
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
    // The cards on each board: not archived, not a routine's next card still waiting.
    () => Object.fromEntries(Object.entries(data.cards).map(([id, cards]) => [id, cards.filter((c) => !c.archivedAt && !isAsleep(c, toISODate(new Date()))).length])),
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
        onImport={(imported) => openBoard(actions.importBoard(imported, data.boards).id)}
        settingsOpen={showSettings}
        onOpenSettings={() => setPage("settings")}
        myWorkOpen={showMyWork}
        metricsOpen={!!metrics}
        calendarOpen={showCalendar}
        calendarCount={urgentCount}
        onOpenCalendar={() => setPage("calendar")}
        activityOpen={showActivity}
        onOpenActivity={() => setPage("activity")}
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
        {showActivity ? (
          <ActivityPage boards={activeBoards} cards={data.cards} history={data.history} comments={data.comments} onOpenCard={openElsewhere} />
        ) : showCalendar ? (
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
            reviews={openReviews}
            releases={releases}
            onOpen={openElsewhere}
          />
        ) : showSettings ? (
          <SettingsPage
            settings={data.settings}
            onSave={actions.saveSettings}
            boards={activeBoards}
            onRestored={reload}
            captureBoardId={target?.id ?? null}
            inboxIssues={inboxIssues}
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
      <RoutineToast notice={routineNotice} onStop={stopRoutine} />
      {showCapture && (
        <Modal onClose={() => setShowCapture(false)} className="capture-modal">
          <h3>{t("capture.title")}</h3>
          <CaptureForm
            target={captureTarget}
            onCancel={() => setShowCapture(false)}
            onSubmit={(boardId, title) => {
              capture(boardId, title);
              setShowCapture(false);
            }}
          />
        </Modal>
      )}
      {showSearch && (
        <GlobalSearch boards={data.boards} cards={data.cards} comments={data.comments} onOpen={openElsewhere} onClose={() => setShowSearch(false)} />
      )}
    </div>
  );
}
