import { useMemo, useRef, useState } from "react";
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
import { byPriority, prioritiesOf } from "../lib/priority";
import { useDragSensors } from "../lib/dnd";
import { t, tn } from "../lib/i18n";
import { TRASH_DAYS } from "../lib/store";
import { ColumnPreview, ColumnView } from "./ColumnView";
import { CardBody } from "./CardTile";
import { CardModal } from "./CardModal";
import { LabelManager } from "./LabelManager";
import { ArchiveModal } from "./ArchiveModal";
import { DangerButton, InlineEdit } from "./ui";

type Lists = Record<string, string[]>;

const COL = "col:";
const CARD = "card:";

export function BoardView({
  board,
  cards: allCards,
  actions,
  unsavedIds,
}: {
  board: Board;
  cards: Card[];
  actions: Actions;
  unsavedIds: ReadonlySet<string>;
}) {
  // Everything below works on the cards still on the board; archived ones only show in the archive.
  const cards = useMemo(() => allCards.filter((c) => !c.archivedAt), [allCards]);
  const archived = useMemo(() => allCards.filter((c) => c.archivedAt), [allCards]);
  const [showArchive, setShowArchive] = useState(false);
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const priorities = prioritiesOf(board);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [newCard, setNewCard] = useState<Card | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [newColumn, setNewColumn] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragLists, setDragLists] = useState<Lists | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const computed = useMemo<Lists>(() => {
    const q = query.trim().toLowerCase();
    const visible = (c: Card) =>
      (!q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) &&
      labelFilter.every((l) => c.labels.includes(l)) &&
      (!priorityFilter.length || (!!c.priority && priorityFilter.includes(c.priority)));
    const lists: Lists = Object.fromEntries(board.columns.map((c) => [c.id, []]));
    const fallback = board.columns[0]?.id;
    for (const c of [...cards].sort((a, b) => a.order - b.order)) {
      if (!visible(c)) continue;
      // Cards whose column was deleted on another machine land in the first column.
      const col = lists[c.columnId] ? c.columnId : fallback;
      if (col) lists[col].push(c.id);
    }
    return lists;
  }, [cards, board.columns, query, labelFilter, priorityFilter]);

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

  const addCard = (columnId: string, title: string) => actions.newCard(board, columnId, title, nextOrder(columnId));

  // Opens the editor on a blank card in the first column; it is written on save.
  const startCard = () => {
    const first = board.columns[0];
    if (first) setNewCard(actions.draftCard(board, first.id, "", nextOrder(first.id)));
  };
  // At the bottom of whichever column was picked in the editor.
  const saveNewCard = (card: Card) =>
    actions.saveCard(card.columnId === newCard?.columnId ? card : { ...card, order: nextOrder(card.columnId) });

  const addColumn = () => {
    const name = newColumn.trim();
    if (!name) return;
    actions.saveBoard({ ...board, columns: [...board.columns, { id: uid(), name }] });
    setNewColumn("");
  };

  const renameColumn = (columnId: string, name: string) =>
    actions.saveBoard({ ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, name } : c)) });

  // Rewrites the positions of the column's cards: highest priority first, then the current order.
  const sortByPriority = (columnId: string) => {
    const sorted = byPriority(board, cards.filter((c) => c.columnId === columnId));
    sorted.forEach((c, i) => {
      if (c.order !== i) actions.saveCard({ ...c, order: i });
    });
  };

  const togglePriority = (id: string) =>
    setPriorityFilter((f) => (f.includes(id) ? f.filter((p) => p !== id) : [...f, id]));

  const toggleFilter = (labelId: string) =>
    setLabelFilter((f) => (f.includes(labelId) ? f.filter((l) => l !== labelId) : [...f, labelId]));

  const overdue = cards.filter((c) => dueStatus(c.due) === "overdue").length;
  const openCard = openCardId ? cardById.get(openCardId) : undefined;
  const activeCard = activeId?.startsWith(CARD) ? cardById.get(activeId.slice(CARD.length)) : undefined;
  const activeColumn = activeId?.startsWith(COL) ? board.columns.find((c) => c.id === activeId.slice(COL.length)) : undefined;
  const filtering = query.trim() !== "" || labelFilter.length > 0 || priorityFilter.length > 0;

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-title-row">
          <InlineEdit value={board.name} onSave={(name) => actions.saveBoard({ ...board, name })} className="board-title" />
          <span className="board-stats">
            {tn("board.cards", cards.length)}
            {overdue > 0 && <span className="stat-overdue"> · {t("board.overdue", { n: overdue })}</span>}
          </span>
        </div>
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
              <button className="btn-ghost small" onClick={() => (setQuery(""), setLabelFilter([]), setPriorityFilter([]))}>
                {t("board.clearFilters")}
              </button>
            )}
          </div>
          <button className="btn-ghost" onClick={() => setShowLabels(true)}>
            {t("board.labels")}
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
                unsavedIds={unsavedIds}
                onOpen={setOpenCardId}
                onAdd={(title) => addCard(col.id, title)}
                onRename={(name) => renameColumn(col.id, name)}
                onDelete={() => actions.deleteColumn(board, col.id, cards)}
                onSortByPriority={() => sortByPriority(col.id)}
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
              <CardBody card={activeCard} labels={board.labels} priorities={priorities} />
            </div>
          )}
          {activeColumn && <ColumnPreview column={activeColumn} count={lists[activeColumn.id]?.length ?? 0} />}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardModal
          key={openCard.id}
          card={openCard}
          board={board}
          onSave={actions.saveCard}
          onClose={() => setOpenCardId(null)}
          onManageLabels={() => setShowLabels(true)}
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
