import { useMemo, useState } from "react";
import type { Board, Card, CardComment } from "../types";
import { searchCards } from "../lib/search";
import { refOf } from "../lib/shortid";
import { t } from "../lib/i18n";
import { Modal } from "./ui";

/** Search window over every board; Enter or a click opens the card in its board. */
export function GlobalSearch({
  boards,
  cards,
  comments,
  onOpen,
  onClose,
}: {
  boards: Board[];
  cards: Record<string, Card[]>;
  comments: Record<string, CardComment[]>;
  onOpen: (boardId: string, cardId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => searchCards(query, boards, cards, comments), [query, boards, cards, comments]);

  const open = (i: number) => {
    const r = results[i];
    // A trashed board is hidden: its cards can be found but not opened until it is restored.
    if (!r || r.board.archivedAt) return;
    onOpen(r.board.id, r.card.id);
    onClose();
  };

  return (
    <Modal onClose={onClose} className="search-modal">
      <input
        className="search-input"
        autoFocus
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setSelected((s) => Math.min(s + 1, results.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setSelected((s) => Math.max(s - 1, 0)));
          else if (e.key === "Enter") open(selected);
        }}
      />
      {query.trim() && (
        <ul className="search-results">
          {results.map((r, i) => {
            const column = r.board.columns.find((c) => c.id === r.card.columnId)?.name;
            const where = r.board.archivedAt ? t("search.trashedBoard") : r.card.archivedAt ? t("search.archived") : column;
            return (
              <li key={r.card.id}>
                <button
                  className={`search-result ${i === selected ? "selected" : ""} ${r.card.archivedAt || r.board.archivedAt ? "off" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => open(i)}
                  disabled={!!r.board.archivedAt}
                >
                  <span className="search-title">
                    {refOf(r.board, r.card) && <span className="card-ref">{refOf(r.board, r.card)}</span>}
                    {r.card.title}
                  </span>
                  <span className="search-where muted">
                    {r.board.name}
                    {where && ` · ${where}`}
                  </span>
                  {r.field !== "title" && r.field !== "ref" && (
                    <span className="search-snippet muted">
                      {t(`search.in.${r.field}`)} : {r.snippet}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="muted search-empty">{t("search.none")}</li>}
        </ul>
      )}
      <div className="search-hint muted">{t("search.hint")}</div>
    </Modal>
  );
}
