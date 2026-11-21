import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { Board, Card } from "../types";
import type { Actions } from "../lib/store";
import { dueStatus, reorder, uid } from "../lib/utils";
import { prioritiesOf } from "../lib/priority";
import { openBlockers, type Located } from "../lib/links";
import { mergedHistory } from "../lib/activity";
import type { CardComment, HistoryEvent } from "../types";
import { cleanKey, nextNumber, parseRef, refOf } from "../lib/shortid";
import { useDragSensors } from "../lib/dnd";
import { t, tn } from "../lib/i18n";
import { TRASH_DAYS } from "../lib/store";
import { ColumnPreview, ColumnView } from "./ColumnView";
import { CardBody } from "./CardTile";
import { CardModal } from "./CardModal";
import { LabelManager } from "./LabelManager";
import { ArchiveModal } from "./ArchiveModal";
import { BoardContext, contextSummary } from "./BoardContext";
import { BulkBar } from "./BulkBar";
import { LanesView } from "./LanesView";
import { loadLaneMode, saveLaneMode, type LaneMode } from "../lib/lanes";
import type { Column } from "../types";
import { movedTogether, toggled, withRange } from "../lib/selection";
import { DUE_FILTERS, loadFilter, matchesDue, saveFilter, sortCards, type DueFilter, type SortKey } from "../lib/sorting";
import { AgentStatusChips } from "./AgentStatus";
import type { AgentStatus } from "../types";
import { DangerButton, InlineEdit } from "./ui";

type Lists = Record<string, string[]>;

const COL = "col:";
const CARD = "card:";

export function BoardView({
  board,
  cards: allCards,
  actions,
  unsavedIds,
  index,
  onOpenElsewhere,
  initialOpenCardId = null,
  otherKeys,
  comments,
  history,
  agents = [],
}: {
  board: Board;
  cards: Card[];
  actions: Actions;
  unsavedIds: ReadonlySet<string>;
  /** Every card by id, on every board, for links. */
  index: Map<string, Located>;
  /** Opens a card of another board. */
  onOpenElsewhere: (boardId: string, cardId: string) => void;
  /** Card to open when the board shows, after following a link from another board. */
  initialOpenCardId?: string | null;
  /** Keys of the other boards, which this one can't take. */
  otherKeys: string[];
  /** Comments by card id. */
  comments: Record<string, CardComment[]>;
  /** History by card id, then by writer. */
  history: Record<string, Record<string, HistoryEvent[]>>;
  /** Agents watching this board. */
  agents?: AgentStatus[];
}) {
  // Everything below works on the cards still on the board; archived ones only show in the archive.
  const cards = useMemo(() => allCards.filter((c) => !c.archivedAt), [allCards]);
  const archived = useMemo(() => allCards.filter((c) => c.archivedAt), [allCards]);
  const [showArchive, setShowArchive] = useState(false);
  const [showContext, setShowContext] = useState(false);
  // The filter bar comes back as it was left on this board (kept on this computer).
  const [saved] = useState(() => loadFilter(board.id));
  const [query, setQuery] = useState(saved.query);
  const [labelFilter, setLabelFilter] = useState<string[]>(saved.labels);
  const [priorityFilter, setPriorityFilter] = useState<string[]>(saved.priorities);
  const [dueFilter, setDueFilter] = useState<DueFilter>(saved.due);
  // Swimlanes, kept per board on this computer.
  const [laneMode, setLaneMode] = useState<LaneMode>(() => loadLaneMode(board.id));
  const changeLaneMode = (mode: LaneMode) => {
    setLaneMode(mode);
    saveLaneMode(board.id, mode);
  };
  useEffect(() => {
    saveFilter(board.id, { query, labels: labelFilter, priorities: priorityFilter, due: dueFilter });
  }, [board.id, query, labelFilter, priorityFilter, dueFilter]);
  const priorities = prioritiesOf(board);
  const [openCardId, setOpenCardId] = useState<string | null>(initialOpenCardId);
  // Cards selected with Ctrl / Shift + click, and the last one clicked, where a Shift range starts.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [newCard, setNewCard] = useState<Card | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [newColumn, setNewColumn] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragLists, setDragLists] = useState<Lists | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const blockers = useMemo(
    () => new Map(cards.map((c) => [c.id, openBlockers(c, index).map((b) => b.card.title)])),
    [cards, index],
  );

  const openLinked = (boardId: string, cardId: string) => {
    if (boardId === board.id) setOpenCardId(cardId);
    else onOpenElsewhere(boardId, cardId);
  };

  const computed = useMemo<Lists>(() => {
    const q = query.trim().toLowerCase();
    // « 42 » or « SOL-42 » finds the card by its number.
    const ref = parseRef(q) ?? (/^\d+$/.test(q) ? { key: board.key ?? "", number: Number(q) } : null);
    const byRef = (c: Card) => !!ref && c.number === ref.number && (!board.key || ref.key === board.key);
    const visible = (c: Card) =>
      (!q || byRef(c) || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) &&
      labelFilter.every((l) => c.labels.includes(l)) &&
      (!priorityFilter.length || (!!c.priority && priorityFilter.includes(c.priority))) &&
      matchesDue(c, dueFilter);
    const lists: Lists = Object.fromEntries(board.columns.map((c) => [c.id, []]));
    const fallback = board.columns[0]?.id;
    for (const c of [...cards].sort((a, b) => a.order - b.order)) {
      if (!visible(c)) continue;
      // Cards whose column was deleted on another machine land in the first column.
      const col = lists[c.columnId] ? c.columnId : fallback;
      if (col) lists[col].push(c.id);
    }
    return lists;
  }, [cards, board.columns, board.key, query, labelFilter, priorityFilter, dueFilter]);

  const lists = dragLists ?? computed;
  const listsRef = useRef(lists);
  listsRef.current = lists;

  const columnOf = (dndId: string): string | undefined => {
    if (dndId.startsWith(COL)) return dndId.slice(COL.length);
    const cardId = dndId.slice(CARD.length);
    return Object.keys(listsRef.current).find((col) => listsRef.current[col].includes(cardId));
  };

  const sensors = useDragSensors();

  // Columns only collide with columns; cards prefer the card under the pointer, then the closest card of the hovered column.
  const collision: CollisionDetection = (args) => {
    const active = String(args.active.id);
    if (active.startsWith(COL)) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(COL)),
      });
    }
    // Keyboard drag: no pointer, the arrow keys move the card's rectangle instead.
    if (!args.pointerCoordinates) return closestCorners(args);
    const hits = pointerWithin(args);
    const cardHits = hits.filter((h) => String(h.id).startsWith(CARD));
    if (cardHits.length) return cardHits;
    const colHit = hits.find((h) => String(h.id).startsWith(COL));
    if (!colHit) return [];
    const ids = new Set((listsRef.current[String(colHit.id).slice(COL.length)] ?? []).map((id) => CARD + id));
    const inColumn = args.droppableContainers.filter((c) => ids.has(String(c.id)));
    if (inColumn.length) {
      const closest = closestCenter({ ...args, droppableContainers: inColumn });
      if (closest.length) return closest;
    }
    return [colHit];
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragLists(computed);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const aid = String(active.id);
    if (!over || !aid.startsWith(CARD)) return;
    const oid = String(over.id);
    const from = columnOf(aid);
    const to = columnOf(oid);
    if (!from || !to || from === to) return;
    const cardId = aid.slice(CARD.length);
    setDragLists((prev) => {
      const cur = prev ?? computed;
      const target = cur[to].filter((id) => id !== cardId);
      let index = target.length;
      if (oid.startsWith(CARD)) {
        const overIndex = target.indexOf(oid.slice(CARD.length));
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      target.splice(index, 0, cardId);
      return { ...cur, [from]: cur[from].filter((id) => id !== cardId), [to]: target };
    });
  };

  const endDrag = () => {
    setActiveId(null);
    setDragLists(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const aid = String(active.id);
    if (!over) return endDrag();

    if (aid.startsWith(COL)) {
      const ids = board.columns.map((c) => c.id);
      const from = ids.indexOf(aid.slice(COL.length));
      const to = ids.indexOf(columnOf(String(over.id)) ?? "");
      if (from >= 0 && to >= 0 && from !== to) actions.saveBoard({ ...board, columns: arrayMove(board.columns, from, to) });
      return endDrag();
    }

    const cardId = aid.slice(CARD.length);
    const col = columnOf(aid);
    const card = cardById.get(cardId);
    if (!col || !card) return endDrag();

    let list = listsRef.current[col];
    const oid = String(over.id);
    if (oid.startsWith(CARD) && columnOf(oid) === col) {
      const from = list.indexOf(cardId);
      const to = list.indexOf(oid.slice(CARD.length));
      if (from !== to) list = arrayMove(list, from, to);
    }

    const unchanged = card.columnId === col && list.join() === (computed[col] ?? []).join();
    if (!unchanged) {
      const updates = new Map(reorder(list, cardId, (id) => cardById.get(id)?.order));
      // A card dropped in another column changes even if its position number doesn't.
      if (!updates.has(cardId)) updates.set(cardId, card.order);
      for (const [id, order] of updates) {
        const c = cardById.get(id);
        if (c) actions.saveCard({ ...c, columnId: col, order });
      }
    }
    endDrag();
  };

  const nextOrder = (columnId: string) =>
    cards.filter((c) => c.columnId === columnId).reduce((m, c) => Math.max(m, c.order), -1) + 1;

  // Numbers count archived cards too, so an id is never given twice.
  const addCard = (columnId: string, title: string) =>
    actions.newCard(board, columnId, title, nextOrder(columnId), nextNumber(allCards));

  const [keyError, setKeyError] = useState(false);
  const saveKey = (input: string) => {
    const key = cleanKey(input);
    const ok = !!key && !otherKeys.some((k) => k.toUpperCase() === key);
    setKeyError(!ok);
    if (ok && key !== board.key) actions.saveBoard({ ...board, key });
  };

  // Opens the editor on a blank card in the first column; it is written on save.
  const startCard = () => {
    const first = board.columns[0];
    if (first) setNewCard(actions.draftCard(board, first.id, "", nextOrder(first.id), nextNumber(allCards)));
  };
  // At the bottom of whichever column was picked in the editor.
  const saveNewCard = (card: Card) =>
    actions.saveCard({
      ...card,
      number: nextNumber(allCards),
      order: card.columnId === newCard?.columnId ? card.order : nextOrder(card.columnId),
    });

  const addColumn = () => {
    const name = newColumn.trim();
    if (!name) return;
    actions.saveBoard({ ...board, columns: [...board.columns, { id: uid(), name }] });
    setNewColumn("");
  };

  const updateColumn = (columnId: string, patch: Partial<Column>) =>
    actions.saveBoard({ ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)) });

  const renameColumn = (columnId: string, name: string) =>
    actions.saveBoard({ ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, name } : c)) });

  // Rewrites the positions of the column's cards: highest priority first, then the current order.
  // Rewrites the positions of the column's cards in the chosen order.
  const sortColumn = (columnId: string, key: SortKey) => {
    const sorted = sortCards(cards.filter((c) => c.columnId === columnId), key, board);
    sorted.forEach((c, i) => {
      if (c.order !== i) actions.saveCard({ ...c, order: i });
    });
  };

  const togglePriority = (id: string) =>
    setPriorityFilter((f) => (f.includes(id) ? f.filter((p) => p !== id) : [...f, id]));

  const toggleFilter = (labelId: string) =>
    setLabelFilter((f) => (f.includes(labelId) ? f.filter((l) => l !== labelId) : [...f, labelId]));

  // The board's order, column by column: what a Shift range follows and moved cards keep.
  const boardOrder = board.columns.flatMap((c) => lists[c.id] ?? []);
  // Cards archived or gone elsewhere drop out of the selection.
  const selected = cards.filter((c) => selection.has(c.id));
  const selectCard = (id: string, range: boolean) => {
    setSelection((s) => (range ? withRange(s, boardOrder, anchor.current, id) : toggled(s, id)));
    anchor.current = id;
  };
  const clearSelection = () => {
    setSelection(new Set());
    anchor.current = null;
  };
  const openFromBoard = (id: string) => {
    clearSelection();
    setOpenCardId(id);
  };
  useEffect(() => {
    if (!selection.size) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".modal") && clearSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection.size]);
  const bulk = {
    move: (columnId: string) =>
      movedTogether(selected, boardOrder, columnId, nextOrder(columnId)).forEach((c) => actions.saveCard(c)),
    addLabel: (labelId: string) =>
      selected.filter((c) => !c.labels.includes(labelId)).forEach((c) => actions.saveCard({ ...c, labels: [...c.labels, labelId] })),
    removeLabel: (labelId: string) =>
      selected.filter((c) => c.labels.includes(labelId)).forEach((c) => actions.saveCard({ ...c, labels: c.labels.filter((l) => l !== labelId) })),
    setPriority: (priority: string | null) =>
      selected.filter((c) => c.priority !== priority).forEach((c) => actions.saveCard({ ...c, priority })),
    archive: () => {
      selected.forEach((c) => actions.archiveCard(c));
      clearSelection();
    },
    clear: clearSelection,
  };

  const overdue = cards.filter((c) => dueStatus(c.due) === "overdue").length;
  // An archived card opens too (from the search, or a link): its editor offers to put it back.
  const openCard = openCardId ? (cardById.get(openCardId) ?? archived.find((c) => c.id === openCardId)) : undefined;
  const activeCard = activeId?.startsWith(CARD) ? cardById.get(activeId.slice(CARD.length)) : undefined;
  const activeColumn = activeId?.startsWith(COL) ? board.columns.find((c) => c.id === activeId.slice(COL.length)) : undefined;
  const filtering = query.trim() !== "" || labelFilter.length > 0 || priorityFilter.length > 0 || dueFilter !== "";

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-title-row">
          <InlineEdit value={board.name} onSave={(name) => actions.saveBoard({ ...board, name })} className="board-title" />
          {board.key && (
            <span className={`board-key ${keyError ? "invalid" : ""}`} title={keyError ? t("board.keyInvalid") : t("board.keyTitle", { key: board.key })}>
              <InlineEdit value={board.key} onSave={saveKey} />
            </span>
          )}
          <span className="board-stats" title={t("card.selectHint")}>
            {tn("board.cards", cards.length)}
            {overdue > 0 && <span className="stat-overdue"> · {t("board.overdue", { n: overdue })}</span>}
          </span>
          <AgentStatusChips agents={agents} cardById={cardById} refOf={(c) => refOf(board, c)} />
        </div>
        <button className={`board-context-line ${board.description ? "" : "empty"}`} onClick={() => setShowContext(true)} title={t("board.contextTitle")}>
          {contextSummary(board.description) ?? t("board.contextEmpty")}
        </button>
        <div className="board-tools">
          <button className="btn-primary" onClick={startCard} disabled={!board.columns.length} title={t("board.newCardTitle")}>
            {t("board.newCard")}
          </button>
          <input
            className="search"
            placeholder={t("board.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className={`due-filter ${laneMode ? "on" : ""}`} value={laneMode} onChange={(e) => changeLaneMode(e.target.value as LaneMode)}>
            <option value="">{t("lanes.none")}</option>
            <option value="priority">{t("lanes.priority")}</option>
            <option value="label">{t("lanes.label")}</option>
          </select>
          <select
            className={`due-filter ${dueFilter ? "on" : ""}`}
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value as DueFilter)}
            aria-label={t("dueFilter.all")}
          >
            <option value="">{t("dueFilter.all")}</option>
            {DUE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {t(`dueFilter.${d}`)}
              </option>
            ))}
          </select>
          <div className="label-filters">
            {priorities.map((p) => (
              <button
                key={p.id}
                className={`filter-chip priority-chip ${priorityFilter.includes(p.id) ? "on" : ""}`}
                style={{ "--chip": p.color } as React.CSSProperties}
                onClick={() => togglePriority(p.id)}
                title={t("card.priority", { name: p.name })}
              >
                {p.name}
              </button>
            ))}
            {priorities.length > 0 && board.labels.length > 0 && <span className="filter-sep" />}
            {board.labels.map((l) => (
              <button
                key={l.id}
                className={`filter-chip ${labelFilter.includes(l.id) ? "on" : ""}`}
                style={{ "--chip": l.color } as React.CSSProperties}
                onClick={() => toggleFilter(l.id)}
              >
                {l.name}
              </button>
            ))}
            {filtering && (
              <button className="btn-ghost small" onClick={() => (setQuery(""), setLabelFilter([]), setPriorityFilter([]), setDueFilter(""))}
                title={t("board.filterSaved")}>
                {t("board.clearFilters")}
              </button>
            )}
          </div>
          <button className="btn-ghost" onClick={() => setShowLabels(true)}>
            {t("board.labels")}
          </button>
          <button className="btn-ghost" onClick={() => setShowContext(true)} title={t("board.contextTitle")}>
            {t("board.context")}
          </button>
          <button className="btn-ghost" onClick={() => setShowArchive(true)} title={t("board.archivesTitle")}>
            {t("board.archives")}{archived.length > 0 && ` (${archived.length})`}
          </button>
          <DangerButton
            onConfirm={() => actions.trashBoard(board)}
            confirmLabel={t("board.trashQ")}
            title={t("board.trashTitle", { days: TRASH_DAYS })}
          >
            {t("board.trash")}
          </DangerButton>
        </div>
      </header>

      {laneMode ? (
        <LanesView
          board={board}
          mode={laneMode}
          lists={lists}
          cardById={cardById}
          blockers={blockers}
          comments={comments}
          selectedIds={selection}
          onOpen={openFromBoard}
          onSelect={selectCard}
        />
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        <div className="columns">
          <SortableContext items={board.columns.map((c) => COL + c.id)} strategy={horizontalListSortingStrategy}>
            {board.columns.map((col) => (
              <ColumnView
                key={col.id}
                column={col}
                cards={(lists[col.id] ?? []).map((id) => cardById.get(id)!).filter(Boolean)}
                labels={board.labels}
                priorities={priorities}
                blockers={blockers}
                boardKey={board.key}
                comments={comments}
                unsavedIds={unsavedIds}
                onOpen={openFromBoard}
                selectedIds={selection}
                onSelect={selectCard}
                onAdd={(title) => addCard(col.id, title)}
                onRename={(name) => renameColumn(col.id, name)}
                onDelete={() => actions.deleteColumn(board, col.id, cards)}
                onSort={(key) => sortColumn(col.id, key)}
                total={cards.filter((c) => c.columnId === col.id).length}
                onUpdate={(patch) => updateColumn(col.id, patch)}
              />
            ))}
          </SortableContext>
          <div className="add-column">
            <input
              placeholder={t("board.newColumn")}
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addColumn()}
            />
            {newColumn.trim() && (
              <button className="btn-primary" onClick={addColumn}>
                {t("common.add")}
              </button>
            )}
          </div>
        </div>
        <DragOverlay>
          {activeCard && (
            <div className="card overlay">
              <CardBody
                card={activeCard}
                cardRef={refOf(board, activeCard)}
                labels={board.labels}
                priorities={priorities}
                blockers={blockers.get(activeCard.id)}
              />
            </div>
          )}
          {activeColumn && <ColumnPreview column={activeColumn} count={lists[activeColumn.id]?.length ?? 0} />}
        </DragOverlay>
      </DndContext>
      )}

      {openCard && (
        <CardModal
          key={openCard.id}
          card={openCard}
          board={board}
          cardRef={refOf(board, openCard)}
          onSave={actions.saveCard}
          onClose={() => setOpenCardId(null)}
          onManageLabels={() => setShowLabels(true)}
          links={{
            index,
            onLink: (type, target) => actions.linkCards(openCard, type, target),
            onUnlink: (targetId) => actions.unlinkCards(openCard, index.get(targetId)?.card, targetId),
            onOpen: openLinked,
          }}
          activity={{
            comments: comments[openCard.id] ?? [],
            history: mergedHistory(history[openCard.id]),
            onComment: (text) => actions.addComment(openCard, text),
            onDeleteComment: (c) => actions.deleteComment(c, board.id),
          }}
          claim={{ onTake: () => actions.claimCard(openCard), onRelease: () => actions.releaseCard(openCard) }}
          onRestore={openCard.archivedAt ? () => actions.restoreCard(board, openCard, allCards) : undefined}
        />
      )}
      {newCard && (
        <CardModal
          key={newCard.id}
          card={newCard}
          board={board}
          isNew
          onSave={saveNewCard}
          onClose={() => setNewCard(null)}
          onManageLabels={() => setShowLabels(true)}
        />
      )}
      {selected.length > 0 && <BulkBar board={board} count={selected.length} actions={bulk} />}
      {showContext && <BoardContext board={board} onSave={actions.saveBoard} onClose={() => setShowContext(false)} />}
      {showLabels && <LabelManager board={board} onSave={actions.saveBoard} onClose={() => setShowLabels(false)} />}
      {showArchive && (
        <ArchiveModal
          board={board}
          cards={archived}
          onRestore={(card) => actions.restoreCard(board, card, allCards)}
          onDelete={actions.deleteCard}
          onClose={() => setShowArchive(false)}
        />
      )}
    </div>
  );
}
