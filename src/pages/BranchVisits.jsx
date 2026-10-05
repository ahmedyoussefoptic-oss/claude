import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Armchair, Handshake, Clock, CalendarDays, Phone, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { branchScopeConstraintValues } from '../utils/scope';
import StatCard from '../components/dashboard/StatCard';

const isToday = (ts) => {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000));

// Branch QR check-ins (see BranchVisit.jsx / confirmBranchVisit) — the only
// page a reception employee (role RECEPTIONIST) can open, and firestore.rules
// only lets them list complaints flagged viaVisitQr. Shows who is waiting,
// for how long, and who met them — never the complaint details, internal
// comments or solution.
export default function BranchVisits() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('TODAY');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [now, setNow] = useState(() => Date.now());

  // Keeps the "waiting for X minutes" figures moving.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!userData) return;
    const constraints = [where('viaVisitQr', '==', true)];
    if (userData.role !== 'ADMIN' && userData.access !== 'all') {
      constraints.push(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const unsubscribe = onSnapshot(query(collection(db, 'complaints'), ...constraints), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.visitArrivedAt?.toMillis?.() || 0) - (a.visitArrivedAt?.toMillis?.() || 0));
      setVisits(list);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.role, userData?.access, userData?.branches?.join(',')]);

  const stats = useMemo(() => {
    const today = visits.filter((v) => isToday(v.visitArrivedAt));
    const metToday = today.filter((v) => v.visitStatus === 'MET' && v.visitMetAt);
    const waits = metToday.map((v) => minutesBetween(v.visitArrivedAt.toMillis(), v.visitMetAt.toMillis()));
    return {
      waiting: visits.filter((v) => v.visitStatus === 'WAITING').length,
      today: today.length,
      metToday: metToday.length,
      avgWait: waits.length ? Math.round(waits.reduce((s, m) => s + m, 0) / waits.length) : null,
    };
  }, [visits]);

  const shown = visits.filter((v) => (range === 'ALL' || isToday(v.visitArrivedAt) || v.visitStatus === 'WAITING')
    && (statusFilter === 'ALL' || v.visitStatus === statusFilter));

  const chip = (active, onClick, label) => (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${active ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Armchair className="w-6 h-6 text-primary" />
          {t('branchVisits.title')}
        </h1>
        <p className="text-slate-500 mt-1">{t('branchVisits.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t('branchVisits.waitingNow')} value={String(stats.waiting)} icon={Armchair} gradient="from-rose-500 to-red-600" />
        <StatCard title={t('branchVisits.today')} value={String(stats.today)} icon={CalendarDays} gradient="from-sky-500 to-blue-600" />
        <StatCard title={t('branchVisits.metToday')} value={String(stats.metToday)} icon={Handshake} gradient="from-emerald-500 to-teal-600" />
        <StatCard title={t('branchVisits.avgWait')} value={stats.avgWait == null ? '—' : t('branchVisits.minutes', { count: stats.avgWait })} icon={Clock} gradient="from-amber-400 to-orange-500" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {chip(range === 'TODAY', () => setRange('TODAY'), t('branchVisits.rangeToday'))}
          {chip(range === 'ALL', () => setRange('ALL'), t('branchVisits.rangeAll'))}
          <span className="w-px h-6 bg-slate-200 mx-1" />
          {chip(statusFilter === 'ALL', () => setStatusFilter('ALL'), t('branchVisits.statusAll'))}
          {chip(statusFilter === 'WAITING', () => setStatusFilter('WAITING'), t('branchVisits.statusWaiting'))}
          {chip(statusFilter === 'MET', () => setStatusFilter('MET'), t('branchVisits.statusMet'))}
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-slate-400 text-sm">{t('branchVisits.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((v) => {
              const waiting = v.visitStatus === 'WAITING';
              const arrived = v.visitArrivedAt?.toMillis?.();
              return (
                <li key={v.id} className={`p-4 flex flex-col md:flex-row md:items-center gap-3 ${waiting ? 'bg-rose-50/40' : ''}`}>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${waiting ? 'bg-rose-100 text-rose-600' : 'bg-teal-100 text-teal-600'}`}>
                    {waiting ? <Armchair className="w-5 h-5" /> : <Handshake className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900">
                      {v.parentName}
                      {v.parentPhone && <a href={`tel:${v.parentPhone}`} className="text-sm font-normal text-slate-500 mr-2 inline-flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" />{v.parentPhone}</a>}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {t('branchVisits.studentLine', { student: v.studentName, grade: [v.stage, v.grade].filter(Boolean).join(' — '), branch: branchName(v.branch) })}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">{t('branchVisits.reason')}: {v.subject}</p>
                    {v.assignedToNames?.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">{t('branchVisits.assigned')}: {v.assignedToNames.join(i18n.language === 'ar' ? '، ' : ', ')}</p>
                    )}
                  </div>
                  <div className="md:text-left shrink-0 space-y-1">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${waiting ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-teal-100 text-teal-700 border-teal-200'}`}>
                      {waiting ? t('branchVisits.statusWaiting') : t('branchVisits.statusMet')}
                    </span>
                    {arrived && (
                      <p className="text-xs text-slate-500">
                        {t('branchVisits.arrived', { time: format(v.visitArrivedAt.toDate(), 'p', { locale: dateLocale }) })}
                        {!isToday(v.visitArrivedAt) && ` · ${format(v.visitArrivedAt.toDate(), 'PP', { locale: dateLocale })}`}
                      </p>
                    )}
                    {waiting && arrived && (
                      <p className="text-xs font-bold text-rose-600">{t('branchVisits.waitingFor', { count: minutesBetween(arrived, now) })}</p>
                    )}
                    {!waiting && v.visitMetAt && (
                      <p className="text-xs text-teal-700">
                        {t('branchVisits.metBy', { name: v.visitMetByName || '—', time: format(v.visitMetAt.toDate(), 'p', { locale: dateLocale }) })}
                        {arrived && ` · ${t('branchVisits.waited', { count: minutesBetween(arrived, v.visitMetAt.toMillis()) })}`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
