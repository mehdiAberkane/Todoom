import { useMemo, useState } from "react";
import type { Board, Card, CardComment, HistoryEvent } from "../types";
import {
  ACTIVITY_KINDS,
  activityItems,
  filterActivity,
  PERIODS,
  periodRange,
  sessions,
  staleClaims,
  STALE_CLAIM_HOURS,
  writersOf,
  type ActivityItem,
  type ActivityKind,
  type Period,
} from "../lib/activityFeed";
import { claimLabel } from "../lib/claim";
import { refOf } from "../lib/shortid";
import { formatDateTime, localGet, localSet } from "../lib/utils";
import { t, tn } from "../lib/i18n";
import { describeEvent } from "./ActivitySection";

interface Props {
  boards: Board[];
  cards: Record<string, Card[]>;
  history: Record<string, Record<string, HistoryEvent[]>>;
  comments: Record<string, CardComment[]>;
  onOpenCard: (boardId: string, cardId: string) => void;
}

const PERIOD_KEY = "todoom-activity-period";
const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * « Activité » (TOD-72): what every computer, agent and conversation did, all boards
 * together, grouped by who and by hour; a click opens the card. Cards held with
 * nothing happening on them are flagged at the top.
 */
export function ActivityPage({ boards, cards, history, comments, onOpenCard }: Props) {
  const [period, setPeriod] = useState<Period>(() => (PERIODS as string[]).includes(localGet(PERIOD_KEY) ?? "") ? (localGet(PERIOD_KEY) as Period) : "today");
  const [writer, setWriter] = useState("");
  const [board, setBoard] = useState("");
  const [kind, setKind] = useState<ActivityKind | "">("");
  const choosePeriod = (p: Period) => {
    setPeriod(p);
    localSet(PERIOD_KEY, p);
  };

  const all = useMemo(() => {
    const { since, until } = periodRange(period);
    return activityItems(boards, cards, history, comments, since, until);
  }, [boards, cards, history, comments, period]);
  const writers = useMemo(() => writersOf(all), [all]);
  const shown = useMemo(() => sessions(filterActivity(all, { writer, board, kind: kind || undefined })), [all, writer, board, kind]);
  const stale = useMemo(() => staleClaims(boards, cards, history, comments), [boards, cards, history, comments]);

  return (
    <div className="calendar-page activity-page">
      <header className="metrics-head">
        <h1>{t("activity.title")}</h1>
        <div className="activity-filters">
          <select value={period} onChange={(e) => choosePeriod(e.target.value as Period)} aria-label={t("activity.period")}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`activity.period.${p}`)}
              </option>
            ))}
          </select>
          <select value={writer} onChange={(e) => setWriter(e.target.value)} aria-label={t("activity.writer")}>
            <option value="">{t("activity.allWriters")}</option>
            {writers.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label} ({w.count})
              </option>
            ))}
          </select>
          <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label={t("activity.board")}>
            <option value="">{t("activity.allBoards")}</option>
            {boards
              .filter((b) => !b.archivedAt)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind | "")} aria-label={t("activity.kind")}>
            <option value="">{t("activity.allKinds")}</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`activity.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {stale.length > 0 && (
        <section className="today-section overdue activity-stale">
          <h2>
            {t("activity.stale")} <span className="count">{stale.length}</span>
          </h2>
          <p className="muted">{tn("activity.staleHint", STALE_CLAIM_HOURS)}</p>
          <ul>
            {stale.map(({ board: b, card, since }) => (
              <li key={card.id} onClick={() => onOpenCard(b.id, card.id)}>
                <span className="today-title">
                  {refOf(b, card) && <span className="card-ref">{refOf(b, card)}</span>}
                  {card.title}
                </span>
                <span className="muted today-meta">{t("activity.staleBy", { who: claimLabel(card.claimedBy!), board: b.name, date: formatDateTime(since) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shown.length === 0 && <p className="muted">{t("activity.none")}</p>}
      {shown.map((s) => (
        <section key={`${s.writer}-${s.hour}-${s.items[0].at}`} className="today-section activity-session">
          <h2>
            {s.label}
            <span className="muted">· {formatDateTime(s.items[0].at)}</span>
            <span className="count">{s.items.length}</span>
          </h2>
          <ul>
            {s.items.map((item, i) => (
              <li key={i} onClick={() => onOpenCard(item.board.id, item.card.id)}>
                <span className="today-title">
                  <span className="activity-time">{time(item.at)}</span>
                  {refOf(item.board, item.card) && <span className="card-ref">{refOf(item.board, item.card)}</span>}
                  {item.card.title}
                </span>
                <span className="muted today-meta">
                  {whatHappened(item)} · {item.board.name}
                  {item.tool && item.tool !== "app" ? ` · ${t(`activity.tool.${item.tool}`)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The change in words, or the start of the comment. */
function whatHappened(item: ActivityItem): string {
  if (item.comment) {
    const text = item.comment.text.replace(/\s+/g, " ").trim();
    return t("activity.commented", { text: text.length > 120 ? `${text.slice(0, 119)}…` : text });
  }
  return item.event ? describeEvent(item.event) : "";
}
