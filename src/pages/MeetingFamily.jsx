import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Loader2, ShieldCheck, CheckCircle2, Star, AlertTriangle, Pencil, Ticket, UserRound, GraduationCap, Briefcase, Users as UsersIcon, ChevronDown, ChevronUp, ArrowLeftRight, LogOut } from 'lucide-react';
import { callMeeting } from '../config/meetings';

const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-2xl bg-white p-5 md:p-7 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';
const ROLE_ICONS = { ACADEMIC: GraduationCap, ADMIN: Briefcase, TEACHER: UsersIcon };
const STATUS_TONE = {
  REQUESTED: 'text-slate-600 bg-slate-50 border-slate-200', DIRECTED: 'text-amber-900 bg-amber-100 border-amber-300',
  IN_PROGRESS: 'text-sky-800 bg-sky-50 border-sky-200', DONE: 'text-emerald-700 bg-emerald-50 border-emerald-200',
};

// Session for this meeting link, kept in the browser (family link + key).
const storeKey = (token) => `meeting:fam:${token}`;
const readSession = (token) => { try { return JSON.parse(localStorage.getItem(storeKey(token)) || 'null'); } catch { return null; } };
const writeSession = (token, v) => { try { if (v) localStorage.setItem(storeKey(token), JSON.stringify(v)); else localStorage.removeItem(storeKey(token)); } catch { /* storage unavailable */ } };

// «مقابلات حسب الطلب»: the parent signs in with their national ID and
// mobile, picks for each child whom to meet and why, gets an entry QR; on
// the day the page becomes the ticket (who to meet, where to go now), and
// the survey once the interviews are over.
export default function MeetingFamily({ token }) {
  const { t } = useTranslation();
  const [sess, setSess] = useState(() => readSession(token));
  const [state, setState] = useState(null);
  const [others, setOthers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!!readSession(token));

  const refresh = useCallback(async (s = sess, quiet = false) => {
    if (!s) return;
    if (!quiet) setLoading(true);
    try {
      const r = await callMeeting('meetingFamilyState', { token: s.familyToken, session: s.session });
      setState(r);
    } catch (err) {
      if (/الجلسة|session/i.test(err.message)) { writeSession(token, null); setSess(null); setState(null); } else setError(err.message);
    } finally { setLoading(false); }
  }, [sess, token]);
  useEffect(() => { if (sess) refresh(sess); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // On the day: the ticket follows the interviews.
  useEffect(() => {
    if (!state?.invite.attended || state.allDone) return undefined;
    const timer = setInterval(() => refresh(sess, true), 15000);
    return () => clearInterval(timer);
  }, [state?.invite.attended, state?.allDone, refresh, sess]);

  const signOut = () => { writeSession(token, null); setSess(null); setState(null); setEditing(false); };

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-primary mt-10" />;
  if (!state) {
    return <SignIn token={token} onDone={(r) => {
      const s = { familyToken: r.familyToken, session: r.session };
      writeSession(token, s);
      setSess(s);
      setOthers(r.others || []);
      setState(r);
      setEditing(!r.invite.response && r.meeting.registrationOpen);
    }} />;
  }
  const { meeting, invite } = state;
  const head = (
    <div className="w-full max-w-2xl flex items-center justify-between text-xs text-slate-500">
      <span>{state.students.map((s) => s.name).join('، ')}</span>
      <button type="button" onClick={signOut} className="flex items-center gap-1 hover:text-primary"><LogOut className="w-3.5 h-3.5" />{t('meetings.family.signOut')}</button>
    </div>
  );

  if (state.surveyOpen) {
    return <>{head}{state.surveyDone ? <Done title={t('meetings.parent.surveyThanks')} /> : <FamilySurvey sess={sess} state={state} onDone={() => refresh()} />}</>;
  }
  if (invite.attended) return <>{head}<TicketView state={state} onRefresh={() => refresh()} /></>;
  if (meeting.status === 'COMPLETED') return <>{head}<div className={`${card} text-center text-slate-700`}>{t('meetings.parent.ended')}</div></>;
  if ((editing || !invite.response) && meeting.registrationOpen) {
    return <>{head}<RequestForm sess={sess} state={state} others={others} onSaved={(r) => { setState(r); setEditing(false); }} /></>;
  }
  if (invite.response) return <>{head}<FamilyConfirmation state={state} onEdit={meeting.registrationOpen ? () => setEditing(true) : null} /></>;
  return <>{head}<div className={`${card} text-center text-slate-600`}>{error || t('meetings.parent.closed')}</div></>;
}

function SignIn({ token, onDone }) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { onDone(await callMeeting('meetingFamilyVerify', { token, id, mobile })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />{t('meetings.family.signInTitle')}</h2>
      <p className="text-sm text-slate-500">{t('meetings.family.signInHint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.family.parentId')}</label>
          <input required inputMode="numeric" dir="ltr" value={id} onChange={(e) => setId(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.parentMobile')}</label>
          <input required inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={mobile} onChange={(e) => setMobile(e.target.value)} className={inputCls} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.continue')}</button>
    </form>
  );
}

function RequestForm({ sess, state, others, onSaved }) {
  const { t } = useTranslation();
  const keyOf = (studentId, staffId) => `${studentId}|${staffId}`;
  const [picks, setPicks] = useState(() => Object.fromEntries(state.requests.filter((r) => r.status !== 'CANCELLED').map((r) => [keyOf(r.studentId, r.staffId), r.purpose])));
  const [open, setOpen] = useState({}); // `${studentId}|${role}` → open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const locked = new Set(state.requests.filter((r) => ['IN_PROGRESS', 'DONE'].includes(r.status)).map((r) => keyOf(r.studentId, r.staffId)));
  const toggle = (k) => setPicks((p) => { const n = { ...p }; if (k in n) { if (!locked.has(k)) delete n[k]; } else n[k] = ''; return n; });
  const count = (studentId) => Object.keys(picks).filter((k) => k.startsWith(`${studentId}|`)).length;

  const send = async (response) => {
    setError(null);
    const requests = Object.entries(picks).map(([k, purpose]) => { const [studentId, staffId] = k.split('|'); return { studentId, staffId, purpose: purpose.trim() }; });
    if (response === 'ATTEND' && !requests.length) { setError(t('meetings.family.pickSomeone')); return; }
    if (response === 'ATTEND' && requests.some((r) => !r.purpose)) { setError(t('meetings.family.purposeRequired')); return; }
    setBusy(true);
    try { onSaved(await callMeeting('meetingFamilyRespond', { token: sess.familyToken, session: sess.session, response, requests })); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className={`${card} space-y-5`}>
      <div>
        <h2 className="font-bold text-slate-900">{t('meetings.family.pickTitle')}</h2>
        <p className="text-sm text-slate-500">{t('meetings.family.pickHint')}</p>
      </div>
      {state.students.map((s) => (
        <div key={s.id} className="border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-1.5"><UserRound className="w-4 h-4 text-primary" />{s.name}</p>
              <p className="text-xs text-slate-500">{s.branchName} · <span dir="ltr">{s.grade} {s.className}</span></p>
            </div>
            {count(s.id) > 0 && <span className="text-xs bg-primary/10 text-primary rounded-lg px-2 py-1">{t('meetings.family.selectedN', { count: count(s.id) })}</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {['ACADEMIC', 'ADMIN', 'TEACHER'].map((role) => {
              const list = s.options.filter((o) => o.role === role);
              const k = `${s.id}|${role}`;
              const Icon = ROLE_ICONS[role];
              const n = list.filter((o) => keyOf(s.id, o.id) in picks).length;
              return (
                <button key={role} type="button" disabled={!list.length} onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
                  className={`p-3 rounded-xl border text-start text-sm flex items-center justify-between gap-2 disabled:opacity-40 ${open[k] ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                  <span className="flex items-center gap-2 font-medium text-slate-800"><Icon className="w-4 h-4 text-primary" />{t(`meetings.family.meet.${role}`)}{n > 0 && <span className="text-xs text-primary">({n})</span>}</span>
                  {open[k] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
              );
            })}
          </div>
          {['ACADEMIC', 'ADMIN', 'TEACHER'].filter((role) => open[`${s.id}|${role}`]).map((role) => (
            <div key={role} className="bg-slate-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600">{t(`meetings.family.listOf.${role}`)}</p>
              {s.options.filter((o) => o.role === role).map((o) => {
                const k = keyOf(s.id, o.id);
                const on = k in picks;
                return (
                  <div key={o.id} className={`bg-white border rounded-xl p-2.5 ${on ? 'border-primary' : 'border-slate-200'}`}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={on} disabled={locked.has(k)} onChange={() => toggle(k)} />
                      <span className="font-medium text-slate-800">{o.name}</span>
                      {o.subject && <span className="text-xs text-slate-500">· {o.subject}</span>}
                    </label>
                    {on && <textarea rows={2} required value={picks[k]} disabled={locked.has(k)} onChange={(e) => setPicks((p) => ({ ...p, [k]: e.target.value }))} placeholder={t('meetings.family.purposePh')} className={`${inputCls} mt-2`} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {others.length > 0 && <p className="text-xs text-slate-500">{t('meetings.family.othersNote', { list: others.map((o) => `${o.name} (${o.grade})`).join('، ') })}</p>}
      {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button type="button" disabled={busy} onClick={() => send('ATTEND')} className="sm:col-span-2 py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.family.confirm')}</button>
        <button type="button" disabled={busy} onClick={() => send('DECLINE')} className="py-3 border border-slate-200 text-slate-600 rounded-xl text-sm">{t('meetings.parent.response.DECLINE')}</button>
      </div>
    </div>
  );
}

const byStudent = (state) => state.students.map((s) => ({ ...s, requests: state.requests.filter((r) => r.studentId === s.id) })).filter((s) => s.requests.length);

function FamilyConfirmation({ state, onEdit }) {
  const { t } = useTranslation();
  const { invite } = state;
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (invite.response === 'ATTEND') QRCode.toDataURL(invite.checkinLink, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => {});
  }, [invite.checkinLink, invite.response]);
  if (invite.response === 'DECLINE') {
    return (
      <div className={`${card} text-center space-y-3`}>
        <h2 className="text-xl font-bold text-slate-900">{t('meetings.parent.done.DECLINE')}</h2>
        {onEdit && <button type="button" onClick={onEdit} className="text-sm text-primary flex items-center gap-1 mx-auto hover:underline"><Pencil className="w-4 h-4" />{t('meetings.parent.edit')}</button>}
      </div>
    );
  }
  return (
    <div className={`${card} space-y-4 text-center`}>
      <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold text-slate-900">{t('meetings.parent.done.ATTEND')}</h2>
      {qr && <img src={qr} alt="QR" className="w-52 h-52 mx-auto border border-slate-100 rounded-xl" />}
      <p className="text-sm text-slate-600">{t('meetings.family.qrHint')}</p>
      <p className="text-2xl font-bold tracking-widest text-slate-900" dir="ltr">{invite.code}</p>
      <div className="text-start space-y-2">
        {byStudent(state).map((s) => (
          <div key={s.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-sm font-bold text-slate-800">{s.name} <span className="text-xs font-normal text-slate-500" dir="ltr">{s.grade} {s.className}</span></p>
            {s.requests.map((r) => <p key={r.id} className="text-sm text-slate-700 mt-1">• {r.staffName} <span className="text-xs text-slate-500">({t(`meetings.roles.${r.staffRole}`)})</span> — <span className="text-slate-500">{r.purpose}</span></p>)}
          </div>
        ))}
      </div>
      {onEdit && <button type="button" onClick={onEdit} className="text-sm text-primary flex items-center gap-1 mx-auto hover:underline"><Pencil className="w-4 h-4" />{t('meetings.family.edit')}</button>}
    </div>
  );
}

// The ticket on the day: the ticket number, the children, each interview and
// where to go when the supervisor directs the parent.
function TicketView({ state, onRefresh }) {
  const { t } = useTranslation();
  const now = state.requests.filter((r) => r.status === 'DIRECTED' || r.status === 'IN_PROGRESS');
  return (
    <div className={`${card} space-y-4`}>
      <div className="text-center">
        <p className="text-sm text-slate-500 flex items-center justify-center gap-1"><Ticket className="w-4 h-4" />{t('meetings.family.ticket')}</p>
        <p className="text-5xl font-bold text-primary my-1" dir="ltr">{state.invite.ticketNo ?? '—'}</p>
        <p className="text-sm text-slate-600">{state.meeting.title}</p>
      </div>
      {now.map((r) => (
        <div key={r.id} className={`rounded-xl border-2 p-3 text-center ${r.status === 'DIRECTED' ? 'border-amber-400 bg-amber-50' : 'border-sky-300 bg-sky-50'}`}>
          <p className="font-bold text-slate-900 flex items-center justify-center gap-1.5"><ArrowLeftRight className="w-4 h-4" />{r.status === 'DIRECTED' ? t('meetings.family.goNow', { name: r.staffName }) : t('meetings.family.inMeeting', { name: r.staffName })}</p>
          {r.room && <p className="text-sm text-slate-700">{r.room}</p>}
        </div>
      ))}
      {!now.length && <p className="text-sm text-center text-slate-600 bg-slate-50 rounded-xl p-3">{state.allDone ? t('meetings.family.allDone') : t('meetings.family.wait')}</p>}
      <div className="space-y-2">
        {byStudent(state).map((s) => (
          <div key={s.id} className="border border-slate-200 rounded-xl p-3">
            <p className="text-sm font-bold text-slate-800">{s.name} <span className="text-xs font-normal text-slate-500">· {s.branchName} · <span dir="ltr">{s.grade} {s.className}</span></span></p>
            {s.requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 mt-1.5 text-sm">
                <span>{r.staffName} <span className="text-xs text-slate-500">({t(`meetings.roles.${r.staffRole}`)})</span></span>
                <span className={`text-xs px-2 py-0.5 rounded-md border ${STATUS_TONE[r.status] || ''}`}>{t(`meetings.request.${r.status}`)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button type="button" onClick={onRefresh} className="text-xs text-slate-500 mx-auto block hover:text-primary">{t('meetings.family.autoRefresh')}</button>
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} onClick={() => onChange(n)} className="p-1" aria-label={String(n)}><Star className={`w-8 h-8 ${value >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>
      ))}
    </div>
  );
}

function FamilySurvey({ sess, state, onDone }) {
  const { t } = useTranslation();
  const [r, setR] = useState({ overall: 0, organization: 0, usefulness: 0 });
  const [people, setPeople] = useState({});
  const [answered, setAnswered] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!r.overall || !r.organization || !r.usefulness || !answered) { setError(t('meetings.parent.surveyIncomplete')); return; }
    setBusy(true);
    try { await callMeeting('meetingFamilySurvey', { token: sess.familyToken, session: sess.session, ...r, teachers: people, answered, comment }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <p className="font-bold text-slate-900">{t('meetings.parent.surveyTitle')}</p>
      {['overall', 'organization', 'usefulness'].map((k) => <div key={k}><p className="text-sm text-slate-700 mb-1">{t(`meetings.survey.${k}`)}</p><Stars value={r[k]} onChange={(v) => setR((x) => ({ ...x, [k]: v }))} /></div>)}
      {state.surveyTeachers.map((p) => (
        <div key={p.id}><p className="text-sm text-slate-700 mb-1">{t('meetings.family.ratePerson', { name: p.name, role: t(`meetings.roles.${p.role}`) })}</p><Stars value={people[p.id] || 0} onChange={(v) => setPeople((x) => ({ ...x, [p.id]: v }))} /></div>
      ))}
      <div>
        <p className="text-sm text-slate-700 mb-1">{t('meetings.survey.answered')}</p>
        <div className="grid grid-cols-3 gap-2">{['YES', 'PARTLY', 'NO'].map((k) => <button type="button" key={k} onClick={() => setAnswered(k)} className={`py-2.5 rounded-xl text-sm border ${answered === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`meetings.survey.answers.${k}`)}</button>)}</div>
      </div>
      <div><p className="text-sm text-slate-700 mb-1">{t('meetings.survey.comment')}</p><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.parent.surveySubmit')}</button>
    </form>
  );
}

function Done({ title }) {
  return (
    <div className={`${card} text-center`}>
      <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
    </div>
  );
}

