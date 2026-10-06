import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Loader2, FileDown, Printer, Bus, Users as UsersIcon, Wallet, Star, ThumbsUp, Flag } from 'lucide-react';
import { functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { TRIP_STATUS_STYLES, TRIP_STAGES, TRIP_RATINGS } from '../../config/trips';

const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);
const fmtPct = (v) => (v == null ? '—' : `${v}%`);
const fmtAvg = (sum, count) => (count > 0 ? (sum / count).toFixed(1) : '—');

// Academic year: September 1 → August 31.
function academicYearRange(now = new Date()) {
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-09-01`, to: `${y + 1}-08-31` };
}

// Trips report (getTripsReport): participation, collection, satisfaction
// per trip, per branch and per grade, and decline reasons.
export default function TripsReport({ onOpenTrip }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [range, setRange] = useState(academicYearRange);
  const [branch, setBranch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'getTripsReport')({ ...range, branch })
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, branch]);

  const reload = (patch) => { setLoading(true); setRange((r) => ({ ...r, ...patch })); };
  const inputCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm';

  const trips = data?.trips || [];
  const active = trips.filter((r) => r.status !== 'CANCELLED');
  const sum = (field) => active.reduce((a, r) => a + (r[field] || 0), 0);
  const totals = {
    trips: active.length,
    completed: trips.filter((r) => r.status === 'COMPLETED').length,
    cancelled: trips.length - active.length,
    targeted: sum('targeted'), confirmed: sum('confirmed'), approved: sum('approved'), declined: sum('declined'), responses: sum('responses'),
    collected: sum('collected'), expected: sum('expected'), surveys: sum('surveys'), ratingSum: sum('ratingSum'), recommend: sum('recommend'),
  };
  const branchRows = Object.entries(data?.byBranch || {}).sort((a, b) => b[1].confirmed - a[1].confirmed);
  const gradeRows = TRIP_STAGES.filter((g) => data?.byGrade?.[g]?.targeted).map((g) => [g, data.byGrade[g]]);
  const reasons = Object.entries(data?.declineReasons || {}).sort((a, b) => b[1] - a[1]);
  const reasonTotal = reasons.reduce((a, [, n]) => a + n, 0);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trips.map((r) => ({
      [t('trips.report.trip')]: r.title, [t('trips.col.status')]: t(`trips.status.${r.status}`), [t('common.date')]: r.date,
      [t('trips.form.branches')]: r.branches.map(branchName).join('، '), [t('trips.form.grades')]: r.stages.join(', '),
      [t('trips.report.targeted')]: r.targeted, [t('trips.statResponses')]: r.responses, [t('trips.statApproved')]: r.approved,
      [t('trips.enrollment.DECLINED')]: r.declined, [t('trips.statConfirmedShort')]: r.confirmed, [t('trips.report.participation')]: fmtPct(pct(r.confirmed, r.targeted)),
      [t('trips.col.boarded')]: r.boarded, [t('trips.report.collected')]: r.collected, [t('trips.report.expected')]: r.expected,
      [t('trips.enrollment.RECEIPT_REVIEW')]: r.pendingReceipts ?? '', [t('trips.enrollment.RECEIPT_REJECTED')]: r.rejectedReceipts ?? '',
      [t('trips.overallRating')]: fmtAvg(r.ratingSum, r.surveys), [t('trips.recommendRate')]: fmtPct(pct(r.recommend, r.surveys)), [t('trips.report.surveys')]: r.surveys,
    }))), t('trips.report.sheetTrips'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows.map(([b, v]) => ({
      [t('common.branch')]: branchName(b), [t('trips.report.trips')]: v.trips, [t('trips.report.targeted')]: v.targeted, [t('trips.statConfirmedShort')]: v.confirmed,
      [t('trips.report.participation')]: fmtPct(pct(v.confirmed, v.targeted)), [t('trips.report.collected')]: v.collected, [t('trips.overallRating')]: fmtAvg(v.ratingSum, v.surveys),
    }))), t('trips.report.sheetBranches'));
    XLSX.writeFile(wb, `trips-report-${range.from}-${range.to}.xlsx`);
  };

  const card = (label, value, sub, Icon, color) => (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
      <p className="text-xs text-slate-500 flex items-center gap-1"><Icon className="w-4 h-4" />{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
  const th = 'px-3 py-2 text-start font-medium whitespace-nowrap';
  const td = 'px-3 py-2 whitespace-nowrap';

  return (
    <div className="p-4 space-y-5 print:p-0">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.fromDate')}</label><input type="date" value={range.from} onChange={(e) => reload({ from: e.target.value })} className={inputCls} /></div>
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.toDate')}</label><input type="date" value={range.to} onChange={(e) => reload({ to: e.target.value })} className={inputCls} /></div>
        <select value={branch} onChange={(e) => { setLoading(true); setBranch(e.target.value); }} className={inputCls}>
          <option value="">{t('common.allBranches')}</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={!trips.length} className="px-3 py-2 rounded-xl text-sm border border-emerald-300 text-emerald-700 bg-white flex items-center gap-1.5 disabled:opacity-50"><FileDown className="w-4 h-4" />{t('trips.exportExcel')}</button>
        <button onClick={() => window.print()} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5"><Printer className="w-4 h-4" />{t('common.print')}</button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : error ? (
        <p className="py-10 text-center text-sm text-red-600">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {card(t('trips.report.trips'), totals.trips, t('trips.report.cancelledCount', { count: totals.cancelled }), Bus, 'text-slate-800')}
            {card(t('trips.report.completed'), totals.completed, null, Flag, 'text-indigo-700')}
            {card(t('trips.report.participation'), fmtPct(pct(totals.confirmed, totals.targeted)), t('trips.report.ofTargeted', { confirmed: totals.confirmed, targeted: totals.targeted }), UsersIcon, 'text-emerald-700')}
            {card(t('trips.report.declineRate'), fmtPct(pct(totals.declined, totals.responses)), t('trips.report.declinedCount', { count: totals.declined }), UsersIcon, 'text-rose-700')}
            {card(t('trips.report.collected'), totals.collected.toLocaleString('en'), t('trips.report.ofExpected', { expected: totals.expected.toLocaleString('en') }), Wallet, 'text-violet-700')}
            {card(t('trips.overallRating'), fmtAvg(totals.ratingSum, totals.surveys), t('trips.report.recommendSub', { rate: fmtPct(pct(totals.recommend, totals.surveys)), count: totals.surveys }), Star, 'text-amber-600')}
          </div>

          <section>
            <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byTrip')}</h3>
            {trips.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">{t('trips.empty')}</p> : (
              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className={th}>{t('trips.report.trip')}</th><th className={th}>{t('trips.report.targeted')}</th><th className={th}>{t('trips.statApproved')}</th>
                      <th className={th}>{t('trips.enrollment.DECLINED')}</th><th className={th}>{t('trips.statConfirmedShort')}</th><th className={th}>{t('trips.report.participation')}</th>
                      <th className={th}>{t('trips.col.boarded')}</th><th className={th}>{t('trips.report.collected')}</th><th className={th}>{t('trips.report.receipts')}</th>
                      <th className={th}>{t('trips.overallRating')}</th><th className={th}>{t('trips.recommendRate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trips.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenTrip(r.id)}>
                        <td className={td}>
                          <p className="font-medium text-slate-900">{r.title}</p>
                          <p className="text-xs text-slate-400"><span dir="ltr">{r.date}</span> · <span className={`px-1.5 rounded border ${TRIP_STATUS_STYLES[r.status]}`}>{t(`trips.status.${r.status}`)}</span></p>
                        </td>
                        <td className={td}>{r.targeted}</td>
                        <td className={td}>{r.approved}</td>
                        <td className={td}>{r.declined}</td>
                        <td className={`${td} font-bold text-emerald-700`}>{r.confirmed}</td>
                        <td className={td}>{fmtPct(pct(r.confirmed, r.targeted))}</td>
                        <td className={td}>{r.boarded || '—'}</td>
                        <td className={td}>{r.fee > 0 ? `${r.collected.toLocaleString('en')} / ${r.expected.toLocaleString('en')}` : t('trips.free')}</td>
                        <td className={`${td} text-xs`}>{r.fee > 0 ? t('trips.report.receiptsCell', { review: r.pendingReceipts || 0, rejected: r.rejectedReceipts || 0, awaiting: r.awaitingPayment || 0 }) : '—'}</td>
                        <td className={td}>{r.surveys ? <span className="text-amber-600 font-bold">{fmtAvg(r.ratingSum, r.surveys)}</span> : '—'}{r.surveys > 0 && <span className="text-xs text-slate-400"> ({r.surveys})</span>}</td>
                        <td className={td}>{fmtPct(pct(r.recommend, r.surveys))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section>
              <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byBranch')}</h3>
              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr><th className={th}>{t('common.branch')}</th><th className={th}>{t('trips.report.trips')}</th><th className={th}>{t('trips.report.targeted')}</th><th className={th}>{t('trips.statConfirmedShort')}</th><th className={th}>{t('trips.report.participation')}</th><th className={th}>{t('trips.report.collected')}</th><th className={th}>{t('trips.overallRating')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchRows.map(([b, v]) => (
                      <tr key={b}>
                        <td className={`${td} font-medium`}>{branchName(b)}</td><td className={td}>{v.trips}</td><td className={td}>{v.targeted}</td>
                        <td className={td}>{v.confirmed}</td><td className={td}>{fmtPct(pct(v.confirmed, v.targeted))}</td>
                        <td className={td}>{v.collected.toLocaleString('en')}</td><td className={td}>{fmtAvg(v.ratingSum, v.surveys)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-5">
              <div>
                <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byGrade')}</h3>
                <div className="space-y-1.5">
                  {gradeRows.map(([g, v]) => {
                    const p = pct(v.confirmed, v.targeted) || 0;
                    return (
                      <div key={g} className="flex items-center gap-2 text-xs">
                        <span className="w-10 font-mono text-slate-600" dir="ltr">{g}</span>
                        <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${p}%` }} /></div>
                        <span className="w-24 text-slate-600">{p}% <span className="text-slate-400">({v.confirmed}/{v.targeted})</span></span>
                      </div>
                    );
                  })}
                  {gradeRows.length === 0 && <p className="text-sm text-slate-400">—</p>}
                </div>
              </div>
              <div>
                <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.declineReasons')}</h3>
                {reasons.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
                  <ul className="space-y-1 text-sm">
                    {reasons.map(([r, n]) => (
                      <li key={r} className="flex justify-between border-b border-slate-50 py-1"><span>{t(`trips.declineReason.${r}`)}</span><span className="text-slate-600">{n} ({pct(n, reasonTotal)}%)</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-1"><ThumbsUp className="w-4 h-4" />{t('trips.report.ratingByCriterion')}</h3>
                <ul className="space-y-1 text-sm">
                  {TRIP_RATINGS.map((k) => {
                    const rated = trips.filter((r) => r.ratings?.[k] != null);
                    const weight = rated.reduce((a, r) => a + r.surveys, 0);
                    const avg = weight ? (rated.reduce((a, r) => a + r.ratings[k] * r.surveys, 0) / weight).toFixed(1) : '—';
                    return <li key={k} className="flex justify-between border-b border-slate-50 py-1"><span>{t(`trips.rating.${k}`)}</span><span className="font-bold text-amber-600">{avg}</span></li>;
                  })}
                </ul>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
