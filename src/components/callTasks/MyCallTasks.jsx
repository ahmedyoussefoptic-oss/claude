import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot, doc, getDoc, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Phone, MessageCircle, Loader2, CheckCircle2, PhoneMissed, PhoneOff, Clock, FileText, ChevronDown, ChevronUp, Flame, ListChecks } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { waLink } from '../../utils/whatsapp';
import ComplaintForm from '../complaints/ComplaintForm';
import { inputCls, btn, Pill } from '../platform/ui';

const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const ms = (ts) => ts?.toMillis?.() || 0;

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
            <a href={waLink(task.phone, '')} target="_blank" rel="noreferrer" className={`${btn.ghost}`}><MessageCircle className="w-4 h-4 text-emerald-600" />{t('callTasks.whatsapp')}</a>
            <button type="button" onClick={onComplaint} className={btn.ghost}><FileText className="w-4 h-4" />{t('callTasks.toComplaint')}</button>
          </div>
          {campaign?.goal && <p className="text-sm text-slate-600"><b>{t('callTasks.goal')}:</b> {campaign.goal}</p>}
          {campaign?.script && <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-sm text-slate-700 whitespace-pre-line"><p className="text-xs font-bold text-sky-800 mb-1">{t('callTasks.script')}</p>{campaign.script}</div>}
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

// «مهامي اليوم»: the agent's calls due now (urgent campaigns first), the
// ones coming back later today, and today's progress.
export default function MyCallTasks() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [pending, setPending] = useState(null);
  const [touched, setTouched] = useState([]);
  const [campaigns, setCampaigns] = useState({});
  const [openId, setOpenId] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [now, setNow] = useState(Date.now());
  const today = riyadhDay();

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(query(collection(db, 'callTasks'), where('assignedTo', '==', user.uid), where('status', '==', 'PENDING')),
      (snap) => setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setPending([]));
  }, [user]);
  useEffect(() => {
    if (!user) return undefined;
    const start = new Date(`${today}T00:00:00+03:00`);
    return onSnapshot(query(collection(db, 'callTasks'), where('assignedTo', '==', user.uid), where('lastAttemptAt', '>=', Timestamp.fromDate(start))),
      (snap) => setTouched(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setTouched([]));
  }, [user, today]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  const campaignIds = useMemo(() => [...new Set((pending || []).map((x) => x.campaignId))].sort().join(','), [pending]);
  useEffect(() => {
    campaignIds.split(',').filter(Boolean).forEach((id) => {
      getDoc(doc(db, 'callCampaigns', id)).then((s) => { if (s.exists()) setCampaigns((c) => ({ ...c, [id]: { id, ...s.data() } })); }).catch(() => {});
    });
  }, [campaignIds]);

  const live = (pending || []).filter((x) => (campaigns[x.campaignId]?.status || 'ACTIVE') === 'ACTIVE');
  const due = live.filter((x) => x.dueDay <= today && (!x.dueAt || ms(x.dueAt) <= now))
    .sort((a, b) => (a.priority === 'URGENT' ? 0 : 1) - (b.priority === 'URGENT' ? 0 : 1) || a.dueDay.localeCompare(b.dueDay) || ms(a.dueAt) - ms(b.dueAt));
  const later = live.filter((x) => x.dueDay <= today && x.dueAt && ms(x.dueAt) > now).sort((a, b) => ms(a.dueAt) - ms(b.dueAt));
  const upcoming = live.filter((x) => x.dueDay > today).length;
  const doneToday = touched.length;
  const total = doneToday + due.length;
  const pct = total ? Math.round((doneToday / total) * 100) : 0;

  if (!pending) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500">{t('callTasks.todayProgress')}</p>
            <p className="text-2xl font-bold text-slate-900">{t('callTasks.doneOf', { done: doneToday, total })}</p>
          </div>
          <p className="text-xs text-slate-500">{t('callTasks.laterCount', { later: later.length, upcoming })}</p>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mt-3"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>

      {due.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-slate-500"><ListChecks className="w-8 h-8 mx-auto mb-2 text-emerald-500" />{t('callTasks.allDone')}</div>
      ) : (
        <ul className="space-y-2">
          {due.map((x) => <TaskCard key={x.id} task={x} campaign={campaigns[x.campaignId]} open={openId === x.id} onToggle={() => setOpenId(openId === x.id ? null : x.id)} onComplaint={() => setComplaint(x)} />)}
        </ul>
      )}
      {later.length > 0 && (
        <div>
          <p className="text-sm font-bold text-slate-600 mb-2">{t('callTasks.laterToday')}</p>
          <ul className="space-y-2 opacity-70">
            {later.map((x) => (
              <li key={x.id} className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm flex justify-between gap-2">
                <span>{x.studentName} · {campaigns[x.campaignId]?.title || x.campaignTitle}</span>
                <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{format(x.dueAt.toDate(), 'HH:mm')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {complaint && <ComplaintForm onClose={() => setComplaint(null)} prefill={{ studentId: complaint.studentId, parentPhone: complaint.phone, details: t('callTasks.complaintDetails', { campaign: complaint.campaignTitle }) }} />}
    </div>
  );
}
