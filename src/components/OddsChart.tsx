import { oddsOf } from '../lib/format';
import { useSession } from '../lib/session';
import type { Outcome } from '../lib/types';

/**
 * Hand-written SVG — no charting library (§2, §14).
 *
 * Traders get a LOGARITHMIC PAYOUT axis (×1, ×2, ×4, ×10, ×50), because that
 * is the quantity they are betting on. The game maker gets a linear
 * probability axis. The dotted lines are the Elo prior, shown only when the
 * market was seeded and the tournament allows traders to see it.
 */
export default function OddsChart({
  history, outcomes, current, prior, showPrior,
}: {
  history: number[][]; outcomes: Outcome[]; current: number[];
  prior: number[] | null; showPrior: boolean;
}) {
  const { adminView } = useSession();
  const series = [...history, current];
  if (series.length < 2) {
    return (
      <div className="empty">
        No trades yet — these are the opening odds.
      </div>
    );
  }

  const W = 680, H = 190, pad = { l: 38, r: 10, t: 10, b: 16 };
  const n = Math.max(series.length - 1, 1);
  const sx = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);

  // Trader axis: log payout, clamped at ×50 so one runaway line doesn't
  // flatten everything else into the floor.
  const LO = Math.log(1), HI = Math.log(50);
  const sy = (v: number) => {
    if (adminView) return pad.t + (1 - v) * (H - pad.t - pad.b);
    const o = Math.min(Math.max(oddsOf(v), 1), 50);
    return pad.t + ((Math.log(o) - LO) / (HI - LO)) * (H - pad.t - pad.b);
  };

  const ticks = adminView ? [0, 0.25, 0.5, 0.75, 1] : [1, 2, 4, 10, 50];

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((t) => {
          const y = adminView ? sy(t) : sy(1 / t);
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#3A3252" opacity=".55" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#8B84A3"
                fontFamily="IBM Plex Mono">
                {adminView ? (t * 100).toFixed(0) : '×' + t}
              </text>
            </g>
          );
        })}
        {outcomes.map((o, i) => (
          <g key={o.id}>
            {showPrior && prior && prior[i] !== undefined && (
              <line x1={pad.l} x2={W - pad.r} y1={sy(prior[i])} y2={sy(prior[i])}
                stroke={o.color} strokeDasharray="2 4" opacity=".6" />
            )}
            <path
              d={series.map((s, k) => `${k ? 'L' : 'M'} ${sx(k)} ${sy(s[i] ?? 0)}`).join(' ')}
              fill="none" stroke={o.color} strokeWidth="2" strokeLinejoin="round"
            />
            <circle cx={sx(series.length - 1)} cy={sy(series[series.length - 1][i] ?? 0)}
              r="3" fill={o.color} />
          </g>
        ))}
      </svg>
      <div className="legend">
        {outcomes.map((o) => (
          <span key={o.id}><i className="dot" style={{ background: o.color }} />{o.label}</span>
        ))}
        <span style={{ color: 'var(--faint)' }}>
          {adminView ? 'probability %' : 'payout multiple'}
          {showPrior && prior ? ' · dotted = Elo prior' : ''}
        </span>
      </div>
    </>
  );
}
