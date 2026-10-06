import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Bus, Plus, CalendarDays, List, ChevronRight, ChevronLeft, Loader2, Hourglass, CheckCircle2, Wallet, AlertTriangle, MapPin, Users as UsersIcon, FileBarChart, Star } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, addDays, addMonths, isSameMonth } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { functions } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import TripForm from '../components/trips/TripForm';
import TripDetails from '../components/trips/TripDetails';
import TripsReport from '../components/trips/TripsReport';
import { canSeeTrips } from '../utils/scope';
import { TRIP_STATUSES, TRIP_STATUS_STYLES, TRIP_DOT, canCreateTrips, tripConflicts, dayToDate } from '../config/trips';

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
    && (statusFilter === 'ALL' || tr.status === statusFilter)), [trips, branchFilter, deptFilter, statusFilter]);

  const today = ymd(new Date());
  const stats = useMemo(() => ({
    upcoming: trips.filter((tr) => ['OPEN', 'CLOSED'].includes(tr.status) && tr.date >= today).length,
    pending: trips.filter((tr) => tr.status === 'PENDING_APPROVAL').length,
    confirmed: trips.filter((tr) => tr.date >= today && tr.status !== 'CANCELLED').reduce((s, tr) => s + (tr.stats?.confirmed || 0), 0),
    review: trips.filter((tr) => tr.status !== 'CANCELLED').reduce((s, tr) => s + (tr.stats?.review || 0), 0),
  }), [trips, today]);

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
        <StatCard title={t('trips.statUpcoming')} value={String(stats.upcoming)} icon={CalendarDays} gradient="from-sky-500 to-blue-600" />
        <StatCard title={t('trips.statPending')} value={String(stats.pending)} icon={Hourglass} gradient="from-amber-400 to-orange-500" />
        <StatCard title={t('trips.statConfirmed')} value={String(stats.confirmed)} icon={CheckCircle2} gradient="from-emerald-500 to-teal-600" />
        <StatCard title={t('trips.statReview')} value={String(stats.review)} icon={Wallet} gradient="from-violet-500 to-purple-600" />
      </div>

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
                              <span className="block truncate opacity-80" dir="ltr">{stageText(tr)}</span>
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
                      <p className="font-bold text-slate-900 flex items-center gap-2">
                        {tr.title}
                        <span className="text-xs font-mono font-normal text-slate-400" dir="ltr">{tr.tripCode}</span>
                        {conflict && <span className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('trips.conflictShort')}</span>}
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{tr.destination}</p>
                      <p className="text-xs text-slate-500 mt-1">{(tr.branches || []).map(branchName).join('، ')} · <span dir="ltr">{stageText(tr)}</span></p>
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
          onEdit={(trip) => setFormTrip(trip)}
          onChanged={load}
        />
      )}
    </div>
  );
}
