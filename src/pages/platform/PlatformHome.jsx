import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where, orderBy, limit, getCountFromServer } from 'firebase/firestore';
import { LayoutDashboard, DoorOpen, UserPlus, GraduationCap, Settings2, FileText, Bus, Armchair, ChevronLeft, Lock } from 'lucide-react';
import { isToday } from 'date-fns';
import { db } from '../../config/firebase';
import { useSlaSettings } from '../../utils/businessTime';
import { usePlatformSettings } from '../../config/platform';
import { leadOpen, stageOverdue, followUpOverdue } from '../../components/platform/leadUtils';

// منصة المكتشف — one screen over every module: today's leaves, the
// enrollment pipeline, re-enrollment, and the existing complaints / visits /
// trips, with a door into each.
export default function PlatformHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = usePlatformSettings();
  const slaCfg = useSlaSettings();
  const [leaves, setLeaves] = useState([]);
  const [leads, setLeads] = useState([]);
  const [reenroll, setReenroll] = useState([]);
  const [counts, setCounts] = useState({});

  useEffect(() => onSnapshot(query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'), limit(300)), (s) => setLeaves(s.docs.map((d) => d.data())), () => {}), []);
  useEffect(() => onSnapshot(collection(db, 'leads'), (s) => setLeads(s.docs.map((d) => d.data())), () => {}), []);
  useEffect(() => onSnapshot(query(collection(db, 'reenrollments'), where('year', '==', settings.academicYear)), (s) => setReenroll(s.docs.map((d) => d.data())), () => {}), [settings.academicYear]);
  useEffect(() => {
    Promise.all([
      getCountFromServer(collection(db, 'students')),
      getCountFromServer(query(collection(db, 'complaints'), where('status', 'in', ['RECEIVED', 'IN_PROGRESS', 'WAITING_PARENT_RESPONSE', 'ESCALATED']))),
      getCountFromServer(query(collection(db, 'complaints'), where('visitStatus', '==', 'WAITING'))),
    ]).then(([s, c, v]) => setCounts({ students: s.data().count, openComplaints: c.data().count, waitingVisits: v.data().count })).catch(() => {});
  }, []);

  const todayLeaves = leaves.filter((l) => l.requestedAt?.toDate && isToday(l.requestedAt.toDate()));
  const openLeads = leads.filter(leadOpen);
  const enrolled = leads.filter((l) => l.stage === 'ENROLLED').length;
  const overdueLeads = openLeads.filter((l) => stageOverdue(l, settings, slaCfg) || followUpOverdue(l)).length;
  const returning = reenroll.filter((r) => r.intent === 'RETURNING').length;
  const notReturning = reenroll.filter((r) => r.intent === 'NOT_RETURNING').length;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');

  const modules = [
    { to: '/platform/leaves', icon: DoorOpen, color: 'from-amber-400 to-orange-500', title: t('platform.leaves.title'), stats: [[t('platform.leaves.statPending'), leaves.filter((l) => l.status === 'PENDING').length], [t('platform.home.leavesToday'), todayLeaves.length], [t('platform.leaves.statExited'), todayLeaves.filter((l) => ['EXITED', 'RETURNED'].includes(l.status)).length]] },
    { to: '/platform/leads', icon: UserPlus, color: 'from-sky-500 to-blue-600', title: t('platform.leads.title'), stats: [[t('platform.leads.statOpen'), openLeads.length], [t('platform.leads.statOverdue'), overdueLeads], [t('platform.leads.report.conversion'), pct(enrolled, leads.length)]] },
    { to: '/platform/students', icon: GraduationCap, color: 'from-emerald-500 to-teal-600', title: t('platform.students.title'), stats: [[t('platform.home.students'), counts.students ?? '…'], [t('platform.reenroll.intents.RETURNING'), `${returning} (${pct(returning, counts.students)})`], [t('platform.reenroll.intents.NOT_RETURNING'), notReturning]] },
    { to: '/complaints', icon: FileText, color: 'from-violet-500 to-purple-600', title: t('nav.complaints'), stats: [[t('platform.home.openComplaints'), counts.openComplaints ?? '…']] },
    { to: '/visits', icon: Armchair, color: 'from-rose-500 to-red-600', title: t('nav.branchVisits'), stats: [[t('branchVisits.waitingNow'), counts.waitingVisits ?? '…']] },
    { to: '/trips', icon: Bus, color: 'from-indigo-500 to-blue-700', title: t('nav.trips'), stats: [] },
    { to: '/platform/settings', icon: Settings2, color: 'from-slate-500 to-slate-700', title: t('platform.settings.title'), stats: [] },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><LayoutDashboard className="w-6 h-6 text-primary" />{t('platform.home.title')}</h1>
        <p className="text-slate-500 mt-1">{t('platform.home.subtitle')}</p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3 inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />{t('platform.home.ownerOnly')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.to} onClick={() => navigate(m.to)} className="text-start bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition relative overflow-hidden">
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${m.color}`} />
              <div className="flex items-center justify-between">
                <span className={`w-10 h-10 rounded-xl bg-gradient-to-br ${m.color} text-white flex items-center justify-center`}><Icon className="w-5 h-5" /></span>
                <ChevronLeft className="w-5 h-5 text-slate-300" />
              </div>
              <p className="font-bold text-slate-900 mt-3">{m.title}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {m.stats.map(([label, value]) => <div key={label}><p className="text-lg font-bold text-slate-800 tabular-nums">{value}</p><p className="text-[11px] text-slate-500 leading-tight">{label}</p></div>)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
