import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Label, Priority } from "../types";
import { dueStatus, formatDue } from "../lib/utils";
import { t } from "../lib/i18n";

export function CardBody({ card, labels, priorities }: { card: Card; labels: Label[]; priorities: Priority[] }) {
  const cardLabels = card.labels.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  const priority = card.priority ? priorities.find((p) => p.id === card.priority) : undefined;
  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;
  const due = dueStatus(card.due);

  return (
    <>
      {(cardLabels.length > 0 || priority) && (
        <div className="card-labels">
          {priority && (
            <span
              className="card-priority"
              style={{ "--prio": priority.color } as React.CSSProperties}
              title={t("card.priority", { name: priority.name })}
            >
              {priority.name}
            </span>
          )}
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
  priorities,
  unsaved,
  onOpen,
}: {
  card: Card;
  labels: Label[];
  priorities: Priority[];
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
      <CardBody card={card} labels={labels} priorities={priorities} />
    </article>
  );
}
