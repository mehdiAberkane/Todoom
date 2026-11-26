import { useMemo, useState } from "react";
import type { Card, LinkType } from "../types";
import { isFinished, LINK_TYPES, type Located } from "../lib/links";
import { refOf, refsIn } from "../lib/shortid";
import { createsCycle, dependsOnIn } from "../lib/depGraph";
import { t } from "../lib/i18n";

const MAX_RESULTS = 8;
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export interface LinkProps {
  /** Every card by id, on every board. */
  index: Map<string, Located>;
  onLink: (type: LinkType, target: Card) => void;
  onUnlink: (targetId: string) => void;
  onOpen: (boardId: string, cardId: string) => void;
}

/**
 * The card's links, grouped by kind, and a search to add one. Links are written
 * right away on both cards, outside the editor's draft, like the labels window.
 */
export function LinkSection({ card, index, onLink, onUnlink, onOpen }: LinkProps & { card: Card }) {
  const [type, setType] = useState<LinkType>("dependsOn");
  const [query, setQuery] = useState("");
  const self = index.get(card.id);

  const results = useMemo(() => {
    const q = plain(query.trim());
    if (!q) return [];
    const linked = new Set(card.links.map((l) => l.cardId));
    return [...index.values()]
      .filter(({ card: c, board }) => c.id !== card.id && !linked.has(c.id) && !c.archivedAt && !board.archivedAt)
      .filter(({ card: c, board }) => plain(c.title).includes(q) || c.id.startsWith(query.trim()) || plain(refOf(board, c) ?? "") === q)
      .sort((a, b) => Number(b.board.id === self?.board.id) - Number(a.board.id === self?.board.id))
      .slice(0, MAX_RESULTS);
  }, [query, index, card.id, card.links, self?.board.id]);

  // A link that would make two cards wait on each other is refused (TOD-73).
  const [refused, setRefused] = useState<string | null>(null);
  const link = (target: Card) => {
    if (createsCycle(card.id, type, target.id, dependsOnIn(index))) {
      const other = index.get(target.id);
      setRefused(t(type === "blocks" ? "links.cycleBlocks" : "links.cycle", { other: (other && refOf(other.board, other.card)) ?? target.title }));
      return;
    }
    setRefused(null);
    onLink(type, target);
    setQuery("");
  };

  return (
    <>
      <h4>{t("field.links")}</h4>
      {card.links.length > 0 && (
        <ul className="links">
          {LINK_TYPES.flatMap((kind) =>
            card.links
              .filter((l) => l.type === kind)
              .map((l) => {
                const target = index.get(l.cardId);
                const done = target && isFinished(target.card, target.board);
                return (
                  <li key={l.cardId} className={done ? "done" : ""}>
                    <span className="link-type">{t(`link.${kind}`)}</span>
                    {target ? (
                      <button
                        className="link-target"
                        disabled={!!target.board.archivedAt}
                        onClick={() => onOpen(target.board.id, target.card.id)}
                        title={target.card.title}
                      >
                        {refOf(target.board, target.card) && <span className="card-ref">{refOf(target.board, target.card)}</span>}
                        {target.card.title}
                      </button>
                    ) : (
                      <span className="link-target missing">{t("links.missing")}</span>
                    )}
                    {target && target.board.id !== self?.board.id && <span className="muted link-board">{target.board.name}</span>}
                    {target?.card.archivedAt ? (
                      <span className="muted">{t("links.archived")}</span>
                    ) : (
                      done && <span className="link-done">✓ {t("links.finished")}</span>
                    )}
                    <button className="icon-btn" onClick={() => onUnlink(l.cardId)} title={t("links.remove")}>
                      ✕
                    </button>
                  </li>
                );
              }),
          )}
        </ul>
      )}
      <div className="link-add">
        <select value={type} onChange={(e) => setType(e.target.value as LinkType)} aria-label={t("links.kind")}>
          {LINK_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`link.${k}`)}
            </option>
          ))}
        </select>
        <div className="link-search">
          <input
            placeholder={t("links.search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setRefused(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) link(results[0].card);
              // Escape clears the search before it closes the card.
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
          {query.trim() && (
            <ul className="link-results">
              {results.map(({ card: c, board }) => (
                <li key={c.id}>
                  <button onClick={() => link(c)}>
                    <span>
                      {refOf(board, c) && <span className="card-ref">{refOf(board, c)}</span>}
                      {c.title}
                    </span>
                    {board.id !== self?.board.id && <span className="muted">{board.name}</span>}
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="muted">{t("links.none")}</li>}
            </ul>
          )}
        </div>
      </div>
      {refused && <p className="link-refused">{refused}</p>}
    </>
  );
}

/** Ids such as SOL-42 written in the description, as links to those cards. */
export function Mentions({
  text,
  selfId,
  index,
  onOpen,
}: {
  text: string;
  selfId: string;
  index: Map<string, Located>;
  onOpen: (boardId: string, cardId: string) => void;
}) {
  const found = useMemo(() => {
    const refs = refsIn(text);
    if (!refs.length) return [];
    const byRef = new Map<string, Located>();
    for (const l of index.values()) {
      const ref = refOf(l.board, l.card);
      if (ref) byRef.set(ref, l);
    }
    return refs.map((r) => byRef.get(r)).filter((l): l is Located => !!l && l.card.id !== selfId);
  }, [text, index, selfId]);

  if (!found.length) return null;
  return (
    <div className="mentions">
      <span className="muted">{t("cardModal.mentions")}</span>
      {found.map(({ card, board }) => (
        <button key={card.id} className="link-target" disabled={!!board.archivedAt} onClick={() => onOpen(board.id, card.id)} title={card.title}>
          <span className="card-ref">{refOf(board, card)}</span>
          {card.title}
        </button>
      ))}
    </div>
  );
}
