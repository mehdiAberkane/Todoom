import { useMemo } from "react";
import type { AppSettings, Board, Card, CardComment } from "../types";
import { prioritiesOf } from "../lib/priority";
import { openBlockers, type Located } from "../lib/links";
import { refOf } from "../lib/shortid";
import { t, tn } from "../lib/i18n";
import { CardBody } from "./CardTile";

/** Columns shown when none were chosen: the usual "being worked on" ones, in French and English. */
export const DEFAULT_MY_WORK = ["En cours", "A verifier", "In progress", "To review"];

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Columns picked for the view, by name: case and accents don't matter, so "À vérifier" matches "A verifier". */
export function myWorkColumns(settings: AppSettings): string[] {
  return settings.myWorkColumns ?? DEFAULT_MY_WORK;
}

export interface MyWorkGroup {
  board: Board;
  columns: { name: string; cards: Card[] }[];
}

/** The cards of the chosen columns, board by board (in sidebar order), column by column (in board order). */
export function myWork(boards: Board[], cards: Record<string, Card[]>, chosen: string[]): MyWorkGroup[] {
  const wanted = new Set(chosen.map(plain));
  return boards
    .filter((b) => !b.archivedAt)
    .map((board) => ({
      board,
      columns: board.columns
        .filter((c) => wanted.has(plain(c.name)))
        .map((c) => ({
          name: c.name,
          cards: (cards[board.id] ?? []).filter((card) => card.columnId === c.id && !card.archivedAt).sort((a, b) => a.order - b.order),
        }))
        .filter((c) => c.cards.length > 0),
    }))
    .filter((g) => g.columns.length > 0);
}

export function MyWork({
  boards,
  cards,
  settings,
  onSaveSettings,
  index,
  comments,
  onOpen,
}: {
  boards: Board[];
  cards: Record<string, Card[]>;
  settings: AppSettings;
  onSaveSettings: (s: AppSettings) => void;
  index: Map<string, Located>;
  comments: Record<string, CardComment[]>;
  onOpen: (boardId: string, cardId: string) => void;
}) {
  const chosen = myWorkColumns(settings);
  const groups = useMemo(() => myWork(boards, cards, chosen), [boards, cards, chosen]);
  const total = groups.reduce((n, g) => n + g.columns.reduce((m, c) => m + c.cards.length, 0), 0);

  // Every column name used on a board, once, so any of them can be picked.
  const allNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of boards) if (!b.archivedAt) for (const c of b.columns) if (!seen.has(plain(c.name))) seen.set(plain(c.name), c.name);
    return [...seen.values()];
  }, [boards]);
  const isChosen = (name: string) => chosen.some((c) => plain(c) === plain(name));
  const toggle = (name: string) =>
    onSaveSettings({
      ...settings,
      myWorkColumns: isChosen(name) ? chosen.filter((c) => plain(c) !== plain(name)) : [...chosen, name],
    });

  return (
    <div className="my-work">
      <header className="my-work-head">
        <h1>{t("myWork.title")}</h1>
        <span className="board-stats">{tn("board.cards", total)}</span>
      </header>
      <div className="my-work-columns" title={t("myWork.columnsTitle")}>
        <span className="muted">{t("myWork.columns")}</span>
        {allNames.map((name) => (
          <button key={name} className={`filter-chip ${isChosen(name) ? "on" : ""}`} onClick={() => toggle(name)}>
            {name}
          </button>
        ))}
      </div>

      {groups.length === 0 && <div className="empty-state">{t("myWork.empty")}</div>}

      {groups.map(({ board, columns }) => (
        <section key={board.id} className="my-work-board">
          <h2>
            {board.name}
            {board.key && <span className="board-key">{board.key}</span>}
          </h2>
          <div className="my-work-row">
            {columns.map((col) => (
              <div key={col.name} className="column my-work-col">
                <header className="column-head">
                  <span className="column-title">{col.name}</span>
                  <span className="count">{col.cards.length}</span>
                </header>
                <div className="card-list">
                  {col.cards.map((card) => (
                    <article
                      key={card.id}
                      className="card"
                      tabIndex={0}
                      onClick={() => onOpen(board.id, card.id)}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(board.id, card.id)}
                    >
                      <CardBody
                        card={card}
                        cardRef={refOf(board, card)}
                        labels={board.labels}
                        priorities={prioritiesOf(board)}
                        blockers={openBlockers(card, index).map((b) => b.card.title)}
                        commentCount={comments[card.id]?.length ?? 0}
                      />
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
