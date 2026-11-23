import { useMemo, useState } from "react";
import type { Board, Card } from "../types";
import { addMonths, agenda, byDay, dueCards, monthGrid, type DueCard } from "../lib/calendar";
import { refOf } from "../lib/shortid";
import { cardColor } from "../lib/priority";
import { formatDue, toISODate } from "../lib/utils";
import { locale, t, tn } from "../lib/i18n";

interface Props {
  boards: Board[];
  cards: Record<string, Card[]>;
  onOpenCard: (boardId: string, cardId: string) => void;
  /** A card dropped on another day gets that due date. */
  onReschedule: (card: Card, due: string) => void;
}

const DRAG_TYPE = "application/x-todoom-card";

/** The due dates of every board: what needs doing now, and a month to plan the rest. */
export function CalendarPage({ boards, cards, onOpenCard, onReschedule }: Props) {
  const today = toISODate(new Date());
  const [[year, month], setMonth] = useState<[number, number]>(() => [new Date().getFullYear(), new Date().getMonth()]);
  const [over, setOver] = useState<string | null>(null);
  const list = useMemo(() => dueCards(boards, cards), [boards, cards]);
  const days = useMemo(() => byDay(list), [list]);
  const now = agenda(list, today);
  const weeks = monthGrid(year, month);
  const monthName = new Date(year, month, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  // Monday to Sunday (1 January 2024 was a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" }));
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const drop = (e: React.DragEvent, day: string) => {
    e.preventDefault();
    setOver(null);
    const [boardId, cardId] = e.dataTransfer.getData(DRAG_TYPE).split("/");
    const card = cards[boardId]?.find((c) => c.id === cardId);
    if (card && card.due !== day) onReschedule(card, day);
  };

  return (
    <div className="calendar-page">
      <header className="metrics-head">
        <h1>{t("calendar.title")}</h1>
      </header>
      <div className="calendar-layout">
        <aside className="today-panel">
          <Section title={t("calendar.overdue")} items={now.overdue} tone="overdue" showDate onOpen={onOpenCard} />
          <Section title={t("calendar.today")} items={now.today} tone="today" onOpen={onOpenCard} />
          <Section title={t("calendar.soon")} items={now.soon} showDate onOpen={onOpenCard} />
          {!now.overdue.length && !now.today.length && !now.soon.length && <p className="muted">{t("calendar.nothingUrgent")}</p>}
        </aside>

        <section className="month">
          <div className="month-nav">
            <button className="icon-btn" onClick={() => setMonth(addMonths(year, month, -1))} title={t("calendar.previous")}>
              ‹
            </button>
            <h2>{monthName}</h2>
            <button className="icon-btn" onClick={() => setMonth(addMonths(year, month, 1))} title={t("calendar.next")}>
              ›
            </button>
            <button className="btn-ghost small" onClick={() => setMonth([new Date().getFullYear(), new Date().getMonth()])}>
              {t("calendar.thisMonth")}
            </button>
            <span className="muted month-hint">{t("calendar.dragHint")}</span>
          </div>
          <div className="month-grid">
            {weekdays.map((w) => (
              <div key={w} className="weekday">
                {w}
              </div>
            ))}
            {weeks.flat().map((day) => {
              const items = days.get(day) ?? [];
              const classes = [
                "day",
                day.startsWith(monthPrefix) ? "" : "other-month",
                day === today ? "is-today" : "",
                day < today ? "past" : "",
                over === day ? "drop-over" : "",
              ];
              return (
                <div
                  key={day}
                  className={classes.filter(Boolean).join(" ")}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (over !== day) setOver(day);
                  }}
                  onDragLeave={() => setOver((o) => (o === day ? null : o))}
                  onDrop={(e) => drop(e, day)}
                >
                  <span className="day-number">{Number(day.slice(8))}</span>
                  <div className="day-cards">
                    {items.map((d) => (
                      <button
                        key={d.card.id}
                        className={`day-card ${d.due < today ? "late" : ""}`}
                        style={cardColor(d.board, d.card) ? ({ "--card-color": cardColor(d.board, d.card) } as React.CSSProperties) : undefined}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, `${d.board.id}/${d.card.id}`);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => onOpenCard(d.board.id, d.card.id)}
                        // The cell is narrow: the title alone; the short id and the board in the tooltip.
                        title={[refOf(d.board, d.card), d.card.title, d.board.name].filter(Boolean).join("\n")}
                      >
                        {d.card.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Section({ title, items, tone, showDate, onOpen }: { title: string; items: DueCard[]; tone?: "overdue" | "today"; showDate?: boolean; onOpen: Props["onOpenCard"] }) {
  if (!items.length) return null;
  return (
    <section className={`today-section ${tone ?? ""}`}>
      <h2>
        {title} <span className="count">{items.length}</span>
      </h2>
      <ul>
        {items.map(({ card, board, due }) => (
          <li key={card.id} onClick={() => onOpen(board.id, card.id)}>
            <span className="today-title">
              {refOf(board, card) && <span className="card-ref">{refOf(board, card)}</span>}
              {card.title}
            </span>
            <span className="muted today-meta">
              {board.name}
              {showDate ? ` · ${formatDue(due)}` : ""}
              {tone === "overdue" ? ` · ${tn("calendar.daysLate", daysBetween(due, toISODate(new Date())))}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
