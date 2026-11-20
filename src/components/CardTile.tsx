import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Label, Priority } from "../types";
import { dueStatus, formatDue } from "../lib/utils";
import { t } from "../lib/i18n";

export function CardBody({
  card,
  cardRef,
  labels,
  priorities,
  blockers = [],
  commentCount = 0,
}: {
  card: Card;
  /** Short id such as SOL-42. */
  cardRef?: string | null;
  labels: Label[];
  priorities: Priority[];
  /** Titles of the unfinished cards this one depends on. */
  blockers?: string[];
  commentCount?: number;
}) {
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
      <div className="card-title">
        {cardRef && <span className="card-ref">{cardRef}</span>}
        {card.title}
      </div>
      {(card.due || total > 0 || card.description || card.links.length > 0 || commentCount > 0) && (
        <div className="card-badges">
          {blockers.length > 0 && (
            <span className="badge badge-blocked" title={t("card.blockedTitle", { titles: blockers.join(", ") })}>
              {t("card.blocked")}
            </span>
          )}
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
          {card.links.length > 0 && (
            <span className="badge" title={t("card.linksTitle")}>
              🔗 {card.links.length}
            </span>
          )}
          {commentCount > 0 && (
            <span className="badge" title={t("card.commentsTitle")}>
              💬 {commentCount}
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
  cardRef,
  labels,
  priorities,
  blockers,
  commentCount,
  unsaved,
  onOpen,
}: {
  card: Card;
  cardRef?: string | null;
  labels: Label[];
  priorities: Priority[];
  blockers?: string[];
  commentCount?: number;
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
      <CardBody card={card} cardRef={cardRef} labels={labels} priorities={priorities} blockers={blockers} commentCount={commentCount} />
    </article>
  );
}
