import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Loader2, FileDown, Printer, Bus, Users as UsersIcon, Wallet, Star, ThumbsUp, Flag } from 'lucide-react';
import { functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { TRIP_STATUS_STYLES, TRIP_STAGES, TRIP_RATINGS } from '../../config/trips';
import { printPage } from '../../utils/printPage';

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
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const contentRef = useRef(null);
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

  // Cancelled trips are left out of the report by the server.
  const trips = data?.trips || [];
  const sum = (field) => trips.reduce((a, r) => a + (r[field] || 0), 0);
  const totals = {
    trips: trips.length,
    completed: trips.filter((r) => r.status === 'COMPLETED').length,
    targeted: sum('targeted'), confirmed: sum('confirmed'), approved: sum('approved'), declined: sum('declined'), responses: sum('responses'),
    collected: sum('collected'), expected: sum('expected'), surveys: sum('surveys'), ratingSum: sum('ratingSum'), recommend: sum('recommend'),
  };
  const branchRows = Object.entries(data?.byBranch || {}).sort((a, b) => b[1].confirmed - a[1].confirmed);
  const gradeRows = TRIP_STAGES.filter((g) => data?.byGrade?.[g]?.students).map((g) => [g, data.byGrade[g]]);
  const methodRows = Object.entries(data?.byMethod || {}).sort((a, b) => b[1].amount - a[1].amount);
  const collectorRows = Object.entries(data?.byCollector || {}).sort((a, b) => b[1].amount - a[1].amount);
  const payments = data?.payments || [];
  const methodName = (m) => t(`trips.collectMethod.${m}`, { defaultValue: m });
  const reasons = Object.entries(data?.declineReasons || {}).sort((a, b) => b[1] - a[1]);
  const reasonTotal = reasons.reduce((a, [, n]) => a + n, 0);

  // The report as shown (cards and tables), in its own window.
  const print = () => {
    if (!contentRef.current) return;
    printPage({
      title: t('trips.print.reportTitle'),
      subtitle: `${t('trips.print.period', { from: range.from, to: range.to })} · ${branch ? branchName(branch) : t('common.allBranches')}`,
      school: t('trips.print.school'),
      body: contentRef.current.outerHTML,
      landscape: true,
      copyStyles: true,
      css: '#report-print-area .whitespace-nowrap { white-space: normal !important } #report-print-area section, #report-print-area table { break-inside: auto }',
      dir: i18n.dir(),
      lang: i18n.language,
    });
  };

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
      [t('common.branch')]: branchName(b), [t('trips.report.trips')]: v.trips, [t('trips.report.branchStudents')]: v.rosterTotal ?? '', [t('trips.report.targetedStudents')]: v.students,
      [t('trips.report.confirmedStudents')]: v.studentsConfirmed, [t('trips.report.participation')]: fmtPct(pct(v.studentsConfirmed, v.students)), [t('trips.report.collected')]: v.collected, [t('trips.overallRating')]: fmtAvg(v.ratingSum, v.surveys),
    }))), t('trips.report.sheetBranches'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payments.map((p) => ({
      [t('trips.report.trip')]: p.tripTitle, [t('common.date')]: p.tripDate, [t('trips.col.student')]: p.studentName, [t('trips.col.nationalId')]: p.studentId,
      [t('common.branch')]: branchName(p.branch), [t('trips.col.grade')]: p.grade, [t('trips.report.amount')]: p.amount, [t('trips.collect.method')]: methodName(p.method),
      [t('trips.collectorLabel')]: p.collector, [t('trips.confirmerLabel')]: p.confirmedBy, [t('trips.collect.ref')]: p.ref,
      [t('trips.report.confirmedAt')]: p.at ? new Date(p.at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }) : '',
    }))), t('trips.report.sheetPayments'));
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
        <button onClick={print} disabled={loading || !!error} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" />{t('common.print')}</button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : error ? (
        <p className="py-10 text-center text-sm text-red-600">{error}</p>
      ) : (
        <div ref={contentRef} className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {card(t('trips.report.trips'), totals.trips, null, Bus, 'text-slate-800')}
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

          {(methodRows.length > 0 || collectorRows.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <section>
                <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-1"><Wallet className="w-4 h-4" />{t('trips.report.byMethod')}</h3>
                <table className="w-full text-sm border border-slate-100 rounded-2xl overflow-hidden">
                  <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className={th}>{t('trips.collect.method')}</th><th className={th}>{t('trips.report.payments')}</th><th className={th}>{t('trips.report.amount')}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {methodRows.map(([m, v]) => <tr key={m}><td className={`${td} font-medium`}>{methodName(m)}</td><td className={td}>{v.count}</td><td className={td}>{v.amount.toLocaleString('en')}</td></tr>)}
                  </tbody>
                </table>
              </section>
              <section>
                <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byCollector')}</h3>
                <table className="w-full text-sm border border-slate-100 rounded-2xl overflow-hidden">
                  <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className={th}>{t('trips.collectorLabel')}</th><th className={th}>{t('trips.report.payments')}</th><th className={th}>{t('trips.report.amount')}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {collectorRows.map(([n, v]) => <tr key={n}><td className={`${td} font-medium`}>{n}</td><td className={td}>{v.count}</td><td className={td}>{v.amount.toLocaleString('en')}</td></tr>)}
                    {collectorRows.length === 0 && <tr><td className={td} colSpan={3}>—</td></tr>}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {payments.length > 0 && (
            <section>
              <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.paymentsLog')}</h3>
              <div className="overflow-x-auto border border-slate-100 rounded-2xl max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr>
                    <th className={th}>{t('trips.report.trip')}</th><th className={th}>{t('trips.col.student')}</th><th className={th}>{t('common.branch')}</th><th className={th}>{t('trips.report.amount')}</th>
                    <th className={th}>{t('trips.collect.method')}</th><th className={th}>{t('trips.collectorLabel')}</th><th className={th}>{t('trips.confirmerLabel')}</th><th className={th}>{t('trips.collect.ref')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p, i) => (
                      <tr key={i}><td className={td}>{p.tripTitle}</td><td className={td}>{p.studentName}</td><td className={td}>{branchName(p.branch)}</td><td className={td}>{p.amount}</td>
                        <td className={td}>{methodName(p.method)}</td><td className={td}>{p.collector || '—'}</td><td className={td}>{p.confirmedBy || '—'}</td><td className={td} dir="ltr">{p.ref}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section>
              <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byBranch')}</h3>
              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr><th className={th}>{t('common.branch')}</th><th className={th}>{t('trips.report.trips')}</th><th className={th}>{t('trips.report.branchStudents')}</th><th className={th}>{t('trips.report.targetedStudents')}</th><th className={th}>{t('trips.report.confirmedStudents')}</th><th className={th}>{t('trips.report.participation')}</th><th className={th}>{t('trips.report.collected')}</th><th className={th}>{t('trips.overallRating')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchRows.map(([b, v]) => (
                      <tr key={b}>
                        <td className={`${td} font-medium`}>{branchName(b)}</td><td className={td}>{v.trips}</td><td className={td}>{v.rosterTotal ?? '—'}</td><td className={td}>{v.students}</td>
                        <td className={td}>{v.studentsConfirmed}</td><td className={td}>{fmtPct(pct(v.studentsConfirmed, v.students))}</td>
                        <td className={td}>{v.collected.toLocaleString('en')}</td><td className={td}>{fmtAvg(v.ratingSum, v.surveys)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{t('trips.report.byBranchHint')}</p>
            </section>

            <section className="space-y-5">
              <div>
                <h3 className="font-bold text-slate-800 mb-2">{t('trips.report.byGrade')}</h3>
                <div className="space-y-1.5">
                  {gradeRows.map(([g, v]) => {
                    const p = pct(v.studentsConfirmed, v.students) || 0;
                    return (
                      <div key={g} className="flex items-center gap-2 text-xs">
                        <span className="w-10 font-mono text-slate-600" dir="ltr">{g}</span>
                        <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${p}%` }} /></div>
                        <span className="w-24 text-slate-600">{p}% <span className="text-slate-400">({v.studentsConfirmed}/{v.students})</span></span>
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
        </div>
      )}
    </div>
  );
}
