import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Loader2, CheckCircle2, Star, AlertTriangle, Pencil, Ticket, ArrowLeftRight, LogOut, Sparkles, HeartHandshake, Check, Printer, ChevronDown } from 'lucide-react';
import logo from '../assets/logo.png';
import { callMeeting, RELATIONS, STAFF_POSITIONS, SUBJECTS, positionLabel } from '../config/meetings';

// The parents' pages share one look: a navy card (like a student card) with
// the school's logo, then white cards with coloured initials for the people.
const NAVY = 'bg-gradient-to-br from-[#1f3c64] via-[#1b345a] to-[#152a4a]';
const inputCls = 'w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-2xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-[#1f3c64] transition';
const card = 'w-full max-w-2xl bg-white p-5 md:p-7 rounded-[28px] shadow-lg shadow-slate-200/70 border border-slate-100';
const mainBtn = `w-full py-3.5 rounded-2xl text-white text-base font-bold ${NAVY} shadow-lg shadow-slate-300 hover:brightness-125 active:scale-[.99] transition flex items-center justify-center gap-2 disabled:opacity-60`;
const ROLE_DOT = { ACADEMIC: 'bg-violet-500', ADMIN: 'bg-amber-500', TEACHER: 'bg-blue-500' };
const AVATAR_TONES = ['bg-[#1f3c64]', 'bg-violet-500', 'bg-blue-500', 'bg-[#1f3c64]', 'bg-teal-500', 'bg-amber-500', 'bg-[#1f3c64]', 'bg-rose-500'];
const STATUS_TONE = {
  REQUESTED: 'text-slate-700 bg-slate-100', DIRECTED: 'text-amber-900 bg-amber-100',
  IN_PROGRESS: 'text-blue-800 bg-blue-100', DONE: 'text-emerald-800 bg-emerald-100',
};
const tail = (id) => `ID ••••${String(id || '').slice(-4)}`;

// Session for this meeting link, kept in the browser (family link + key).
const storeKey = (token) => `meeting:fam:${token}`;
const readSession = (token) => { try { return JSON.parse(localStorage.getItem(storeKey(token)) || 'null'); } catch { return null; } };
const writeSession = (token, v) => { try { if (v) localStorage.setItem(storeKey(token), JSON.stringify(v)); else localStorage.removeItem(storeKey(token)); } catch { /* storage unavailable */ } };

// Who will attend: typed once, filled in for the family's other branches
// (kept on this device until sign-out; open forms follow it as it's typed).
const ATT_KEY = 'meeting:attendee';
const ATT_EVENT = 'meeting-attendee';
const readAttendee = () => { try { const v = JSON.parse(localStorage.getItem(ATT_KEY) || 'null'); return v && typeof v.name === 'string' ? { name: v.name, relation: v.relation || '' } : null; } catch { return null; } };
const shareAttendee = (v, from) => {
  try { localStorage.setItem(ATT_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(ATT_EVENT, { detail: { v, from } }));
};
export const clearAttendee = () => { try { localStorage.removeItem(ATT_KEY); } catch { /* storage unavailable */ } };

function Avatar({ name, size = 'w-12 h-12 text-lg' }) {
  const s = String(name || '').trim();
  const h = [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  // The first letter of the name itself (titles such as «أ.» «د.» «Mr.» skipped).
  const word = s.split(/\s+/).find((w) => w.length > 1 && !/[.:]$/.test(w) && !/^(أ|د|م|ا)\.?$/.test(w)) || s;
  return <span className={`${size} ${AVATAR_TONES[h % AVATAR_TONES.length]} rounded-full text-white font-extrabold flex items-center justify-center shrink-0 uppercase`}>{word.replace(/^[^\p{L}]+/u, '').charAt(0) || '؟'}</span>;
}

// The navy card: logo, school, date, a big title, a row of facts, a tear line
// and a footer (status pill + a short id).
export function NavyCard({ date, title, sub, fields = [], pill, corner, children }) {
  const { t } = useTranslation();
  return (
    <div className={`w-full max-w-2xl rounded-[28px] ${NAVY} text-white shadow-2xl shadow-slate-400/40 overflow-hidden relative`}>
      <svg aria-hidden className="absolute -top-24 -start-24 w-[420px] h-[420px] text-white/10" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth=".4" /></svg>
      <div className="relative px-5 sm:px-7 pt-5 sm:pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="bg-white rounded-xl p-1.5 shrink-0"><img src={logo} alt="" className="h-9 w-auto" /></span>
            <span className="font-bold text-sm sm:text-base leading-tight">{t('tripConsent.schoolName')}</span>
          </div>
          {date && <span className="text-xs sm:text-base font-medium text-end leading-tight max-w-[45%]">{date}</span>}
        </div>
        {title && <h2 className="text-3xl sm:text-4xl font-extrabold mt-5 leading-tight break-words">{title}</h2>}
        {sub && <p className="text-white/75 text-[15px] mt-1">{sub}</p>}
        {fields.length > 0 && (
          <div className={`grid grid-cols-2 ${fields.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-x-4 gap-y-3 mt-5`}>
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <p className="text-sm text-white/65">{k}</p>
                <p className="text-xl font-extrabold truncate" dir="auto">{v}</p>
              </div>
            ))}
          </div>
        )}
        {children}
      </div>
      {(pill || corner) && (
        <>
          <div className="relative h-10 mt-3">
            <span className="absolute -start-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-50" />
            <span className="absolute -end-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-50" />
            <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-white/35" />
          </div>
          <div className="relative flex items-center justify-between gap-3 px-5 sm:px-7 pb-5">
            {pill ? <span className="bg-white/15 rounded-full px-4 py-1.5 text-[15px] font-bold">{pill}</span> : <span />}
            {corner && <span className="text-sm font-medium text-white/85" dir="ltr">{corner}</span>}
          </div>
        </>
      )}
      {!(pill || corner) && <div className="h-6" />}
    </div>
  );
}

// The three steps, so the parent knows where they are.
export function Steps({ at }) {
  const { t } = useTranslation();
  const steps = ['id', 'pick', 'ticket'];
  return (
    <div className="w-full max-w-2xl flex items-center justify-center gap-1 sm:gap-3 text-[11px] sm:text-sm">
      {steps.map((k, i) => (
        <div key={k} className="flex items-center gap-1 sm:gap-3">
          <span className={`flex items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-full ps-1 pe-2 sm:pe-3 py-1 font-bold ${i < at ? 'bg-emerald-500 text-white' : i === at ? `${NAVY} text-white shadow` : 'bg-white text-slate-400 border border-slate-200'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${i <= at ? 'bg-white/25' : 'bg-slate-100'}`}>{i < at ? <Check className="w-3 h-3" /> : i + 1}</span>
            {t(`meetings.family.steps.${k}`)}
          </span>
          {i < steps.length - 1 && <span className={`w-2 sm:w-8 h-0.5 rounded ${i < at ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

// «مقابلات حسب الطلب»: the parent signs in with their national ID, picks
// for each child whom to meet and why and who will attend, gets an entry QR;
// on the day the page becomes the ticket (who to meet, where to go now), and
// the survey once the interviews are over.
export default function MeetingFamily({ token }) {
  const [sess, setSess] = useState(() => readSession(token));
  const [first, setFirst] = useState(null); // the sign-in reply

  const signOut = () => { writeSession(token, null); clearAttendee(); setSess(null); setFirst(null); };
  if (!sess) {
    return (
      <>
        <Steps at={0} />
        <SignIn onSubmit={(v) => callMeeting('meetingFamilyVerify', { token, ...v })} onDone={(r) => {
          const s = { familyToken: r.familyToken, session: r.session };
          writeSession(token, s);
          setFirst(r);
          setSess(s);
        }} />
      </>
    );
  }
  return (
    <>
      <SignOutBar onClick={signOut} />
      <FamilyPanel sess={sess} initial={first} others={first?.others || []} onExpired={signOut} />
    </>
  );
}

export function SignOutBar({ onClick }) {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-2xl flex justify-end">
      <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-sm text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1 hover:text-rose-600 hover:border-rose-200"><LogOut className="w-4 h-4" />{t('meetings.family.signOut')}</button>
    </div>
  );
}

// One meeting for one family (also used for each branch on the portal).
export function FamilyPanel({ sess, initial, others = [], onExpired, showSteps = true }) {
  const { t } = useTranslation();
  const [state, setState] = useState(initial || null);
  const [editing, setEditing] = useState(!!initial && !initial.invite.response && initial.meeting.registrationOpen);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!initial);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setState(await callMeeting('meetingFamilyState', { token: sess.familyToken, session: sess.session }));
    } catch (err) {
      if (/الجلسة|session/i.test(err.message)) onExpired?.(); else setError(err.message);
    } finally { setLoading(false); }
  }, [sess, onExpired]);
  useEffect(() => { if (!initial) refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // On the day: the ticket follows the interviews.
  useEffect(() => {
    if (!state?.invite.attended || state.allDone) return undefined;
    const timer = setInterval(() => refresh(true), 15000);
    return () => clearInterval(timer);
  }, [state?.invite.attended, state?.allDone, refresh]);

  if (loading) return <Loader2 className="w-9 h-9 animate-spin text-[#1f3c64] mt-6" />;
  if (!state) return <div className={`${card} text-center text-slate-600`}>{error}</div>;
  const { meeting, invite } = state;
  const steps = (at) => (showSteps ? <Steps at={at} /> : null);
  if (meeting.status === 'CANCELLED') return <div className={`${card} text-center text-slate-700`}>{t('meetings.parent.cancelled')}</div>;
  if (state.surveyOpen) return state.surveyDone ? <Done title={t('meetings.parent.surveyThanks')} /> : <FamilySurvey sess={sess} state={state} onDone={() => refresh()} />;
  if (invite.attended) return <TicketView state={state} onRefresh={() => refresh()} />;
  if (meeting.status === 'COMPLETED') return <div className={`${card} text-center text-slate-700`}>{t('meetings.parent.ended')}</div>;
  if ((editing || !invite.response) && meeting.registrationOpen) {
    return <>{steps(1)}<RequestForm sess={sess} state={state} others={others} onSaved={(r) => { setState(r); setEditing(false); }} /></>;
  }
  if (invite.response) return <>{steps(2)}<FamilyConfirmation state={state} onEdit={meeting.registrationOpen ? () => setEditing(true) : null} /></>;
  return <div className={`${card} text-center text-slate-600`}>{error || t('meetings.parent.closed')}</div>;
}

export function SignIn({ onSubmit, onDone, title, hint }) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { onDone(await onSubmit({ id })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <>
      <NavyCard title={title || t('meetings.family.welcomeTitle')} sub={t('meetings.family.welcomeSub')} />
      <form onSubmit={submit} className={`${card} space-y-4`}>
        <p className="text-[15px] text-slate-600">{hint || t('meetings.family.signInHint')}</p>
        <div>
          <label className="block text-[15px] font-bold text-slate-800 mb-1.5">{t('meetings.family.parentId')}</label>
          <input required autoFocus inputMode="numeric" autoComplete="off" dir="ltr" value={id} onChange={(e) => setId(e.target.value)} placeholder={t('meetings.family.idPh')}
            className={`${inputCls} text-center text-xl font-bold tracking-[0.2em] placeholder:tracking-normal placeholder:font-normal placeholder:text-base`} />
        </div>
        {error && <p className="text-[15px] text-rose-700 bg-rose-50 border border-rose-100 rounded-2xl p-3 flex items-center gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>}
        <button disabled={busy} className={mainBtn}>{busy && <Loader2 className="w-5 h-5 animate-spin" />}{t('tripConsent.continue')}</button>
      </form>
    </>
  );
}

function AttendeeFields({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className={`${card} space-y-4`}>
      <p className="font-extrabold text-slate-900 text-xl flex items-center gap-2"><HeartHandshake className="w-6 h-6 text-rose-500" />{t('meetings.family.attendeeTitle')}</p>
      <div>
        <label className="block text-[15px] font-bold text-slate-800 mb-1.5">{t('meetings.family.attendeeName')}</label>
        <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={t('meetings.family.attendeeNamePh')} className={inputCls} maxLength={80} />
      </div>
      <div>
        <p className="text-[15px] font-bold text-slate-800 mb-2">{t('meetings.family.relation')}</p>
        <div className="flex flex-wrap gap-2">
          {RELATIONS.map((r) => (
            <button key={r} type="button" onClick={() => onChange({ ...value, relation: r })}
              className={`px-4 py-2 rounded-full text-[15px] font-bold border-2 transition ${value.relation === r ? `${NAVY} border-transparent text-white shadow` : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'}`}>
              {t(`meetings.family.relations.${r}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// A person to meet: initials, name, subject; tapping picks them and opens
// the purpose box.
function PersonRow({ person, on, locked, purpose, onToggle, onPurpose }) {
  const { t } = useTranslation();
  return (
    <div className={`bg-white rounded-3xl border-2 transition ${on ? 'border-[#1f3c64] shadow-md shadow-slate-200' : 'border-slate-100 hover:border-slate-300'}`}>
      <button type="button" disabled={locked} onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-4 text-start">
        <span className="flex items-center gap-3 min-w-0">
          <Avatar name={person.name} />
          <span className="min-w-0">
            <span className="block text-lg font-extrabold text-slate-900 leading-snug break-words" dir="auto">{person.name}</span>
            {person.subject && <span className="block text-[15px] text-slate-500 leading-snug break-words" dir="auto">{person.subject}</span>}
          </span>
        </span>
        {on
          ? <span className="flex items-center gap-1 text-[15px] font-bold text-emerald-700 shrink-0"><span className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check className="w-4 h-4" /></span>{t('meetings.family.chosen')}</span>
          : <span className="text-[15px] text-slate-400 shrink-0">{t('meetings.family.choose')}</span>}
      </button>
      {on && (
        <div className="px-4 pb-4 -mt-1">
          <textarea rows={2} value={purpose} disabled={locked} onChange={(e) => onPurpose(e.target.value)} placeholder={t('meetings.family.purposePh')} className={`${inputCls} text-[15px]`} />
        </div>
      )}
    </div>
  );
}

// The positions of one manager section, in a fixed order, each with the
// person holding it in this meeting (none → shown as not available); people
// without a position set come last, by their title.
function positionSlots(t, role, list) {
  const out = [];
  const used = new Set();
  (STAFF_POSITIONS[role] || []).forEach((pos) => {
    (pos === 'SUBJECT_SUPERVISOR' ? SUBJECTS : [null]).forEach((sub) => {
      const label = sub ? t('meetings.positions.supervisorOf', { subject: t(`meetings.subjects.${sub}`) }) : t(`meetings.positions.${pos}`);
      const holders = list.filter((o) => o.position === pos && (sub ? o.posSubject === sub : true));
      if (!holders.length) out.push({ key: `${pos}|${sub || ''}`, label, staff: null });
      holders.forEach((h) => { used.add(h.id); out.push({ key: h.id, label: holders.length > 1 ? `${label} — ${h.name}` : label, staff: h }); });
    });
  });
  list.filter((o) => !used.has(o.id)).forEach((o) => out.push({ key: o.id, label: o.subject || positionLabel(t, o) || o.name, staff: o }));
  return out;
}

// A manager section: a drop-down of the positions; each choice becomes a
// card (with the purpose box) under it.
function ManagerPicker({ role, list, studentId, picks, locked, keyOf, onAdd, onToggle, onPurpose }) {
  const { t } = useTranslation();
  const slots = positionSlots(t, role, list);
  const chosen = list.filter((o) => keyOf(studentId, o.id) in picks);
  const picked = new Set(chosen.map((o) => o.id));
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <select value="" onChange={(e) => { const sl = slots.find((x) => x.key === e.target.value); if (sl?.staff) onAdd(sl.staff); }}
          className={`${inputCls} appearance-none pe-11 font-bold text-[#1b345a] cursor-pointer`} aria-label={t(`meetings.family.listOf.${role}`)}>
          <option value="">{t('meetings.family.pickFromList')}</option>
          {slots.map((sl) => (
            <option key={sl.key} value={sl.key} disabled={!sl.staff || picked.has(sl.staff.id)}>
              {sl.label}{!sl.staff ? ` — ${t('meetings.family.unavailable')}` : picked.has(sl.staff.id) ? ` ✓ ${t('meetings.family.picked')}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="w-5 h-5 text-slate-400 absolute top-1/2 -translate-y-1/2 end-4 pointer-events-none" />
      </div>
      {chosen.map((o) => {
        const k = keyOf(studentId, o.id);
        const person = o.slot ? { ...o, name: positionLabel(t, o), subject: t('meetings.family.onDutyNote') } : { ...o, subject: positionLabel(t, o) || o.subject };
        return <PersonRow key={o.id} person={person} on locked={locked.has(k)} purpose={picks[k] || ''} onToggle={() => onToggle(k)} onPurpose={(v) => onPurpose(k, v)} />;
      })}
    </div>
  );
}

function RequestForm({ sess, state, others, onSaved }) {
  const { t, i18n } = useTranslation();
  const keyOf = (studentId, staffId) => `${studentId}|${staffId}`;
  const [picks, setPicks] = useState(() => Object.fromEntries(state.requests.filter((r) => r.status !== 'CANCELLED').map((r) => [keyOf(r.studentId, r.staffId), r.purpose])));
  const [attendee, setAttendeeState] = useState(() => (state.invite.attendee ? { name: state.invite.attendee.name, relation: state.invite.attendee.relation } : readAttendee() || { name: '', relation: '' }));
  // Typed here → shared with the other branches' forms; typed there → taken
  // here unless this form's own answer was already given.
  const formId = useRef(Math.random().toString(36)).current;
  const own = useRef(!!state.invite.attendee);
  const setAttendee = (v) => { own.current = false; setAttendeeState(v); shareAttendee(v, formId); };
  useEffect(() => {
    const on = (e) => { if (e.detail.from !== formId && !own.current) setAttendeeState(e.detail.v); };
    window.addEventListener(ATT_EVENT, on);
    return () => window.removeEventListener(ATT_EVENT, on);
  }, [formId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const locked = new Set(state.requests.filter((r) => ['IN_PROGRESS', 'DONE'].includes(r.status)).map((r) => keyOf(r.studentId, r.staffId)));
  const toggle = (k) => setPicks((p) => { const n = { ...p }; if (k in n) { if (!locked.has(k)) delete n[k]; } else n[k] = ''; return n; });
  const count = (studentId) => Object.keys(picks).filter((k) => k.startsWith(`${studentId}|`)).length;
  const date = i18n.language === 'ar' ? state.meeting.dateLabel : state.meeting.date;
  const first = (name) => String(name || '').split(/\s+/)[0];

  const send = async (response) => {
    setError(null);
    const requests = Object.entries(picks).map(([k, purpose]) => { const [studentId, staffId] = k.split('|'); return { studentId, staffId, purpose: purpose.trim() }; });
    if (response === 'ATTEND' && !requests.length) { setError(t('meetings.family.pickSomeone')); return; }
    if (response === 'ATTEND' && requests.some((r) => !r.purpose)) { setError(t('meetings.family.purposeRequired')); return; }
    if (response === 'ATTEND' && (!attendee.name.trim() || !attendee.relation)) { setError(t('meetings.family.attendeeRequired')); return; }
    setBusy(true);
    try { onSaved(await callMeeting('meetingFamilyRespond', { token: sess.familyToken, session: sess.session, response, requests, attendee })); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <>
      <div className="w-full max-w-2xl">
        <h2 className="text-2xl font-extrabold text-[#1b345a]">{t('meetings.family.pickTitle')}</h2>
        <p className="text-[15px] text-slate-600 mt-1">{t('meetings.family.pickHint')}</p>
      </div>
      {state.students.map((s) => (
        <section key={s.id} className="w-full max-w-2xl flex flex-col gap-3">
          <NavyCard date={date} title={s.name}
            fields={[[t('meetings.family.grade'), s.grade || '—'], [t('meetings.family.class'), s.className || '—'], [t('meetings.family.branch'), s.branchName || '—'], [t('meetings.family.chosenN'), count(s.id)]]}
            pill={count(s.id) ? t('meetings.family.selectedN', { count: count(s.id) }) : t('meetings.family.noneYet')} corner={tail(s.id)} />
          {['ACADEMIC', 'ADMIN', 'TEACHER'].map((role) => {
            const list = s.options.filter((o) => o.role === role);
            return (
              <div key={role} className="space-y-2.5">
                <h3 className="text-xl font-extrabold text-[#1b345a] flex items-center gap-2 mt-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${ROLE_DOT[role]}`} />
                  {role === 'TEACHER' ? t('meetings.family.teachersOf', { name: first(s.name) }) : t(`meetings.family.listOf.${role}`)}
                </h3>
                {role !== 'TEACHER' && (
                  <ManagerPicker role={role} list={list} studentId={s.id} picks={picks} locked={locked} keyOf={keyOf}
                    onAdd={(o) => setPicks((p) => ({ ...p, [keyOf(s.id, o.id)]: p[keyOf(s.id, o.id)] ?? '' }))}
                    onToggle={toggle} onPurpose={(k, v) => setPicks((p) => ({ ...p, [k]: v }))} />
                )}
                {role === 'TEACHER' && !list.length && <p className="text-[15px] text-slate-400 bg-white/70 border border-dashed border-slate-200 rounded-2xl p-3">{t('meetings.family.notAvailable')}</p>}
                {role === 'TEACHER' && list.map((o) => {
                  const k = keyOf(s.id, o.id);
                  return <PersonRow key={o.id} person={o} on={k in picks} locked={locked.has(k)} purpose={picks[k] || ''} onToggle={() => toggle(k)} onPurpose={(v) => setPicks((p) => ({ ...p, [k]: v }))} />;
                })}
              </div>
            );
          })}
        </section>
      ))}
      {others.length > 0 && <p className="w-full max-w-2xl text-sm text-slate-500">{t('meetings.family.othersNote', { list: others.map((o) => `${o.name} (${o.grade})`).join('، ') })}</p>}
      <AttendeeFields value={attendee} onChange={setAttendee} />
      <div className="w-full max-w-2xl space-y-3">
        {error && <p className="text-[15px] text-rose-700 bg-rose-50 border border-rose-100 rounded-2xl p-3 flex items-center gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button type="button" disabled={busy} onClick={() => send('ATTEND')} className={`sm:col-span-2 ${mainBtn}`}>{busy && <Loader2 className="w-5 h-5 animate-spin" />}{t('meetings.family.confirm')}</button>
          <button type="button" disabled={busy} onClick={() => send('DECLINE')} className="py-3.5 border-2 border-slate-200 bg-white text-slate-600 rounded-2xl text-[15px] font-bold hover:border-slate-300">{t('meetings.parent.response.DECLINE')}</button>
        </div>
      </div>
    </>
  );
}

// Whom a request is for: the teacher, or the position (+ who holds it today).
const staffLabel = (t, r) => `${positionLabel(t, r) || r.staffName}${r.holder ? ` — ${r.holder}` : ''}`;

const byStudent = (state) => state.students.map((s) => ({ ...s, requests: state.requests.filter((r) => r.studentId === s.id) })).filter((s) => s.requests.length);

// The family's interviews as person cards (with their status on the day).
function RequestList({ state, withStatus = false }) {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-2xl space-y-3">
      {byStudent(state).map((s) => (
        <div key={s.id} className="space-y-2.5">
          <h3 className="text-xl font-extrabold text-[#1b345a] mt-1">{s.name} <span className="text-sm font-medium text-slate-500">· {s.branchName} · <span dir="ltr">{s.grade} {s.className}</span></span></h3>
          {s.requests.map((r) => (
            <div key={r.id} className="bg-white rounded-3xl border-2 border-slate-100 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={r.holder || r.staffName} />
                <div className="min-w-0">
                  <p className="text-lg font-extrabold text-slate-900 truncate" dir="auto">{staffLabel(t, r)}</p>
                  <p className="text-[15px] text-slate-500 truncate"><span className={`inline-block w-2 h-2 rounded-full me-1.5 ${ROLE_DOT[r.staffRole] || ROLE_DOT.TEACHER}`} />{withStatus ? t(`meetings.roles.${r.staffRole}`) : r.purpose}</p>
                </div>
              </div>
              {withStatus
                ? <span className={`text-sm font-bold px-3 py-1 rounded-full shrink-0 ${STATUS_TONE[r.status] || ''}`}>{t(`meetings.request.${r.status}`)}</span>
                : <span className="text-sm text-slate-400 shrink-0">{t(`meetings.roles.${r.staffRole}`)}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const relationText = (t, a) => (a ? t(`meetings.family.relations.${a.relation}`) : '—');

function FamilyConfirmation({ state, onEdit }) {
  const { t, i18n } = useTranslation();
  const { invite } = state;
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (invite.response === 'ATTEND') QRCode.toDataURL(invite.checkinLink, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => {});
  }, [invite.checkinLink, invite.response]);
  if (invite.response === 'DECLINE') {
    return (
      <div className={`${card} text-center space-y-3`}>
        <h2 className="text-xl font-extrabold text-slate-900">{t('meetings.parent.done.DECLINE')}</h2>
        {onEdit && <button type="button" onClick={onEdit} className="text-[15px] font-bold text-[#1f3c64] flex items-center gap-1 mx-auto hover:underline"><Pencil className="w-4 h-4" />{t('meetings.parent.edit')}</button>}
      </div>
    );
  }
  const date = i18n.language === 'ar' ? state.meeting.dateLabel : state.meeting.date;
  return (
    <>
      <div id="report-print-area" className="w-full max-w-2xl flex justify-center">
      <NavyCard date={date} title={invite.attendee?.name || t('meetings.parent.done.ATTEND')} sub={t('meetings.parent.done.ATTEND')}
        fields={[[t('meetings.family.relationShort'), relationText(t, invite.attendee)], [t('meetings.family.children'), byStudent(state).length], [t('meetings.family.interviews'), state.requests.length]]}
        pill={<span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-300" />{t('meetings.family.awaitingCheckin')}</span>} corner={`#${invite.code}`}>
        {qr && (
          <div className="mt-5 bg-white rounded-3xl p-4 flex flex-col sm:flex-row items-center gap-4 text-slate-800">
            <img src={qr} alt="QR" className="w-44 h-44 shrink-0" />
            <div className="text-center sm:text-start">
              <p className="text-[15px] text-slate-600">{t('meetings.family.qrHint')}</p>
              <p className="text-3xl font-extrabold tracking-[0.3em] text-[#1b345a] mt-2" dir="ltr">{invite.code}</p>
            </div>
          </div>
        )}
      </NavyCard>
      </div>
      <div className="w-full max-w-2xl flex flex-wrap gap-2 no-print">
        <button type="button" onClick={() => window.print()} className="px-4 py-2.5 bg-white border-2 border-slate-200 rounded-2xl text-[15px] font-bold text-[#1b345a] flex items-center gap-2"><Printer className="w-4 h-4" />{t('meetings.family.printCard')}</button>
        {onEdit && <button type="button" onClick={onEdit} className="px-4 py-2.5 bg-white border-2 border-slate-200 rounded-2xl text-[15px] font-bold text-[#1b345a] flex items-center gap-2"><Pencil className="w-4 h-4" />{t('meetings.family.edit')}</button>}
      </div>
      <RequestList state={state} />
    </>
  );
}

// The ticket on the day: the ticket number, the children, each interview and
// where to go when the supervisor directs the parent.
function TicketView({ state, onRefresh }) {
  const { t, i18n } = useTranslation();
  const now = state.requests.filter((r) => r.status === 'DIRECTED' || r.status === 'IN_PROGRESS');
  const { attendee, ticketNo } = state.invite;
  const left = state.requests.filter((r) => r.status !== 'DONE').length;
  const date = i18n.language === 'ar' ? state.meeting.dateLabel : state.meeting.date;
  return (
    <>
      <NavyCard date={date} title={<span className="flex items-baseline gap-3"><Ticket className="w-8 h-8 text-amber-300 self-center" />{t('meetings.family.ticket')} <span dir="ltr" className="text-5xl sm:text-6xl">{ticketNo ?? '—'}</span></span>}
        sub={attendee ? `${t('meetings.family.hello', { name: attendee.name })} 👋` : state.meeting.title}
        fields={[[t('meetings.family.relationShort'), relationText(t, attendee)], [t('meetings.family.children'), byStudent(state).length], [t('meetings.family.interviews'), state.requests.length], [t('meetings.family.remaining'), left]]}
        pill={state.allDone ? t('meetings.family.allDoneShort') : now.length ? t('meetings.family.goNowShort') : t('meetings.family.waitShort')} corner={state.invite.code ? `#${state.invite.code}` : ''} />
      {now.map((r) => (
        <div key={r.id} className={`w-full max-w-2xl rounded-3xl p-5 text-center border-2 ${r.status === 'DIRECTED' ? 'border-amber-400 bg-gradient-to-br from-amber-50 to-yellow-50' : 'border-blue-300 bg-blue-50'}`}>
          <p className="text-xl font-extrabold text-slate-900 flex items-center justify-center gap-2"><ArrowLeftRight className="w-5 h-5" />{r.status === 'DIRECTED' ? t('meetings.family.goNow', { name: staffLabel(t, r) }) : t('meetings.family.inMeeting', { name: staffLabel(t, r) })}</p>
          {r.room && <p className="text-lg font-bold text-slate-700 mt-1">{r.room}</p>}
        </div>
      ))}
      {!now.length && <p className={`w-full max-w-2xl text-[15px] font-bold text-center rounded-3xl p-4 ${state.allDone ? 'bg-emerald-50 text-emerald-800' : 'bg-violet-50 text-violet-800'}`}>{state.allDone ? t('meetings.family.allDone') : t('meetings.family.wait')}</p>}
      <RequestList state={state} withStatus />
      <button type="button" onClick={onRefresh} className="text-sm text-slate-500 hover:text-[#1f3c64]">{t('meetings.family.autoRefresh')}</button>
    </>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} onClick={() => onChange(n)} className="p-1 transition hover:scale-110" aria-label={String(n)}><Star className={`w-9 h-9 ${value >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>
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
  const row = 'rounded-3xl bg-white border-2 border-slate-100 p-4';
  return (
    <>
      <NavyCard title={t('meetings.parent.surveyTitle')} sub={state.meeting.title} />
      <form onSubmit={submit} className="w-full max-w-2xl space-y-3">
        {['overall', 'organization', 'usefulness'].map((k) => <div key={k} className={row}><p className="text-[15px] font-bold text-slate-800 mb-1">{t(`meetings.survey.${k}`)}</p><Stars value={r[k]} onChange={(v) => setR((x) => ({ ...x, [k]: v }))} /></div>)}
        {state.surveyTeachers.map((p) => (
          <div key={p.id} className={`${row} flex flex-col sm:flex-row sm:items-center justify-between gap-2`}>
            <span className="flex items-center gap-3"><Avatar name={p.name} /><span><span className="block text-lg font-extrabold text-slate-900" dir="auto">{p.name}</span><span className="block text-[15px] text-slate-500">{p.subject || t(`meetings.roles.${p.role}`)}</span></span></span>
            <Stars value={people[p.id] || 0} onChange={(v) => setPeople((x) => ({ ...x, [p.id]: v }))} />
          </div>
        ))}
        <div className={row}>
          <p className="text-[15px] font-bold text-slate-800 mb-2">{t('meetings.survey.answered')}</p>
          <div className="grid grid-cols-3 gap-2">{[['YES', 'bg-emerald-500 border-emerald-500'], ['PARTLY', 'bg-amber-500 border-amber-500'], ['NO', 'bg-rose-500 border-rose-500']].map(([k, on]) => <button type="button" key={k} onClick={() => setAnswered(k)} className={`py-2.5 rounded-2xl text-[15px] font-bold border-2 transition ${answered === k ? `${on} text-white shadow` : 'bg-white text-slate-700 border-slate-200'}`}>{t(`meetings.survey.answers.${k}`)}</button>)}</div>
        </div>
        <div className={row}><p className="text-[15px] font-bold text-slate-800 mb-1">{t('meetings.survey.comment')}</p><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} /></div>
        {error && <p className="text-[15px] text-rose-700">{error}</p>}
        <button disabled={busy} className={mainBtn}>{busy && <Loader2 className="w-5 h-5 animate-spin" />}{t('meetings.parent.surveySubmit')}</button>
      </form>
    </>
  );
}

function Done({ title }) {
  return (
    <NavyCard title={<span className="flex items-center gap-3"><Sparkles className="w-8 h-8 text-amber-300" />{title}</span>} />
  );
}
