import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Activity, Loader2, Search, Users as UsersIcon, LogIn, Moon, Wifi } from 'lucide-react';
import { db, functions } from '../config/firebase';
import { useBranches } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import { ROLE_LABELS } from '../config/roles';

const ONLINE_MS = 3 * 60 * 1000;
const PAGE_NAMES = {
  '/dashboard': 'nav.dashboard', '/complaints': 'nav.complaints', '/lost-found': 'nav.lostFound', '/tech-support': 'nav.techSupport',
  '/reports': 'nav.reports', '/visits': 'nav.branchVisits', '/trips': 'nav.trips', '/students': 'nav.studentRecords', '/users': 'nav.users',
  '/settings': 'nav.settings', '/calls': 'nav.calls', '/wa-reports': 'nav.waReports', '/search': 'nav.advancedSearch', '/flow-map': 'nav.flowMap',
  '/activity': 'activity.title',
};

// «نشاط المستخدمين»: who is online now (presence heartbeats) and each
// account's last sign-in (Firebase Auth, getUserActivity). For the owner and
// the users the owner shares it with.
export default function UserActivity() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? ar : enUS;
  const branches = useBranches();
  const [accounts, setAccounts] = useState(null);
  const [presence, setPresence] = useState({});
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    const load = () => httpsCallable(functions, 'getUserActivity')().then(({ data }) => setAccounts(data.users)).catch((err) => setError(err.message));
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => onSnapshot(collection(db, 'presence'), (snap) => {
    setPresence(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])));
  }, (err) => setError(err.message)), []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const ago = (ms) => (ms ? formatDistanceToNowStrict(ms, { locale, addSuffix: true }) : '—');
  const branchLabel = (list) => (list.includes('*') ? t('common.allBranches') : list.map((id) => branches.find((b) => b.id === id)?.name || id).join('، ') || '—');

  const rows = useMemo(() => (accounts || []).map((u) => {
    const p = presence[u.id] || {};
    const seen = p.lastSeenAt?.toMillis?.() || null;
    const online = Boolean(seen && p.online !== false && now - seen < ONLINE_MS);
    const lastActive = Math.max(seen || 0, u.lastRefresh || 0) || null;
    return { ...u, online, seen, lastActive, page: p.page || '', device: p.device || '' };
  }).sort((a, b) => (b.online - a.online) || ((b.lastActive || 0) - (a.lastActive || 0))), [accounts, presence, now]);

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const stats = {
    online: rows.filter((r) => r.online).length,
    hour: rows.filter((r) => r.lastActive && now - r.lastActive < 3600e3).length,
    today: rows.filter((r) => (r.lastActive || 0) >= dayStart.getTime() || (r.lastSignIn || 0) >= dayStart.getTime()).length,
    idle: rows.filter((r) => r.active && (!r.lastActive || now - r.lastActive > 7 * 86400e3)).length,
  };
  const shown = rows.filter((r) => (filter === 'ALL' || (filter === 'ONLINE' && r.online) || (filter === 'TODAY' && ((r.lastActive || 0) >= dayStart.getTime())) || (filter === 'IDLE' && r.active && (!r.lastActive || now - r.lastActive > 7 * 86400e3)))
    && (!q.trim() || `${r.name} ${r.email} ${r.jobTitle}`.toLowerCase().includes(q.trim().toLowerCase())));
  const pageName = (path) => { const key = Object.keys(PAGE_NAMES).find((k) => path === k || path.startsWith(`${k}/`)); return key ? t(PAGE_NAMES[key]) : path || '—'; };
  const chip = (k) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${filter === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`activity.filters.${k}`)}</button>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Activity className="w-6 h-6 text-primary" />{t('activity.title')}</h1>
        <p className="text-slate-500 mt-1">{t('activity.subtitle')}</p>
      </div>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t('activity.onlineNow')} value={String(stats.online)} icon={Wifi} gradient="from-emerald-500 to-teal-600" />
        <StatCard title={t('activity.lastHour')} value={String(stats.hour)} icon={Activity} gradient="from-sky-500 to-blue-600" />
        <StatCard title={t('activity.today')} value={String(stats.today)} icon={LogIn} gradient="from-indigo-500 to-violet-600" />
        <StatCard title={t('activity.idle')} value={String(stats.idle)} icon={Moon} gradient="from-slate-500 to-slate-700" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {['ALL', 'ONLINE', 'TODAY', 'IDLE'].map(chip)}
          <div className="flex-1" />
          <div className="relative"><Search className="w-4 h-4 absolute top-2.5 right-3 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('activity.search')} className="pr-9 pl-3 py-2 border border-slate-200 rounded-xl text-sm" /></div>
        </div>
        {!accounts ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-100">
                <th className="text-start px-4 py-3">{t('activity.col.user')}</th><th className="text-start">{t('activity.col.status')}</th><th className="text-start">{t('activity.col.page')}</th>
                <th className="text-start">{t('activity.col.lastSignIn')}</th><th className="text-start">{t('activity.col.lastActive')}</th><th className="text-start">{t('activity.col.branches')}</th><th className="text-start">{t('activity.col.device')}</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={`border-b border-slate-50 ${!r.active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3"><p className="font-medium text-slate-900">{r.name || r.email}</p><p className="text-xs text-slate-500">{r.jobTitle || t(`roles.${r.role}`, ROLE_LABELS[r.role] || r.role)}{!r.active ? ` · ${t('activity.inactive')}` : ''}</p></td>
                    <td>{r.online
                      ? <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />{t('activity.online')}</span>
                      : <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />{r.lastActive ? ago(r.lastActive) : t('activity.never')}</span>}</td>
                    <td className="text-slate-600">{r.online ? pageName(r.page) : '—'}</td>
                    <td className="text-slate-600 whitespace-nowrap" title={r.lastSignIn ? format(r.lastSignIn, 'yyyy-MM-dd HH:mm') : ''}>{r.lastSignIn ? ago(r.lastSignIn) : t('activity.never')}</td>
                    <td className="text-slate-600 whitespace-nowrap" title={r.lastActive ? format(r.lastActive, 'yyyy-MM-dd HH:mm') : ''}>{ago(r.lastActive)}</td>
                    <td className="text-xs text-slate-500 max-w-48 truncate">{branchLabel(r.branches)}</td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{r.device || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="py-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><UsersIcon className="w-4 h-4" />{t('activity.empty')}</p>}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400">{t('activity.note')}</p>
    </div>
  );
}
