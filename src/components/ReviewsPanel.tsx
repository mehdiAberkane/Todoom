import { useCallback, useEffect, useState } from "react";
import type { Board, Card } from "../types";
import { backend } from "../lib/backend";
import { t } from "../lib/i18n";
import { refOf } from "../lib/shortid";
import { openExternal } from "../lib/open";
import { cardOfReview, parseRepo, parseReviews, repoUrl, reviewError, type Repo, type Review, type ReviewError } from "../lib/reviews";
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
  const [merged, setMerged] = useState<Review[]>([]);
  const [error, setError] = useState<ReviewError | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const key = repo ? `${repo.forge}:${repo.host}/${repo.path}` : "";

  const refresh = useCallback(async () => {
    const r = parseRepo(key ? board.repo : undefined);
    if (!r) return;
    setLoading(true);
    try {
      // The open ones, and those merged in the last 24 hours: one gh or glab launched.
      const sets = parseReviews(r.forge, await backend.listReviews(r.forge, r.host, r.path));
      setReviews(sets.open);
      setMerged(sets.merged);
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
    setMerged([]);
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
          {error && (error.code === "unapproved" || error.code === "refused") ? (
            <div className="reviews-host">
              <p>
                <strong>{t(error.code === "unapproved" ? "reviews.host.ask" : "reviews.host.refused", { host: error.host })}</strong>
              </p>
              <p className="hint">{t("reviews.host.why", { host: error.host })}</p>
              <div className="reviews-host-actions">
                <button
                  className="btn-primary small"
                  onClick={() => backend.setForgeHost(error.host, true).then(refresh).catch(() => {})}
                >
                  {t("reviews.host.allow")}
                </button>
                {error.code === "unapproved" && (
                  <button className="btn-ghost small" onClick={() => backend.setForgeHost(error.host, false).then(refresh).catch(() => {})}>
                    {t("reviews.host.refuse")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            error && <ReviewErrorText error={error} />
          )}
          {reviews && reviews.length === 0 && !error && <p className="muted reviews-empty">{t("reviews.none")}</p>}
          {reviews && reviews.length > 0 && (
            <ul className="reviews-list">
              {reviews.map((r) => (
                <ReviewItem key={r.url || r.number} review={r} repo={repo} board={board} cards={cards} onOpenCard={onOpenCard} />
              ))}
            </ul>
          )}
          {merged.length > 0 && (
            <>
              <h4 className="reviews-sub">{t("reviews.merged")}</h4>
              <ul className="reviews-list merged">
                {merged.map((r) => (
                  <ReviewItem key={r.url || r.number} review={r} repo={repo} board={board} cards={cards} onOpenCard={onOpenCard} />
                ))}
              </ul>
            </>
          )}
          {checkedAt && <p className="hint reviews-checked">{t("reviews.checkedAt", { date: formatDateTime(checkedAt) })}</p>}
        </>
      )}
    </aside>
  );
}

const CI_ICON = { running: "◌", success: "✓", failure: "✕", none: "·" } as const;

/** One pull/merge request: CI, number and title (opens it), draft, author, its card. Merged: when instead of the CI. */
function ReviewItem({ review: r, repo, board, cards, onOpenCard }: { review: Review; repo: Repo; board: Board; cards: Card[]; onOpenCard: (id: string) => void }) {
  const card = cardOfReview(r, cards);
  const cardRef = card ? refOf(board, card) : null;
  return (
    <li className="review">
      {r.mergedAt ? (
        <span className="ci ci-merged" title={t("reviews.mergedAt", { date: formatDateTime(r.mergedAt) })}>
          ⑂
        </span>
      ) : (
        <span className={`ci ci-${r.ci}`} title={t(`reviews.ci.${r.ci}`)}>
          {CI_ICON[r.ci]}
        </span>
      )}
      <div className="review-main">
        <button className="review-title link-btn" onClick={() => openExternal(r.url)} title={t("reviews.open")}>
          <span className="review-number">{repo.forge === "gitlab" ? `!${r.number}` : `#${r.number}`}</span> {r.title}
        </button>
        <div className="review-meta">
          {r.draft && <span className="review-draft">{t("reviews.draft")}</span>}
          <span className="review-ci-text">{r.mergedAt ? t("reviews.mergedAt", { date: formatDateTime(r.mergedAt) }) : t(`reviews.ci.${r.ci}`)}</span>
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
}

function ReviewErrorText({ error }: { error: ReviewError }) {
  const text =
    error.code === "missing"
      ? t("reviews.err.missing", { tool: error.tool })
      : error.code === "auth"
        ? t("reviews.err.auth", { tool: error.tool })
        : error.code === "failed"
          ? t("reviews.err.failed", { message: error.message })
          : error.code === "unapproved" || error.code === "refused"
            ? t("reviews.host.refused", { host: error.host })
            : t(`reviews.err.${error.code}`);
  return <p className="reviews-error">{text}</p>;
}
