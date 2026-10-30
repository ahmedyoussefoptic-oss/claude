import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { format, subDays } from 'date-fns';
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Clock, Timer, Loader2, AlertTriangle, PhoneForwarded, Repeat } from 'lucide-react';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import { userBranches } from '../utils/scope';

const inputCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const mmss = (sec) => (sec == null || Number.isNaN(sec) ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const atMs = (c) => c.at?.toMillis?.() || 0;

// Call analytics from Bevatel (bevatelSync → calls): volume and answer rate
// per branch and agent, busy hours, and the missed calls nobody returned.
export default function Calls() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || (id ? id : t('calls.noBranch'));
  const [from, setFrom] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [branch, setBranch] = useState('ALL');
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [students, setStudents] = useState({}); // phone → names

  const allBranches = userData?.role === 'ADMIN' || userData?.access === 'all';
  const myBranches = allBranches ? null : userBranches(userData);

  useEffect(() => onSnapshot(doc(db, 'settings', 'bevatel'), (snap) => setCfg(snap.data() || {}), () => setCfg({})), []);

  useEffect(() => {
    let cancelled = false;
    setCalls(null);
    setError(null);
    const range = [where('day', '>=', from), where('day', '<=', to)];
    const scope = branch !== 'ALL' ? [where('branch', '==', branch)] : myBranches ? [where('branch', 'in', myBranches.length ? myBranches.slice(0, 30) : ['__NONE__'])] : [];
    getDocs(query(collection(db, 'calls'), ...scope, ...range))
      .then((snap) => { if (!cancelled) setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [from, to, branch, myBranches?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = useMemo(() => {
    if (!calls) return null;
    const inbound = calls.filter((c) => c.dir === 'in');
    const outbound = calls.filter((c) => c.dir === 'out');
    const answered = inbound.filter((c) => c.answered);
    const missed = inbound.filter((c) => !c.answered);
    // A missed call counts as returned once the number was called back or
    // got through on a later call.
    const lastHandled = new Map(); // phone → latest call-back or answered call
    calls.forEach((x) => { if (x.phone && (x.dir === 'out' || x.answered)) lastHandled.set(x.phone, Math.max(lastHandled.get(x.phone) || 0, atMs(x))); });
    const handledAfter = (c) => (lastHandled.get(c.phone) || 0) > atMs(c);
    const byPhone = new Map();
    missed.filter((c) => c.phone && !handledAfter(c)).forEach((c) => {
      const cur = byPhone.get(c.phone);
      if (!cur) byPhone.set(c.phone, { ...c, attempts: 1 });
      else byPhone.set(c.phone, { ...(atMs(c) > atMs(cur) ? c : cur), attempts: cur.attempts + 1 });
    });
    const notReturned = [...byPhone.values()].sort((x, y) => atMs(y) - atMs(x));

    const group = (list, key) => list.reduce((m, c) => { const k = key(c) || ''; (m[k] = m[k] || []).push(c); return m; }, {});
    const branchRows = Object.entries(group(calls, (c) => c.branch)).map(([b, list]) => {
      const inb = list.filter((c) => c.dir === 'in');
      const ans = inb.filter((c) => c.answered);
      return { branch: b, inbound: inb.length, answered: ans.length, missed: inb.length - ans.length, rate: pct(ans.length, inb.length), wait: avg(ans.map((c) => c.waitSec || 0)), outbound: list.length - inb.length, notReturned: notReturned.filter((c) => (c.branch || '') === b).length };
    }).sort((x, y) => y.inbound - x.inbound);
    const agentRows = Object.entries(group(calls.filter((c) => c.agent && (c.dir === 'out' || c.answered)), (c) => c.agent)).map(([agent, list]) => {
      const ans = list.filter((c) => c.dir === 'in');
      return { agent, answered: ans.length, outbound: list.length - ans.length, talk: avg(list.map((c) => c.talkSec || 0)) };
    }).sort((x, y) => (y.answered + y.outbound) - (x.answered + x.outbound));

    const hours = inbound.map((c) => c.hour).filter((h) => Number.isInteger(h));
    const minH = Math.min(7, ...hours);
    const maxH = Math.max(15, ...hours);
    const heat = Array.from({ length: 7 }, () => Array(maxH - minH + 1).fill(0));
    inbound.forEach((c) => { if (Number.isInteger(c.hour) && Number.isInteger(c.weekday)) heat[c.weekday][c.hour - minH]++; });
    const heatMax = Math.max(1, ...heat.flat());

    const repeat = Object.entries(group(inbound.filter((c) => c.phone), (c) => c.phone))
      .filter(([, list]) => list.length >= 3)
      .map(([phone, list]) => ({ phone, count: list.length, missed: list.filter((c) => !c.answered).length, branch: list[0].branch, last: Math.max(...list.map(atMs)) }))
      .sort((x, y) => y.count - x.count);

    return {
      inbound: inbound.length, answered: answered.length, missed: missed.length, outbound: outbound.length,
      rate: pct(answered.length, inbound.length), wait: avg(answered.map((c) => c.waitSec || 0)), talk: avg(answered.map((c) => c.talkSec || 0)),
      notReturned, branchRows, agentRows, heat, heatMax, minH, repeat,
    };
  }, [calls]);

  // Parent / student names for the numbers worth following up.
  useEffect(() => {
    if (!a) return;
    const phones = [...new Set([...a.notReturned.map((c) => c.phone), ...a.repeat.map((r) => r.phone)])].filter((p) => p && !(p in students)).slice(0, 90);
    if (!phones.length) return;
    const chunks = [];
    for (let i = 0; i < phones.length; i += 30) chunks.push(phones.slice(i, i + 30));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, 'students'), where('mobile', 'in', c))).catch(() => null)))
      .then((snaps) => {
        const found = Object.fromEntries(phones.map((p) => [p, []]));
        snaps.filter(Boolean).forEach((snap) => snap.docs.forEach((d) => { const s = d.data(); if (s.active !== false) found[s.mobile]?.push(s.nameAr || s.name); }));
        setStudents((prev) => ({ ...prev, ...found }));
      });
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = (phone) => (students[phone]?.length ? students[phone].join('، ') : '');
  const days = [t('calls.days.0'), t('calls.days.1'), t('calls.days.2'), t('calls.days.3'), t('calls.days.4'), t('calls.days.5'), t('calls.days.6')];
  const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-5';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><PhoneCall className="w-6 h-6 text-primary" />{t('calls.title')}</h1>
          <p className="text-slate-500 mt-1">{t('calls.subtitle')}</p>
          {cfg?.lastSyncAt && <p className="text-xs text-slate-400 mt-1">{t('calls.lastSync', { time: format(cfg.lastSyncAt.toDate(), 'yyyy-MM-dd HH:mm') })}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">{t('calls.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} block mt-1`} /></label>
          <label className="text-xs text-slate-500">{t('calls.to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputCls} block mt-1`} /></label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>
            <option value="ALL">{t('common.allBranches')}</option>
            {branches.filter((b) => !myBranches || myBranches.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {cfg && cfg.connected !== true && !cfg.webhookLastAt && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{t('calls.notConnected')}</div>
      )}
      {cfg?.lastSyncError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{t('calls.syncError', { error: cfg.lastSyncError })}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}
      {!a && !error && <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}

      {a && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title={t('calls.inbound')} value={String(a.inbound)} icon={PhoneIncoming} gradient="from-sky-500 to-blue-600" />
            <StatCard title={t('calls.answerRate')} value={`${a.rate}%`} icon={PhoneCall} gradient="from-emerald-500 to-teal-600" />
            <StatCard title={t('calls.missed')} value={String(a.missed)} icon={PhoneMissed} gradient="from-rose-500 to-pink-600" />
            <StatCard title={t('calls.notReturned')} value={String(a.notReturned.length)} icon={PhoneForwarded} gradient="from-amber-400 to-orange-500" />
            <StatCard title={t('calls.outbound')} value={String(a.outbound)} icon={PhoneOutgoing} gradient="from-indigo-500 to-violet-600" />
            <StatCard title={t('calls.avgWait')} value={mmss(a.wait)} icon={Clock} gradient="from-slate-500 to-slate-700" />
            <StatCard title={t('calls.avgTalk')} value={mmss(a.talk)} icon={Timer} gradient="from-cyan-500 to-teal-600" />
            <StatCard title={t('calls.repeatCallers')} value={String(a.repeat.length)} icon={Repeat} gradient="from-fuchsia-500 to-purple-600" />
          </div>

          <div className={card}>
            <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-1"><PhoneForwarded className="w-5 h-5 text-amber-500" />{t('calls.notReturnedTitle')}</h2>
            <p className="text-xs text-slate-500 mb-3">{t('calls.notReturnedHint')}</p>
            {a.notReturned.length === 0 ? <p className="text-sm text-emerald-700">{t('calls.allReturned')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-slate-500 text-xs border-b border-slate-100"><th className="text-start py-2">{t('calls.col.time')}</th><th className="text-start">{t('calls.col.number')}</th><th className="text-start">{t('calls.col.parentOf')}</th><th className="text-start">{t('calls.col.branch')}</th><th className="text-start">{t('calls.col.attempts')}</th></tr></thead>
                  <tbody>
                    {a.notReturned.slice(0, 100).map((c) => (
                      <tr key={c.id} className="border-b border-slate-50">
                        <td className="py-2 whitespace-nowrap" dir="ltr">{format(c.at.toDate(), 'MM-dd HH:mm')}</td>
                        <td><a href={`tel:${c.phone}`} className="text-primary font-medium" dir="ltr">{c.phone}</a></td>
                        <td className="text-slate-700">{who(c.phone) || <span className="text-slate-400">—</span>}</td>
                        <td className="text-slate-600">{branchName(c.branch)}{c.queueName ? <span className="text-xs text-slate-400"> · {c.queueName}</span> : null}</td>
                        <td>{c.attempts > 1 ? <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-xs">{c.attempts}×</span> : '1'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={card}>
              <h2 className="font-bold text-slate-900 mb-3">{t('calls.byBranch')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-slate-500 text-xs border-b border-slate-100"><th className="text-start py-2">{t('calls.col.branch')}</th><th>{t('calls.inbound')}</th><th>{t('calls.answerRate')}</th><th>{t('calls.missed')}</th><th>{t('calls.notReturned')}</th><th>{t('calls.avgWait')}</th><th>{t('calls.outbound')}</th></tr></thead>
                  <tbody>
                    {a.branchRows.map((r) => (
                      <tr key={r.branch} className="border-b border-slate-50 text-center">
                        <td className="py-2 text-start font-medium text-slate-800">{branchName(r.branch)}</td>
                        <td>{r.inbound}</td>
                        <td className={r.rate >= 90 ? 'text-emerald-700' : r.rate >= 75 ? 'text-amber-700' : 'text-rose-700'}>{r.inbound ? `${r.rate}%` : '—'}</td>
                        <td>{r.missed}</td>
                        <td className={r.notReturned ? 'text-rose-700 font-bold' : ''}>{r.notReturned}</td>
                        <td dir="ltr">{mmss(r.wait)}</td>
                        <td>{r.outbound}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={card}>
              <h2 className="font-bold text-slate-900 mb-3">{t('calls.byAgent')}</h2>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-sm">
                  <thead><tr className="text-slate-500 text-xs border-b border-slate-100"><th className="text-start py-2">{t('calls.col.agent')}</th><th>{t('calls.col.answered')}</th><th>{t('calls.outbound')}</th><th>{t('calls.avgTalk')}</th></tr></thead>
                  <tbody>
                    {a.agentRows.map((r) => (
                      <tr key={r.agent} className="border-b border-slate-50 text-center"><td className="py-2 text-start text-slate-800">{r.agent}</td><td>{r.answered}</td><td>{r.outbound}</td><td dir="ltr">{mmss(r.talk)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-bold text-slate-900 mb-1">{t('calls.heatTitle')}</h2>
            <p className="text-xs text-slate-500 mb-3">{t('calls.heatHint')}</p>
            <div className="overflow-x-auto">
              <table className="text-xs border-separate border-spacing-1">
                <thead><tr><th />{a.heat[0].map((_, i) => <th key={i} className="text-slate-500 font-normal" dir="ltr">{a.minH + i}</th>)}</tr></thead>
                <tbody>
                  {a.heat.map((row, d) => (
                    <tr key={d}>
                      <td className="text-slate-600 pe-2 whitespace-nowrap">{days[d]}</td>
                      {row.map((n, h) => (
                        <td key={h} title={String(n)} className="w-9 h-7 rounded-md text-center" style={{ background: n ? `rgba(3, 105, 161, ${0.12 + (0.88 * n) / a.heatMax})` : '#f1f5f9', color: n / a.heatMax > 0.5 ? 'white' : '#334155' }}>{n || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {a.repeat.length > 0 && (
            <div className={card}>
              <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-1"><Repeat className="w-5 h-5 text-fuchsia-500" />{t('calls.repeatTitle')}</h2>
              <p className="text-xs text-slate-500 mb-3">{t('calls.repeatHint')}</p>
              <ul className="divide-y divide-slate-100">
                {a.repeat.slice(0, 50).map((r) => (
                  <li key={r.phone} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <a href={`tel:${r.phone}`} className="text-primary font-medium" dir="ltr">{r.phone}</a>
                    <span className="text-slate-700">{who(r.phone)}</span>
                    <span className="text-slate-500">{branchName(r.branch)}</span>
                    <span className="ms-auto text-slate-600">{t('calls.repeatCount', { count: r.count, missed: r.missed })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
