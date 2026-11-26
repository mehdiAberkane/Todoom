import { useMemo } from "react";
import type { Board } from "../types";
import type { Located } from "../lib/links";
import { dependencyGraph, type GraphNode } from "../lib/depGraph";
import { refOf } from "../lib/shortid";
import { t, tn } from "../lib/i18n";
import { Modal } from "./ui";

const W = 210;
const H = 50;
const GAP_X = 70;
const GAP_Y = 14;
const PAD = 16;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const label = (n: GraphNode) => refOf(n.board, n.card) ?? "";

/**
 * « Dépendances » of a board (TOD-73): the linked cards from left (to do first) to
 * right, colored by state, the ready ones outlined, what unblocks the most, the
 * longest chain left, the cycles. Drawn in SVG by hand; a click opens the card.
 */
export function DependencyGraph({ board, index, onOpen, onClose }: { board: Board; index: Map<string, Located>; onOpen: (boardId: string, cardId: string) => void; onClose: () => void }) {
  const graph = useMemo(() => dependencyGraph(board, index), [board, index]);
  const place = useMemo(() => {
    const rows = new Map<number, number>();
    const at = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
      const row = rows.get(n.layer) ?? 0;
      rows.set(n.layer, row + 1);
      at.set(n.card.id, { x: PAD + n.layer * (W + GAP_X), y: PAD + row * (H + GAP_Y) });
    }
    const layers = Math.max(0, ...graph.nodes.map((n) => n.layer)) + 1;
    const tallest = Math.max(0, ...rows.values());
    // Room under the cards for the edges going back (cycles).
    return { at, width: PAD * 2 + layers * W + (layers - 1) * GAP_X, height: PAD * 2 + tallest * H + Math.max(0, tallest - 1) * GAP_Y + (graph.cycles.length ? H : 0) };
  }, [graph]);

  const byId = new Map(graph.nodes.map((n) => [n.card.id, n]));
  const chainEdges = new Set(graph.longestChain.slice(1).map((id, i) => `${graph.longestChain[i]}>${id}`));
  const cycleIds = new Set(graph.cycles.flat());
  const ready = graph.nodes.filter((n) => n.ready);
  const most = [...graph.nodes].filter((n) => n.unblocks > 0).sort((a, b) => b.unblocks - a.unblocks)[0];
  const open = (n: GraphNode) => {
    onClose();
    onOpen(n.board.id, n.card.id);
  };

  return (
    <Modal onClose={onClose} className="graph-modal">
      <div className="modal-head">
        <h3>{t("graph.title", { name: board.name })}</h3>
        <button className="icon-btn" onClick={onClose} title={t("common.closeEsc")}>
          ✕
        </button>
      </div>
      {graph.nodes.length === 0 ? (
        <p className="muted">{t("graph.empty")}</p>
      ) : (
        <>
          <ul className="graph-facts">
            <li>
              <strong>{tn("graph.ready", ready.length)}</strong> {ready.map(label).filter(Boolean).join(", ")}
            </li>
            {most && (
              <li>
                <strong>{t("graph.most")}</strong> {label(most) || most.card.title} · {tn("graph.unblocks", most.unblocks)}
              </li>
            )}
            {graph.longestChain.length > 1 && (
              <li>
                <strong>{tn("graph.chain", graph.longestChain.length)}</strong> {graph.longestChain.map((id) => (byId.get(id) ? label(byId.get(id)!) : "?")).join(" → ")}
              </li>
            )}
            {graph.cycles.length > 0 && (
              <li className="graph-cycle-fact">
                <strong>{tn("graph.cycles", graph.cycles.length)}</strong> {graph.cycles.map((c) => c.map((id) => (byId.get(id) ? label(byId.get(id)!) : "?")).join(" ⇄ ")).join(" ; ")}
              </li>
            )}
          </ul>
          <div className="graph-legend">
            {(["todo", "doing", "blocked", "done"] as const).map((s) => (
              <span key={s} className={`graph-key graph-${s}`}>
                {t(`graph.state.${s}`)}
              </span>
            ))}
            <span className="graph-key graph-ready-key">{t("graph.readyKey")}</span>
          </div>
          <div className="graph-scroll">
            <svg width={place.width} height={place.height} role="img" aria-label={t("graph.title", { name: board.name })}>
              <defs>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrow" />
                </marker>
              </defs>
              {graph.edges.map((e) => {
                const a = place.at.get(e.from)!;
                const b = place.at.get(e.to)!;
                const x1 = a.x + W;
                const y1 = a.y + H / 2;
                const x2 = b.x;
                const y2 = b.y + H / 2;
                const bend = Math.max(40, Math.abs(x2 - x1) / 2);
                // Back to an earlier column (a cycle): round under the cards.
                const back = x2 <= x1;
                const low = Math.max(a.y, b.y) + H + GAP_Y;
                const d = back
                  ? `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x1 + 50} ${low}, ${x1} ${low} L ${x2} ${low} C ${x2 - 50} ${low}, ${x2 - 50} ${y2}, ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                const kind = cycleIds.has(e.from) && cycleIds.has(e.to) ? "cycle" : chainEdges.has(`${e.from}>${e.to}`) ? "chain" : "";
                return <path key={`${e.from}>${e.to}`} d={d} className={`graph-edge ${kind}`} markerEnd="url(#graph-arrow)" />;
              })}
              {graph.nodes.map((n) => {
                const { x, y } = place.at.get(n.card.id)!;
                const ref = label(n);
                return (
                  <g
                    key={n.card.id}
                    className={`graph-node graph-${n.state} ${n.ready ? "ready" : ""} ${n.inCycle ? "in-cycle" : ""} ${n.outside ? "outside" : ""}`}
                    transform={`translate(${x}, ${y})`}
                    onClick={() => open(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && open(n)}
                  >
                    <title>{`${ref} ${n.card.title}${n.outside ? ` (${n.board.name})` : ""}`}</title>
                    <rect width={W} height={H} rx={8} />
                    <text x={10} y={19} className="graph-ref">
                      {ref}
                      {n.outside ? ` · ${cut(n.board.name, 14)}` : ""}
                    </text>
                    {n.unblocks > 0 && (
                      <text x={W - 10} y={19} textAnchor="end" className="graph-badge">
                        {tn("graph.unblocksShort", n.unblocks)}
                      </text>
                    )}
                    <text x={10} y={38} className="graph-title">
                      {cut(n.card.title, 30)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </Modal>
  );
}
