import { useCallback, useEffect, useState } from "react";
import type { Board, Card } from "../types";
import { backend } from "../lib/backend";
import { t } from "../lib/i18n";
import { refOf } from "../lib/shortid";
import { openExternal } from "../lib/open";
import { cardOfReview, parseRepo, parseReviews, repoUrl, reviewError, type Review, type ReviewError } from "../lib/reviews";
import { formatDateTime } from "../lib/utils";

const REFRESH_MS = 60_000;

/**
 * The open pull requests / merge requests of the board's repository and their
 * CI, beside the columns. Read through gh or glab (already signed in on this
 * computer); refreshed every minute while the panel is open and visible.
 */
export function ReviewsPanel({ board, cards, onOpenCard, onEditRepo, onClose }: {
  board: Board;
  cards: Card[];
  onOpenCard: (id: string) => void;
  /** Opens the board's context page, where the repository is set. */
  onEditRepo: () => void;
  onClose: () => void;
}) {
  const repo = parseRepo(board.repo);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<ReviewError | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const key = repo ? `${repo.forge}:${repo.host}/${repo.path}` : "";

  const refresh = useCallback(async () => {
    const r = parseRepo(key ? board.repo : undefined);
    if (!r) return;
    setLoading(true);
    try {
      const output = await backend.listReviews(r.forge, r.host, r.path);
      setReviews(parseReviews(r.forge, output));
      setError(null);
    } catch (e) {
      setError(reviewError(e));
    } finally {
      setLoading(false);
      setCheckedAt(new Date().toISOString());
    }
    // board.repo is read through key, which changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setReviews(null);
    setError(null);
    if (!key) return;
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [key, refresh]);

  return (
    <aside className="reviews-panel" aria-label={t("reviews.title")}>
      <div className="reviews-head">
        <h3>{repo?.forge === "gitlab" ? t("reviews.titleGitlab") : t("reviews.title")}</h3>
        {repo && (
          <button className="icon-btn" onClick={refresh} disabled={loading} title={t("reviews.refresh")}>
            {loading ? "…" : "⟳"}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title={t("reviews.hide")}>
          ✕
        </button>
      </div>

      {!repo ? (
        <div className="reviews-empty">
          <p>{board.repo ? t("reviews.badRepo", { repo: board.repo }) : t("reviews.noRepo")}</p>
          <button className="btn-ghost small" onClick={onEditRepo}>
            {t("reviews.setRepo")}
          </button>
        </div>
      ) : (
        <>
          <button className="reviews-repo link-btn" onClick={() => openExternal(repoUrl(repo))} title={t("reviews.openRepo")}>
            {repo.host}/{repo.path}
          </button>
          {error && <ReviewErrorText error={error} />}
          {reviews && reviews.length === 0 && !error && <p className="muted reviews-empty">{t("reviews.none")}</p>}
          {reviews && reviews.length > 0 && (
            <ul className="reviews-list">
              {reviews.map((r) => {
                const card = cardOfReview(r, cards);
                const cardRef = card ? refOf(board, card) : null;
                return (
                  <li key={r.url || r.number} className="review">
                    <span className={`ci ci-${r.ci}`} title={t(`reviews.ci.${r.ci}`)}>
                      {CI_ICON[r.ci]}
                    </span>
                    <div className="review-main">
                      <button className="review-title link-btn" onClick={() => openExternal(r.url)} title={t("reviews.open")}>
                        <span className="review-number">{repo.forge === "gitlab" ? `!${r.number}` : `#${r.number}`}</span> {r.title}
                      </button>
                      <div className="review-meta">
                        {r.draft && <span className="review-draft">{t("reviews.draft")}</span>}
                        <span className="review-ci-text">{t(`reviews.ci.${r.ci}`)}</span>
                        {r.author && <span>· {r.author}</span>}
                        {card && (
                          <button className="link-btn review-card" onClick={() => onOpenCard(card.id)} title={card.title}>
                            · {cardRef ?? card.title}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {checkedAt && <p className="hint reviews-checked">{t("reviews.checkedAt", { date: formatDateTime(checkedAt) })}</p>}
        </>
      )}
    </aside>
  );
}

const CI_ICON = { running: "◌", success: "✓", failure: "✕", none: "·" } as const;

function ReviewErrorText({ error }: { error: ReviewError }) {
  const text =
    error.code === "missing"
      ? t("reviews.err.missing", { tool: error.tool })
      : error.code === "auth"
        ? t("reviews.err.auth", { tool: error.tool })
        : error.code === "failed"
          ? t("reviews.err.failed", { message: error.message })
          : t(`reviews.err.${error.code}`);
  return <p className="reviews-error">{text}</p>;
}
