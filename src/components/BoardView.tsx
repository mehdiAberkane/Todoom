import { useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { Board, Card } from "../types";
import type { Actions } from "../lib/store";
import { dueStatus, orderBetween, uid } from "../lib/utils";
import { ColumnPreview, ColumnView } from "./ColumnView";
import { CardBody } from "./CardTile";
import { CardModal } from "./CardModal";
import { LabelManager } from "./LabelManager";
import { DangerButton, InlineEdit } from "./ui";

type Lists = Record<string, string[]>;

const COL = "col:";
const CARD = "card:";

export function BoardView({ board, cards, actions }: { board: Board; cards: Card[]; actions: Actions }) {
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [newColumn, setNewColumn] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragLists, setDragLists] = useState<Lists | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const computed = useMemo<Lists>(() => {
    const q = query.trim().toLowerCase();
    const visible = (c: Card) =>
      (!q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) &&
      labelFilter.every((l) => c.labels.includes(l));
    const lists: Lists = Object.fromEntries(board.columns.map((c) => [c.id, []]));
    const fallback = board.columns[0]?.id;
    for (const c of [...cards].sort((a, b) => a.order - b.order)) {
      if (!visible(c)) continue;
      // Cards whose column was deleted on another machine land in the first column.
      const col = lists[c.columnId] ? c.columnId : fallback;
      if (col) lists[col].push(c.id);
    }
    return lists;
  }, [cards, board.columns, query, labelFilter]);

  const lists = dragLists ?? computed;
  const listsRef = useRef(lists);
  listsRef.current = lists;

  const columnOf = (dndId: string): string | undefined => {
    if (dndId.startsWith(COL)) return dndId.slice(COL.length);
    const cardId = dndId.slice(CARD.length);
    return Object.keys(listsRef.current).find((col) => listsRef.current[col].includes(cardId));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Columns only collide with columns; cards prefer the card under the pointer, then the closest card of the hovered column.
  const collision: CollisionDetection = (args) => {
    const active = String(args.active.id);
    if (active.startsWith(COL)) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(COL)),
      });
    }
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
      const i = list.indexOf(cardId);
      const orderOf = (id: string | undefined) => (id ? cardById.get(id)?.order : undefined);
      const order = orderBetween(orderOf(list[i - 1]), orderOf(list[i + 1]));
      if (order !== null) {
        actions.saveCard({ ...card, columnId: col, order });
      } else {
        list.forEach((id, idx) => {
          const c = cardById.get(id);
          if (c) actions.saveCard({ ...c, columnId: col, order: idx });
        });
      }
    }
    endDrag();
  };

  const addCard = (columnId: string, title: string) => {
    const last = cards.filter((c) => c.columnId === columnId).reduce((m, c) => Math.max(m, c.order), -1);
    actions.newCard(board, columnId, title, last + 1);
  };

  const addColumn = () => {
    const name = newColumn.trim();
    if (!name) return;
    actions.saveBoard({ ...board, columns: [...board.columns, { id: uid(), name }] });
    setNewColumn("");
  };

  const renameColumn = (columnId: string, name: string) =>
    actions.saveBoard({ ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, name } : c)) });

  const toggleFilter = (labelId: string) =>
    setLabelFilter((f) => (f.includes(labelId) ? f.filter((l) => l !== labelId) : [...f, labelId]));

  const overdue = cards.filter((c) => dueStatus(c.due) === "overdue").length;
  const openCard = openCardId ? cardById.get(openCardId) : undefined;
  const activeCard = activeId?.startsWith(CARD) ? cardById.get(activeId.slice(CARD.length)) : undefined;
  const activeColumn = activeId?.startsWith(COL) ? board.columns.find((c) => c.id === activeId.slice(COL.length)) : undefined;
  const filtering = query.trim() !== "" || labelFilter.length > 0;

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-title-row">
          <InlineEdit value={board.name} onSave={(name) => actions.saveBoard({ ...board, name })} className="board-title" />
          <span className="board-stats">
            {cards.length} carte{cards.length > 1 ? "s" : ""}
            {overdue > 0 && <span className="stat-overdue"> · 🔥 {overdue} en retard</span>}
          </span>
        </div>
        <div className="board-tools">
          <input
            className="search"
            placeholder="🔍 Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="label-filters">
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
              <button className="btn-ghost small" onClick={() => (setQuery(""), setLabelFilter([]))}>
                Effacer
              </button>
            )}
          </div>
          <button className="btn-ghost" onClick={() => setShowLabels(true)}>
            🏷 Étiquettes
          </button>
          <DangerButton onConfirm={() => actions.deleteBoard(board.id)} confirmLabel="Supprimer le tableau ?" title="Supprimer ce tableau">
            🗑 Tableau
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
                onOpen={setOpenCardId}
                onAdd={(title) => addCard(col.id, title)}
                onRename={(name) => renameColumn(col.id, name)}
                onDelete={() => actions.deleteColumn(board, col.id, cards)}
              />
            ))}
          </SortableContext>
          <div className="add-column">
            <input
              placeholder="+ Nouvelle colonne"
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addColumn()}
            />
            {newColumn.trim() && (
              <button className="btn-primary" onClick={addColumn}>
                Ajouter
              </button>
            )}
          </div>
        </div>
        <DragOverlay>
          {activeCard && (
            <div className="card overlay">
              <CardBody card={activeCard} labels={board.labels} />
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
          onDelete={() => {
            actions.deleteCard(openCard);
            setOpenCardId(null);
          }}
          onClose={() => setOpenCardId(null)}
          onManageLabels={() => setShowLabels(true)}
        />
      )}
      {showLabels && <LabelManager board={board} onSave={actions.saveBoard} onClose={() => setShowLabels(false)} />}
    </div>
  );
}
