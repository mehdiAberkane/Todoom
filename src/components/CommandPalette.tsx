import { useMemo, useState } from "react";
import type { Board, Card, CardComment } from "../types";
import { searchCards } from "../lib/search";
import { refOf } from "../lib/shortid";
import { SHORTCUTS } from "../lib/keys";
import { getLang, t } from "../lib/i18n";
import { Modal } from "./ui";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Ctrl + K: type to go to a board, open a card (by words or short id), or run
 * a command. ↑ ↓ to choose, Enter to run.
 */
export function CommandPalette({
  commands,
  boards,
  cards,
  comments,
  onOpenCard,
  onClose,
}: {
  commands: Command[];
  boards: Board[];
  cards: Record<string, Card[]>;
  comments: Record<string, CardComment[]>;
  onOpenCard: (boardId: string, cardId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const items = useMemo<Command[]>(() => {
    const q = plain(query.trim());
    const matching = commands.filter((c) => !q || plain(c.label).includes(q));
    if (!q) return matching;
    // Cards on the board (not archived, not in the trash) after the commands.
    const found = searchCards(query, boards.filter((b) => !b.archivedAt), cards, comments, 20)
      .filter((r) => !r.card.archivedAt)
      .slice(0, 8)
      .map((r) => ({
        id: `card:${r.card.id}`,
        label: `${refOf(r.board, r.card) ? `${refOf(r.board, r.card)} ` : ""}${r.card.title}`,
        hint: r.board.name,
        run: () => onOpenCard(r.board.id, r.card.id),
      }));
    return [...matching, ...found];
  }, [query, commands, boards, cards, comments, onOpenCard]);

  const run = (i: number) => {
    const item = items[i];
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <Modal onClose={onClose} className="search-modal palette">
      <input
        className="search-input"
        autoFocus
        placeholder={t("palette.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((s) => Math.min(s + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          }
          else if (e.key === "Enter") run(selected);
        }}
      />
      <ul className="search-results">
        {items.map((item, i) => (
          <li key={item.id}>
            <button className={`search-result ${i === selected ? "selected" : ""}`} onMouseEnter={() => setSelected(i)} onClick={() => run(i)}>
              <span className="search-title">{item.label}</span>
              {item.hint && <span className="search-where muted">{item.hint}</span>}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="muted search-empty">{t("palette.none")}</li>}
      </ul>
    </Modal>
  );
}

/** Key names as written on an English keyboard when the interface is in English. */
const keyNames = (keys: string) =>
  getLang() === "en" ? keys.replace("Maj", "Shift").replace("Entrée", "Enter").replace("Échap", "Esc").replace(/clic/g, "click") : keys;

/** ?: every keyboard shortcut. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="label-modal">
      <div className="modal-head">
        <h3>{t("keys.title")}</h3>
        <button className="icon-btn" onClick={onClose} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={keys}>
              <td>
                <kbd>{keyNames(keys)}</kbd>
              </td>
              <td>{t(what as Parameters<typeof t>[0])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
