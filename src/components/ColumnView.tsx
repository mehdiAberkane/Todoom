import { useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Column, Label, Priority } from "../types";
import { CardTile } from "./CardTile";
import { DangerButton, InlineEdit } from "./ui";
import { emptyColumnLine } from "../lib/utils";
import { refOf } from "../lib/shortid";
import { COLUMN_SORTS, columnSort, type ColumnSort } from "../lib/sorting";
import { t, tn } from "../lib/i18n";

interface Props {
  column: Column;
  cards: Card[];
  labels: Label[];
  priorities: Priority[];
  /** Titles of the unfinished cards each card waits for, by card id. */
  blockers: Map<string, string[]>;
  checklistDone: Map<string, number>;
  boardKey?: string;
  comments: Record<string, unknown[]>;
  attachments: Record<string, unknown[]>;
  unsavedIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string, range: boolean) => void;
  onAdd: (title: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** The color of a card's band: its own, else its priority's. */
  colorFor: (card: Card) => string | null;
  /** Changes how the column orders its cards. */
  onSort: (sort: ColumnSort) => void;
  /** Cards in the column, filters aside: what the limit counts. */
  total: number;
  onUpdate: (patch: Partial<Column>) => void;
}

export function ColumnView({ column, cards, labels, priorities, blockers, checklistDone, boardKey, comments, attachments, unsavedIds, onOpen, selectedIds, onSelect, onAdd, onRename, onDelete, onSort, colorFor, total, onUpdate }: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `col:${column.id}`,
  });

  const over = column.limit !== undefined && total > column.limit;

  // Collapsed: a narrow strip, still a place to drop cards; a click opens it again.
  if (column.collapsed) {
    return (
      <section
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={`column collapsed ${isDragging ? "ghost" : ""} ${over ? "over-limit" : ""}`}
        {...attributes}
        {...listeners}
        onClick={() => onUpdate({ collapsed: false })}
        title={t("column.expand", { name: column.name })}
      >
        <span className="count">{total}</span>
        <span className="collapsed-name">{column.name}</span>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`column ${isDragging ? "ghost" : ""} ${over ? "over-limit" : ""}`}
    >
      <header className="column-head" {...attributes} {...listeners}>
        <InlineEdit value={column.name} onSave={onRename} className="column-title" />
        <span className="count" title={over ? t("column.overLimit", { n: total, limit: column.limit! }) : undefined}>
          {column.limit !== undefined ? `${total}/${column.limit}` : cards.length}
        </span>
        <ColumnSortBadge column={column} onSort={onSort} />
        {column.archiveAfter && (
          <span className="auto-archive" title={tn("column.autoArchiveTitle", column.archiveAfter)}>
            🗄 {t("dur.d", { d: column.archiveAfter })}
          </span>
        )}
        <ColumnMenu column={column} onSort={onSort} onUpdate={onUpdate} />
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
              color={colorFor(c)}
              cardRef={refOf({ key: boardKey }, c)}
              labels={labels}
              priorities={priorities}
              blockers={blockers.get(c.id)}
              commentCount={comments[c.id]?.length ?? 0}
              attachmentCount={attachments[c.id]?.length ?? 0}
              checklistDone={checklistDone.get(c.id)}
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

/** The column's sort in its header (↓ Priorité); a click opens the choices. */
function ColumnSortBadge({ column, onSort }: { column: Column; onSort: (sort: ColumnSort) => void }) {
  const [open, setOpen] = useState(false);
  const current = columnSort(column);
  return (
    <span className="sort-menu column-sort" onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="sort-badge" onClick={() => setOpen((o) => !o)} title={t(column.sort ? "column.sortTitleChosen" : "column.sortTitleDefault")} aria-expanded={open}>
        {current === "manual" ? "↕" : "↓"} {t(`sort.short.${current}`)}
      </button>
      {open && (
        <div className="sort-options" role="menu">
          <SortChoices current={current} onSort={(sort) => (onSort(sort), setOpen(false))} />
        </div>
      )}
    </span>
  );
}

/** The sorts a column can have, the current one ticked. */
function SortChoices({ current, onSort }: { current: ColumnSort; onSort: (sort: ColumnSort) => void }) {
  return (
    <>
      <div className="menu-title">{t("column.sortTitle")}</div>
      {COLUMN_SORTS.map((sort) => (
        <button key={sort} role="menuitemradio" aria-checked={sort === current} onClick={() => onSort(sort)}>
          {sort === current ? "✓ " : ""}
          {t(`sort.${sort}`)}
        </button>
      ))}
    </>
  );
}

/** ⋯ on a column: its sort, collapse it, set its card limit and its automatic archiving. */
function ColumnMenu({
  column,
  onSort,
  onUpdate,
}: {
  column: Column;
  onSort: (sort: ColumnSort) => void;
  onUpdate: (patch: Partial<Column>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(column.limit !== undefined ? String(column.limit) : "");
  const [archiveAfter, setArchiveAfter] = useState(column.archiveAfter !== undefined ? String(column.archiveAfter) : "");
  // A whole number above 0, or nothing (no limit, never archived).
  const positive = (text: string) => {
    const n = Math.floor(Number(text));
    return text.trim() && n > 0 ? n : undefined;
  };
  const saveLimit = () => {
    const nextLimit = positive(limit);
    const nextArchive = positive(archiveAfter);
    const patch: Partial<Column> = {};
    if (nextLimit !== column.limit) patch.limit = nextLimit;
    if (nextArchive !== column.archiveAfter) patch.archiveAfter = nextArchive;
    if (Object.keys(patch).length) onUpdate(patch);
    setLimit(nextLimit !== undefined ? String(nextLimit) : "");
    setArchiveAfter(nextArchive !== undefined ? String(nextArchive) : "");
  };
  return (
    <span className="sort-menu" onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && (saveLimit(), setOpen(false))}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} title={t("column.menu")} aria-expanded={open}>
        ⋯
      </button>
      {open && (
        <div className="sort-options" role="menu">
          <SortChoices
            current={columnSort(column)}
            onSort={(sort) => {
              onSort(sort);
              setOpen(false);
            }}
          />
          <button
            role="menuitem"
            onClick={() => {
              onUpdate({ collapsed: true });
              setOpen(false);
            }}
          >
            {t("column.collapse")}
          </button>
          <label className="menu-limit">
            {t("column.limit")}
            <input
              type="number"
              min={1}
              value={limit}
              placeholder={t("column.limitPlaceholder")}
              onChange={(e) => setLimit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (saveLimit(), setOpen(false))}
            />
          </label>
          <label className="menu-limit" title={t("column.archiveAfterTitle")}>
            {t("column.archiveAfter")}
            <input
              type="number"
              min={1}
              value={archiveAfter}
              placeholder={t("column.archiveAfterPlaceholder")}
              onChange={(e) => setArchiveAfter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (saveLimit(), setOpen(false))}
            />
          </label>
        </div>
      )}
    </span>
  );
}
