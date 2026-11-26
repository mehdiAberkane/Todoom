import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { t } from "../lib/i18n";
import { isTauri } from "../lib/backend";
import { PR_ACK, PR_NOTICES, PR_OPEN, PR_READY } from "../lib/prWatcher";
import type { PrNotice } from "../lib/reviewWatch";

const SHOW_MS = 8_000;

/**
 * The PR/MR popup window, in the bottom right corner of the screen: the notices
 * the main window sends, each for 8 seconds (longer while the mouse is over
 * them). A click opens the PR/MR in the browser. The window sizes itself to its
 * notices and hides when none is left.
 */
export function PrPopupWindow({ demo }: { demo?: PrNotice[] }) {
  const [notices, setNotices] = useState<(PrNotice & { until: number })[]>(() => (demo ?? []).map((n) => ({ ...n, until: Infinity })));
  const hovered = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return;
    const off = listen<PrNotice[]>(PR_NOTICES, (e) => {
      setNotices((current) => {
        const known = new Set(current.map((n) => n.id));
        const fresh = e.payload.filter((n) => !known.has(n.id)).map((n) => ({ ...n, until: Date.now() + SHOW_MS }));
        return [...current, ...fresh];
      });
      emitTo("main", PR_ACK, e.payload.map((n) => n.id)).catch(() => {});
    });
    emitTo("main", PR_READY).catch(() => {});
    return () => {
      off.then((f) => f());
    };
  }, []);

  // Old ones go, unless the mouse is over the popup.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (hovered.current) return;
      setNotices((current) => {
        const kept = current.filter((n) => n.until > Date.now());
        return kept.length === current.length ? current : kept;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // The window follows its content: sized and placed by the app, hidden when empty.
  useLayoutEffect(() => {
    if (!isTauri) return;
    const height = notices.length ? Math.ceil(root.current?.getBoundingClientRect().height ?? 0) : 0;
    invoke("pr_popup_layout", { height }).catch(() => {});
  }, [notices]);

  const dismiss = (id: string) => setNotices((current) => current.filter((n) => n.id !== id));
  const open = (n: PrNotice) => {
    if (n.url && isTauri) emitTo("main", PR_OPEN, n.url).catch(() => {});
    dismiss(n.id);
  };

  return (
    <div
      ref={root}
      className="pr-popup"
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => {
        hovered.current = false;
        // Left: the remaining ones get a few seconds again.
        setNotices((current) => current.map((n) => ({ ...n, until: Math.max(n.until, Date.now() + 3_000) })));
      }}
    >
      {notices.map((n) =>
        n.kind === "more" ? (
          <div key={n.id} className="pr-notice pr-more">
            <span>{t("prPopup.more", { count: n.count ?? 0 })}</span>
            <button className="pr-close" onClick={() => dismiss(n.id)} title={t("prPopup.close")}>
              ✕
            </button>
          </div>
        ) : (
          <div key={n.id} className={`pr-notice pr-${n.kind}`} role="button" tabIndex={0} onClick={() => open(n)} title={t("prPopup.open")}>
            <div className="pr-notice-head">
              <span className="pr-kind">{n.kind.startsWith("release") ? "🏷" : "⑂"} {t(`prPopup.${n.kind}`)}</span>
              <span className="pr-repo">{n.repo}</span>
              <button
                className="pr-close"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(n.id);
                }}
                title={t("prPopup.close")}
              >
                ✕
              </button>
            </div>
            <div className="pr-notice-title">
              <span className="pr-number">{n.number}</span> {n.title}
            </div>
            {(n.author || n.card) && (
              <div className="pr-notice-meta">
                {n.author}
                {n.card && <span className="pr-card"> · {n.card}</span>}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
