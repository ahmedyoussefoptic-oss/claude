import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, KeyRound, RefreshCw, Play, FileText, CheckCircle2, UserCheck, X, Save, AlertTriangle, Clock, Ban, Undo2 } from 'lucide-react';
import { PublicShell } from './MeetingParent';
import { callMeeting, meetingTime, savedPin, savePin, FOLLOW_TYPES } from '../config/meetings';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-2xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-100';

export function PinGate({ title, onSubmit, error, busy }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(pin); }} className={`${card} max-w-sm mt-10 space-y-4 text-center`}>
      <KeyRound className="w-8 h-8 text-primary mx-auto" />
      <h1 className="font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500">{t('meetings.staff.pinHint')}</p>
      <input autoFocus required inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center text-2xl tracking-[0.5em]`} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full py-2.5 bg-primary text-white rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.staff.enter')}</button>
    </form>
  );
}

// The teacher's screen (/meeting-teacher/<token>): their appointments in
// order with the parents' topics, a short minute per student, and turning a
// point into a follow-up note for the right department.
export default function MeetingTeacher() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { token } = useParams();
  const [pin, setPin] = useState(() => savedPin('teacher', token));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { inviteId, student, slotId }

  const load = useCallback(async (p = pin, quiet = false) => {
    if (!p) return;
    if (!quiet) setBusy(true);
    try {
      const r = await callMeeting('meetingTeacher', { token, pin: p });
      setData(r);
      setError(null);
      savePin('teacher', token, p);
    } catch (err) {
      setError(err.message);
      if (/رمز الدخول|code/i.test(err.message)) { setPin(''); setData(null); }
    } finally { setBusy(false); }
  }, [token, pin]);
  useEffect(() => { if (pin) load(pin); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return undefined;
    const timer = setInterval(() => load(pin, true), 30000);
    return () => clearInterval(timer);
  }, [data, load, pin]);

  const act = async (payload) => {
    const r = await callMeeting('meetingTeacherAction', { token, pin, ...payload });
    setData(r);
    return r;
  };
  const minuteOf = (studentId) => data?.minutes.find((x) => x.studentId === studentId);

  if (!data) {
    return <PublicShell><PinGate title={t('meetings.staff.teacherTitle')} busy={busy} error={error} onSubmit={(p) => { setPin(p); load(p); }} /></PublicShell>;
  }
  const done = data.slots.filter((s) => s.doneAt).length;
  const studentRow = (inviteId, s, slotId) => {
    const mn = minuteOf(s.id);
    return (
      <div key={s.id} className="flex items-center justify-between gap-2 py-1.5">
        <span className="text-sm text-slate-800">{s.name} <span className="text-xs text-slate-500" dir="ltr">{s.grade} {s.className}</span></span>
        <button type="button" onClick={() => setEditing({ inviteId, student: s, slotId })} className={`px-2.5 py-1 text-xs rounded-lg border flex items-center gap-1 ${mn ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-primary text-primary'}`}>
          {mn ? <CheckCircle2 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}{mn ? t('meetings.teacher.minuteSaved') : t('meetings.teacher.writeMinute')}
        </button>
      </div>
    );
  };

  return (
    <PublicShell>
      <div className={card}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">{data.meeting.title} · {data.meeting.date}</p>
            <h1 className="text-lg font-bold text-slate-900">{data.teacher.name}</h1>
            <p className="text-sm text-slate-500">{data.mode === 'REQUESTS' ? `${t(`meetings.roles.${data.teacher.role || 'TEACHER'}`)} · ` : ''}{data.teacher.subject}{data.teacher.room ? ` · ${data.teacher.room}` : ''}</p>
          </div>
          <button type="button" onClick={() => load(pin)} className="p-2 text-slate-500 hover:text-primary" aria-label={t('common.refresh')}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}</button>
        </div>
        {data.slots.length > 0 && <p className="text-sm text-slate-600 mt-2">{t('meetings.teacher.progress', { done, total: data.slots.length })}</p>}
      </div>

      {data.mode === 'REQUESTS' && <RequestsBoard requests={data.requests} act={act} onError={setError} />}

      {data.mode !== 'REQUESTS' && data.slots.length === 0 && data.others.length === 0 && <div className={`${card} text-center text-slate-500`}>{t('meetings.teacher.empty')}</div>}

      {data.slots.map((s) => (
        <div key={s.id} className={`${card} ${s.doneAt ? 'opacity-70' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap"><Clock className="w-4 h-4 text-primary" />{meetingTime(s.time, lang)}</p>
            <div className="flex flex-wrap items-center justify-end gap-2 ms-auto">
              {s.arrived ? <span className="text-xs text-emerald-700 flex items-center gap-1 whitespace-nowrap"><UserCheck className="w-3.5 h-3.5" />{t('meetings.teacher.arrived')}</span> : <span className="text-xs text-slate-400 whitespace-nowrap">{t('meetings.teacher.notArrived')}</span>}
              {!s.arrived && !s.doneAt && <button type="button" onClick={() => { if (window.confirm(t('meetings.teacher.markArrivedConfirm', { names: s.students.map((st) => st.name).join('، ') }))) act({ action: 'checkinSlot', slotId: s.id }).catch((e) => setError(e.message)); }} className="px-2.5 py-1 text-xs text-emerald-700 border border-emerald-300 bg-white hover:bg-emerald-50 rounded-lg flex items-center gap-1 whitespace-nowrap"><UserCheck className="w-3.5 h-3.5" />{t('meetings.teacher.markArrived')}</button>}
              {!s.startedAt && !s.doneAt && <button type="button" onClick={() => act({ action: 'start', slotId: s.id }).catch((e) => setError(e.message))} className="px-2.5 py-1 text-xs bg-primary text-white rounded-lg flex items-center gap-1 whitespace-nowrap"><Play className="w-3.5 h-3.5" />{t('meetings.teacher.start')}</button>}
              {s.doneAt && <span className="text-xs text-emerald-700">{t('meetings.teacher.done')}</span>}
            </div>
          </div>
          {(s.topic || s.generalTopics) && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 mt-2 text-sm text-slate-700">
              <p className="text-xs font-medium text-amber-800">{t('meetings.teacher.parentTopics')}</p>
              {s.topic && <p>{s.topic}</p>}
              {s.generalTopics && <p className="text-slate-600">{s.generalTopics}</p>}
            </div>
          )}
          <div className="mt-2 divide-y divide-slate-50">{s.students.map((st) => studentRow(s.inviteId, st, s.id))}</div>
        </div>
      ))}

      {data.others.length > 0 && (
        <div className={card}>
          <p className="font-bold text-slate-900">{t('meetings.teacher.others')}</p>
          <p className="text-xs text-slate-500 mb-2">{t('meetings.teacher.othersHint')}</p>
          <div className="divide-y divide-slate-50">{data.others.flatMap((o) => o.students.map((st) => studentRow(o.inviteId, st, null)))}</div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {editing && <MinuteEditor minute={minuteOf(editing.student.id)} student={editing.student} onClose={() => setEditing(null)}
        onSave={async (minute) => { await act({ action: 'saveMinute', inviteId: editing.inviteId, studentId: editing.student.id, minute }); setEditing(null); }} />}
    </PublicShell>
  );
}

// «مقابلات حسب الطلب»: this person's requests — start when the parent is
// in the room, end with the result (required), or mark as not met.
const GROUPS = [
  ['now', (r) => r.status === 'IN_PROGRESS'],
  ['directed', (r) => r.status === 'DIRECTED'],
  ['waiting', (r) => r.status === 'REQUESTED' && r.arrived],
  ['notArrived', (r) => r.status === 'REQUESTED' && !r.arrived],
  ['done', (r) => r.status === 'DONE'],
  ['rejected', (r) => r.status === 'REJECTED'],
];
const OPEN = ['REQUESTED', 'DIRECTED'];
export function RequestsBoard({ requests, act, onError }) {
  const { t, i18n } = useTranslation();
  const [ending, setEnding] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState('');
  const run = async (payload, key) => {
    setBusy(key);
    try { await act(payload); } catch (err) { onError(err.message); } finally { setBusy(''); }
  };
  // The parent came straight to this teacher without passing reception.
  const arrivedHere = (r) => {
    if (window.confirm(t('meetings.staffReq.arrivedHereConfirm', { name: r.studentName }))) run({ action: 'startRequest', requestId: r.id, markArrived: true }, r.id);
  };
  const skip = (r) => {
    const reason = window.prompt(t('meetings.staffReq.skipPrompt'));
    if (reason !== null) run({ action: 'skipRequest', requestId: r.id, reason }, r.id);
  };
  if (!requests.length) return <div className={`${card} text-center text-slate-500`}>{t('meetings.staffReq.empty')}</div>;
  const time = (ms) => (ms ? new Date(ms).toLocaleTimeString(i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <>
      {GROUPS.map(([g, f]) => {
        const list = requests.filter(f);
        if (!list.length) return null;
        return (
          <div key={g} className={`${card} space-y-2`}>
            <p className="font-bold text-slate-900">{t(`meetings.staffReq.group.${g}`)} <span className="text-slate-400 font-normal">({list.length})</span></p>
            {list.map((r) => (
              <div key={r.id} className={`border rounded-xl p-3 ${g === 'now' ? 'border-sky-300 bg-sky-50/50' : g === 'directed' ? 'border-amber-300 bg-amber-50/50' : g === 'rejected' ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-bold text-slate-900">{r.studentName} <span className="text-xs font-normal text-slate-500" dir="ltr">{r.grade} {r.className}</span></p>
                    <p className={`text-xs text-slate-500 ${r.status === 'REJECTED' ? 'hidden' : ''}`}>
                      {r.arrived ? t('meetings.staffReq.arrivedTicket', { n: r.ticketNo ?? '—', time: time(r.checkedInAt) }) : t('meetings.teacher.notArrived')}
                      {r.startedAt && ` · ${t('meetings.staffReq.startedAt', { time: time(r.startedAt) })}`}
                    </p>
                    {r.attendee && <p className="text-xs text-slate-700 mt-0.5">{t('meetings.family.attendee', { name: r.attendee.name, relation: t(`meetings.family.relations.${r.attendee.relation}`) })}</p>}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5 ms-auto">
                    {OPEN.includes(r.status) && r.arrived && <button type="button" disabled={!!busy} onClick={() => run({ action: 'startRequest', requestId: r.id }, r.id)} className="px-2.5 py-1.5 text-xs bg-primary text-white rounded-lg flex items-center gap-1">{busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}{t('meetings.staffReq.start')}</button>}
                    {OPEN.includes(r.status) && !r.arrived && <button type="button" disabled={!!busy} onClick={() => arrivedHere(r)} className="px-2.5 py-1.5 text-xs text-emerald-700 border border-emerald-300 bg-white hover:bg-emerald-50 rounded-lg flex items-center gap-1">{busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}{t('meetings.staffReq.arrivedHere')}</button>}
                    {r.status === 'IN_PROGRESS' && <button type="button" onClick={() => setEnding(r)} className="px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('meetings.staffReq.end')}</button>}
                    {OPEN.includes(r.status) && <button type="button" disabled={!!busy} onClick={() => setRejecting(r)} className="px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200 bg-white hover:bg-rose-50 rounded-lg flex items-center gap-1"><Ban className="w-3.5 h-3.5" />{t('meetings.staffReq.reject')}</button>}
                    {!['DONE', 'REJECTED'].includes(r.status) && <button type="button" disabled={!!busy} onClick={() => skip(r)} className="px-2 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg">{t('meetings.staffReq.skip')}</button>}
                    {r.status === 'REJECTED' && <button type="button" disabled={!!busy} onClick={() => run({ action: 'restoreRequest', requestId: r.id }, r.id)} className="px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 bg-white rounded-lg flex items-center gap-1">{busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}{t('meetings.staffReq.restore')}</button>}
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2 text-sm text-slate-700">
                  <p className="text-xs font-medium text-amber-800">{t('meetings.staffReq.purpose')}</p>
                  <p className="whitespace-pre-wrap">{r.purpose}</p>
                </div>
                {r.status === 'REJECTED' && (
                  <div className="text-sm mt-2 bg-rose-50 border border-rose-200 rounded-lg p-2">
                    <p className="text-xs font-medium text-rose-800">{t('meetings.staffReq.rejectReason')}{r.rejectedBy ? ` · ${r.rejectedBy}` : ''}{r.rejectedAt ? ` · ${time(r.rejectedAt)}` : ''}</p>
                    <p className="whitespace-pre-wrap text-slate-800">{r.rejectReason}</p>
                  </div>
                )}
                {r.others.length > 0 && <p className="text-xs text-slate-500 mt-1">{t('meetings.staffReq.alsoMeeting', { list: r.others.join('، ') })}</p>}
                {r.status === 'DONE' && r.autoClosed && (
                  <div className="text-sm mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-amber-900">{t('meetings.staffReq.autoClosed')}</p>
                    <button type="button" onClick={() => setEnding(r)} className="px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('meetings.staffReq.writeResult')}</button>
                  </div>
                )}
                {r.status === 'DONE' && !r.autoClosed && (
                  <div className="text-sm text-slate-700 mt-2 bg-emerald-50 rounded-lg p-2">
                    <p className="text-xs font-medium text-emerald-800">{t('meetings.staffReq.result')}</p>
                    <p className="whitespace-pre-wrap">{r.result}</p>
                    {r.followUp?.complaintNo && <p className="text-xs text-amber-700 mt-1">{t('meetings.teacher.followUpCreated', { number: r.followUp.complaintNo })}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {ending && <ResultEditor request={ending} onClose={() => setEnding(null)} onSave={async (minute) => { await act({ action: 'endRequest', requestId: ending.id, minute }); setEnding(null); }} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onSave={async (reason) => { await act({ action: 'rejectRequest', requestId: rejecting.id, reason }); setRejecting(null); }} />}
    </>
  );
}

// Declining a request before it starts: a reason is required (the family
// sees it on their page), with a few ready reasons to pick from.
function RejectDialog({ request, onClose, onSave }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const quick = t('meetings.staffReq.rejectQuick', { returnObjects: true });
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 3) { setError(t('meetings.staffReq.rejectRequired')); return; }
    setBusy(true);
    try { await onSave(reason.trim()); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
          <div><p className="font-bold text-slate-900 flex items-center gap-1.5"><Ban className="w-4 h-4 text-rose-600" />{t('meetings.staffReq.rejectTitle')}</p><p className="text-sm text-slate-500">{request.studentName} <span dir="ltr">{request.grade} {request.className}</span></p></div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{t('meetings.staffReq.purpose')}: {request.purpose}</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.staffReq.rejectReason')} <span className="text-red-500">*</span></label>
            {Array.isArray(quick) && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {quick.map((q) => <button key={q} type="button" onClick={() => setReason(q)} className={`px-2.5 py-1 text-xs rounded-full border ${reason === q ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{q}</button>)}
              </div>
            )}
            <textarea autoFocus rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('meetings.staffReq.rejectPh')} className={inputCls} />
          </div>
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2">{t('meetings.staffReq.rejectNote')}</p>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <button disabled={busy} className="w-full py-2.5 bg-rose-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}{t('meetings.staffReq.rejectSave')}</button>
        </div>
      </form>
    </div>
  );
}

function ResultEditor({ request, onClose, onSave }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ result: '', recommendations: '', followUpType: '', followUpText: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!f.result.trim()) { setError(t('meetings.staffReq.resultRequired')); return; }
    if (f.followUpType && !f.followUpText.trim()) { setError(t('meetings.teacher.followUpTextRequired')); return; }
    setBusy(true);
    try { await onSave(f); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
          <div><p className="font-bold text-slate-900">{t('meetings.staffReq.endTitle')}</p><p className="text-sm text-slate-500">{request.studentName}</p></div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{t('meetings.staffReq.purpose')}: {request.purpose}</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.staffReq.result')} <span className="text-red-500">*</span></label>
            <textarea rows={4} value={f.result} onChange={(e) => set('result', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.teacher.recommendations')}</label>
            <textarea rows={2} value={f.recommendations} onChange={(e) => set('recommendations', e.target.value)} className={inputCls} />
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <p className="text-sm font-medium text-slate-700">{t('meetings.teacher.followUp')}</p>
            <p className="text-xs text-slate-500">{t('meetings.teacher.followUpHint')}</p>
            <select value={f.followUpType} onChange={(e) => set('followUpType', e.target.value)} className={inputCls}>
              <option value="">{t('meetings.teacher.noFollowUp')}</option>
              {FOLLOW_TYPES.map((x) => <option key={x} value={x}>{t(`businessData.complaintTypes.${x}`, x)}</option>)}
            </select>
            {f.followUpType && <textarea rows={2} value={f.followUpText} onChange={(e) => set('followUpText', e.target.value)} placeholder={t('meetings.teacher.followUpPh')} className={inputCls} />}
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <button disabled={busy} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('meetings.staffReq.endSave')}</button>
        </div>
      </form>
    </div>
  );
}

function MinuteEditor({ minute, student, onClose, onSave }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ points: minute?.points || '', recommendations: minute?.recommendations || '', agreements: minute?.agreements || '', followUpType: '', followUpText: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (f.followUpType && !f.followUpText.trim()) { setError(t('meetings.teacher.followUpTextRequired')); return; }
    setBusy(true);
    try { await onSave(f); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
          <div><p className="font-bold text-slate-900">{t('meetings.teacher.minuteTitle')}</p><p className="text-sm text-slate-500">{student.name}</p></div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {[['points', 3], ['recommendations', 2], ['agreements', 2]].map(([k, rows]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t(`meetings.teacher.${k}`)}</label>
              <textarea rows={rows} value={f[k]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
            </div>
          ))}
          {minute?.followUp?.complaintNo ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl p-2.5">{t('meetings.teacher.followUpCreated', { number: minute.followUp.complaintNo })}</p>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <p className="text-sm font-medium text-slate-700">{t('meetings.teacher.followUp')}</p>
              <p className="text-xs text-slate-500">{t('meetings.teacher.followUpHint')}</p>
              <select value={f.followUpType} onChange={(e) => set('followUpType', e.target.value)} className={inputCls}>
                <option value="">{t('meetings.teacher.noFollowUp')}</option>
                {FOLLOW_TYPES.map((x) => <option key={x} value={x}>{t(`businessData.complaintTypes.${x}`, x)}</option>)}
              </select>
              {f.followUpType && <textarea rows={2} value={f.followUpText} onChange={(e) => set('followUpText', e.target.value)} placeholder={t('meetings.teacher.followUpPh')} className={inputCls} />}
            </div>
          )}
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <button disabled={busy} className="w-full py-2.5 bg-primary text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('meetings.teacher.saveMinute')}</button>
        </div>
      </form>
    </div>
  );
}
