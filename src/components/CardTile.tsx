import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Label } from "../types";
import { dueStatus, formatDue } from "../lib/utils";
import { t } from "../lib/i18n";

export function CardBody({ card, labels }: { card: Card; labels: Label[] }) {
  const cardLabels = card.labels.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;
  const due = dueStatus(card.due);

  return (
    <>
      {cardLabels.length > 0 && (
        <div className="card-labels">
          {cardLabels.map((l) => (
            <span key={l.id} className="card-label" style={{ background: l.color }} title={l.name}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-title">{card.title}</div>
      {(card.due || total > 0 || card.description) && (
        <div className="card-badges">
          {card.due && (
            <span className={`badge due-${due}`} title={t("card.due")}>
              {due === "overdue" ? "🔥" : "📅"} {formatDue(card.due)}
            </span>
          )}
          {total > 0 && (
            <span className={`badge ${done === total ? "badge-done" : ""}`} title={t("card.checklist")}>
              ☑ {done}/{total}
            </span>
          )}
          {card.description && (
            <span className="badge" title={t("card.hasDescription")}>
              ≡
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function CardTile({
  card,
  labels,
  unsaved,
  onOpen,
}: {
  card: Card;
  labels: Label[];
  /** The disk hasn't confirmed the last change of this card yet. */
  unsaved: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `card:${card.id}`,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card ${isDragging ? "ghost" : ""} ${unsaved ? "unsaved" : ""}`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        // Enter opens the card; the drag sensor keeps Space and the arrows.
        if (e.key === "Enter" && !isDragging) onOpen(card.id);
        else listeners?.onKeyDown?.(e);
      }}
    >
      {unsaved && (
        <div className="unsaved-badge" title={t("card.unsavedTitle")}>
          {t("card.unsaved")}
        </div>
      )}
      <CardBody card={card} labels={labels} />
    </article>
  );
}
