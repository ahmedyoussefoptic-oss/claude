import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { format, subDays, eachDayOfInterval, parseISO } from 'date-fns';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { MessageSquareText, Inbox, Send, MessageCircleWarning, Timer, FileText, Loader2, Check, Info, ClipboardEdit, BarChart3 } from 'lucide-react';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import StatCard from '../components/dashboard/StatCard';
import { userBranches } from '../utils/scope';

// What the parents wrote about (counted by the branch each day).
export const WA_TOPICS = ['REGISTRATION', 'FEES', 'TRANSPORT', 'ACADEMIC', 'PLATFORMS', 'ABSENCE', 'COMPLAINT', 'TRIPS', 'GENERAL', 'OTHER'];
const NUMBER_FIELDS = ['newChats', 'received', 'sent', 'unanswered', 'responseMinutes', 'converted'];
const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(v) || 0)));
const isWorkday = (day) => ![5, 6].includes(parseISO(day).getDay()); // Fri, Sat

// «تحليل واتساب الفروع»: until the branches' WhatsApp numbers are connected
// to the API (Taqnyat coexistence), each branch enters a short daily report
// from its WhatsApp Business app (waDailyReports/<branch>_<day>); this page
// shows the totals, trends, topics and which branches have not reported.
export default function WaReports() {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const allBranches = useBranches();
  const all = userData?.role === 'ADMIN' || userData?.access === 'all';
  const mine = all ? null : userBranches(userData);
  const branches = allBranches.filter((b) => all || mine?.includes(b.id));
  const branchName = (id) => allBranches.find((b) => b.id === id)?.name || id;
  const [tab, setTab] = useState('entry');

  // ---- entry
  const [branch, setBranch] = useState('');
  const [day, setDay] = useState(format(new Date(), 'yyyy-MM-dd'));
  const empty = { newChats: '', received: '', sent: '', unanswered: '', responseMinutes: '', converted: '', topics: {}, notes: '' };
  const [form, setForm] = useState(empty);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (!branch && branches.length) setBranch(branches[0].id); }, [branches, branch]);
  useEffect(() => {
    if (!branch || !day) return;
    let cancelled = false;
    setLoadingEntry(true);
    setSaved(null);
    getDoc(doc(db, 'waDailyReports', `${branch}_${day}`))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setForm(d ? { ...empty, ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, d[k] ?? ''])), topics: d.topics || {}, notes: d.notes || '' } : empty);
        setSaved(d ? { by: d.submittedByName } : null);
      })
      .catch(() => { if (!cancelled) setForm(empty); })
      .finally(() => { if (!cancelled) setLoadingEntry(false); });
    return () => { cancelled = true; };
  }, [branch, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const topics = Object.fromEntries(Object.entries(form.topics).map(([k, v]) => [k, num(v)]).filter(([, v]) => v));
      await setDoc(doc(db, 'waDailyReports', `${branch}_${day}`), {
        branch, day, ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, num(form[k])])), topics, notes: form.notes.trim().slice(0, 500),
        submittedBy: user.uid, submittedByName: userData?.name || '', updatedAt: serverTimestamp(),
      });
      setSaved({ by: userData?.name || '', now: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- analysis
  const [from, setFrom] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filter, setFilter] = useState('ALL');
  const [reports, setReports] = useState(null);
  useEffect(() => {
    if (tab !== 'analysis') return;
    let cancelled = false;
    setReports(null);
    const range = [where('day', '>=', from), where('day', '<=', to)];
    const scope = filter !== 'ALL' ? [where('branch', '==', filter)] : mine ? [where('branch', 'in', mine.length ? mine.slice(0, 30) : ['__NONE__'])] : [];
    getDocs(query(collection(db, 'waDailyReports'), ...scope, ...range))
      .then((snap) => { if (!cancelled) setReports(snap.docs.map((d) => d.data())); })
      .catch((err) => { if (!cancelled) { setReports([]); setError(err.message); } });
    return () => { cancelled = true; };
  }, [tab, from, to, filter, mine?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = useMemo(() => {
    if (!reports) return null;
    const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0);
    const days = from <= to ? eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) => format(d, 'yyyy-MM-dd')) : [];
    const shownBranches = filter === 'ALL' ? branches.map((b) => b.id) : [filter];
    const rated = reports.filter((r) => r.responseMinutes != null);
    const topics = {};
    reports.forEach((r) => Object.entries(r.topics || {}).forEach(([k, v]) => { topics[k] = (topics[k] || 0) + v; }));
    const workdays = days.filter(isWorkday);
    const byBranch = shownBranches.map((b) => {
      const list = reports.filter((r) => r.branch === b);
      const rr = list.filter((r) => r.responseMinutes != null);
      return {
        branch: b, reported: list.length, expected: workdays.length, newChats: sum(list, 'newChats'), received: sum(list, 'received'), sent: sum(list, 'sent'),
        unanswered: sum(list, 'unanswered'), converted: sum(list, 'converted'), response: rr.length ? Math.round(sum(rr, 'responseMinutes') / rr.length) : null,
      };
    });
    return {
      newChats: sum(reports, 'newChats'), received: sum(reports, 'received'), sent: sum(reports, 'sent'), unanswered: sum(reports, 'unanswered'), converted: sum(reports, 'converted'),
      response: rated.length ? Math.round(sum(rated, 'responseMinutes') / rated.length) : null,
      trend: days.map((d) => ({ day: d.slice(5), chats: sum(reports.filter((r) => r.day === d), 'newChats') })),
      topics: Object.entries(topics).sort((x, y) => y[1] - x[1]), topicTotal: Object.values(topics).reduce((s, v) => s + v, 0),
      byBranch, days, has: new Set(reports.map((r) => `${r.branch}_${r.day}`)), shownBranches,
    };
  }, [reports, from, to, filter, branches]);

  const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-5';
  const field = (k) => (
    <div key={k}>
      <label className="block text-xs text-slate-600 mb-1">{t(`waReports.f.${k}`)}</label>
      <input type="number" min="0" inputMode="numeric" dir="ltr" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={inputCls} />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><MessageSquareText className="w-6 h-6 text-primary" />{t('waReports.title')}</h1>
        <p className="text-slate-500 mt-1">{t('waReports.subtitle')}</p>
      </div>
      <div className="flex gap-2">
        {[['entry', ClipboardEdit], ['analysis', BarChart3]].map(([k, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-medium border flex items-center gap-1.5 ${tab === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}><Icon className="w-4 h-4" />{t(`waReports.tabs.${k}`)}</button>
        ))}
      </div>

      {tab === 'entry' && (
        <form onSubmit={save} className={`${card} space-y-5`}>
          <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-xs text-sky-900 flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{t('waReports.howTo')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="block text-xs text-slate-600 mb-1">{t('common.branch')}</label><select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label className="block text-xs text-slate-600 mb-1">{t('waReports.day')}</label><input type="date" value={day} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setDay(e.target.value)} className={inputCls} /></div>
            <div className="flex items-end text-xs text-slate-500">{loadingEntry ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? t('waReports.savedBy', { name: saved.by || '' }) : t('waReports.notYet')}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{NUMBER_FIELDS.map(field)}</div>
          <div>
            <p className="text-xs font-bold text-slate-700 mb-2">{t('waReports.topicsTitle')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {WA_TOPICS.map((k) => (
                <label key={k} className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-2">
                  {t(`waReports.topics.${k}`)}
                  <input type="number" min="0" dir="ltr" value={form.topics[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, topics: { ...f.topics, [k]: e.target.value } }))} className="mt-1 w-full px-2 py-1 border border-slate-200 rounded-lg text-sm bg-white" />
                </label>
              ))}
            </div>
          </div>
          <div><label className="block text-xs text-slate-600 mb-1">{t('waReports.notes')}</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} placeholder={t('waReports.notesPlaceholder')} /></div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button disabled={saving || !branch} className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('waReports.save')}</button>
            {saved?.now && <span className="text-sm text-emerald-700 flex items-center gap-1"><Check className="w-4 h-4" />{t('waReports.saved')}</span>}
          </div>
        </form>
      )}

      {tab === 'analysis' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">{t('calls.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} block mt-1`} /></label>
            <label className="text-xs text-slate-500">{t('calls.to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputCls} block mt-1`} /></label>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="ALL">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {!a ? <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard title={t('waReports.f.newChats')} value={String(a.newChats)} icon={MessageSquareText} gradient="from-emerald-500 to-teal-600" />
                <StatCard title={t('waReports.f.received')} value={String(a.received)} icon={Inbox} gradient="from-sky-500 to-blue-600" />
                <StatCard title={t('waReports.f.sent')} value={String(a.sent)} icon={Send} gradient="from-indigo-500 to-violet-600" />
                <StatCard title={t('waReports.f.unanswered')} value={String(a.unanswered)} icon={MessageCircleWarning} gradient="from-rose-500 to-pink-600" />
                <StatCard title={t('waReports.f.responseMinutes')} value={a.response == null ? '—' : t('waReports.minutes', { n: a.response })} icon={Timer} gradient="from-amber-400 to-orange-500" />
                <StatCard title={t('waReports.f.converted')} value={String(a.converted)} icon={FileText} gradient="from-slate-500 to-slate-700" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={card}>
                  <h2 className="font-bold text-slate-900 mb-3">{t('waReports.trend')}</h2>
                  <div className="h-56" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={a.trend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="day" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="chats" stroke="#0369a1" fill="#0369a133" name={t('waReports.f.newChats')} /></AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className={card}>
                  <h2 className="font-bold text-slate-900 mb-3">{t('waReports.topicsTitle')}</h2>
                  {a.topics.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
                    <div className="space-y-1.5">
                      {a.topics.map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-32 text-slate-600 truncate">{t(`waReports.topics.${k}`)}</span>
                          <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((v / a.topicTotal) * 100)}%` }} /></div>
                          <span className="w-16 text-slate-600">{v} ({Math.round((v / a.topicTotal) * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={card}>
                <h2 className="font-bold text-slate-900 mb-3">{t('waReports.byBranch')}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-slate-500 text-xs border-b border-slate-100">
                      <th className="text-start py-2">{t('common.branch')}</th><th>{t('waReports.compliance')}</th><th>{t('waReports.f.newChats')}</th><th>{t('waReports.f.received')}</th><th>{t('waReports.f.sent')}</th><th>{t('waReports.f.unanswered')}</th><th>{t('waReports.f.responseMinutes')}</th><th>{t('waReports.f.converted')}</th>
                    </tr></thead>
                    <tbody>
                      {a.byBranch.map((r) => (
                        <tr key={r.branch} className="border-b border-slate-50 text-center">
                          <td className="py-2 text-start font-medium text-slate-800">{branchName(r.branch)}</td>
                          <td className={r.reported >= r.expected ? 'text-emerald-700' : 'text-rose-700 font-bold'}>{r.reported}/{r.expected}</td>
                          <td>{r.newChats}</td><td>{r.received}</td><td>{r.sent}</td>
                          <td className={r.unanswered ? 'text-rose-700 font-bold' : ''}>{r.unanswered}</td>
                          <td>{r.response == null ? '—' : t('waReports.minutes', { n: r.response })}</td><td>{r.converted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={card}>
                <h2 className="font-bold text-slate-900 mb-1">{t('waReports.grid')}</h2>
                <p className="text-xs text-slate-500 mb-3">{t('waReports.gridHint')}</p>
                <div className="overflow-x-auto">
                  <table className="text-xs border-separate border-spacing-1">
                    <thead><tr><th />{a.days.map((d) => <th key={d} className={`font-normal ${isWorkday(d) ? 'text-slate-500' : 'text-slate-300'}`} dir="ltr">{d.slice(5)}</th>)}</tr></thead>
                    <tbody>
                      {a.shownBranches.map((b) => (
                        <tr key={b}>
                          <td className="text-slate-700 pe-2 whitespace-nowrap">{branchName(b)}</td>
                          {a.days.map((d) => {
                            const ok = a.has.has(`${b}_${d}`);
                            return <td key={d} className={`w-8 h-7 rounded-md text-center ${ok ? 'bg-emerald-500 text-white' : isWorkday(d) ? 'bg-rose-100 text-rose-500' : 'bg-slate-100 text-slate-300'}`}>{ok ? '✓' : '—'}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
