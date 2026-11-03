import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Label } from "../types";
import { dueStatus, formatDue } from "../lib/utils";

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
            <span className={`badge due-${due}`} title="Échéance">
              {due === "overdue" ? "🔥" : "📅"} {formatDue(card.due)}
            </span>
          )}
          {total > 0 && (
            <span className={`badge ${done === total ? "badge-done" : ""}`} title="Checklist">
              ☑ {done}/{total}
            </span>
          )}
          {card.description && (
            <span className="badge" title="A une description">
              ≡
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function CardTile({ card, labels, onOpen }: { card: Card; labels: Label[]; onOpen: (id: string) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `card:${card.id}`,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card ${isDragging ? "ghost" : ""}`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
    >
      <CardBody card={card} labels={labels} />
    </article>
  );
}
