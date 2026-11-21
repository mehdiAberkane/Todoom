import type { Board, Card } from "../types";
import { laneOf, lanesOf, type LaneMode } from "../lib/lanes";
import { prioritiesOf } from "../lib/priority";
import { refOf } from "../lib/shortid";
import { t } from "../lib/i18n";
import { CardBody } from "./CardTile";

/**
 * The board in swimlanes: one row per priority or label, the board's columns
 * across. No drag and drop here: moving a card to another lane would quietly
 * change its priority or labels; the editor and the normal view do that.
 */
export function LanesView({
  board,
  mode,
  lists,
  cardById,
  blockers,
  comments,
  selectedIds,
  onOpen,
  onSelect,
}: {
  board: Board;
  mode: Exclude<LaneMode, "">;
  /** Visible card ids per column, filters applied, in order. */
  lists: Record<string, string[]>;
  cardById: Map<string, Card>;
  blockers: Map<string, string[]>;
  comments: Record<string, unknown[]>;
  selectedIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onSelect: (id: string, range: boolean) => void;
}) {
  const priorities = prioritiesOf(board);
  const rows = lanesOf(board, mode)
    .map((lane) => ({
      lane,
      cells: board.columns.map((col) => (lists[col.id] ?? []).map((id) => cardById.get(id)!).filter((c) => c && laneOf(board, c, mode) === lane.id)),
    }))
    .filter((row) => row.cells.some((cell) => cell.length));

  return (
    <div className="lanes" title={t("lanes.dragHint")}>
      <div className="lanes-grid" style={{ gridTemplateColumns: board.columns.map((c) => (c.collapsed ? "44px" : "minmax(250px, 1fr)")).join(" ") }}>
        {board.columns.map((col) => (
          <div key={col.id} className={`lane-col-head ${col.collapsed ? "collapsed" : ""}`} title={col.name}>
            {col.collapsed ? "…" : col.name}
          </div>
        ))}
        {rows.map(({ lane, cells }) => (
          <div key={lane.id || "none"} className="lane" style={{ gridColumn: `1 / span ${board.columns.length}` }}>
            <div className="lane-head" style={lane.color ? ({ "--lane": lane.color } as React.CSSProperties) : undefined}>
              {lane.name ?? (mode === "priority" ? t("lanes.noPriority") : t("lanes.noLabel"))}
              <span className="count">{cells.reduce((n, c) => n + c.length, 0)}</span>
            </div>
            <div className="lane-row" style={{ gridTemplateColumns: board.columns.map((c) => (c.collapsed ? "44px" : "minmax(250px, 1fr)")).join(" ") }}>
              {cells.map((cards, i) =>
                board.columns[i].collapsed ? (
                  <div key={board.columns[i].id} className="lane-cell collapsed">
                    {cards.length || ""}
                  </div>
                ) : (
                  <div key={board.columns[i].id} className="lane-cell">
                    {cards.map((card) => (
                      <article
                        key={card.id}
                        className={`card ${selectedIds.has(card.id) ? "selected" : ""}`}
                        tabIndex={0}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) onSelect(card.id, false);
                          else if (e.shiftKey) onSelect(card.id, true);
                          else onOpen(card.id);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && onOpen(card.id)}
                      >
                        <CardBody
                          card={card}
                          cardRef={refOf(board, card)}
                          labels={board.labels}
                          priorities={priorities}
                          blockers={blockers.get(card.id)}
                          commentCount={comments[card.id]?.length ?? 0}
                        />
                      </article>
                    ))}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 && <div className="empty-state">{t("lanes.empty")}</div>}
    </div>
  );
}
