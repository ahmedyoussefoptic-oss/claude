import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Presentation, CalendarDays, Clock, MapPin, Loader2, ShieldCheck, CheckCircle2, Video, Star, AlertTriangle, Pencil, Info } from 'lucide-react';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';
import { callMeeting, meetingTime, isIndividual, isRequests } from '../config/meetings';
import MeetingFamily from './MeetingFamily';

const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-2xl bg-white p-5 md:p-7 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';

export function PublicShell({ children }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <img src={logo} alt={t('tripConsent.schoolName')} className="h-8 w-auto" />
            <span className="font-bold text-lg">{t('tripConsent.schoolName')}</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-5">{children}</main>
    </div>
  );
}

export function MeetingInfo({ meeting }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <div className={card}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Presentation className="w-6 h-6" /></div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">{meeting.title}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{meeting.branchNames.join(lang === 'ar' ? '، ' : ', ')} · {t(`meetings.type.${meeting.type}`)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 text-sm">
        <p className="flex items-center gap-2 text-slate-700"><CalendarDays className="w-4 h-4 text-primary shrink-0" />{lang === 'ar' ? meeting.dateLabel : meeting.date}</p>
        <p className="flex items-center gap-2 text-slate-700"><Clock className="w-4 h-4 text-primary shrink-0" />{meetingTime(meeting.startTime, lang)} – {meetingTime(meeting.endTime, lang)}</p>
        {meeting.location && <p className="flex items-center gap-2 text-slate-700"><MapPin className="w-4 h-4 text-primary shrink-0" />{meeting.location}</p>}
        {meeting.remote && <p className="flex items-center gap-2 text-slate-700"><Video className="w-4 h-4 text-primary shrink-0" />{t('meetings.parent.remoteAvailable')}</p>}
      </div>
      {meeting.agenda && <div className="mt-4"><p className="text-sm font-medium text-slate-800">{t('meetings.form.agenda')}</p><p className="text-sm text-slate-600 whitespace-pre-wrap">{meeting.agenda}</p></div>}
      {meeting.registrationOpen && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 mt-4 flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{t('meetings.parent.deadline', { date: lang === 'ar' ? meeting.regDeadlineLabel : meeting.regDeadline })}</p>}
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} onClick={() => onChange(n)} className="p-1" aria-label={String(n)}>
          <Star className={`w-8 h-8 ${value >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
        </button>
      ))}
    </div>
  );
}

// The family's page (/meeting/<token>) from the WhatsApp invitation: the
// parent identifies with a child's national ID, confirms, books the
// teachers, and gets the entry QR; after the meeting, the survey.
export default function MeetingParent() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { token } = useParams();
  const [meeting, setMeeting] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [studentId, setStudentId] = useState('');
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const prev = document.title;
    document.title = meeting ? `${t('meetings.parent.brand')} — ${meeting.title}` : t('meetings.parent.brand');
    return () => { document.title = prev; };
  }, [meeting, t]);
  useEffect(() => {
    callMeeting('meetingPublic', { token }).then((r) => setMeeting(r.meeting)).catch((err) => setLoadError(err.message));
  }, [token]);

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await callMeeting('meetingParentVerify', { token, studentId });
      setState(r);
      setMeeting(r.meeting);
      setEditing(!r.invite.response && r.meeting.registrationOpen);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const view = state?.meeting || meeting;
  return (
    <PublicShell>
      {loadError ? <div className={`${card} mt-10 text-center text-slate-600`}>{loadError}</div>
        : !view ? <Loader2 className="w-8 h-8 animate-spin text-primary mt-20" />
          : (
            <>
              <h1 className="w-full max-w-2xl text-center text-2xl font-bold text-primary mt-2">{t('meetings.parent.brand')}</h1>
              <MeetingInfo meeting={view} />
              {view.status === 'CANCELLED' ? (
                <div className={`${card} text-center text-slate-700`}>{t('meetings.parent.cancelled')}{view.cancelReason ? ` — ${view.cancelReason}` : ''}</div>
              ) : isRequests(view) ? (
                <MeetingFamily token={token} />
              ) : !state ? (
                <form onSubmit={verify} className={`${card} space-y-4`}>
                  <h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />{t('meetings.parent.verifyTitle')}</h2>
                  <p className="text-sm text-slate-500">{t('meetings.parent.verifyHint')}</p>
                  <input required inputMode="numeric" dir="ltr" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder={t('tripConsent.studentId')} className={inputCls} />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.continue')}</button>
                </form>
              ) : state.surveyOpen ? (
                state.surveyDone ? <Done title={t('meetings.parent.surveyThanks')} /> : <Survey token={token} studentId={studentId} state={state} onDone={() => setState({ ...state, surveyDone: true })} />
              ) : view.status === 'COMPLETED' ? (
                <div className={`${card} text-center text-slate-700`}>{t('meetings.parent.ended')}</div>
              ) : editing && view.registrationOpen ? (
                <RespondForm token={token} studentId={studentId} state={state} onSaved={(r) => { setState(r); setEditing(false); }} />
              ) : state.invite.response ? (
                <Confirmation state={state} onEdit={view.registrationOpen ? () => setEditing(true) : null} lang={lang} />
              ) : (
                <div className={`${card} text-center text-slate-600`}>{t('meetings.parent.closed')}</div>
              )}
            </>
          )}
    </PublicShell>
  );
}

function Done({ title, body }) {
  return (
    <div className={`${card} text-center`}>
      <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {body && <p className="text-sm text-slate-600 mt-2">{body}</p>}
    </div>
  );
}

function RespondForm({ token, studentId, state, onSaved }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { meeting, invite, teachers } = state;
  const [response, setResponse] = useState(invite.response || '');
  const [attendees, setAttendees] = useState(invite.attendees || 1);
  const [topics, setTopics] = useState(invite.topics || '');
  const [picks, setPicks] = useState(() => Object.fromEntries((invite.slots || []).map((s) => [s.teacherId, { time: s.time, topic: s.topic || '' }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const usedTimes = (except) => new Set(Object.entries(picks).filter(([id]) => id !== except).map(([, p]) => p.time));
  const pick = (teacherId, time) => setPicks((p) => {
    const next = { ...p };
    if (next[teacherId]?.time === time) delete next[teacherId];
    else next[teacherId] = { time, topic: next[teacherId]?.topic || '' };
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!response) { setError(t('meetings.parent.pickResponse')); return; }
    setBusy(true);
    try {
      const slots = Object.entries(picks).map(([teacherId, p]) => ({ teacherId, time: p.time, topic: p.topic }));
      onSaved(await callMeeting('meetingParentRespond', { token, studentId, response, attendees, topics, slots }));
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className={`${card} space-y-5`}>
      <div>
        <p className="text-xs text-slate-500">{t('meetings.parent.students')}</p>
        {invite.students.map((s) => <p key={s.id} className="font-bold text-slate-900">{s.name} <span className="text-sm font-normal text-slate-500" dir="ltr">{s.grade} {s.className}</span></p>)}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">{t('meetings.parent.responseLabel')}</p>
        <div className={`grid gap-2 ${meeting.remote ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {['ATTEND', ...(meeting.remote ? ['REMOTE'] : []), 'DECLINE'].map((r) => (
            <button type="button" key={r} onClick={() => setResponse(r)} className={`py-3 rounded-xl text-sm font-medium border ${response === r ? (r === 'DECLINE' ? 'bg-rose-600 text-white border-rose-600' : 'bg-emerald-600 text-white border-emerald-600') : 'bg-white text-slate-700 border-slate-200'}`}>{t(`meetings.parent.response.${r}`)}</button>
          ))}
        </div>
      </div>
      {response === 'ATTEND' && (
        <label className="flex items-center gap-3 text-sm text-slate-700 whitespace-nowrap">{t('meetings.parent.attendees')}
          <select value={attendees} onChange={(e) => setAttendees(Number(e.target.value))} className={`${inputCls} w-24`}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
      )}
      {response === 'ATTEND' && isIndividual(meeting) && teachers.length > 0 && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-700">{t('meetings.parent.bookTitle')}</p>
            <p className="text-xs text-slate-500">{t('meetings.parent.bookHint', { minutes: meeting.slotMinutes })}</p>
          </div>
          {teachers.map((tc) => {
            const used = usedTimes(tc.id);
            const mine = picks[tc.id];
            return (
              <div key={tc.id} className={`border rounded-xl p-3 ${mine ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                <p className="text-sm font-medium text-slate-800">{tc.name} <span className="text-xs text-slate-500">{tc.subject}{tc.room ? ` · ${tc.room}` : ''}</span></p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tc.slots.map((s) => {
                    const selected = mine?.time === s.time;
                    const disabled = !selected && (!s.free || used.has(s.time));
                    return (
                      <button type="button" key={s.time} disabled={disabled} onClick={() => pick(tc.id, s.time)}
                        className={`px-2 py-1 rounded-lg text-xs border ${selected ? 'bg-primary text-white border-primary' : disabled ? 'bg-slate-50 text-slate-300 border-slate-100 line-through' : 'bg-white text-slate-700 border-slate-200 hover:border-primary/50'}`}>
                        {meetingTime(s.time, lang)}
                      </button>
                    );
                  })}
                </div>
                {mine && <input value={mine.topic} onChange={(e) => setPicks((p) => ({ ...p, [tc.id]: { ...p[tc.id], topic: e.target.value } }))} placeholder={t('meetings.parent.teacherTopic')} className={`${inputCls} mt-2`} />}
              </div>
            );
          })}
        </div>
      )}
      {response && response !== 'DECLINE' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.parent.topics')}</label>
          <textarea rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={t('meetings.parent.topicsPh')} className={inputCls} />
        </div>
      )}
      {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
      <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.parent.submit')}</button>
    </form>
  );
}

function Confirmation({ state, onEdit, lang }) {
  const { t } = useTranslation();
  const { invite, teamsLink, teachers } = state;
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (invite.response === 'ATTEND') QRCode.toDataURL(invite.checkinLink, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => {});
  }, [invite.checkinLink, invite.response]);
  const tName = (id) => teachers.find((x) => x.id === id);
  return (
    <div className={`${card} space-y-4 text-center`}>
      <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold text-slate-900">{t(`meetings.parent.done.${invite.response}`)}</h2>
      <p className="text-sm text-slate-600">{invite.students.map((s) => s.name).join('، ')}</p>
      {invite.response === 'ATTEND' && (
        <>
          {qr && <img src={qr} alt="QR" className="w-52 h-52 mx-auto border border-slate-100 rounded-xl" />}
          <p className="text-sm text-slate-600">{t('meetings.parent.qrHint')}</p>
          <p className="text-2xl font-bold tracking-widest text-slate-900" dir="ltr">{invite.code}</p>
        </>
      )}
      {invite.slots.length > 0 && (
        <div className="text-start bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p className="text-sm font-medium text-slate-800 mb-1">{t('meetings.parent.yourSlots')}</p>
          {[...invite.slots].sort((a, b) => a.time.localeCompare(b.time)).map((s) => (
            <p key={s.teacherId} className="text-sm text-slate-700">{meetingTime(s.time, lang)} — {tName(s.teacherId)?.name || ''} <span className="text-xs text-slate-500">{tName(s.teacherId)?.room || ''}</span></p>
          ))}
        </div>
      )}
      {invite.response === 'REMOTE' && teamsLink && <a href={teamsLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm"><Video className="w-4 h-4" />{t('meetings.parent.joinTeams')}</a>}
      {onEdit && <button type="button" onClick={onEdit} className="text-sm text-primary flex items-center gap-1 mx-auto hover:underline"><Pencil className="w-4 h-4" />{t('meetings.parent.edit')}</button>}
    </div>
  );
}

function Survey({ token, studentId, state, onDone }) {
  const { t } = useTranslation();
  const [r, setR] = useState({ overall: 0, organization: 0, usefulness: 0 });
  const [teachers, setTeachers] = useState({});
  const [answered, setAnswered] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!r.overall || !r.organization || !r.usefulness || !answered) { setError(t('meetings.parent.surveyIncomplete')); return; }
    setBusy(true);
    try {
      await callMeeting('meetingParentSurvey', { token, studentId, ...r, teachers, answered, comment });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <p className="font-bold text-slate-900">{t('meetings.parent.surveyTitle')}</p>
      {['overall', 'organization', 'usefulness'].map((k) => (
        <div key={k}><p className="text-sm text-slate-700 mb-1">{t(`meetings.survey.${k}`)}</p><Stars value={r[k]} onChange={(v) => setR((x) => ({ ...x, [k]: v }))} /></div>
      ))}
      {state.surveyTeachers.map((tc) => (
        <div key={tc.id}><p className="text-sm text-slate-700 mb-1">{t('meetings.survey.teacher', { name: tc.name })}{tc.subject ? ` (${tc.subject})` : ''}</p><Stars value={teachers[tc.id] || 0} onChange={(v) => setTeachers((x) => ({ ...x, [tc.id]: v }))} /></div>
      ))}
      <div>
        <p className="text-sm text-slate-700 mb-1">{t('meetings.survey.answered')}</p>
        <div className="grid grid-cols-3 gap-2">
          {['YES', 'PARTLY', 'NO'].map((k) => <button type="button" key={k} onClick={() => setAnswered(k)} className={`py-2.5 rounded-xl text-sm border ${answered === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`meetings.survey.answers.${k}`)}</button>)}
        </div>
      </div>
      <div><p className="text-sm text-slate-700 mb-1">{t('meetings.survey.comment')}</p><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.parent.surveySubmit')}</button>
    </form>
  );
}
