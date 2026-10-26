import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Bus, Plus, CalendarDays, List, ChevronRight, ChevronLeft, Loader2, Hourglass, CheckCircle2, Wallet, AlertTriangle, MapPin, Users as UsersIcon, FileBarChart, Star, Clock, Flag, UserCheck, ThumbsUp, ThumbsDown, HelpCircle, X, Search, FileDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, addDays, addMonths, isSameMonth } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { functions } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import TripForm from '../components/trips/TripForm';
import TripDetails from '../components/trips/TripDetails';
import TripsReport from '../components/trips/TripsReport';
import TripStudentSearch from '../components/trips/TripStudentSearch';
import { canSeeTrips } from '../utils/scope';
import { TRIP_STATUSES, TRIP_STATUS_STYLES, TRIP_DOT, TRIP_GENDER_STYLES, ENROLLMENT_STATUS_STYLES, canCreateTrips, tripConflicts, dayToDate, tripTime } from '../config/trips';

const ymd = (d) => format(d, 'yyyy-MM-dd');

// School trips tab: calendar / list of the trips in the user's branches,
// with the trip details (approval, consents, finance, boarding) in a modal.
export default function Trips() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('calendar');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [formTrip, setFormTrip] = useState(null); // {} new, trip to edit
  const [tripPassword, setTripPassword] = useState(); // entered before editing
  const openId = searchParams.get('openId');

  const load = useCallback(async () => {
    try {
      const { data } = await httpsCallable(functions, 'listTrips')();
      setTrips(data.trips || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openTrip = (id) => setSearchParams(id ? { openId: id } : {});

  const shown = useMemo(() => trips.filter((tr) => (branchFilter === 'ALL' || (tr.branches || []).includes(branchFilter))
    && (deptFilter === 'ALL' || !(tr.departments || []).length || tr.departments.includes(deptFilter))
    // Cancelled trips are left out of the log unless picked in the status filter.
    && (statusFilter === 'ALL' ? tr.status !== 'CANCELLED' : tr.status === statusFilter)), [trips, branchFilter, deptFilter, statusFilter]);

  const today = ymd(new Date());
  const stats = useMemo(() => {
    const coming = trips.filter((tr) => ['OPEN', 'CLOSED'].includes(tr.status) && tr.date >= today);
    const sum = (k) => coming.reduce((s, tr) => s + (tr.stats?.[k] || 0), 0);
    return {
      upcoming: coming.length,
      open: trips.filter((tr) => tr.status === 'OPEN').length,
      approved: sum('approved'), confirmed: sum('confirmed'), awaiting: sum('awaiting'), review: sum('review'), declined: sum('declined'),
      noAnswer: coming.reduce((s, tr) => s + Math.max(0, (tr.targetedCount || 0) - (tr.stats?.responses || 0)), 0),
    };
  }, [trips, today]);
  const [drill, setDrill] = useState(null); // enrollment status shown in the students list
  const showTrips = (status) => { setStatusFilter(status); setView('list'); };

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn: 0 });
    const end = endOfMonth(month);
    const list = [];
    for (let d = start; d <= end || list.length % 7; d = addDays(d, 1)) list.push(d);
    return list;
  }, [month]);
  const byDay = useMemo(() => {
    const map = {};
    shown.forEach((tr) => { (map[tr.date] = map[tr.date] || []).push(tr); });
    return map;
  }, [shown]);

  const select = (value, onChange, options) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm">
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
  const stageText = (tr) => ((tr.stages || []).length ? tr.stages.join('، ') : t('trips.allGrades'));
  const selected = trips.find((tr) => tr.id === openId);

  if (!canSeeTrips(userData)) {
    return <p className="max-w-xl mx-auto mt-20 text-center text-slate-500">{t('trips.noAccess')}</p>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Bus className="w-6 h-6 text-primary" />{t('trips.title')}</h1>
          <p className="text-slate-500 mt-1">{t('trips.subtitle')}</p>
        </div>
        {canCreateTrips(userData) && (
          <button onClick={() => setFormTrip({})} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark flex items-center gap-2 self-start">
            <Plus className="w-4 h-4" />{t('trips.newTrip')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t('trips.statUpcoming')} value={String(stats.upcoming)} icon={CalendarDays} gradient="from-sky-500 to-blue-600" onClick={() => showTrips('ALL')} />
        <StatCard title={t('trips.statOpen')} value={String(stats.open)} icon={Hourglass} gradient="from-amber-400 to-orange-500" onClick={() => showTrips('OPEN')} />
        <StatCard title={t('trips.drill.APPROVED')} value={String(stats.approved)} icon={ThumbsUp} gradient="from-teal-500 to-emerald-600" sub={t('trips.statComing')} onClick={() => setDrill('APPROVED')} />
        <StatCard title={t('trips.statConfirmed')} value={String(stats.confirmed)} icon={CheckCircle2} gradient="from-emerald-500 to-green-600" onClick={() => setDrill('CONFIRMED')} />
        <StatCard title={t('trips.drill.AWAITING_PAYMENT')} value={String(stats.awaiting)} icon={Hourglass} gradient="from-amber-500 to-yellow-500" onClick={() => setDrill('AWAITING_PAYMENT')} />
        <StatCard title={t('trips.statReview')} value={String(stats.review)} icon={Wallet} gradient="from-violet-500 to-purple-600" onClick={() => setDrill('RECEIPT_REVIEW')} />
        <StatCard title={t('trips.drill.DECLINED')} value={String(stats.declined)} icon={ThumbsDown} gradient="from-rose-500 to-pink-600" onClick={() => setDrill('DECLINED')} />
        <StatCard title={t('trips.statNoAnswer')} value={String(stats.noAnswer)} icon={HelpCircle} gradient="from-slate-500 to-slate-700" sub={t('trips.statNoAnswerHint')} onClick={() => showTrips('OPEN')} />
      </div>
      <TripStudentSearch branchName={branchName} onOpenTrip={openTrip} />
      {drill && <EnrollmentDrill status={drill} branchName={branchName} onClose={() => setDrill(null)} onOpenTrip={(id) => { setDrill(null); openTrip(id); }} />}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setView('calendar')} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view === 'calendar' ? 'bg-white shadow-sm text-primary font-medium' : 'text-slate-600'}`}><CalendarDays className="w-4 h-4" />{t('trips.viewCalendar')}</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view === 'list' ? 'bg-white shadow-sm text-primary font-medium' : 'text-slate-600'}`}><List className="w-4 h-4" />{t('trips.viewList')}</button>
            <button onClick={() => setView('report')} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view === 'report' ? 'bg-white shadow-sm text-primary font-medium' : 'text-slate-600'}`}><FileBarChart className="w-4 h-4" />{t('trips.viewReport')}</button>
          </div>
          {view !== 'report' && <>{select(branchFilter, setBranchFilter, [['ALL', t('common.allBranches')], ...branches.map((b) => [b.id, b.name])])}
          {select(deptFilter, setDeptFilter, [['ALL', t('trips.allSections')], ...departments.map((d) => [d.id, d.name])])}
          {select(statusFilter, setStatusFilter, [['ALL', t('trips.allStatuses')], ...TRIP_STATUSES.map((s) => [s, t(`trips.status.${s}`)])])}</>}
        </div>

        {view === 'report' ? (
          <TripsReport onOpenTrip={openTrip} />
        ) : loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : error ? (
          <p className="py-16 text-center text-red-600 text-sm">{error}</p>
        ) : view === 'calendar' ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setMonth((m) => addMonths(m, -1))} className="p-2 rounded-lg hover:bg-slate-100" title={t('trips.prevMonth')}>{i18n.dir() === 'rtl' ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}</button>
              <p className="font-bold text-slate-800">{format(month, 'LLLL yyyy', { locale: dateLocale })}</p>
              <button onClick={() => setMonth((m) => addMonths(m, 1))} className="p-2 rounded-lg hover:bg-slate-100" title={t('trips.nextMonth')}>{i18n.dir() === 'rtl' ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}</button>
            </div>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden min-w-[640px]">
                {days.slice(0, 7).map((d) => (
                  <div key={`h${d}`} className="bg-slate-50 text-center text-xs font-bold text-slate-500 py-2">{format(d, 'EEEE', { locale: dateLocale })}</div>
                ))}
                {days.map((d) => {
                  const key = ymd(d);
                  const list = byDay[key] || [];
                  return (
                    <div key={key} className={`bg-white min-h-[92px] p-1.5 ${isSameMonth(d, month) ? '' : 'bg-slate-50/70 text-slate-300'}`}>
                      <p className={`text-xs mb-1 ${key === today ? 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-white font-bold' : 'text-slate-500'}`}>{format(d, 'd')}</p>
                      <div className="space-y-1">
                        {list.map((tr) => {
                          const conflict = tr.status !== 'CANCELLED' && tripConflicts(tr, trips).length > 0;
                          return (
                            <button key={tr.id} onClick={() => openTrip(tr.id)} className={`w-full text-start text-[11px] leading-tight px-1.5 py-1 rounded-md border ${TRIP_STATUS_STYLES[tr.status]} hover:brightness-95 ${tr.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}>
                              <span className="flex items-center gap-1 font-medium">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TRIP_DOT[tr.status]}`} />
                                <span className="truncate">{tr.title}</span>
                                {conflict && <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />}
                              </span>
                              <span className="block truncate opacity-80">{tr.gender && tr.gender !== 'ALL' ? `${t(`trips.gender.${tr.gender}`)} · ` : ''}<span dir="ltr">{stageText(tr)}</span></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-slate-400 text-sm">{t('trips.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((tr) => {
              const conflict = tr.status !== 'CANCELLED' && tripConflicts(tr, trips).length > 0;
              return (
                <li key={tr.id}>
                  <button onClick={() => openTrip(tr.id)} className="w-full text-start p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-slate-50">
                    <div className="w-14 shrink-0 text-center bg-primary/10 text-primary rounded-xl py-1.5">
                      <p className="text-lg font-bold leading-none">{format(dayToDate(tr.date), 'd')}</p>
                      <p className="text-[11px] mt-1">{format(dayToDate(tr.date), 'LLL', { locale: dateLocale })}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                        {tr.title}
                        {tr.gender && tr.gender !== 'ALL' && <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${TRIP_GENDER_STYLES[tr.gender]}`}>{t(`trips.gender.${tr.gender}`)}</span>}
                        <span className="text-xs font-mono font-normal text-slate-400" dir="ltr">{tr.tripCode}</span>
                        {conflict && <span className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('trips.conflictShort')}</span>}
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{tr.destination}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{format(dayToDate(tr.date), 'EEEE', { locale: dateLocale })}{tr.departTime && ` · ${tripTime(tr.departTime, i18n.language)} – ${tripTime(tr.returnTime, i18n.language)}`}</span>
                        {tr.meetingPoint && <span className="flex items-center gap-1"><Flag className="w-3.5 h-3.5 text-slate-400" />{tr.meetingPoint}</span>}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{(tr.branches || []).map(branchName).join('، ')} · <span dir="ltr">{stageText(tr)}</span>{(tr.departments || []).length > 0 && ` · ${tr.departments.map((d) => departments.find((x) => x.id === d)?.name || d).join('، ')}`}</p>
                      {['OPEN', 'CLOSED', 'COMPLETED'].includes(tr.status) && <TripListStats tr={tr} t={t} today={today} />}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-sm">
                      {['OPEN', 'CLOSED', 'COMPLETED'].includes(tr.status) && (
                        <span className="text-slate-600 flex items-center gap-1" title={t('trips.confirmedStudents')}>
                          <UsersIcon className="w-4 h-4 text-emerald-600" />{tr.stats?.confirmed || 0}{tr.capacity > 0 && <span className="text-slate-400">/{tr.capacity}</span>}
                        </span>
                      )}
                      {tr.surveyStats?.count > 0 && <span className="text-amber-600 flex items-center gap-1" title={t('trips.overallRating')}><Star className="w-4 h-4 fill-amber-400 text-amber-400" />{tr.surveyStats.average.toFixed(1)}</span>}
                      {tr.fee > 0 && <span className="text-slate-500">{t('trips.feeValue', { fee: tr.fee })}</span>}
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${TRIP_STATUS_STYLES[tr.status]}`}>{t(`trips.status.${tr.status}`)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {formTrip && (
        <TripForm
          trip={formTrip.id ? formTrip : null}
          tripPassword={formTrip.id ? tripPassword : undefined}
          allTrips={trips}
          onClose={() => setFormTrip(null)}
          onSaved={async (id) => { setFormTrip(null); await load(); openTrip(id); }}
        />
      )}
      {openId && (
        <TripDetails
          tripId={openId}
          listed={selected}
          allTrips={trips}
          onClose={() => openTrip(null)}
          onEdit={(trip, pw) => { setTripPassword(pw); setFormTrip(trip); }}
          onDeleted={async () => { openTrip(null); await load(); }}
          onChanged={load}
        />
      )}
    </div>
  );
}

// Response numbers under each trip in the list (trip.stats, kept by the
// functions; targetedCount is stored when the trip's roster is first opened).
function TripListStats({ tr, t, today }) {
  const s = tr.stats || {};
  const targeted = tr.targetedCount || 0;
  const confirmed = s.confirmed || 0;
  const responses = s.responses || 0;
  const daysLeft = tr.payDeadline ? Math.round((new Date(`${tr.payDeadline}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null;
  const chip = (label, value, cls = 'bg-slate-50 text-slate-700 border-slate-200') => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${cls}`}>{label}<b className="tabular-nums">{value}</b></span>
  );
  const pct = targeted ? Math.min(100, Math.round((confirmed / targeted) * 100)) : null;
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {targeted > 0 && chip(t('trips.list.targeted'), targeted)}
        {chip(t('trips.list.responses'), responses)}
        {chip(t('trips.list.approved'), s.approved || 0, 'bg-emerald-50 text-emerald-700 border-emerald-200')}
        {(s.declined || 0) > 0 && chip(t('trips.list.declined'), s.declined, 'bg-rose-50 text-rose-700 border-rose-200')}
        {chip(t('trips.list.confirmed'), tr.capacity > 0 ? `${confirmed}/${tr.capacity}` : confirmed, 'bg-sky-50 text-sky-700 border-sky-200')}
        {tr.fee > 0 && (s.awaiting || 0) > 0 && chip(t('trips.list.awaiting'), s.awaiting, 'bg-amber-50 text-amber-700 border-amber-200')}
        {tr.fee > 0 && (s.review || 0) > 0 && chip(t('trips.list.review'), s.review, 'bg-violet-50 text-violet-700 border-violet-200')}
        {tr.fee > 0 && chip(t('trips.list.collected'), `${(s.collected || 0).toLocaleString('en')} / ${((s.approved || 0) * tr.fee).toLocaleString('en')}`)}
        {(tr.supervisors || []).length > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] bg-slate-50 text-slate-700 border-slate-200"><UserCheck className="w-3 h-3" />{t('trips.list.supervisors', { count: tr.supervisors.length })}</span>}
        {tr.status === 'OPEN' && daysLeft != null && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] ${daysLeft < 0 ? 'bg-slate-100 text-slate-500 border-slate-200' : daysLeft <= 2 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
            {daysLeft < 0 ? t('trips.list.deadlinePassed') : daysLeft === 0 ? t('trips.list.deadlineToday') : t('trips.list.deadlineIn', { count: daysLeft })}
          </span>
        )}
      </div>
      {targeted > 0 && (() => {
        // Where the targeted students stand: confirmed / approved but not paid
        // yet / declined / no answer.
        const awaitingPay = Math.max(0, (s.approved || 0) - confirmed);
        const declined = s.declined || 0;
        const none = Math.max(0, targeted - confirmed - awaitingPay - declined);
        const seg = [[confirmed, 'bg-emerald-500', 'confirmed'], [awaitingPay, 'bg-amber-400', 'awaiting'], [declined, 'bg-rose-400', 'declined'], [none, 'bg-slate-200', 'noAnswer']];
        const w = (n) => `${(n / targeted) * 100}%`;
        return (
          <div className="max-w-xl space-y-1">
            <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100" title={seg.map(([n, , k]) => `${t(`trips.list.seg.${k}`)}: ${n}`).join(' · ')}>
              {seg.filter(([n]) => n > 0).map(([n, cls, k]) => <div key={k} className={cls} style={{ width: w(n) }} />)}
            </div>
            <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
              {seg.map(([n, cls, k]) => <span key={k} className="inline-flex items-center gap-1"><i className={`w-2 h-2 rounded-full ${cls}`} />{t(`trips.list.seg.${k}`)} <b className="tabular-nums text-slate-700">{n}</b></span>)}
              <span className="font-medium text-emerald-700">{t('trips.list.participation', { pct })}</span>
            </div>
          </div>
        );
      })()}
      {tr.fee > 0 && (s.approved || 0) > 0 && (
        <div className="flex items-center gap-2 max-w-xl">
          <span className="text-[11px] text-slate-500 w-16 shrink-0">{t('trips.list.collected')}</span>
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${Math.min(100, Math.round(((s.collected || 0) / ((s.approved || 0) * tr.fee)) * 100))}%` }} /></div>
          <span className="text-[11px] text-slate-500 tabular-nums">{Math.min(100, Math.round(((s.collected || 0) / ((s.approved || 0) * tr.fee)) * 100))}%</span>
        </div>
      )}
    </div>
  );
}

// The students behind a trips-page indicator (tripEnrollmentsByStatus):
// coming trips only; a row opens its trip.
function EnrollmentDrill({ status, branchName, onClose, onOpenTrip }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    httpsCallable(functions, 'tripEnrollmentsByStatus')({ status }).then(({ data }) => setRows(data.rows)).catch((err) => setError(err.message));
  }, [status]);
  const shown = (rows || []).filter((r) => !q.trim() || `${r.studentName} ${r.studentId} ${r.tripTitle} ${r.className}`.includes(q.trim()));
  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(shown.map((r) => ({
      [t('trips.report.trip')]: r.tripTitle, [t('common.date')]: r.tripDate, [t('trips.col.student')]: r.studentName, [t('trips.col.nationalId')]: r.studentId,
      [t('trips.col.branch')]: branchName(r.branch), [t('trips.col.grade')]: `${r.grade} ${r.className}`.trim(), [t('trips.col.status')]: t(`trips.enrollment.${r.status}`),
      [t('trips.col.payMethod')]: r.payMethod ? t(`trips.payMethod.${r.payMethod}`) : '',
    })));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, `${t(`trips.drill.${status}`)}.xlsx`);
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-0 md:p-6">
      <div className="w-full max-w-5xl bg-white md:rounded-2xl shadow-2xl flex flex-col h-full md:h-auto md:max-h-full overflow-hidden">
        <div className="shrink-0 px-5 py-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-slate-900 flex-1">{t(`trips.drill.${status}`)} <span className="text-sm font-normal text-slate-500">— {t('trips.statComing')}{rows ? ` (${rows.length})` : ''}</span></h2>
          <div className="relative"><Search className="w-4 h-4 absolute top-2.5 right-3 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('trips.drill.search')} className="pr-9 pl-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
          <button onClick={exportXlsx} disabled={!shown.length} className="px-3 py-2 rounded-xl text-sm border border-emerald-300 text-emerald-700 bg-white flex items-center gap-1.5 disabled:opacity-50"><FileDown className="w-4 h-4" />Excel</button>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error ? <p className="p-6 text-sm text-rose-600">{error}</p> : !rows ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            : shown.length === 0 ? <p className="py-16 text-center text-sm text-slate-400">{t('trips.drill.empty')}</p> : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50"><tr className="text-slate-500 text-xs">
                  <th className="text-start px-4 py-2">{t('trips.col.student')}</th><th className="text-start">{t('trips.col.branch')}</th><th className="text-start">{t('trips.col.grade')}</th>
                  <th className="text-start">{t('trips.report.trip')}</th><th className="text-start">{t('trips.col.status')}</th><th className="text-start">{t('trips.col.payMethod')}</th>
                </tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={`${r.tripId}-${r.studentId}`} onClick={() => onOpenTrip(r.tripId)} className="border-b border-slate-50 cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{r.studentName}</p><p className="text-xs text-slate-400" dir="ltr">{r.studentId}</p></td>
                      <td className="text-slate-600">{branchName(r.branch)}</td>
                      <td className="text-slate-600" dir="ltr">{r.grade} {r.className}</td>
                      <td><p className="text-slate-800">{r.tripTitle}</p><p className="text-xs text-slate-400" dir="ltr">{r.tripDate}</p></td>
                      <td><span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${ENROLLMENT_STATUS_STYLES[r.status] || ''}`}>{t(`trips.enrollment.${r.status}`)}</span></td>
                      <td className="text-xs text-slate-600">{r.collectMethod ? t(`trips.collectMethod.${r.collectMethod}`) : r.payMethod ? t(`trips.payMethod.${r.payMethod}`) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}
