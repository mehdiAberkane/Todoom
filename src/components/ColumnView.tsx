import { useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Column, Label } from "../types";
import { CardTile } from "./CardTile";
import { DangerButton, InlineEdit } from "./ui";
import { emptyColumnLine } from "../lib/utils";
import { t } from "../lib/i18n";

interface Props {
  column: Column;
  cards: Card[];
  labels: Label[];
  unsavedIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onAdd: (title: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function ColumnView({ column, cards, labels, unsavedIds, onOpen, onAdd, onRename, onDelete }: Props) {
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
            <CardTile key={c.id} card={c} labels={labels} unsaved={unsavedIds.has(c.id)} onOpen={onOpen} />
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
