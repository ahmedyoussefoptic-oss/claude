import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, getDoc, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Phone, MessageCircle, Loader2, CheckCircle2, PhoneMissed, PhoneOff, Clock, FileText, ChevronDown, ChevronUp, Flame, ListChecks, ShieldCheck, Users as UsersIcon, Timer, AlertTriangle, CalendarClock, Printer } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { waLink } from '../../utils/whatsapp';
import { printPage, escapeHtml } from '../../utils/printPage';
import ComplaintForm from '../complaints/ComplaintForm';
import { inputCls, btn, Pill } from '../platform/ui';

const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const ms = (ts) => ts?.toMillis?.() || 0;
const notePath = (c) => `${c.finance ? '/finance' : '/complaints'}?openId=${encodeURIComponent(c.id)}`;
// A note number on a call, opening the note.
function NotePill({ c }) {
  const navigate = useNavigate();
  return <button type="button" onClick={(e) => { e.stopPropagation(); navigate(notePath(c)); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs bg-slate-50 text-primary border-slate-200 hover:bg-primary/5 font-mono" dir="ltr"><FileText className="w-3 h-3" />{c.no || c.id}</button>;
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const logAction = (data) => httpsCallable(functions, 'logCallTaskAction')(data).catch(() => {});
// The first day of a period in Riyadh: today, this week (from Sunday), this month.
function periodStart(period, today) {
  if (period === 'week') { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); }
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  return today;
}

// One call: the script, the parent's number, and the result in one step.
function TaskCard({ task, campaign, open, onToggle, onComplaint }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const [mode, setMode] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState(() => format(new Date(Date.now() + 3600e3), "yyyy-MM-dd'T'HH:mm"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const outcomes = campaign?.outcomes || [];

  const save = async (result) => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'recordCallResult')({
        taskId: task.id, result, outcome, note: note.trim(), ...(result === 'CALLBACK' ? { callbackAt: new Date(callbackAt).getTime() } : {}),
      });
      setMode(null);
      setNote('');
      setOutcome('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`border rounded-2xl ${task.priority === 'URGENT' ? 'border-rose-200' : 'border-slate-200'} bg-white`}>
      <button type="button" onClick={onToggle} className="w-full p-4 flex items-center gap-3 text-start">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
            {task.studentName}
            <span className="text-xs font-normal text-slate-500" dir="ltr">{task.grade}</span>
            {task.priority === 'URGENT' && <Pill className="bg-rose-50 text-rose-700 border-rose-200"><Flame className="w-3 h-3 ml-0.5" />{t('callTasks.urgent')}</Pill>}
            {task.attempts > 0 && <Pill className="bg-amber-50 text-amber-800 border-amber-200">{t('callTasks.attempt', { n: task.attempts + 1 })}</Pill>}
            {task.dueAt && <Pill className="bg-indigo-50 text-indigo-700 border-indigo-200"><CalendarClock className="w-3 h-3 ml-0.5" />{format(task.dueAt.toDate(), 'MM-dd HH:mm')}</Pill>}
            {(task.complaints || []).map((c) => <NotePill key={c.id} c={c} />)}
          </p>
          <p className="text-sm text-slate-500 truncate">{campaign?.title || task.campaignTitle} · {branches.find((b) => b.id === task.branch)?.name || task.branch}</p>
        </div>
        <span className="text-sm font-mono text-slate-700" dir="ltr">{task.phone}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${task.phone}`} className={`${btn.primary}`}><Phone className="w-4 h-4" />{t('callTasks.call')}</a>
            <a href={waLink(task.phone, '')} target="_blank" rel="noreferrer" onClick={() => logAction({ taskId: task.id, action: 'WHATSAPP' })} className={`${btn.ghost}`}><MessageCircle className="w-4 h-4 text-emerald-600" />{t('callTasks.whatsapp')}{task.waCount > 0 && <span className="text-xs text-emerald-700">({task.waCount})</span>}</a>
            <button type="button" onClick={onComplaint} className={btn.ghost}><FileText className="w-4 h-4" />{t('callTasks.toComplaint')}</button>
          </div>
          {campaign?.goal && <p className="text-sm text-slate-600"><b>{t('callTasks.goal')}:</b> {campaign.goal}</p>}
          {campaign?.script && <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-sm text-slate-700 whitespace-pre-line"><p className="text-xs font-bold text-sky-800 mb-1">{t('callTasks.script')}</p>{campaign.script}</div>}
          {(task.fileData || []).some((x) => Object.keys(x.data || {}).length) && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-slate-700 space-y-2">
              <p className="text-xs font-bold text-amber-800">{t('callTasks.file.fromFile')}</p>
              {task.fileData.filter((x) => Object.keys(x.data || {}).length).map((x, i) => (
                <div key={i}>
                  {task.fileData.length > 1 && <p className="text-xs font-bold text-slate-800">{x.name}</p>}
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                    {Object.entries(x.data).map(([k, v]) => <div key={k} className="flex gap-1.5 min-w-0"><dt className="text-slate-500 shrink-0">{k}:</dt><dd className="font-medium text-slate-900 break-words min-w-0">{v}</dd></div>)}
                  </dl>
                </div>
              ))}
            </div>
          )}
          {(task.history || []).length > 0 && (
            <ul className="text-xs text-slate-500 space-y-0.5">
              {task.history.map((h, i) => <li key={i}>{format(h.at.toDate(), 'yyyy-MM-dd HH:mm')} — {t(`callTasks.results.${h.result}`)}{h.note ? `: ${h.note}` : ''}</li>)}
            </ul>
          )}

          {mode === null && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button type="button" onClick={() => setMode('ANSWERED')} className="py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white flex items-center justify-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{t('callTasks.results.ANSWERED')}</button>
              <button type="button" disabled={busy} onClick={() => save('NO_ANSWER')} className="py-2.5 rounded-xl text-sm font-medium bg-amber-500 text-white flex items-center justify-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneMissed className="w-4 h-4" />}{t('callTasks.results.NO_ANSWER')}</button>
              <button type="button" onClick={() => setMode('CALLBACK')} className="py-2.5 rounded-xl text-sm font-medium bg-indigo-600 text-white flex items-center justify-center gap-1.5"><Clock className="w-4 h-4" />{t('callTasks.results.CALLBACK')}</button>
              <button type="button" onClick={() => setMode('WRONG_NUMBER')} className="py-2.5 rounded-xl text-sm font-medium bg-white border border-rose-200 text-rose-700 flex items-center justify-center gap-1.5"><PhoneOff className="w-4 h-4" />{t('callTasks.results.WRONG_NUMBER')}</button>
            </div>
          )}
          {mode && (
            <div className="bg-slate-50 rounded-xl p-3 space-y-2">
              <p className="text-sm font-bold text-slate-800">{t(`callTasks.results.${mode}`)}</p>
              {mode === 'ANSWERED' && outcomes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {outcomes.map((o) => <button type="button" key={o} onClick={() => setOutcome(o)} className={`px-3 py-1.5 rounded-lg text-sm border ${outcome === o ? 'bg-primary text-white border-primary' : 'bg-white border-slate-200 text-slate-700'}`}>{o}</button>)}
                </div>
              )}
              {mode === 'CALLBACK' && <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className={inputCls} dir="ltr" />}
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('callTasks.notePlaceholder')} className={inputCls} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={busy || (mode === 'ANSWERED' && outcomes.length > 0 && !outcome)} onClick={() => save(mode)} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button>
                <button type="button" onClick={() => { setMode(null); setError(null); }} className={btn.ghost}>{t('common.cancel')}</button>
              </div>
            </div>
          )}
          {mode === null && error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}

// A finished call (answered / failed) with what was done on it.
function DoneRow({ task, campaign }) {
  const { t } = useTranslation();
  const last = (task.history || [])[task.history.length - 1];
  return (
    <li className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{task.studentName}</span>
        <span className="text-xs text-slate-500" dir="ltr">{task.phone}</span>
        <Pill className={task.status === 'DONE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}>{task.outcome || t(`callTasks.results.${task.result}`, task.result || '')}</Pill>
        {last?.verified === true && <span className="text-emerald-700 text-xs inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />{mmss(last.talkSec || 0)}</span>}
        {task.waCount > 0 && <Pill className="bg-emerald-50 text-emerald-700 border-emerald-200"><MessageCircle className="w-3 h-3 ml-0.5" />{task.waCount}</Pill>}
        {(task.complaints || []).map((c) => <NotePill key={c.id} c={c} />)}
        <span className="text-xs text-slate-400 ms-auto">{campaign?.title || task.campaignTitle} · {task.completedAt ? format(task.completedAt.toDate(), 'MM-dd HH:mm') : ''}</span>
      </div>
      {task.note && <p className="text-xs text-slate-500 mt-1">{task.note}</p>}
    </li>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = 'text-slate-900', onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`text-start bg-white rounded-2xl border p-3 ${active ? 'border-primary ring-2 ring-primary/15' : 'border-slate-100'} ${onClick ? 'hover:border-primary/40' : ''}`}>
      <p className="text-xs text-slate-500 flex items-center gap-1">{Icon && <Icon className="w-3.5 h-3.5" />}{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </Tag>
  );
}

// «مهامي»: the agent's own indicators for a period (calls made, answered,
// no answer, callbacks, wrong numbers, talk time, WhatsApp, notes), the calls
// by state — due now, callbacks / retries, coming days, finished — and the
// whole team's indicators.
export default function MyCallTasks() {
  const { t, i18n } = useTranslation();
  const { user, userData } = useAuthStore();
  const [mine, setMine] = useState(null);
  const [campaigns, setCampaigns] = useState({});
  const [openId, setOpenId] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [period, setPeriod] = useState('today');
  const [tab, setTab] = useState('DUE');
  const [team, setTeam] = useState(null);
  const today = riyadhDay();

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(query(collection(db, 'callTasks'), where('assignedTo', '==', user.uid)),
      (snap) => setMine(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMine([]));
  }, [user]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  useEffect(() => {
    let alive = true;
    setTeam(null);
    httpsCallable(functions, 'callTeamStats')({ period }).then((r) => { if (alive) setTeam(r.data); }).catch(() => { if (alive) setTeam({ agents: [], totals: {} }); });
    return () => { alive = false; };
  }, [period]);
  const campaignIds = useMemo(() => [...new Set((mine || []).map((x) => x.campaignId))].sort().join(','), [mine]);
  useEffect(() => {
    campaignIds.split(',').filter(Boolean).forEach((id) => {
      getDoc(doc(db, 'callCampaigns', id)).then((s) => { if (s.exists()) setCampaigns((c) => ({ ...c, [id]: { id, ...s.data() } })); }).catch(() => {});
    });
  }, [campaignIds]);

  const startMs = Date.parse(`${periodStart(period, today)}T00:00:00+03:00`);
  const stats = useMemo(() => {
    const r = { attempts: 0, answered: 0, noAnswer: 0, callback: 0, wrong: 0, talkSec: 0, talked: 0, whatsapp: 0, complaints: 0, done: 0 };
    (mine || []).forEach((k) => {
      (k.history || []).filter((h) => h.byId === user?.uid && ms(h.at) >= startMs).forEach((h) => {
        r.attempts++;
        if (h.result === 'ANSWERED') r.answered++;
        else if (h.result === 'NO_ANSWER') r.noAnswer++;
        else if (h.result === 'CALLBACK') r.callback++;
        else if (h.result === 'WRONG_NUMBER') r.wrong++;
        if (h.verified === true && h.talkSec) { r.talkSec += h.talkSec; r.talked++; }
      });
      (k.actions || []).filter((a) => a.byId === user?.uid && ms(a.at) >= startMs).forEach((a) => { if (a.kind === 'WHATSAPP') r.whatsapp++; if (a.kind === 'COMPLAINT') r.complaints++; });
      if (k.status !== 'PENDING' && ms(k.completedAt) >= startMs) r.done++;
    });
    return r;
  }, [mine, startMs, user]);

  if (!mine) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const live = mine.filter((x) => x.status === 'PENDING' && (campaigns[x.campaignId]?.status || 'ACTIVE') === 'ACTIVE');
  const byPriority = (a, b) => (a.priority === 'URGENT' ? 0 : 1) - (b.priority === 'URGENT' ? 0 : 1) || a.dueDay.localeCompare(b.dueDay) || ms(a.dueAt) - ms(b.dueAt);
  const due = live.filter((x) => x.dueDay <= today && (!x.dueAt || ms(x.dueAt) <= now)).sort(byPriority);
  // Callbacks and unanswered retries waiting for their time (can be called now).
  const retry = live.filter((x) => x.dueAt && ms(x.dueAt) > now).sort((a, b) => ms(a.dueAt) - ms(b.dueAt));
  const upcoming = live.filter((x) => x.dueDay > today && !x.dueAt).sort(byPriority);
  const late = live.filter((x) => x.dueDay < today).length;
  const finished = mine.filter((x) => x.status !== 'PENDING' && ms(x.completedAt) >= startMs).sort((a, b) => ms(b.completedAt) - ms(a.completedAt));
  const doneToday = mine.filter((x) => (x.history || []).some((h) => h.byId === user?.uid && ms(h.at) >= Date.parse(`${today}T00:00:00+03:00`))).length;
  const totalToday = doneToday + due.length;
  const pctToday = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;
  const rate = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  // Calls I turned into a note in the period (newest first).
  const noted = mine.filter((x) => (x.actions || []).some((a) => a.kind === 'COMPLAINT' && a.byId === user?.uid && ms(a.at) >= startMs))
    .sort((a, b) => Math.max(...(b.actions || []).map((y) => ms(y.at))) - Math.max(...(a.actions || []).map((y) => ms(y.at))));
  const lists = { DUE: due, RETRY: retry, UPCOMING: upcoming, FINISHED: finished, NOTES: noted };
  // My indicators, the team's and my finished calls as a printable page (PDF).
  const printReport = () => {
    const e = escapeHtml;
    const k = (x) => t(`callTasks.my.k.${x}`);
    const tiles = [
      [k('attempts'), stats.attempts], [k('answered'), `${stats.answered} (${rate(stats.answered, stats.attempts)})`], [k('noAnswer'), stats.noAnswer], [k('callback'), stats.callback],
      [k('wrong'), stats.wrong], [k('talk'), stats.talked ? mmss(stats.talkSec / stats.talked) : '—'], [k('whatsapp'), stats.whatsapp], [k('complaints'), stats.complaints],
      [k('remaining'), live.length], [k('late'), late],
    ].map(([l, v]) => `<div class="tile"><div class="tl">${e(l)}</div><div class="tv">${e(v)}</div></div>`).join('');
    const cols = ['agent', 'attempts', 'answered', 'rate', 'noAnswer', 'done', 'whatsapp', 'complaints', 'pending', 'late'];
    const teamRows = team?.agents?.length ? [...team.agents, { id: '__t', name: t('callTasks.my.total'), ...team.totals }].map((a) => `<tr class="${a.id === team.me ? 'me' : ''}">${cols.map((c) => `<td>${c === 'agent' ? e(a.name || '—') : c === 'rate' ? rate(a.answered, a.attempts) : a[c] ?? 0}</td>`).join('')}</tr>`).join('') : '';
    const done = finished.map((x) => `<tr><td>${e(x.studentName)}</td><td dir="ltr">${e(x.phone)}</td><td>${e(x.outcome || t(`callTasks.results.${x.result}`, x.result || ''))}</td><td>${e(x.note || '')}</td><td>${(x.complaints || []).map((c) => e(c.no)).join(' ')}</td><td dir="ltr">${x.completedAt ? format(x.completedAt.toDate(), 'yyyy-MM-dd HH:mm') : ''}</td></tr>`).join('');
    printPage({
      title: t('callTasks.my.reportTitle'), subtitle: [userData?.name, t(`callTasks.my.period.${period}`), today].filter(Boolean).join(' · '),
      school: t('trips.print.school'), dir: i18n.dir(), lang: i18n.language,
      body: `<div class="tiles">${tiles}</div>
        ${teamRows ? `<h3>${e(t('callTasks.my.team', { period: t(`callTasks.my.period.${period}`) }))}</h3><table><thead><tr>${cols.map((c) => `<th>${e(t(`callTasks.my.col.${c}`))}</th>`).join('')}</tr></thead><tbody>${teamRows}</tbody></table>` : ''}
        <h3>${e(t('callTasks.my.tab.FINISHED'))} (${finished.length})</h3>${done ? `<table><tbody>${done}</tbody></table>` : '<p>—</p>'}`,
      css: `.tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px } .tile { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px } .tl { color: #64748b; font-size: 8pt } .tv { font-size: 14pt; font-weight: bold }
        table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 8px } th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: start } th { background: #f1f5f9 } tr.me td { background: #f0f9ff; font-weight: bold } h3 { color: #0369a1; font-size: 11pt; margin: 10px 0 4px }`,
    });
  };
  const card = (x) => <TaskCard key={x.id} task={x} campaign={campaigns[x.campaignId]} open={openId === x.id} onToggle={() => setOpenId(openId === x.id ? null : x.id)} onComplaint={() => setComplaint(x)} />;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500">{t('callTasks.todayProgress')}</p>
            <p className="text-2xl font-bold text-slate-900">{t('callTasks.doneOf', { done: doneToday, total: totalToday })}</p>
          </div>
          <p className="text-xs text-slate-500">{t('callTasks.my.pendingLine', { due: due.length, retry: retry.length, upcoming: upcoming.length, late })}</p>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mt-3"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pctToday}%` }} /></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-800">{t('callTasks.my.indicators')}</p>
        <button type="button" onClick={printReport} className={`${btn.ghost} ms-auto`}><Printer className="w-4 h-4" />{t('callTasks.my.pdf')}</button>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {['today', 'week', 'month'].map((p) => <button key={p} type="button" onClick={() => setPeriod(p)} className={`px-3 py-1 rounded-lg text-sm ${period === p ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500'}`}>{t(`callTasks.my.period.${p}`)}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Kpi icon={Phone} label={t('callTasks.my.k.attempts')} value={stats.attempts} sub={t('callTasks.my.k.doneSub', { n: stats.done })} />
        <Kpi icon={CheckCircle2} label={t('callTasks.my.k.answered')} value={stats.answered} sub={t('callTasks.my.k.rate', { rate: rate(stats.answered, stats.attempts) })} tone="text-emerald-700" />
        <Kpi icon={PhoneMissed} label={t('callTasks.my.k.noAnswer')} value={stats.noAnswer} tone="text-amber-700" onClick={() => setTab('RETRY')} active={tab === 'RETRY'} />
        <Kpi icon={Clock} label={t('callTasks.my.k.callback')} value={stats.callback} sub={t('callTasks.my.k.waiting', { n: retry.length })} tone="text-indigo-700" onClick={() => setTab('RETRY')} />
        <Kpi icon={PhoneOff} label={t('callTasks.my.k.wrong')} value={stats.wrong} tone="text-rose-700" />
        <Kpi icon={Timer} label={t('callTasks.my.k.talk')} value={stats.talked ? mmss(stats.talkSec / stats.talked) : '—'} sub={t('callTasks.my.k.talkSub', { n: stats.talked })} />
        <Kpi icon={MessageCircle} label={t('callTasks.my.k.whatsapp')} value={stats.whatsapp} tone="text-emerald-700" />
        <Kpi icon={FileText} label={t('callTasks.my.k.complaints')} value={stats.complaints} onClick={() => setTab('NOTES')} active={tab === 'NOTES'} />
        <Kpi icon={ListChecks} label={t('callTasks.my.k.remaining')} value={live.length} sub={t('callTasks.my.k.dueNow', { n: due.length })} tone="text-sky-700" onClick={() => setTab('DUE')} active={tab === 'DUE'} />
        <Kpi icon={AlertTriangle} label={t('callTasks.my.k.late')} value={late} tone={late ? 'text-rose-700' : 'text-slate-900'} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-2 border-b border-slate-100 flex flex-wrap gap-1">
          {Object.keys(lists).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`callTasks.my.tab.${k}`)} <span className={tab === k ? 'opacity-80' : 'text-slate-400'}>({lists[k].length})</span></button>)}
        </div>
        <div className="p-3">
          {tab === 'RETRY' && retry.length > 0 && <p className="text-xs text-slate-500 mb-2">{t('callTasks.my.retryHint')}</p>}
          {!lists[tab].length ? (
            <div className="p-8 text-center text-slate-500 text-sm"><ListChecks className="w-7 h-7 mx-auto mb-2 text-emerald-500" />{tab === 'DUE' ? t('callTasks.allDone') : t('callTasks.my.empty')}</div>
          ) : tab === 'FINISHED' || tab === 'NOTES' ? (
            <ul className="space-y-2">{lists[tab].slice(0, 300).map((x) => (x.status === 'PENDING' ? card(x) : <DoneRow key={x.id} task={x} campaign={campaigns[x.campaignId]} />))}</ul>
          ) : (
            <ul className="space-y-2">{lists[tab].slice(0, 300).map(card)}</ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-3"><UsersIcon className="w-4 h-4 text-primary" />{t('callTasks.my.team', { period: t(`callTasks.my.period.${period}`) })}</p>
        {!team ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !team.agents.length ? <p className="text-sm text-slate-400">—</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr>{['agent', 'attempts', 'answered', 'rate', 'noAnswer', 'done', 'whatsapp', 'complaints', 'pending', 'late'].map((k) => <th key={k} className="text-start py-1.5 px-2 whitespace-nowrap">{t(`callTasks.my.col.${k}`)}</th>)}</tr></thead>
            <tbody>
              {[...team.agents, { id: '__total', name: t('callTasks.my.total'), ...team.totals }].map((a) => (
                <tr key={a.id} className={`border-t border-slate-50 ${a.id === team.me ? 'bg-primary/5 font-medium' : ''} ${a.id === '__total' ? 'font-bold bg-slate-50' : ''}`}>
                  <td className="py-1.5 px-2 whitespace-nowrap">{a.name || '—'}{a.id === team.me && <span className="text-xs text-primary"> ({t('callTasks.my.you')})</span>}</td>
                  <td className="px-2 tabular-nums">{a.attempts}</td><td className="px-2 tabular-nums text-emerald-700">{a.answered}</td><td className="px-2 tabular-nums">{rate(a.answered, a.attempts)}</td>
                  <td className="px-2 tabular-nums text-amber-700">{a.noAnswer}</td><td className="px-2 tabular-nums">{a.done}</td><td className="px-2 tabular-nums">{a.whatsapp}</td><td className="px-2 tabular-nums">{a.complaints}</td>
                  <td className="px-2 tabular-nums text-sky-700">{a.pending}</td><td className={`px-2 tabular-nums ${a.late ? 'text-rose-700' : ''}`}>{a.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {complaint && <ComplaintForm onClose={() => setComplaint(null)} onCreated={({ id }) => logAction({ taskId: complaint.id, action: 'COMPLAINT', complaintDocId: id })} prefill={{ studentId: complaint.studentId, parentPhone: complaint.phone, details: t('callTasks.complaintDetails', { campaign: complaint.campaignTitle }) }} />}
    </div>
  );
}
