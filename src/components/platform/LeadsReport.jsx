import { useTranslation } from 'react-i18next';
import { FileDown } from 'lucide-react';
import { LEAD_STAGES, LOSS_REASONS, STAGE_COLORS } from '../../config/platform';
import { reached, leadOpen, stageOverdue, followUpOverdue, tsMs } from './leadUtils';
import { btn } from './ui';

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);

// Enrollment follow-up report: funnel, conversion, response and journey
// times, loss reasons, sources, staff and seats.
export default function LeadsReport({ leads, settings, slaCfg, branchName }) {
  const { t } = useTranslation();
  const enrolled = leads.filter((l) => l.stage === 'ENROLLED');
  const lost = leads.filter((l) => l.sideStatus === 'LOST');
  const open = leads.filter(leadOpen);
  const overdue = open.filter((l) => stageOverdue(l, settings, slaCfg) || followUpOverdue(l));
  const firstResp = leads.filter((l) => l.firstResponseAt).map((l) => (tsMs(l.firstResponseAt) - tsMs(l.createdAt)) / 3600e3);
  const journey = enrolled.filter((l) => l.enrolledAt).map((l) => (tsMs(l.enrolledAt) - tsMs(l.createdAt)) / 86400e3);
  const funnel = LEAD_STAGES.map((s) => ({ s, n: leads.filter((l) => reached(l, s)).length }));
  const maxN = Math.max(1, funnel[0]?.n || 0);
  const lossRows = LOSS_REASONS.map((r) => [r, lost.filter((l) => l.sideReason === r).length]).filter(([, n]) => n);
  const group = (key) => {
    const m = {};
    leads.forEach((l) => {
      const k = key(l) || '—';
      m[k] = m[k] || { total: 0, enrolled: 0, lost: 0, overdue: 0 };
      m[k].total++;
      if (l.stage === 'ENROLLED') m[k].enrolled++;
      if (l.sideStatus === 'LOST') m[k].lost++;
      if (leadOpen(l) && (stageOverdue(l, settings, slaCfg) || followUpOverdue(l))) m[k].overdue++;
    });
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  };
  const bySource = group((l) => l.source);
  const byStaff = group((l) => l.assignedToName);
  const byBranch = group((l) => l.branch);

  // Seats: enrolled students per branch+grade vs capacity in settings.
  const seats = {};
  enrolled.forEach((l) => (l.students || []).forEach((s) => {
    const k = `${l.branch}|${s.grade}`;
    seats[k] = (seats[k] || 0) + 1;
  }));
  const capRows = Object.entries(settings.capacity || {}).flatMap(([b, grades]) => Object.entries(grades || {}).filter(([, c]) => Number(c) > 0).map(([g, c]) => [b, g, Number(c), seats[`${b}|${g}`] || 0]));

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leads.map((l) => ({
      [t('platform.code')]: l.code, [t('platform.leads.form.parentName')]: l.parentName, [t('platform.leads.form.phone')]: `0${String(l.phone).slice(3)}`,
      [t('platform.leads.form.students')]: (l.students || []).map((s) => `${s.name} ${s.grade}`).join('، '), [t('common.branch')]: branchName(l.branch),
      [t('platform.leads.form.source')]: t(`platform.leads.sources.${l.source}`, l.source), [t('platform.leads.stage')]: t(`platform.leads.stages.${l.stage}`),
      [t('platform.leads.sideTitle')]: l.sideStatus ? t(`platform.leads.side.${l.sideStatus}`) : '', [t('platform.leads.form.assignedTo')]: l.assignedToName || '',
      [t('platform.leads.nextFollowUp')]: l.nextFollowUp?.toDate ? l.nextFollowUp.toDate().toISOString().slice(0, 16).replace('T', ' ') : '',
      [t('platform.createdAt')]: l.createdAt?.toDate ? l.createdAt.toDate().toISOString().slice(0, 10) : '',
    }))), 'Leads');
    XLSX.writeFile(wb, 'leads.xlsx');
  };

  const th = 'text-start py-2 px-2 font-medium text-slate-500 text-xs';
  const td = 'py-2 px-2 tabular-nums';
  const table = (title, rows, label) => (
    <section className="border border-slate-100 rounded-2xl p-4">
      <h3 className="font-bold text-slate-800 mb-2">{title}</h3>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100"><th className={th}>{label}</th><th className={th}>{t('platform.leads.report.total')}</th><th className={th}>{t('platform.leads.stages.ENROLLED')}</th><th className={th}>{t('platform.leads.report.conversion')}</th><th className={th}>{t('platform.leads.side.LOST')}</th><th className={th}>{t('platform.leads.report.overdue')}</th></tr></thead>
        <tbody>{rows.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-50"><td className="py-2 px-2 text-slate-800">{k}</td><td className={td}>{v.total}</td><td className={`${td} text-emerald-700`}>{v.enrolled}</td><td className={td}>{pct(v.enrolled, v.total)}</td><td className={`${td} text-rose-600`}>{v.lost}</td><td className={`${td} text-amber-700`}>{v.overdue}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><button onClick={exportExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('platform.exportExcel')}</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          [t('platform.leads.report.total'), leads.length, ''],
          [t('platform.leads.stages.ENROLLED'), enrolled.length, 'text-emerald-700'],
          [t('platform.leads.report.conversion'), pct(enrolled.length, leads.length), 'text-emerald-700'],
          [t('platform.leads.report.firstResponse'), firstResp.length ? t('platform.hours', { n: avg(firstResp).toFixed(1) }) : '—', 'text-sky-700'],
          [t('platform.leads.report.journey'), journey.length ? t('platform.days', { n: avg(journey).toFixed(1) }) : '—', 'text-indigo-700'],
          [t('platform.leads.report.overdue'), overdue.length, 'text-rose-600'],
        ].map(([label, value, tone]) => (
          <div key={label} className="bg-white border border-slate-100 rounded-2xl p-4"><p className="text-xs text-slate-500">{label}</p><p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p></div>
        ))}
      </div>

      <section className="border border-slate-100 rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-3">{t('platform.leads.report.funnel')}</h3>
        <div className="space-y-1.5">
          {funnel.map(({ s, n }, i) => (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className="w-28 text-slate-600">{t(`platform.leads.stages.${s}`)}</span>
              <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${STAGE_COLORS[s]}`} style={{ width: `${(100 * n) / maxN}%` }} /></div>
              <span className="w-24 text-slate-700 tabular-nums">{n}{i > 0 && <span className="text-slate-400"> ({pct(n, funnel[i - 1].n)})</span>}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {table(t('platform.leads.report.bySource'), bySource.map(([k, v]) => [t(`platform.leads.sources.${k}`, k), v]), t('platform.leads.form.source'))}
        {table(t('platform.leads.report.byBranch'), byBranch.map(([k, v]) => [branchName(k), v]), t('common.branch'))}
        {table(t('platform.leads.report.byStaff'), byStaff, t('platform.leads.form.assignedTo'))}
        <section className="border border-slate-100 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-2">{t('platform.leads.report.lossReasons')}</h3>
          {lossRows.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <ul className="text-sm space-y-1">{lossRows.map(([r, n]) => <li key={r} className="flex justify-between border-b border-slate-50 py-1"><span>{t(`platform.leads.loss.${r}`)}</span><span>{n} ({pct(n, lost.length)})</span></li>)}</ul>
          )}
        </section>
      </div>

      {capRows.length > 0 && (
        <section className="border border-slate-100 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-2">{t('platform.leads.report.seats')}</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className={th}>{t('common.branch')}</th><th className={th}>{t('platform.grade')}</th><th className={th}>{t('platform.leads.report.capacity')}</th><th className={th}>{t('platform.leads.stages.ENROLLED')}</th><th className={th}>{t('platform.leads.report.remaining')}</th></tr></thead>
            <tbody>{capRows.map(([b, g, c, n]) => <tr key={`${b}${g}`} className="border-b border-slate-50"><td className="py-2 px-2">{branchName(b)}</td><td className={td} dir="ltr">{g}</td><td className={td}>{c}</td><td className={td}>{n}</td><td className={`${td} ${c - n <= 0 ? 'text-rose-600 font-bold' : ''}`}>{c - n}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
