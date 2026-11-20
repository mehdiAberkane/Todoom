import { useEffect, useState } from "react";
import type { AgentStatus, Card } from "../types";
import { formatDateTime } from "../lib/utils";
import { t } from "../lib/i18n";

/** A status not refreshed for this long means the agent stopped without saying so. */
export function isStale(s: AgentStatus, now = Date.now()): boolean {
  const limit = Math.max(3 * (s.pollSeconds ?? 30) * 1000, 3 * 60_000);
  return s.state !== "stopped" && now - Date.parse(s.heartbeat) > limit;
}

/** The agents watching this board, as written in boards/<id>/agents/*.json. */
export function AgentStatusChips({ agents, cardById, refOf }: { agents: AgentStatus[]; cardById: Map<string, Card>; refOf: (c: Card) => string | null }) {
  // Re-checked every half minute, so a silent agent turns "stopped?" on its own.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {agents.map((a) => {
        const stale = isStale(a, now);
        const card = a.card ? cardById.get(a.card.id) : undefined;
        const what = stale
          ? t("agent.silent")
          : a.state === "working"
            ? t("agent.working", { card: (card && refOf(card)) ?? a.card?.title ?? "?" })
            : a.state === "stopped"
              ? t("agent.stopped")
              : t("agent.idle");
        const state = stale ? "silent" : a.state;
        return (
          <span
            key={`${a.host}-${a.agent}`}
            className={`agent-chip agent-${state}`}
            title={t("agent.title", {
              host: a.host,
              since: formatDateTime(a.since),
              heartbeat: formatDateTime(a.heartbeat),
              card: a.card?.title ?? "—",
            })}
          >
            🤖 {what}
          </span>
        );
      })}
    </>
  );
}
