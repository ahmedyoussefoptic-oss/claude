import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, UserCheck, Undo2, QrCode, UserPlus, RefreshCw, CheckCircle2, AlertTriangle, Ticket, ArrowLeftRight, HeartHandshake } from 'lucide-react';
import { PublicShell } from './MeetingParent';
import { PinGate } from './MeetingTeacher';
import { callMeeting, meetingTime, savedPin, savePin, savedDesks, RELATIONS } from '../config/meetings';

const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-2xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-100';

export function AttendeeText({ attendee, className = '' }) {
  const { t } = useTranslation();
  if (!attendee) return null;
  return <span className={`inline-flex items-center gap-1 ${className}`}><HeartHandshake className="w-3.5 h-3.5 text-rose-500" />{attendee.name} ({t(`meetings.family.relations.${attendee.relation}`)})</span>;
}

// Name + relation of who came (asked at the desk when the parent didn't
// give it, or to correct it).
function AttendeeInputs({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row gap-2 mt-2">
      <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={t('meetings.family.attendeeName')} className={`${inputCls} py-2`} maxLength={80} />
      <select value={value.relation} onChange={(e) => onChange({ ...value, relation: e.target.value })} className={`${inputCls} py-2 sm:w-44`}>
        <option value="">{t('meetings.family.relation')}</option>
        {RELATIONS.map((r) => <option key={r} value={r}>{t(`meetings.family.relations.${r}`)}</option>)}
      </select>
    </div>
  );
}

function InviteRow({ inv, teachers, onCheckin, onUndo, onAttendee, busy, lang, readOnly = false }) {
  const { t } = useTranslation();
  const tName = (id) => teachers.find((x) => x.id === id);
  const [att, setAtt] = useState(() => ({ name: inv.attendee?.name || '', relation: inv.attendee?.relation || '' }));
  const [editAtt, setEditAtt] = useState(false);
  const full = att.name.trim() && att.relation;
  const showInputs = !readOnly && (editAtt || (!inv.attended && !inv.attendee));
  return (
    <div className={`border rounded-xl p-3 ${inv.attended ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          {inv.students.map((s, i) => <p key={i} className="text-sm font-medium text-slate-900">{s.name} <span className="text-xs text-slate-500" dir="ltr">{s.grade} {s.className}</span></p>)}
          <p className="text-xs text-slate-500">{inv.ticketNo ? <b className="text-primary">{t('meetings.desk.ticketN', { n: inv.ticketNo })} · </b> : null}{t(`meetings.response.${inv.response || 'NONE'}`)}{inv.attendees > 1 ? ` · ×${inv.attendees}` : ''} · <span dir="ltr">{inv.code}</span></p>
          {inv.attendee && !editAtt && (
            <p className="text-xs text-slate-700 mt-0.5"><AttendeeText attendee={inv.attendee} />{!readOnly && <button type="button" onClick={() => setEditAtt(true)} className="ms-2 text-primary hover:underline">{t('common.edit')}</button>}</p>
          )}
        </div>
        {readOnly ? null : inv.attended
          ? <button type="button" disabled={busy} onClick={onUndo} className="px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg flex items-center gap-1 shrink-0"><Undo2 className="w-3.5 h-3.5" />{t('meetings.desk.undo')}</button>
          : <button type="button" disabled={busy} onClick={() => onCheckin(full ? att : null)} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg flex items-center gap-1 shrink-0"><UserCheck className="w-4 h-4" />{t('meetings.desk.checkin')}</button>}
      </div>
      {showInputs && (
        <div>
          <p className="text-xs font-medium text-slate-600 mt-2">{t('meetings.desk.setAttendee')}</p>
          <AttendeeInputs value={att} onChange={setAtt} />
          {(editAtt || inv.attended) && (
            <div className="flex gap-2 mt-2">
              <button type="button" disabled={busy || !full} onClick={async () => { if (await onAttendee?.(att)) setEditAtt(false); }} className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg disabled:opacity-50">{t('meetings.desk.saveAttendee')}</button>
              {editAtt && <button type="button" onClick={() => setEditAtt(false)} className="px-3 py-1.5 text-xs text-slate-500">{t('common.cancel')}</button>}
            </div>
          )}
        </div>
      )}
      {inv.slots.length > 0 && (
        <div className="mt-2 text-xs text-slate-600 space-y-0.5">
          {[...inv.slots].sort((a, b) => a.time.localeCompare(b.time)).map((s) => <p key={s.teacherId}>{meetingTime(s.time, lang)} — {tName(s.teacherId)?.name} {tName(s.teacherId)?.room ? `(${tName(s.teacherId).room})` : ''}</p>)}
        </div>
      )}
    </div>
  );
}

// Reception (/meeting-desk/<token>): check parents in by their QR (the
// phone camera opens /meeting-in/…, which uses this browser's desk code), by
// search or by entry code; register a parent who wasn't invited.
export default function MeetingDesk() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { token } = useParams();
  const [pin, setPin] = useState(() => savedPin('desk', token));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [walkId, setWalkId] = useState('');
  const [walkAtt, setWalkAtt] = useState({ name: '', relation: '' });
  const [flash, setFlash] = useState(null);

  const load = useCallback(async (p = pin) => {
    if (!p) return;
    setBusy(true);
    try {
      setData(await callMeeting('meetingDesk', { token, pin: p }));
      savePin('desk', token, p);
      setError(null);
    } catch (err) {
      setError(err.message);
      if (/رمز الدخول|code/i.test(err.message)) { setPin(''); setData(null); }
    } finally { setBusy(false); }
  }, [token, pin]);
  useEffect(() => { if (pin) load(pin); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The waiting board follows the interviews.
  const hasBoard = !!data?.queue;
  useEffect(() => {
    if (!hasBoard) return undefined;
    const timer = setInterval(() => callMeeting('meetingDesk', { token, pin }).then(setData).catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [hasBoard, token, pin]);

  const act = async (payload) => {
    setBusy(true);
    setError(null);
    try {
      const r = await callMeeting('meetingDeskAction', { token, pin, ...payload });
      return r;
    } catch (err) { setError(err.message); return null; } finally { setBusy(false); }
  };
  const search = async (e) => {
    e?.preventDefault();
    const r = await act({ action: 'search', q });
    if (r) setResults(r.results);
  };
  const checkin = async (inv, action = 'checkin', attendee = null) => {
    const r = await act({ action, inviteId: inv.id, ...(attendee ? { attendee } : {}) });
    if (!r) return;
    setResults((list) => list.map((x) => (x.id === inv.id ? r.invite : x)));
    setData((d) => ({ ...d, stats: r.stats, queue: r.queue ?? d.queue }));
    if (action === 'checkin') setFlash(r.invite);
  };
  const setAttendee = async (inv, attendee) => {
    const r = await act({ action: 'attendee', inviteId: inv.id, attendee });
    if (!r) return false;
    setResults((list) => list.map((x) => (x.id === inv.id ? r.invite : x)));
    setData((d) => ({ ...d, stats: r.stats, queue: r.queue ?? d.queue }));
    return true;
  };
  const walkIn = async (e) => {
    e.preventDefault();
    const full = walkAtt.name.trim() && walkAtt.relation;
    const r = await act({ action: 'walkIn', studentId: walkId, ...(full ? { attendee: walkAtt } : {}) });
    if (!r) return;
    setWalkId('');
    setWalkAtt({ name: '', relation: '' });
    setFlash(r.invite);
    setData((d) => ({ ...d, stats: r.stats, queue: r.queue ?? d.queue }));
  };

  if (!data) return <PublicShell><PinGate title={t('meetings.staff.deskTitle')} busy={busy} error={error} onSubmit={(p) => { setPin(p); load(p); }} /></PublicShell>;
  const s = data.stats || {};
  return (
    <PublicShell>
      <div className={card}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">{t('meetings.staff.deskTitle')}</p>
            <h1 className="text-lg font-bold text-slate-900">{data.meeting.title}</h1>
            <p className="text-sm text-slate-500">{data.meeting.date} · {meetingTime(data.meeting.startTime, lang)}</p>
          </div>
          <button type="button" onClick={() => load()} className="p-2 text-slate-500" aria-label={t('common.refresh')}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {[[t('meetings.live.confirmed'), s.attend || 0], [t('meetings.live.arrived'), s.attended || 0], [t('meetings.live.notYet'), Math.max(0, (s.attend || 0) - (s.attended || 0))]].map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded-xl py-2"><p className="text-xl font-bold text-slate-900">{v}</p><p className="text-[11px] text-slate-500">{k}</p></div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3 flex gap-1.5"><QrCode className="w-4 h-4 shrink-0 text-primary" />{t('meetings.desk.qrHint')}</p>
      </div>

      {flash && (
        <div className={`${card} border-emerald-200 bg-emerald-50 flex items-center gap-3`}>
          <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
          <div><p className="font-bold text-emerald-800">{t('meetings.desk.welcome')}{flash.ticketNo ? ` — ${t('meetings.desk.ticketN', { n: flash.ticketNo })}` : ''}</p><p className="text-sm text-emerald-700">{flash.students.map((x) => x.name).join('، ')}</p>{flash.attendee && <p className="text-sm text-emerald-800"><AttendeeText attendee={flash.attendee} /></p>}</div>
        </div>
      )}

      <form onSubmit={search} className={`${card} space-y-3`}>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('meetings.desk.search')} className={inputCls} />
          <button disabled={busy || q.trim().length < 2} className="px-4 bg-primary text-white rounded-xl disabled:opacity-60"><Search className="w-4 h-4" /></button>
        </div>
        {results.map((inv) => <InviteRow key={inv.id} inv={inv} teachers={data.teachers} lang={lang} busy={busy} onCheckin={(a) => checkin(inv, 'checkin', a)} onUndo={() => checkin(inv, 'undo')} onAttendee={(a) => setAttendee(inv, a)} />)}
        {results.length === 0 && q && !busy && <p className="text-xs text-slate-400">{t('meetings.desk.noResults')}</p>}
      </form>

      {data.queue && <WaitingBoard queue={data.queue} busy={busy} onAct={async (payload) => { const r = await act(payload); if (r) setData(r); }} />}

      <form onSubmit={walkIn} className={`${card} space-y-2`}>
        <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><UserPlus className="w-4 h-4 text-primary" />{t('meetings.desk.walkIn')}</p>
        <p className="text-xs text-slate-500">{t('meetings.desk.walkInHint')}</p>
        <div className="flex gap-2">
          <input required inputMode="numeric" dir="ltr" value={walkId} onChange={(e) => setWalkId(e.target.value)} placeholder={t('tripConsent.studentId')} className={inputCls} />
          <button disabled={busy} className="px-4 bg-slate-800 text-white rounded-xl text-sm disabled:opacity-60">{t('meetings.desk.register')}</button>
        </div>
        <AttendeeInputs value={walkAtt} onChange={setWalkAtt} />
      </form>
      {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
    </PublicShell>
  );
}

// «مقابلات حسب الطلب»: families in the building by ticket; the supervisor
// directs each one to a person who is free (the parent's page shows it).
function WaitingBoard({ queue, busy, onAct }) {
  const { t } = useTranslation();
  const tone = { REQUESTED: 'border-slate-200', DIRECTED: 'border-amber-300 bg-amber-50', IN_PROGRESS: 'border-sky-300 bg-sky-50', DONE: 'border-emerald-200 bg-emerald-50 opacity-70' };
  const waiting = queue.filter((f) => f.requests.some((r) => r.status !== 'DONE'));
  const finished = queue.length - waiting.length;
  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <p className="font-bold text-slate-900 flex items-center gap-1.5"><Ticket className="w-4 h-4 text-primary" />{t('meetings.desk.board')}</p>
        <span className="text-xs text-slate-500">{t('meetings.desk.boardCounts', { waiting: waiting.length, finished })}</span>
      </div>
      {!waiting.length && <p className="text-sm text-slate-500">{t('meetings.desk.boardEmpty')}</p>}
      {waiting.map((f) => (
        <div key={f.inviteId} className="border border-slate-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-bold text-primary" dir="ltr">#{f.ticketNo ?? '—'}</span>
            <span className="text-sm text-slate-800">{f.students.map((s) => s.name).join('، ')}</span>
          </div>
          {f.attendee && <p className="text-xs text-slate-600 -mt-1 mb-2"><AttendeeText attendee={f.attendee} /></p>}
          <div className="space-y-1.5">
            {f.requests.map((r) => (
              <div key={r.id} className={`flex items-center justify-between gap-2 border rounded-lg p-2 text-sm ${tone[r.status] || ''}`}>
                <div className="min-w-0">
                  <p className="text-slate-800">{r.staffName}{r.holder ? ` — ${r.holder}` : ''} <span className="text-xs text-slate-500">({t(`meetings.roles.${r.staffRole}`)}{r.room ? ` · ${r.room}` : ''})</span></p>
                  <p className="text-xs text-slate-500 truncate">{r.studentName} — {r.purpose}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {r.status === 'REQUESTED' && (
                    <button type="button" disabled={busy} onClick={() => onAct({ action: 'direct', requestId: r.id })} className={`px-2.5 py-1 text-xs rounded-lg flex items-center gap-1 ${r.staffBusy ? 'border border-amber-300 text-amber-800' : 'bg-primary text-white'}`} title={r.staffBusy ? t('meetings.desk.staffBusy') : ''}>
                      <ArrowLeftRight className="w-3.5 h-3.5" />{r.staffBusy ? t('meetings.desk.busyDirect') : t('meetings.desk.direct')}
                    </button>
                  )}
                  {r.status === 'DIRECTED' && <button type="button" disabled={busy} onClick={() => onAct({ action: 'undirect', requestId: r.id })} className="px-2 py-1 text-xs text-slate-500 border border-slate-200 rounded-lg">{t('meetings.desk.undo')}</button>}
                  {r.status !== 'REQUESTED' && <span className="text-xs text-slate-600">{t(`meetings.request.${r.status}`)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The parent's QR (/meeting-in/<token>).
export function MeetingCheckin() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  // Once per page load (a second call would report "already checked in").
  const started = useRef('');
  useEffect(() => {
    if (started.current === token) return;
    started.current = token;
    callMeeting('meetingCheckinScan', { token, desks: savedDesks() }).then(setR).catch((err) => setError(err.message));
  }, [token]);
  return (
    <PublicShell>
      <div className={`${card} max-w-md mt-8 text-center space-y-3`}>
        {error ? <p className="text-slate-600">{error}</p> : !r ? <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" /> : r.desk ? (
          <>
            <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">{r.already ? t('meetings.desk.already') : t('meetings.desk.welcome')}</h1>
            <p className="text-sm text-slate-600">{r.title}</p>
            <InviteRow inv={r.invite} teachers={r.teachers} lang={i18n.language} readOnly />
          </>
        ) : (
          <>
            <QrCode className="w-10 h-10 text-primary mx-auto" />
            <h1 className="text-lg font-bold text-slate-900">{r.title}</h1>
            <p className="text-sm text-slate-600">{t('meetings.desk.showCode', { names: r.names })}</p>
            <p className="text-3xl font-bold tracking-widest text-slate-900" dir="ltr">{r.code}</p>
          </>
        )}
      </div>
    </PublicShell>
  );
}
