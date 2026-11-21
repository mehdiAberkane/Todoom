import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Label, Priority } from "../types";
import { dueStatus, formatDue } from "../lib/utils";
import { t } from "../lib/i18n";
import { mrLabel } from "../lib/dev";
import { claimLabel } from "../lib/claim";
import { formatDateTime } from "../lib/utils";

/** The class and style giving a card its color band, if it has one. */
export function colorOf(card: Card): { className: string; style: React.CSSProperties } {
  return card.color ? { className: "colored", style: { "--card-color": card.color } as React.CSSProperties } : { className: "", style: {} };
}

export function CardBody({
  card,
  cardRef,
  labels,
  priorities,
  blockers = [],
  commentCount = 0,
  attachmentCount = 0,
  checklistDone,
}: {
  card: Card;
  /** Short id such as SOL-42. */
  cardRef?: string | null;
  labels: Label[];
  priorities: Priority[];
  /** Titles of the unfinished cards this one depends on. */
  blockers?: string[];
  commentCount?: number;
  attachmentCount?: number;
  /** Items done, counting those turned into finished cards; else the ticked ones. */
  checklistDone?: number;
}) {
  const cardLabels = card.labels.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l);
  const priority = card.priority ? priorities.find((p) => p.id === card.priority) : undefined;
  const done = checklistDone ?? card.checklist.filter((i) => i.done).length;
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
      {(card.due || total > 0 || card.description || card.links.length > 0 || commentCount > 0 || card.branch || card.mergeRequest || card.claimedBy || attachmentCount > 0 || card.repeat) && (
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
          {card.repeat && (
            <span className="badge" title={t("repeat.badge", { every: t(`repeat.${card.repeat.every}`) })}>
              🔁
            </span>
          )}
          {total > 0 && (
            <span className={`badge ${done === total ? "badge-done" : ""}`} title={t("card.checklist")}>
              ☑ {done}/{total}
            </span>
          )}
          {card.claimedBy && (
            <span
              className="badge badge-claim"
              title={t("card.claimedTitle", { who: claimLabel(card.claimedBy), date: formatDateTime(card.claimedBy.at) })}
            >
              👤 {[card.claimedBy.host, card.claimedBy.agent].filter(Boolean).join(" · ")}
            </span>
          )}
          {card.mergeRequest ? (
            <span
              className={`badge badge-mr mr-${card.mergeRequest.state}`}
              title={t("card.mrTitle", { label: mrLabel(card.mergeRequest.url), state: t(`mr.${card.mergeRequest.state}`) })}
            >
              ⑂ {mrLabel(card.mergeRequest.url)} {t(`mr.${card.mergeRequest.state}`)}
            </span>
          ) : (
            card.branch && (
              <span className="badge" title={t("card.branchTitle", { name: card.branch })}>
                ⑂
              </span>
            )
          )}
          {card.links.length > 0 && (
            <span className="badge" title={t("card.linksTitle")}>
              🔗 {card.links.length}
            </span>
          )}
          {attachmentCount > 0 && (
            <span className="badge" title={t("card.attachmentsTitle")}>
              📎 {attachmentCount}
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
  attachmentCount,
  checklistDone,
  unsaved,
  selected = false,
  onOpen,
  onSelect,
}: {
  card: Card;
  cardRef?: string | null;
  labels: Label[];
  priorities: Priority[];
  blockers?: string[];
  commentCount?: number;
  attachmentCount?: number;
  checklistDone?: number;
  /** The disk hasn't confirmed the last change of this card yet. */
  unsaved: boolean;
  selected?: boolean;
  onOpen: (id: string) => void;
  /** Ctrl + click (range false) or Shift + click (range true). */
  onSelect?: (id: string, range: boolean) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `card:${card.id}`,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ ...colorOf(card).style, transform: CSS.Translate.toString(transform), transition }}
      className={`card ${colorOf(card).className} ${isDragging ? "ghost" : ""} ${unsaved ? "unsaved" : ""} ${selected ? "selected" : ""}`}
      aria-selected={selected}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (onSelect && (e.ctrlKey || e.metaKey)) onSelect(card.id, false);
        else if (onSelect && e.shiftKey) onSelect(card.id, true);
        else onOpen(card.id);
      }}
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
      <CardBody card={card} cardRef={cardRef} labels={labels} priorities={priorities} blockers={blockers} commentCount={commentCount} attachmentCount={attachmentCount} checklistDone={checklistDone} />
    </article>
  );
}
