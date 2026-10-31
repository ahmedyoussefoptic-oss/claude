import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { BellRing, Loader2 } from 'lucide-react';
import { functions } from '../../config/firebase';
import { formatDuration } from '../../utils/duration';
import { ITEM_STATUS_BADGE } from '../../config/lostFound';

// Reports › المفقودات (numbers from lostFoundMetrics).
export default function LostFoundReport({ m, branches, categories, onOpen, canRemind, merged }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const remind = async () => {
    if (!window.confirm(t('lfReport.remindConfirm'))) return;
    setBusy(true);
    try {
      const { data } = await httpsCallable(functions, 'remindLostFoundBranches')({});
      setSent(t('lfReport.reminded', { reports: data.reports, people: data.people }));
    } catch (err) {
      setSent(err.message);
    } finally {
      setBusy(false);
    }
  };
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || id || '—';
  const dur = (v) => (v == null ? '—' : formatDuration(v, t));
  const th = 'py-2 text-start text-xs font-medium text-slate-500';
  const box = (value, label, color = 'text-slate-900') => (
    <div className="rounded-xl border border-slate-200 p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
  const groupTable = (title, rows, nameOf) => (
    <div>
      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      <table className="w-full text-sm border-collapse">
        <thead><tr className="border-b border-slate-200"><th className={th}>{title}</th><th className={th}>{t('lfReport.total')}</th><th className={th}>{t('lfReport.returned')}</th><th className={th}>{t('lfReport.open')}</th><th className={th}>{t('lfReport.returnRate')}</th><th className={th}>{t('lfReport.avgReturn')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-50">
              <td className="py-2 text-slate-800 font-medium">{nameOf(r.key)}</td><td className="py-2 tabular-nums">{r.total}</td><td className="py-2 tabular-nums text-emerald-700">{r.returned}</td>
              <td className={`py-2 tabular-nums ${r.open ? 'text-amber-700' : ''}`}>{r.open}</td><td className="py-2 tabular-nums">{r.returnRate}%</td><td className="py-2">{dur(r.avgReturn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={`space-y-8 ${merged ? 'pt-8 border-t-4 border-sky-100' : ''}`}>
      {merged && <h2 className="text-lg font-bold text-sky-800">{t('reports.types.LOST_FOUND')}</h2>}
      {canRemind && m.byStatus.find((s) => s.status === 'UNCLAIMED')?.count > 0 && (
        <div className="no-print flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <button disabled={busy} onClick={remind} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}{t('lfReport.remindBranches')}
          </button>
          <span className="text-xs text-amber-900">{sent || t('lfReport.remindHint')}</span>
        </div>
      )}
      <div>
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.generalSummary')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {box(m.total, t('lfReport.total'))}
          {box(`${m.lost} / ${m.found}`, t('lfReport.lostFound'))}
          {box(m.returned, t('lfReport.returned'), 'text-emerald-600')}
          {box(`${m.returnRate}%`, t('lfReport.returnRate'), 'text-emerald-600')}
          {box(m.open, t('lfReport.open'), 'text-amber-600')}
          {box(m.notAcknowledged, t('lfReport.notAcknowledged'), m.notAcknowledged ? 'text-rose-600' : 'text-slate-900')}
          {box(m.closed, t('lfReport.closed'), 'text-slate-500')}
          {box(dur(m.avgReturn), t('lfReport.avgReturn'))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('lfReport.stepTimes')}</h3>
          <table className="w-full text-sm border-collapse"><tbody>
            {[['avgAck', m.avgAck], ['avgFound', m.avgFound], ['avgReturn', m.avgReturn]].map(([k, v]) => (
              <tr key={k} className="border-b border-slate-50"><td className="py-2 text-slate-700">{t(`lfReport.${k}`)}</td><td className="py-2 font-medium">{dur(v)}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('lfReport.byStatus')}</h3>
          <table className="w-full text-sm border-collapse"><tbody>
            {m.byStatus.map((s) => (
              <tr key={s.status} className="border-b border-slate-50">
                <td className="py-2"><span className={`px-2 py-0.5 rounded-md text-xs border ${ITEM_STATUS_BADGE[s.status] || ''}`}>{t(`statuses.lostFound.${s.status}`)}</span></td>
                <td className="py-2 tabular-nums">{s.count}</td><td className="py-2 text-slate-500 tabular-nums">{m.total ? Math.round((s.count / m.total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>

      {groupTable(t('common.branch'), m.byBranch, branchName)}
      {groupTable(t('lfReport.category'), m.byCategory, categoryName)}

      {m.byStaff.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('lfReport.byStaff')}</h3>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b border-slate-200"><th className={th}>{t('lfReport.staff')}</th><th className={th}>{t('lfReport.acknowledged')}</th><th className={th}>{t('lfReport.foundCol')}</th><th className={th}>{t('lfReport.returned')}</th></tr></thead>
            <tbody>{m.byStaff.map((s) => <tr key={s.name} className="border-b border-slate-50"><td className="py-2 font-medium text-slate-800">{s.name}</td><td className="py-2 tabular-nums">{s.acknowledged}</td><td className="py-2 tabular-nums">{s.found}</td><td className="py-2 tabular-nums">{s.returned}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {m.openList.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('lfReport.openList')}</h3>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b border-slate-200"><th className={th}>{t('lfReport.code')}</th><th className={th}>{t('lfReport.item')}</th><th className={th}>{t('common.branch')}</th><th className={th}>{t('lfReport.status')}</th><th className={th}>{t('lfReport.age')}</th><th className={th}>{t('lfReport.assignees')}</th></tr></thead>
            <tbody>
              {m.openList.map((i) => (
                <tr key={i.id} onClick={() => onOpen?.(i)} className="border-b border-slate-50 cursor-pointer hover:bg-slate-50">
                  <td className="py-2 font-mono text-xs" dir="ltr">{i.itemCode}</td>
                  <td className="py-2 text-slate-800">{i.itemName}{i.studentName ? <span className="text-xs text-slate-500"> — {i.studentName}</span> : null}</td>
                  <td className="py-2">{branchName(i.branch)}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded-md text-xs border ${ITEM_STATUS_BADGE[i.status] || ''}`}>{t(`statuses.lostFound.${i.status}`)}</span></td>
                  <td className="py-2">{dur(m.ageMs(i))}</td>
                  <td className="py-2 text-xs text-slate-600">{(i.assignedToNames || []).join('، ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
