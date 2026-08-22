import { oddsText, returnsLine, adminPercent } from '../lib/format';
import { useSession } from '../lib/session';
import type { Outcome } from '../lib/types';

/**
 * The signature element (§9).
 *
 * Four benches in a 2×2 grid where each cell's AREA is its probability, laid
 * out to match BP seating: Government left, Opposition right, Opening top,
 * Closing bottom. Outcomes arrive in the fixed BP order [OG, OO, CG, CO], so
 * the Gov column is 0 and 2 and the Opp column is 1 and 3.
 *
 * This is not decoration. The vertical split line IS the Gov-vs-Opp market and
 * the horizontal splits ARE the Opening-vs-Closing markets, so two derived
 * markets are readable off the geometry for free — rendered as labelled bars
 * underneath.
 *
 * Each basis is clamped to a 16% floor so labels stay readable. That makes the
 * areas slightly inaccurate at the extremes, which is the right trade: a cell
 * nobody can read is worse than one that is 4 points too big.
 */
const FLOOR_COL = 18;
const FLOOR_CELL = 16;

export default function Quadrant({
  outcomes, p, selected, onSelect, flash,
}: {
  outcomes: Outcome[]; p: number[]; selected: number;
  onSelect: (i: number) => void; flash?: number | null;
}) {
  const { adminView } = useSession();
  const pGov = p[0] + p[2];
  const pOpp = p[1] + p[3];
  const pOpen = p[0] + p[1];
  const pClose = p[2] + p[3];
  const clamp = (v: number, floor: number) => Math.max(v, floor);

  const cell = (i: number, basis: number) => {
    const o = outcomes[i];
    return (
      <button
        key={o.id}
        className={'cell' + (selected === i ? ' sel' : '') + (flash === i ? ' flash' : '')}
        style={{
          flex: `0 0 ${basis}%`,
          background: o.color,
          color: isDark(o.color) ? '#F2F8FB' : '#1B1206',
        }}
        onClick={() => onSelect(i)}
      >
        <span>
          <span className="pos" style={{ display: 'block' }}>{o.label}</span>
          <span className="team" style={{ display: 'block' }}>{o.sublabel ?? ''}</span>
        </span>
        <span>
          <span className="odds" style={{ display: 'block' }}>{oddsText(p[i])}</span>
          <span className="sub" style={{ display: 'block' }}>
            {returnsLine(p[i])}{adminView ? ' · ' + adminPercent(p[i]) : ''}
          </span>
        </span>
      </button>
    );
  };

  return (
    <>
      <div className="room">
        <div className="col" style={{ flex: `0 0 ${clamp(pGov * 100, FLOOR_COL)}%` }}>
          {cell(0, clamp((p[0] / pGov) * 100, FLOOR_CELL))}
          {cell(2, clamp((p[2] / pGov) * 100, FLOOR_CELL))}
        </div>
        <div className="col" style={{ flex: `0 0 ${clamp(pOpp * 100, FLOOR_COL)}%` }}>
          {cell(1, clamp((p[1] / pOpp) * 100, FLOOR_CELL))}
          {cell(3, clamp((p[3] / pOpp) * 100, FLOOR_CELL))}
        </div>
      </div>

      <div className="splits">
        <Split
          leftLabel="Government" rightLabel="Opposition"
          left={pGov} right={pOpp}
          leftColor="var(--gov)" rightColor="var(--opp)"
        />
        <Split
          leftLabel="Opening half" rightLabel="Closing half"
          left={pOpen} right={pClose}
          leftColor="#9E8FC4" rightColor="#5B4F7D"
        />
      </div>
      <div className="note">
        Cell size is how likely the room thinks that bench is. The split down the
        middle is the Gov-vs-Opp market; the splits across are Opening-vs-Closing.
      </div>
    </>
  );
}

function Split({
  leftLabel, rightLabel, left, right, leftColor, rightColor,
}: {
  leftLabel: string; rightLabel: string; left: number; right: number;
  leftColor: string; rightColor: string;
}) {
  return (
    <div className="split">
      <div className="lab"><span>{leftLabel}</span><span>{rightLabel}</span></div>
      <div className="bar">
        <i style={{ background: leftColor, flexBasis: `${left * 100}%` }} />
        <i style={{ background: rightColor, flexBasis: `${right * 100}%` }} />
      </div>
      <div className="val">
        <span>{oddsText(left)}</span><span>{oddsText(right)}</span>
      </div>
    </div>
  );
}

/** Pick readable text for an arbitrary outcome colour. */
function isDark(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}
