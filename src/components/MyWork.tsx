import { useMemo, useState } from "react";
import type { AppSettings, Board, Card, CardComment } from "../types";
import { prioritiesOf } from "../lib/priority";
import { openBlockers, type Located } from "../lib/links";
import { refOf } from "../lib/shortid";
import { t, tn } from "../lib/i18n";
import { CardBody } from "./CardTile";
import { projectSummaries, workColumns } from "../lib/myWorkView";
import { formatDuration } from "../lib/timeline";
import type { Review } from "../lib/reviews";

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
  reviews,
  onOpen,
}: {
  boards: Board[];
  cards: Record<string, Card[]>;
  settings: AppSettings;
  onSaveSettings: (s: AppSettings) => void;
  index: Map<string, Located>;
  comments: Record<string, CardComment[]>;
  /** Open PR/MR of each repository at the last look (see prWatcher), by "forge:host/path". */
  reviews: Record<string, Review[]>;
  onOpen: (boardId: string, cardId: string) => void;
}) {
  const chosen = myWorkColumns(settings);
  // Boards picked in the summary; none means all.
  const [only, setOnly] = useState<Set<string>>(new Set());
  const summaries = useMemo(() => projectSummaries(boards, cards, reviews), [boards, cards, reviews]);
  const columns = useMemo(() => workColumns(boards, cards, chosen, only), [boards, cards, chosen, only]);
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  const now = Date.now();

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
  // A click shows only that project (again: all); Ctrl + click adds or removes it.
  const pick = (id: string, add: boolean) =>
    setOnly((current) => {
      if (add) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return current.size === 1 && current.has(id) ? new Set() : new Set([id]);
    });

  return (
    <div className="my-work">
      <header className="my-work-head">
        <h1>{t("myWork.title")}</h1>
        <span className="board-stats">{tn("board.cards", total)}</span>
      </header>

      <section className="projects" aria-label={t("myWork.projects")}>
        <div className="projects-head">
          <h2>{t("myWork.projects")}</h2>
          <span className="hint">{t("myWork.projectsHint")}</span>
          {only.size > 0 && (
            <button className="btn-ghost small" onClick={() => setOnly(new Set())}>
              {t("myWork.all")}
            </button>
          )}
        </div>
        <div className="projects-grid">
          {summaries.map((p) => (
            <button
              key={p.board.id}
              className={`project-tile state-${p.state} ${only.has(p.board.id) ? "picked" : ""} ${only.size && !only.has(p.board.id) ? "dimmed" : ""}`}
              onClick={(e) => pick(p.board.id, e.ctrlKey || e.metaKey)}
              title={t("myWork.pickTitle")}
              aria-pressed={only.has(p.board.id)}
            >
              <span className="project-name">
                {p.board.name}
                {p.board.key && <span className="board-key">{p.board.key}</span>}
              </span>
              <span className={`project-state ${p.state}`}>{t(`myWork.state.${p.state}`)}</span>
              <span className="project-stats">
                {p.doing > 0 && <span>{t("myWork.doing", { n: p.doing })}</span>}
                {p.review > 0 && <span className="wait">{t("myWork.review", { n: p.review })}</span>}
                {p.failed > 0 && <span className="wait">{t("myWork.failed", { n: p.failed })}</span>}
                {!p.doing && !p.review && !p.failed && <span className="muted">{t("myWork.nothing")}</span>}
              </span>
              {p.board.repo && (
                <span className="project-prs">
                  {p.prs ? (
                    p.prs.open ? (
                      <>
                        {tn("myWork.prs", p.prs.open)}
                        {p.prs.failing > 0 && <span className="ci ci-failure" title={t("reviews.ci.failure")}> ✕{p.prs.failing}</span>}
                        {p.prs.running > 0 && <span className="ci ci-running" title={t("reviews.ci.running")}> ◌{p.prs.running}</span>}
                        {p.prs.passing > 0 && <span className="ci ci-success" title={t("reviews.ci.success")}> ✓{p.prs.passing}</span>}
                      </>
                    ) : (
                      t("myWork.noPr")
                    )
                  ) : (
                    <span className="muted">{t("myWork.prsUnknown")}</span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <div className="my-work-columns" title={t("myWork.columnsTitle")}>
        <span className="muted">{t("myWork.columns")}</span>
        {allNames.map((name) => (
          <button key={name} className={`filter-chip ${isChosen(name) ? "on" : ""}`} onClick={() => toggle(name)}>
            {name}
          </button>
        ))}
      </div>

      {total === 0 && <div className="empty-state">{t("myWork.empty")}</div>}

      <div className="my-work-row">
        {columns
          .filter((col) => col.items.length > 0)
          .map((col) => (
            <div key={col.name} className="column my-work-col">
              <header className="column-head">
                <span className="column-title">{col.name}</span>
                <span className="count">{col.items.length}</span>
              </header>
              <div className="card-list">
                {col.items.map(({ board, card }) => (
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
                    <div className="my-work-origin">
                      {board.name}
                      {card.updatedAt && <span> · {t("myWork.ago", { d: formatDuration(Math.max(0, now - Date.parse(card.updatedAt))) })}</span>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
