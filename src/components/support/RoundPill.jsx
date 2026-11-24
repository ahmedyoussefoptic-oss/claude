import { ROUND_STYLE, roundLabel } from '../../config/support';

// A student's Cycle tag («Cycle 1», «Cycle 2»).
export default function RoundPill({ n, className = '' }) {
  if (!n) return null;
  return <span dir="ltr" className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium border align-middle ${ROUND_STYLE[n] || 'bg-slate-50 text-slate-600 border-slate-200'} ${className}`}>{roundLabel(n)}</span>;
}
