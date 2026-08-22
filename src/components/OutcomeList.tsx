import { oddsText, returnsLine, adminPercent } from '../lib/format';
import { useSession } from '../lib/session';
import type { Outcome } from '../lib/types';

/**
 * The default board for every market that is not a 4-way room call: a colour
 * swatch, label, sub-label, a proportional mini-bar and the odds.
 */
export default function OutcomeList({
  outcomes, p, selected, onSelect, flash,
}: {
  outcomes: Outcome[]; p: number[]; selected: number;
  onSelect: (i: number) => void; flash?: number | null;
}) {
  const { adminView } = useSession();
  const max = Math.max(...p, 1e-9);
  return (
    <div className="olist">
      {outcomes.map((o, i) => (
        <button
          key={o.id}
          className={'orow' + (i === selected ? ' sel' : '') + (flash === i ? ' flash' : '')}
          onClick={() => onSelect(i)}
        >
          <span className="sw" style={{ background: o.color }} />
          <span className="nm">
            {o.label}
            {o.sublabel && <small>{o.sublabel}</small>}
          </span>
          <span className="pb">
            <span className="mini-bar">
              <i style={{ width: `${(p[i] / max) * 100}%`, background: o.color }} />
            </span>
          </span>
          <span className="odwrap">
            <span className="od">{oddsText(p[i])}</span>
            <span className="ret">
              {adminView ? adminPercent(p[i]) : returnsLine(p[i])}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
