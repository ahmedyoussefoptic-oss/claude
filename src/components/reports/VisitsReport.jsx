import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Armchair, Handshake, Clock, Hourglass, CheckCircle2, CalendarCheck, CalendarX, Timer } from 'lucide-react';
import { complaintTypesLabel, complaintStatusLabel } from '../../config/complaintTypes';

const DAY_MS = 86400000;
const minutes = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const avg = (list) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : null);
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pctOf = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const SOLVED = ['SOLVED', 'CLOSED'];

function Box({ title, value, sub, icon: Icon, gradient }) {
  return (
    <div className="relative overflow-hidden bg-white rounded-xl p-4 border border-slate-200 break-inside-avoid">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-gradient-to-br ${gradient} text-white`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div className="mb-3 border-r-4 border-teal-500 pr-3">
      <h3 className="text-base font-bold text-slate-900">{children}</h3>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// Branch visits report: parents who checked in at a branch with its QR code
// (walk-ins and booked appointments) and the visit-appointment requests.
// Visits are dated by arrival, appointments by their slot; the branch /
// date filters of the reports page apply to both.
export default function VisitsReport({ complaints, filters, branches, complaintTypes, showDetails, onOpenComplaint, merged }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const listSep = t('publicReport.listSeparator');
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;
  const fromMs = filters.from ? new Date(filters.from).getTime() : -Infinity;
  const toMs = filters.to ? new Date(filters.to).getTime() + DAY_MS - 1 : Infinity;
  const inRange = (ms) => ms != null && ms >= fromMs && ms <= toMs;
  const inBranch = (c) => !filters.branch || c.branch === filters.branch;
  const now = Date.now();

  const visits = complaints
    .filter((c) => c.viaVisitQr && inBranch(c) && inRange(c.visitArrivedAt?.toMillis?.()))
    .map((c) => {
      const arrived = c.visitArrivedAt.toMillis();
      const met = c.visitStatus === 'MET' && c.visitMetAt ? c.visitMetAt.toMillis() : null;
      return { c, arrived, met, wait: met ? minutes(arrived, met) : null, booked: c.appointment?.status === 'CHECKED_IN' };
    })
    .sort((a, b) => b.arrived - a.arrived);
  const met = visits.filter((v) => v.met);
  const waits = met.map((v) => v.wait);
  const waiting = visits.filter((v) => !v.met);
  const solved = visits.filter((v) => SOLVED.includes(v.c.status));
  const byReception = visits.filter((v) => v.c.visitConfirmedByName);

  const appts = complaints
    .filter((c) => c.appointment?.start && inBranch(c) && inRange(c.appointment.start.toMillis?.()))
    .map((c) => c.appointment);
  const apptCount = (s) => appts.filter((a) => a.status === s).length;
  const noShow = appts.filter((a) => a.status === 'CONFIRMED' && a.start.toMillis() < now - 2 * 3600000).length;

  const branchRows = branches
    .map((b) => {
      const bv = visits.filter((v) => v.c.branch === b.id);
      const bm = bv.filter((v) => v.met);
      const ba = complaints.filter((c) => c.branch === b.id && c.appointment?.start && inRange(c.appointment.start.toMillis?.()));
      return {
        id: b.id, name: b.name, total: bv.length, met: bm.length, waiting: bv.length - bm.length,
        avgWait: avg(bm.map((v) => v.wait)), maxWait: bm.length ? Math.max(...bm.map((v) => v.wait)) : null,
        solved: bv.filter((v) => SOLVED.includes(v.c.status)).length, booked: bv.filter((v) => v.booked).length, appts: ba.length,
      };
    })
    .filter((r) => r.total + r.appts > 0)
    .sort((a, b) => b.total - a.total);

  const staffMap = {};
  met.forEach((v) => {
    const k = v.c.visitMetByName || '—';
    (staffMap[k] = staffMap[k] || []).push(v.wait);
  });
  const staffRows = Object.entries(staffMap).map(([name, w]) => ({ name, count: w.length, avgWait: avg(w) })).sort((a, b) => b.count - a.count);

  const typeCounts = {};
  visits.forEach((v) => {
    const k = complaintTypesLabel(v.c, typeName, listSep) || '—';
    typeCounts[k] = (typeCounts[k] || 0) + 1;
  });
  const typeRows = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  // Peak times (Riyadh local time of arrival).
  const dayCounts = Array(7).fill(0);
  const hourCounts = {};
  visits.forEach((v) => {
    const d = new Date(v.arrived);
    dayCounts[d.getDay()]++;
    hourCounts[d.getHours()] = (hourCounts[d.getHours()] || 0) + 1;
  });
  const hours = Object.keys(hourCounts).map(Number).sort((a, b) => a - b);
  const maxHour = Math.max(1, ...Object.values(hourCounts));
  const maxDay = Math.max(1, ...dayCounts);
  const dayName = (i) => format(new Date(2026, 9, 4 + i), 'EEEE', { locale: dateLocale }); // 4 Oct 2026 is a Sunday

  const th = 'text-right py-2 px-2 font-medium text-slate-500 text-xs whitespace-nowrap';
  const td = 'py-2 px-2 tabular-nums text-slate-800';
  const mins = (v) => (v == null ? '—' : t('visitsReport.minutes', { count: v }));

  return (
    <div className={`space-y-8 ${merged ? 'pt-8 border-t-4 border-teal-100' : ''}`}>
      {merged && <h2 className="text-lg font-bold text-teal-800">{t('visitsReport.mergedTitle')}</h2>}

      <section>
        <SectionTitle sub={t('visitsReport.summarySub')}>{t('visitsReport.summaryTitle')}</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Box title={t('visitsReport.totalVisits')} value={visits.length} sub={t('visitsReport.bookedSub', { count: visits.filter((v) => v.booked).length })} icon={Armchair} gradient="from-teal-500 to-emerald-600" />
          <Box title={t('visitsReport.metCount')} value={met.length} sub={pctOf(met.length, visits.length)} icon={Handshake} gradient="from-emerald-500 to-green-600" />
          <Box title={t('visitsReport.notMet')} value={waiting.length} sub={t('visitsReport.receptionSub', { count: byReception.length })} icon={Hourglass} gradient="from-rose-500 to-red-600" />
          <Box title={t('visitsReport.solvedCount')} value={solved.length} sub={pctOf(solved.length, visits.length)} icon={CheckCircle2} gradient="from-sky-500 to-blue-600" />
          <Box title={t('visitsReport.avgWait')} value={mins(avg(waits))} icon={Clock} gradient="from-amber-400 to-orange-500" />
          <Box title={t('visitsReport.medianWait')} value={mins(median(waits))} icon={Timer} gradient="from-amber-400 to-orange-500" />
          <Box title={t('visitsReport.over30')} value={waits.filter((w) => w > 30).length} sub={pctOf(waits.filter((w) => w > 30).length, waits.length)} icon={Hourglass} gradient="from-orange-500 to-red-500" />
          <Box title={t('visitsReport.maxWait')} value={mins(waits.length ? Math.max(...waits) : null)} icon={Clock} gradient="from-slate-500 to-slate-700" />
        </div>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle sub={t('visitsReport.apptSub')}>{t('visitsReport.apptTitle')}</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Box title={t('visitsReport.apptTotal')} value={appts.length} sub={t('visitsReport.rescheduledSub', { count: appts.filter((a) => a.rescheduled).length })} icon={CalendarCheck} gradient="from-indigo-500 to-violet-600" />
          <Box title={t('visitsReport.apptRequested')} value={apptCount('REQUESTED')} icon={Hourglass} gradient="from-amber-400 to-orange-500" />
          <Box title={t('visitsReport.apptConfirmed')} value={apptCount('CONFIRMED')} icon={CalendarCheck} gradient="from-emerald-500 to-green-600" />
          <Box title={t('visitsReport.apptCheckedIn')} value={apptCount('CHECKED_IN')} sub={pctOf(apptCount('CHECKED_IN'), apptCount('CHECKED_IN') + apptCount('CONFIRMED'))} icon={Handshake} gradient="from-sky-500 to-blue-600" />
          <Box title={t('visitsReport.apptNoShow')} value={noShow} icon={CalendarX} gradient="from-rose-500 to-red-600" />
        </div>
      </section>

      {!filters.branch && branchRows.length > 0 && (
        <section className="break-inside-avoid">
          <SectionTitle>{t('visitsReport.byBranch')}</SectionTitle>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('common.branch')}</th>
                <th className={th}>{t('visitsReport.totalVisits')}</th>
                <th className={th}>{t('visitsReport.metCount')}</th>
                <th className={th}>{t('visitsReport.notMet')}</th>
                <th className={th}>{t('visitsReport.avgWait')}</th>
                <th className={th}>{t('visitsReport.maxWait')}</th>
                <th className={th}>{t('visitsReport.solvedCount')}</th>
                <th className={th}>{t('visitsReport.fromAppt')}</th>
                <th className={th}>{t('visitsReport.apptTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {branchRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 px-2 font-medium text-slate-800">{r.name}</td>
                  <td className={td}>{r.total}</td>
                  <td className={`${td} text-emerald-700`}>{r.met}</td>
                  <td className={`${td} ${r.waiting ? 'text-rose-600' : ''}`}>{r.waiting}</td>
                  <td className={td}>{mins(r.avgWait)}</td>
                  <td className={td}>{mins(r.maxWait)}</td>
                  <td className={td}>{r.solved} <span className="text-slate-400 text-xs">({pctOf(r.solved, r.total)})</span></td>
                  <td className={td}>{r.booked}</td>
                  <td className={td}>{r.appts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {staffRows.length > 0 && (
          <section className="break-inside-avoid">
            <SectionTitle>{t('visitsReport.byStaff')}</SectionTitle>
            <table className="w-full text-sm border-collapse">
              <thead><tr className="border-b border-slate-200"><th className={th}>{t('visitsReport.staff')}</th><th className={th}>{t('visitsReport.metCount')}</th><th className={th}>{t('visitsReport.avgWait')}</th></tr></thead>
              <tbody>
                {staffRows.map((r) => (
                  <tr key={r.name} className="border-b border-slate-100"><td className="py-2 px-2 text-slate-800">{r.name}</td><td className={td}>{r.count}</td><td className={td}>{mins(r.avgWait)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {typeRows.length > 0 && (
          <section className="break-inside-avoid">
            <SectionTitle>{t('visitsReport.byReason')}</SectionTitle>
            <table className="w-full text-sm border-collapse">
              <thead><tr className="border-b border-slate-200"><th className={th}>{t('common.type')}</th><th className={th}>{t('reports.countLabel')}</th><th className={th}>{t('reports.percentLabel')}</th></tr></thead>
              <tbody>
                {typeRows.map(([name, n]) => (
                  <tr key={name} className="border-b border-slate-100"><td className="py-2 px-2 text-slate-800">{name}</td><td className={td}>{n}</td><td className={`${td} text-slate-500`}>{pctOf(n, visits.length)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {visits.length > 0 && (
        <section className="break-inside-avoid">
          <SectionTitle sub={t('visitsReport.peakSub')}>{t('visitsReport.peakTitle')}</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-1.5">
              {dayCounts.map((n, i) => (n > 0 || i < 5) && (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-slate-600">{dayName(i)}</span>
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${(100 * n) / maxDay}%` }} /></div>
                  <span className="w-8 text-slate-700 tabular-nums">{n}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {hours.map((h) => (
                <div key={h} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-slate-600" dir="ltr">{String(h).padStart(2, '0')}:00</span>
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${(100 * hourCounts[h]) / maxHour}%` }} /></div>
                  <span className="w-8 text-slate-700 tabular-nums">{hourCounts[h]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {showDetails && visits.length > 0 && (
        <section>
          <SectionTitle>{t('visitsReport.detailsTitle')} ({visits.length})</SectionTitle>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('reports.full.recordNumber')}</th>
                <th className={th}>{t('visitsReport.arrival')}</th>
                <th className={th}>{t('common.branch')}</th>
                <th className={th}>{t('common.parent')}</th>
                <th className={th}>{t('common.student')}</th>
                <th className={th}>{t('visitsReport.reason')}</th>
                <th className={th}>{t('visitsReport.metBy')}</th>
                <th className={th}>{t('visitsReport.wait')}</th>
                <th className={th}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.c.id} onClick={() => onOpenComplaint(v.c)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50">
                  <td className="py-1.5 px-2 text-slate-800" dir="ltr">{v.c.complaintId}</td>
                  <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap" dir="ltr">{format(v.arrived, 'yyyy-MM-dd HH:mm')}</td>
                  <td className="py-1.5 px-2 text-slate-600">{branchName(v.c.branch)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{v.c.parentName || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{v.c.studentName || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{v.c.subject || complaintTypesLabel(v.c, typeName, listSep)}{v.booked && <span className="text-indigo-600"> · {t('visitsReport.bookedTag')}</span>}</td>
                  <td className="py-1.5 px-2 text-slate-600">{v.c.visitMetByName || '—'}</td>
                  <td className={`py-1.5 px-2 ${v.wait > 30 ? 'text-rose-600 font-medium' : 'text-slate-600'}`}>{v.met ? mins(v.wait) : t('visitsReport.notMetShort')}</td>
                  <td className="py-1.5 px-2 text-slate-600">{complaintStatusLabel(v.c, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
