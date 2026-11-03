import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Video, Loader2, RefreshCw, CalendarDays, Users as UsersIcon, UserX, Percent, Send, Settings2, AlertTriangle, CheckCircle2, Link2 } from 'lucide-react';
import { functions } from '../config/firebase';
import { useBranches } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import { VC_STATUSES, VC_STATUS_STYLES, VC_STATUS_BAR, vcRate } from '../config/attendance';
import SessionDetails from '../components/attendance/SessionDetails';
import AttendanceSettings from '../components/attendance/AttendanceSettings';

const riyadhDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

// «الحضور الافتراضي»: each day's Teams classes with who attended, the day's
// absences and their parent notices, and (admins) the Teams connection.
export default function VirtualAttendance() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? ar : enUS;
  const branches = useBranches();
  const [cfg, setCfg] = useState(null);
  const [view, setView] = useState('classes');
  const [day, setDay] = useState(riyadhDay);
  const [branch, setBranch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const loadConfig = useCallback(() => call('vcGetConfig').then(setCfg).catch((err) => setError(err.message)), []);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    call('vcDay', { day }).then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [day]);
  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { load(); }, [load]);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const sessions = useMemo(() => (data?.sessions || []).filter((s) => !branch || s.branch === branch), [data, branch]);
  const absences = useMemo(() => (data?.absences || []).filter((a) => !branch || a.branch === branch), [data, branch]);
  // One row per student, the classes missed under it.
  const absentStudents = useMemo(() => {
    const map = new Map();
    absences.forEach((a) => map.set(a.nationalId, [...(map.get(a.nationalId) || []), a]));
    return [...map.values()].map((list) => list.sort((a, b) => a.startAt - b.startAt)).sort((a, b) => b.length - a.length || a[0].studentName.localeCompare(b[0].studentName, 'ar'));
  }, [absences]);
  const totals = useMemo(() => {
    const counts = Object.fromEntries(VC_STATUSES.map((s) => [s, sessions.reduce((n, x) => n + (x.counts[s] || 0), 0)]));
    return { counts, rate: vcRate(counts), expected: sessions.reduce((n, x) => n + x.expected, 0) };
  }, [sessions]);
  const unsent = absentStudents.filter((list) => list.some((a) => !a.notifiedAt)).length;
  const time = (ms) => (ms ? format(ms, 'h:mm a', { locale }) : '—');

  const sendNotices = async () => {
    if (!window.confirm(t('vc.sendConfirm', { count: unsent }))) return;
    setSending(true);
    setSendResult(null);
    try {
      setSendResult(await call('vcSendNotices', { day }));
      load();
    } catch (err) {
      setSendResult({ error: err.message });
    } finally {
      setSending(false);
    }
  };

  const tabs = [['classes', CalendarDays], ['absences', UserX], ...(cfg?.canManage ? [['settings', Settings2]] : [])];
  const inputCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Video className="w-6 h-6 text-primary" />{t('vc.title')}</h1>
        <p className="text-slate-500 mt-1">{t('vc.subtitle')}</p>
      </div>

      {cfg && !cfg.connected && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{cfg.canManage ? t('vc.notConnectedAdmin') : t('vc.notConnected')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-1">
          {tabs.map(([k, Icon]) => (
            <button key={k} onClick={() => setView(k)} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${view === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon className="w-4 h-4" />{t(`vc.tabs.${k}`)}
            </button>
          ))}
        </div>
        {view !== 'settings' && (
          <>
            <div className="flex-1" />
            <input type="date" value={day} max={riyadhDay()} onChange={(e) => e.target.value && setDay(e.target.value)} className={inputCls} dir="ltr" />
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={t('common.branch')} className={inputCls}>
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={load} disabled={loading} className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label={t('vc.refresh')}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}

      {view === 'settings' ? <AttendanceSettings cfg={cfg} onSaved={loadConfig} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title={t('vc.stats.classes')} value={String(sessions.length)} icon={CalendarDays} gradient="from-sky-500 to-blue-600" />
            <StatCard title={t('vc.stats.expected')} value={String(totals.expected)} icon={UsersIcon} gradient="from-indigo-500 to-violet-600" />
            <StatCard title={t('vc.stats.rate')} value={totals.rate == null ? '—' : `${totals.rate}%`} icon={Percent} gradient="from-emerald-500 to-teal-600" />
            <StatCard title={t('vc.stats.absentStudents')} value={String(absentStudents.length)} icon={UserX} gradient="from-rose-500 to-pink-600" />
          </div>

          {!data && loading ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : view === 'classes' ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
              {sessions.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">{t('vc.noClasses', { day })}</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-slate-500 text-xs border-b border-slate-100">
                    {['time', 'subject', 'teacher', 'class', 'attendance', 'absent'].map((k) => <th key={k} className="text-start px-4 py-3 font-medium">{t(`vc.col.${k}`)}</th>)}
                  </tr></thead>
                  <tbody>
                    {sessions.map((s) => {
                      const total = VC_STATUSES.reduce((n, k) => n + (s.counts[k] || 0), 0);
                      return (
                        <tr key={s.id} onClick={() => setOpenId(s.id)} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">{time(s.startAt)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{s.subject || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{s.teacherName}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {s.className ? `${s.className} · ${branchName(s.branch)}` : '—'}
                            {s.status === 'DONE' && s.rosterSource === 'NONE' && <span className="block text-xs text-amber-700 flex items-center gap-1"><Link2 className="w-3 h-3" />{t('vc.needsClass')}</span>}
                          </td>
                          <td className="px-4 py-3 min-w-44">
                            {s.status === 'NO_REPORT' ? <span className="text-xs text-slate-400">{t('vc.noReport')}</span> : (
                              <>
                                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                                  {VC_STATUSES.filter((k) => s.counts[k]).map((k) => <div key={k} className={VC_STATUS_BAR[k]} style={{ width: `${(100 * s.counts[k]) / total}%` }} />)}
                                </div>
                                <p className="text-xs text-slate-500 mt-1 tabular-nums">{t('vc.attendedOf', { n: (s.counts.PRESENT || 0) + (s.counts.LATE || 0) + (s.counts.PARTIAL || 0), total })}</p>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums font-bold text-rose-700">{s.counts.ABSENT || 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
              <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600 flex-1">{t('vc.absencesHint')}</p>
                <button onClick={sendNotices} disabled={sending || !unsent || !cfg?.waReady || !cfg?.template} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('vc.sendNotices', { count: unsent })}
                </button>
              </div>
              {cfg && (!cfg.waReady || !cfg.template) && <p className="px-4 pt-3 text-xs text-amber-700">{!cfg.waReady ? t('vc.waOff') : t('vc.noTemplate')}</p>}
              {sendResult && (
                <p className={`mx-4 mt-3 text-sm rounded-lg p-2 ${sendResult.error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {sendResult.error || t('vc.sendResult', sendResult)}
                </p>
              )}
              {absentStudents.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">{t('vc.noAbsences')}</p> : (
                <ul className="divide-y divide-slate-100">
                  {absentStudents.map((list) => {
                    const a = list[0];
                    const notified = list.every((x) => x.notifiedAt);
                    const failed = list.find((x) => x.notifyError && !x.notifiedAt);
                    return (
                      <li key={a.nationalId} className="px-4 py-3 flex flex-wrap items-start gap-3">
                        <div className="flex-1 min-w-48">
                          <p className="font-medium text-slate-900">{a.studentName || a.nationalId}</p>
                          <p className="text-xs text-slate-500">{[a.className, branchName(a.branch)].filter(Boolean).join(' · ')}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {list.map((x) => (
                              <button key={x.sessionId} onClick={() => setOpenId(x.sessionId)} className={`px-2 py-0.5 rounded-md text-xs border ${VC_STATUS_STYLES.ABSENT}`}>
                                {x.subject || t('vc.class')} · {time(x.startAt)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <span className={`text-xs whitespace-nowrap flex items-center gap-1 ${notified ? 'text-emerald-700' : failed ? 'text-rose-700' : 'text-slate-400'}`}>
                          {notified ? <><CheckCircle2 className="w-3.5 h-3.5" />{t('vc.notified')}</> : failed ? <span title={failed.notifyError}>{t('vc.notifyFailed')}</span> : t('vc.notNotified')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {openId && <SessionDetails id={openId} onClose={() => setOpenId(null)} onChanged={load} branchName={branchName} />}
    </div>
  );
}
