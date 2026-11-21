import { useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Column, Label, Priority } from "../types";
import { CardTile } from "./CardTile";
import { DangerButton, InlineEdit } from "./ui";
import { emptyColumnLine } from "../lib/utils";
import { refOf } from "../lib/shortid";
import { SORT_KEYS, type SortKey } from "../lib/sorting";
import { t } from "../lib/i18n";

interface Props {
  column: Column;
  cards: Card[];
  labels: Label[];
  priorities: Priority[];
  /** Titles of the unfinished cards each card waits for, by card id. */
  blockers: Map<string, string[]>;
  boardKey?: string;
  comments: Record<string, unknown[]>;
  unsavedIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string, range: boolean) => void;
  onAdd: (title: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSort: (key: SortKey) => void;
}

export function ColumnView({ column, cards, labels, priorities, blockers, boardKey, comments, unsavedIds, onOpen, selectedIds, onSelect, onAdd, onRename, onDelete, onSort }: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `col:${column.id}`,
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`column ${isDragging ? "ghost" : ""}`}
    >
      <header className="column-head" {...attributes} {...listeners}>
        <InlineEdit value={column.name} onSave={onRename} className="column-title" />
        <span className="count">{cards.length}</span>
        {cards.length > 1 && <SortMenu onSort={onSort} />}
        <DangerButton
          className="icon-btn"
          onConfirm={onDelete}
          confirmLabel={t("column.deleteQ")}
          title={t("column.deleteTitle")}
        >
          🗑
        </DangerButton>
      </header>
      <SortableContext items={cards.map((c) => `card:${c.id}`)} strategy={verticalListSortingStrategy}>
        <div className="card-list">
          {cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              cardRef={refOf({ key: boardKey }, c)}
              labels={labels}
              priorities={priorities}
              blockers={blockers.get(c.id)}
              commentCount={comments[c.id]?.length ?? 0}
              unsaved={unsavedIds.has(c.id)}
              selected={selectedIds.has(c.id)}
              onOpen={onOpen}
              onSelect={onSelect}
            />
          ))}
          {cards.length === 0 && <div className="empty-col">{emptyColumnLine(column.id)}</div>}
        </div>
      </SortableContext>
      <QuickAdd onAdd={onAdd} />
    </section>
  );
}

export function ColumnPreview({ column, count }: { column: Column; count: number }) {
  return (
    <section className="column overlay">
      <header className="column-head">
        <span className="column-title">{column.name}</span>
        <span className="count">{count}</span>
      </header>
    </section>
  );
}

function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <button className="add-card" onClick={() => setOpen(true)}>
        {t("column.addCard")}
      </button>
    );
  }

  const submit = () => {
    const title = text.trim();
    if (title) onAdd(title);
    setText("");
  };

  return (
    <div className="quick-add">
      <textarea
        autoFocus
        rows={2}
        placeholder={t("column.cardTitlePlaceholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !text.trim() && setOpen(false)}
      />
      <div className="quick-add-actions">
        <button className="btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          {t("common.add")}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** ⇅ opens the ways to sort the column; picking one rewrites the cards' positions. */
function SortMenu({ onSort }: { onSort: (key: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="sort-menu" onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} title={t("sort.title")} aria-expanded={open}>
        ⇅
      </button>
      {open && (
        <div className="sort-options" role="menu">
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              role="menuitem"
              onClick={() => {
                onSort(key);
                setOpen(false);
              }}
            >
              {t(`sort.${key}`)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
