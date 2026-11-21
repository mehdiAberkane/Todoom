import { useState } from "react";
import type { CardComment, HistoryEvent } from "../types";
import { authorLabel } from "../lib/activity";
import { formatDateTime, localGet, localSet } from "../lib/utils";
import { t } from "../lib/i18n";
import { DangerButton } from "./ui";
import { Markdown } from "./Markdown";
import { mrLabel, MR_STATES } from "../lib/dev";
import type { MergeRequestState } from "../types";

export interface ActivityProps {
  comments: CardComment[];
  /** Oldest first, all writers merged. */
  history: HistoryEvent[];
  onComment: (text: string) => void;
  onDeleteComment: (comment: CardComment) => void;
}

const SHOW_HISTORY_KEY = "todoom-show-history";

type Entry = { at: string; comment: CardComment } | { at: string; event: HistoryEvent };

/**
 * Comments and history of a card, newest first. Comments are written right
 * away, each in its own file, outside the editor's draft.
 */
export function ActivitySection({ comments, history, onComment, onDeleteComment }: ActivityProps) {
  const [text, setText] = useState("");
  const [showHistory, setShowHistory] = useState(() => localGet(SHOW_HISTORY_KEY) !== "0");

  const post = () => {
    const value = text.trim();
    if (!value) return;
    onComment(value);
    setText("");
  };

  const entries: Entry[] = [
    ...comments.map((comment) => ({ at: comment.createdAt, comment })),
    ...(showHistory ? history.map((event) => ({ at: event.at, event })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <h4>
        {t("field.activity")}
        <label className="history-toggle">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(e) => {
              setShowHistory(e.target.checked);
              localSet(SHOW_HISTORY_KEY, e.target.checked ? "1" : "0");
            }}
          />
          {t("activity.showHistory")}
        </label>
      </h4>
      <div className="comment-new">
        <textarea
          rows={2}
          placeholder={t("activity.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl + Enter posts the comment here, instead of saving and closing the card.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.nativeEvent.stopImmediatePropagation();
              post();
            }
          }}
        />
        {text.trim() && (
          <button className="btn-primary" onClick={post} title={t("activity.postTitle")}>
            {t("activity.post")}
          </button>
        )}
      </div>
      <ul className="activity">
        {entries.map((e) =>
          "comment" in e ? (
            <li key={e.comment.id} className="comment">
              <div className="comment-head">
                <span className="comment-author">{authorLabel(e.comment.author)}</span>
                <span className="muted">{formatDateTime(e.comment.createdAt)}</span>
                <DangerButton className="icon-btn" onConfirm={() => onDeleteComment(e.comment)} confirmLabel={t("common.sureQ")} title={t("activity.delete")}>
                  🗑
                </DangerButton>
              </div>
              <div className="comment-text">
                <Markdown text={e.comment.text} />
              </div>
            </li>
          ) : (
            <li key={`${e.event.at}-${e.event.field}-${e.event.by.host}`} className="event">
              <span className="muted">
                {formatDateTime(e.event.at)} · {authorLabel(e.event.by)}
              </span>{" "}
              {describeEvent(e.event)}
            </li>
          ),
        )}
        {entries.length === 0 && <li className="muted">{t("activity.empty")}</li>}
      </ul>
    </>
  );
}

/** "open https://…/-/merge_requests/12" → "!12 ouverte". */
function mrText(value: string | null | undefined): string {
  if (!value) return t("describe.none");
  const [state, url = ""] = value.split(" ");
  const known = MR_STATES.includes(state as MergeRequestState);
  return `${mrLabel(url)} ${known ? t(`mr.${state as MergeRequestState}`) : state}`;
}

function describeEvent(e: HistoryEvent): string {
  const v = (x: string | null | undefined) => x || t("describe.none");
  switch (e.field) {
    case "created":
      return t("history.created", { to: v(e.to) });
    case "archived":
      return e.to ? t("history.archived") : t("history.restored");
    case "description":
      return t("history.description");
    case "column":
    case "title":
    case "priority":
    case "labels":
    case "due":
    case "branch":
      return t(`history.${e.field}`, { from: v(e.from), to: v(e.to) });
    case "mergeRequest":
      return t("history.mergeRequest", { from: mrText(e.from), to: mrText(e.to) });
    case "claimedBy":
      return e.to ? t("history.claimed", { to: e.to }) : t("history.released", { from: v(e.from) });
    default:
      return String(e.field);
  }
}
