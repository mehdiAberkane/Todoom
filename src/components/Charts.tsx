// Small hand-written charts for the metrics page: a donut, weekly bars and
// horizontal bars. Colors come from the --series-* tokens (a palette checked for
// colorblind readers on the app's dark surface); text stays in text colors.
import { useState, type ReactNode } from "react";

/** Categorical slots, in fixed order: an entity keeps its slot, never its rank. */
export const SERIES = 8;
export const seriesColor = (i: number) => `var(--series-${(i % SERIES) + 1})`;

interface Tip {
  x: number;
  y: number;
  text: ReactNode;
  /** In the right half of the chart: shown on the left of the pointer, so it isn't cut off. */
  flip: boolean;
}

/** A tooltip that follows the pointer inside a chart's box. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, text: ReactNode) => {
    const box = (e.currentTarget as Element).closest(".chart")!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text, flip: e.clientX - box.left > box.width / 2 });
  };
  const node = tip && (
    <div className={`chart-tip ${tip.flip ? "flip" : ""}`} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
  return { show, hide: () => setTip(null), node };
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Index of the categorical slot: follows the entity (a column's position), not the rank. */
  slot: number;
}

/** A donut with its legend: few slices (a board's columns), each named with its count. */
export function Donut({ slices, total, caption }: { slices: Slice[]; total: number; caption: string }) {
  const { show, hide, node } = useTip();
  const R = 80;
  const r = 52;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 0.025 : 0;
  let angle = -Math.PI / 2;
  const point = (rad: number, a: number) => `${100 + rad * Math.cos(a)} ${100 + rad * Math.sin(a)}`;
  return (
    <div className="chart donut-chart">
      <svg viewBox="0 0 200 200" role="img" aria-label={caption}>
        {total === 0 && <circle cx="100" cy="100" r={(R + r) / 2} fill="none" stroke="var(--border)" strokeWidth={R - r} />}
        {slices.map((s) => {
          if (!s.value) return null;
          const sweep = (s.value / total) * Math.PI * 2;
          const a0 = angle + gap / 2;
          const a1 = angle + sweep - gap / 2;
          angle += sweep;
          const pct = Math.round((s.value / total) * 100);
          const hover = (e: React.MouseEvent) => show(e, <><b>{s.label}</b> : {s.value} ({pct} %)</>);
          if (sweep >= Math.PI * 2 - 0.001)
            return <circle key={s.key} cx="100" cy="100" r={(R + r) / 2} fill="none" stroke={seriesColor(s.slot)} strokeWidth={R - r} onMouseMove={hover} onMouseLeave={hide} />;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M ${point(R, a0)} A ${R} ${R} 0 ${large} 1 ${point(R, a1)} L ${point(r, a1)} A ${r} ${r} 0 ${large} 0 ${point(r, a0)} Z`;
          return <path key={s.key} d={d} fill={seriesColor(s.slot)} onMouseMove={hover} onMouseLeave={hide} />;
        })}
        <text x="100" y="98" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="100" y="118" textAnchor="middle" className="donut-caption">
          {caption}
        </text>
      </svg>
      <ul className="chart-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: seriesColor(s.slot) }} />
            <span className="legend-name">{s.label}</span>
            <span className="legend-value">{s.value}</span>
          </li>
        ))}
      </ul>
      {node}
    </div>
  );
}

/** One bar per week, oldest on the left; the label under each bar is the week's Monday. */
export function WeekBars({ weeks, label, tip }: { weeks: { week: string; count: number }[]; label: (week: string) => string; tip: (week: string, n: number) => string }) {
  const { show, hide, node } = useTip();
  const W = 320;
  const H = 150;
  const top = 16;
  const base = H - 22;
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const step = W / Math.max(1, weeks.length);
  const bar = Math.min(26, step - 10);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={weeks.map((w) => tip(w.week, w.count)).join(", ")}>
        <line x1="0" x2={W} y1={top} y2={top} className="chart-grid" />
        <text x="2" y={top - 4} className="chart-axis">
          {max}
        </text>
        {weeks.map((w, i) => {
          const h = ((base - top) * w.count) / max;
          const x = i * step + (step - bar) / 2;
          return (
            <g key={w.week} onMouseMove={(e) => show(e, tip(w.week, w.count))} onMouseLeave={hide}>
              {/* Hit area: the whole column, taller than the bar. */}
              <rect x={i * step} y={top} width={step} height={base - top} fill="transparent" />
              {w.count > 0 && <path d={roundedTop(x, base - h, bar, h, 4)} fill={seriesColor(0)} />}
              <text x={x + bar / 2} y={H - 6} textAnchor="middle" className="chart-axis">
                {label(w.week)}
              </text>
            </g>
          );
        })}
        <line x1="0" x2={W} y1={base} y2={base} className="chart-baseline" />
      </svg>
      {node}
    </div>
  );
}

/** A bar with its top corners rounded, standing on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, h, w / 2);
  return `M ${x} ${y + h} V ${y + k} Q ${x} ${y} ${x + k} ${y} H ${x + w - k} Q ${x + w} ${y} ${x + w} ${y + k} V ${y + h} Z`;
}

export interface Row {
  key: string;
  label: ReactNode;
  value: number;
  /** What is written at the end of the bar. */
  text: string;
  tip?: string;
  onClick?: () => void;
}

/** Horizontal bars, one measure: a name, a bar from zero, the value written after it. */
export function HBars({ rows }: { rows: Row[] }) {
  const { show, hide, node } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="chart hbars">
      {rows.map((r) => (
        <div
          key={r.key}
          className={`hbar-row ${r.onClick ? "clickable" : ""}`}
          onClick={r.onClick}
          onMouseMove={r.tip ? (e) => show(e, r.tip) : undefined}
          onMouseLeave={hide}
        >
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            {r.value > 0 && <span className="hbar-fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: seriesColor(0) }} />}
          </span>
          <span className="hbar-value">{r.text}</span>
        </div>
      ))}
      {node}
    </div>
  );
}
