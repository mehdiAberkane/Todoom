import { useMemo } from "react";
import type { Board, Card, HistoryEvent } from "../types";
import { mergedHistory } from "../lib/activity";
import { boardMetrics, columnAverages, combined, mean, median, oldest, type OpenCard } from "../lib/metrics";
import { formatDuration } from "../lib/timeline";
import { refOf } from "../lib/shortid";
import { formatDue } from "../lib/utils";
import { t, tn } from "../lib/i18n";
import { Donut, HBars, WeekBars } from "./Charts";

interface Props {
  boards: Board[];
  cards: Record<string, Card[]>;
  history: Record<string, Record<string, HistoryEvent[]>>;
  /** "all", or the id of one board. */
  scope: string;
  onScope: (scope: string) => void;
  onOpenCard: (boardId: string, cardId: string) => void;
}

/** Figures for one board, or for every board: what is open, what got done, how long it takes. */
export function MetricsPage({ boards, cards, history, scope, onScope, onOpenCard }: Props) {
  const all = useMemo(
    () => boards.map((b) => boardMetrics(b, cards[b.id] ?? [], (id) => mergedHistory(history[id]))),
    [boards, cards, history],
  );
  const one = all.find((m) => m.board.id === scope);
  const sum = useMemo(() => combined(one ? [one] : all), [one, all]);
  const avg = mean(sum.cycleTimes);
  const mid = median(sum.cycleTimes);
  const thisWeek = sum.weekly[sum.weekly.length - 1]?.count ?? 0;
  const lastWeeks = sum.weekly.reduce((n, w) => n + w.count, 0);

  return (
    <div className="metrics">
      <header className="metrics-head">
        <h1>{t("metrics.title")}</h1>
        <select className="settings-select" value={one ? scope : "all"} onChange={(e) => onScope(e.target.value)}>
          <option value="all">{t("metrics.allBoards")}</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </header>

      <div className="stat-tiles">
        <Tile label={t("metrics.open")} value={String(sum.open)} />
        <Tile label={t("metrics.overdue")} value={String(sum.overdue)} warn={sum.overdue > 0} />
        <Tile label={t("metrics.doneThisWeek")} value={String(thisWeek)} sub={t("metrics.doneWeeks", { n: lastWeeks })} />
        <Tile
          label={t("metrics.cycle")}
          value={avg === null ? "—" : formatDuration(avg)}
          sub={mid === null ? t("metrics.cycleNone") : t("metrics.cycleSub", { median: formatDuration(mid), n: sum.cycleTimes.length })}
          title={t("metrics.cycleTitle")}
        />
      </div>

      <div className="metrics-grid">
        {one ? (
          <section className="metrics-panel">
            <h2>{t("metrics.byColumn")}</h2>
            <Donut
              caption={tn("metrics.cardsWord", one.byColumn.reduce((n, c) => n + c.count, 0))}
              total={one.byColumn.reduce((n, c) => n + c.count, 0)}
              slices={one.byColumn.map((c, i) => ({ key: c.column.id, label: c.column.name, value: c.count, slot: i }))}
            />
          </section>
        ) : (
          <section className="metrics-panel">
            <h2>{t("metrics.openByBoard")}</h2>
            <HBars
              rows={all.map((m) => ({
                key: m.board.id,
                label: m.board.name,
                value: m.open,
                text: String(m.open),
                tip: t("metrics.openByBoardTip", { board: m.board.name, n: m.open, overdue: m.overdue }),
                onClick: () => onScope(m.board.id),
              }))}
            />
          </section>
        )}

        <section className="metrics-panel">
          <h2>{t("metrics.weekly")}</h2>
          <WeekBars
            weeks={sum.weekly}
            label={(w) => formatDue(w).replace(/\.$/, "")}
            tip={(w, n) => t("metrics.weeklyTip", { week: formatDue(w), n })}
          />
        </section>

        {one && (
          <section className="metrics-panel">
            <h2>{t("metrics.columnTime")}</h2>
            <p className="hint">{t("metrics.columnTimeHint")}</p>
            {columnAverages(one.board, one.columnTime).length ? (
              <HBars
                rows={columnAverages(one.board, one.columnTime).map((c) => ({
                  key: c.column,
                  label: c.column,
                  value: c.ms,
                  text: formatDuration(c.ms),
                  tip: tn("metrics.columnTimeTip", c.cards, { column: c.column }),
                }))}
              />
            ) : (
              <p className="muted">{t("metrics.noHistory")}</p>
            )}
          </section>
        )}

        {!one && (
          <section className="metrics-panel wide">
            <h2>{t("metrics.perBoard")}</h2>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>{t("metrics.board")}</th>
                  <th>{t("metrics.open")}</th>
                  <th>{t("metrics.overdue")}</th>
                  <th>{t("metrics.done8")}</th>
                  <th>{t("metrics.cycle")}</th>
                </tr>
              </thead>
              <tbody>
                {all.map((m) => {
                  const a = mean(m.cycleTimes);
                  return (
                    <tr key={m.board.id} onClick={() => onScope(m.board.id)} className="clickable">
                      <td>{m.board.name}</td>
                      <td>{m.open}</td>
                      <td className={m.overdue ? "warn" : ""}>{m.overdue}</td>
                      <td>{m.weekly.reduce((n, w) => n + w.count, 0)}</td>
                      <td>{a === null ? "—" : formatDuration(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <section className="metrics-panel wide">
          <h2>{t("metrics.oldest")}</h2>
          <OldestList cards={oldest(sum.openCards)} showBoard={!one} onOpen={onOpenCard} />
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, warn, title }: { label: string; value: string; sub?: string; warn?: boolean; title?: string }) {
  return (
    <div className="stat-tile" title={title}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${warn ? "warn" : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function OldestList({ cards, showBoard, onOpen }: { cards: OpenCard[]; showBoard: boolean; onOpen: (boardId: string, cardId: string) => void }) {
  if (!cards.length) return <p className="muted">{t("metrics.nothingOpen")}</p>;
  const now = Date.now();
  return (
    <ul className="oldest-list">
      {cards.map(({ card, board, since }) => {
        const ref = refOf(board, card);
        const column = board.columns.find((c) => c.id === card.columnId)?.name;
        return (
          <li key={card.id} onClick={() => onOpen(board.id, card.id)}>
            {ref && <span className="card-ref">{ref}</span>}
            <span className="oldest-title">{card.title}</span>
            <span className="muted">
              {showBoard ? `${board.name} · ` : ""}
              {column}
            </span>
            <span className="oldest-age">{formatDuration(now - Date.parse(since))}</span>
          </li>
        );
      })}
    </ul>
  );
}
