import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BookOpenCheck, Loader2 } from 'lucide-react';
import { callSupport, STATUS_STYLE, TYPE_STYLE, attRate } from '../../config/support';
import { Pill } from '../platform/ui';

// «برامج الدعم» in the student record: each nomination, the parent's answer
// or pledge, the group and the attendance. Hidden when there are none (or
// the user can't see the section).
export default function StudentSupport({ studentId, className = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    callSupport('supportForStudent', { studentId }).then((r) => { if (alive) setItems(r.items || []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [studentId]);
  if (items && !items.length) return null;
  const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  return (
    <div className={className}>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><BookOpenCheck className="w-4 h-4 text-primary" />{t('support.student.title')}</p>
      {!items ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <div className="space-y-2">
          {items.map((x) => {
            const rate = attRate(x.att);
            return (
              <button key={x.cycleId} type="button" onClick={() => navigate(`/support-programs?openId=${x.cycleId}`)} className="w-full text-start border border-slate-100 rounded-lg p-2.5 text-sm hover:border-primary/40">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{x.cycle}</span>
                  <Pill className={TYPE_STYLE[x.type]}>{t(`support.types.${x.type}`)}</Pill>
                  <Pill className={STATUS_STYLE[x.status]}>{t(`support.status.${x.status}`)}</Pill>
                  {rate != null && <span className={`text-xs ${rate < 75 ? 'text-rose-700 font-bold' : 'text-emerald-700'}`}>{t('support.student.attendance', { rate, absent: x.att.A || 0 })}</span>}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {[x.subjects.join('، '), x.reason, x.group && `${t('support.col.group')}: ${x.group.name}${x.group.teacher ? ` (${x.group.teacher})` : ''}`].filter(Boolean).join(' · ')}
                </p>
                {x.consent && <p className="text-xs text-emerald-700 mt-0.5">✓ {t('support.student.consent', { name: x.consent.name, day: day(x.consent.at) })}</p>}
                {x.decline && <p className="text-xs text-rose-700 mt-0.5">✗ {t('support.student.decline', { name: x.decline.name, day: day(x.decline.at) })}{x.decline.reason ? ` — ${x.decline.reason}` : ''}</p>}
                {x.pledge && <p className="text-xs text-violet-700 mt-0.5">✍ {t('support.pledgeSigned', { name: x.pledge.name, day: day(x.pledge.at) })}</p>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
