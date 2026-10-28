import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { DoorOpen, ShieldCheck, Loader2, CheckCircle2, Paperclip, AlertTriangle, IdCard, Car, MapPin, Clock, Ban, RefreshCw, XCircle, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from '../utils/publicSubmission';
import { LEAVE_REASONS, PICKUP_RELATIONS } from '../config/platform';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const ACTIVE = ['PENDING', 'APPROVED', 'CALLED'];
const toAttachment = async (f) => (f ? { fileName: f.name, mimeType: f.type || 'application/octet-stream', base64Data: await fileToBase64(f) } : null);
// "HH:mm" today → epoch ms.
const todayAt = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const at = new Date(); at.setHours(h, m, 0, 0); return at.getTime(); };

// The request's path for the parent: steps with their times, and what the
// parent can do at this point (prepare / arrived / change time / cancel).
function LeaveTrack({ track, busy, onAction, onRefresh }) {
  const { t, i18n } = useTranslation();
  const [newTime, setNewTime] = useState(null);
  const when = (ms) => (ms ? new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(ms) : '');
  const active = ACTIVE.includes(track.status);
  const steps = [
    ['REQUESTED', track.createdAt],
    ['APPROVED', track.approvedAt],
    ['CALLED', track.calledAt],
    ['EXITED', track.exitAt],
    ...(track.type === 'TEMPORARY' ? [['RETURNED', track.returnAt]] : []),
  ];
  const reached = { PENDING: 0, APPROVED: 1, CALLED: 2, EXITED: 3, RETURNED: 4 }[track.status] ?? -1;
  const ended = ['REJECTED', 'CANCELLED'].includes(track.status);
  const btnCls = 'py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{t('leaveRequest.track.code')}</p>
          <p className="font-mono font-bold text-slate-900" dir="ltr">{track.code}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={busy} className="text-sm text-primary flex items-center gap-1 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />{t('leaveRequest.track.refresh')}</button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 rounded-xl p-3">
        <p><span className="text-slate-500">{t('leaveRequest.time')}: </span><span className="font-medium">{when(track.requestedAt)}</span>{track.rescheduled && <span className="text-xs text-amber-700"> ({t('leaveRequest.track.rescheduled')})</span>}</p>
        <p><span className="text-slate-500">{t('leaveRequest.pickup')}: </span><span className="font-medium">{track.pickup.name}</span></p>
        <p><span className="text-slate-500">{t('platform.leaves.reason')}: </span>{t(`platform.leaves.reasons.${track.reason}`)}</p>
        <p><span className="text-slate-500">{t('platform.leaves.type')}: </span>{t(`platform.leaves.types.${track.type}`)}</p>
      </div>

      {ended ? (
        <div className="rounded-xl p-3 text-sm bg-rose-50 border border-rose-100 text-rose-800 flex gap-2">
          <XCircle className="w-5 h-5 shrink-0" />
          <span>{track.status === 'REJECTED' ? t('leaveRequest.track.rejected', { reason: track.rejectReason || '—' }) : t('leaveRequest.track.cancelled', { time: when(track.cancelledAt) })}</span>
        </div>
      ) : (
        <ol className="space-y-0">
          {steps.map(([k, at], i) => {
            const done = i <= reached;
            const current = i === reached + 1 && active;
            return (
              <li key={k} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-emerald-500 text-white' : current ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' : 'bg-slate-100 text-slate-400'}`}>{done ? '✓' : i + 1}</span>
                  {i < steps.length - 1 && <span className={`w-0.5 flex-1 min-h-[18px] ${i < reached ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                </div>
                <div className="pb-3">
                  <p className={`text-sm font-medium ${done ? 'text-slate-900' : current ? 'text-amber-800' : 'text-slate-400'}`}>{t(`leaveRequest.track.steps.${k}`)}{current && ` — ${t('leaveRequest.track.inProgress')}`}</p>
                  {done && at && <p className="text-xs text-slate-500">{when(at)}{k === 'EXITED' && track.receiverName ? ` · ${t('leaveRequest.track.receivedBy', { name: track.receiverName })}` : ''}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {active && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          {track.status === 'PENDING' && <p className="text-xs text-slate-500">{t('leaveRequest.track.pendingHint')}</p>}
          {['APPROVED', 'CALLED'].includes(track.status) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => onAction('prepare')} className={`${btnCls} bg-indigo-600 text-white`}><Car className="w-4 h-4" />{t('leaveRequest.track.prepare')}</button>
              <button type="button" disabled={busy} onClick={() => onAction('arrived')} className={`${btnCls} bg-emerald-600 text-white`}><MapPin className="w-4 h-4" />{t('leaveRequest.track.arrived')}</button>
            </div>
          )}
          {(track.parentPrepareAt || track.parentArrivedAt) && (
            <p className="text-xs text-emerald-700">{track.parentArrivedAt ? t('leaveRequest.track.arrivedSent', { time: when(track.parentArrivedAt) }) : t('leaveRequest.track.prepareSent', { time: when(track.parentPrepareAt) })}</p>
          )}
          {['PENDING', 'APPROVED'].includes(track.status) && (newTime === null ? (
            <button type="button" disabled={busy} onClick={() => setNewTime(format(new Date(track.requestedAt || Date.now()), 'HH:mm'))} className={`${btnCls} w-full border border-slate-300 bg-white text-slate-700`}><Clock className="w-4 h-4" />{t('leaveRequest.track.changeTime')}</button>
          ) : (
            <div className="flex gap-2">
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={inputCls} dir="ltr" />
              <button type="button" disabled={busy || !newTime} onClick={async () => { if (await onAction('reschedule', { requestedAt: todayAt(newTime) })) setNewTime(null); }} className={`${btnCls} px-4 bg-primary text-white`}>{t('common.save')}</button>
              <button type="button" onClick={() => setNewTime(null)} className={`${btnCls} px-3 text-slate-500`}>{t('common.cancel')}</button>
            </div>
          ))}
          {['PENDING', 'APPROVED'].includes(track.status) && <p className="text-[11px] text-slate-400">{t('leaveRequest.track.changeTimeHint')}</p>}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(t('leaveRequest.track.cancelConfirm'))) onAction('cancel'); }} className={`${btnCls} w-full text-rose-700 hover:bg-rose-50`}><Ban className="w-4 h-4" />{t('leaveRequest.track.cancel')}</button>
        </div>
      )}
    </div>
  );
}

// Public leave request (/leave): the parent identifies the student (national
// ID + last 4 digits of the registered mobile). With a request still active
// the page shows its path and the parent's actions instead of the form —
// one active request per student. A new receiver comes with an ID photo and
// joins the student's authorized pickups.
export default function LeaveRequest() {
  const { t } = useTranslation();
  const [studentId, setStudentId] = useState('');
  const [last4, setLast4] = useState('');
  const [ctx, setCtx] = useState(null);
  const [track, setTrack] = useState(null);
  const [newRequest, setNewRequest] = useState(false);
  const [form, setForm] = useState({ reason: 'MEDICAL', type: 'FULL', time: format(new Date(Date.now() + 3600e3), 'HH:mm'), pickupId: '', pickupName: '', pickupRelation: 'FATHER', pickupNationalId: '', pickupPhone: '', note: '' });
  const [file, setFile] = useState(null);
  const [idImage, setIdImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pickFile = (setter) => (e) => { const f = e.target.files?.[0]; if (f && f.size > MAX_PUBLIC_FILE_BYTES) setError(t('tripConsent.fileTooBig')); else setter(f || null); };

  const load = async () => {
    const data = await call('getLeaveContext', { studentId, last4 });
    setCtx(data);
    setTrack(data.active || null);
    setNewRequest(false);
    setForm((f) => ({ ...f, pickupId: data.pickups[0]?.id || '' }));
    return data;
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try { await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const chosen = ctx?.pickups.find((p) => p.id === form.pickupId);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.pickupId) {
      if (!form.pickupName.trim()) { setError(t('leaveRequest.pickupRequired')); return; }
      if (!/^\d{10}$/.test(form.pickupNationalId.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/\D/g, ''))) { setError(t('leaveRequest.idRequired')); return; }
      if (!idImage) { setError(t('leaveRequest.idImageRequired')); return; }
    }
    setBusy(true);
    try {
      const data = await call('submitLeaveRequest', {
        studentId, last4, reason: form.reason, type: form.type, requestedAt: todayAt(form.time), note: form.note,
        pickupId: form.pickupId || null, pickupName: form.pickupName, pickupRelation: form.pickupRelation, pickupNationalId: form.pickupNationalId, pickupPhone: form.pickupPhone,
        attachment: await toAttachment(file), idImage: await toAttachment(idImage),
      });
      setTrack(data.track);
      setNewRequest(false);
      setNotice(t('leaveRequest.doneBody'));
    } catch (err) {
      setError(err.message);
      // Another request is already active: show it.
      if (err.code === 'functions/already-exists') { try { await load(); } catch { /* keep the message */ } }
    } finally {
      setBusy(false);
    }
  };

  const action = async (name, extra = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await call('parentLeaveAction', { studentId, last4, action: name, ...extra });
      setTrack(data.track);
      setNotice(t(`leaveRequest.track.done.${name}`));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const card = 'w-full max-w-xl bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';
  const studentLine = ctx && <div><p className="text-xs text-slate-500">{t('tripConsent.student')}</p><p className="font-bold text-slate-900">{ctx.studentName} <span className="text-sm font-normal text-slate-500" dir="ltr">{ctx.grade} {ctx.className}</span></p></div>;
  const showTrack = track && !newRequest;
  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary"><img src={logo} alt="" className="h-8 w-auto" /><span className="font-bold text-lg">{t('app.brand')}</span></div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        <h1 className="text-2xl font-bold text-slate-900 mt-4 flex items-center gap-2"><DoorOpen className="w-7 h-7 text-primary" />{t('leaveRequest.title')}</h1>
        <p className="text-sm text-slate-500 text-center max-w-md">{t('leaveRequest.subtitle')}</p>
        {!ctx ? (
          <form onSubmit={verify} className={`${card} space-y-4`}>
            <h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />{t('tripConsent.verifyTitle')}</h2>
            <p className="text-sm text-slate-500">{t('leaveRequest.verifyHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.studentId')}</label><input required inputMode="numeric" dir="ltr" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.last4')}</label><input required inputMode="numeric" maxLength={4} dir="ltr" value={last4} onChange={(e) => setLast4(e.target.value)} className={inputCls} /></div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.continue')}</button>
          </form>
        ) : showTrack ? (
          <div className={`${card} space-y-4`}>
            {studentLine}
            {notice && <p className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3 flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" />{notice}</p>}
            {error && <p className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>}
            <LeaveTrack track={track} busy={busy} onAction={action} onRefresh={refresh} />
            {!ACTIVE.includes(track.status) && (
              <button type="button" onClick={() => { setNewRequest(true); setNotice(null); setError(null); }} className="w-full py-2.5 rounded-xl text-sm border border-primary text-primary flex items-center justify-center gap-2"><Plus className="w-4 h-4" />{t('leaveRequest.track.newRequest')}</button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className={`${card} space-y-4`}>
            {studentLine}
            {ctx.recent && !newRequest && (
              <button type="button" onClick={() => setTrack(ctx.recent)} className="w-full text-start text-sm bg-slate-50 border border-slate-100 rounded-xl p-3">
                {t('leaveRequest.recent', { code: ctx.recent.code, status: t(`platform.leaves.status.${ctx.recent.status}`) })} <span className="text-primary">{t('leaveRequest.track.view')}</span>
              </button>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.reason')}</label><select value={form.reason} onChange={set('reason')} className={inputCls}>{LEAVE_REASONS.map((r) => <option key={r} value={r}>{t(`platform.leaves.reasons.${r}`)}</option>)}</select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('leaveRequest.time')}</label><input type="time" required value={form.time} onChange={set('time')} className={inputCls} dir="ltr" /></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.type')}</label>
              <div className="grid grid-cols-2 gap-2">{['FULL', 'TEMPORARY'].map((x) => <button type="button" key={x} onClick={() => setForm((f) => ({ ...f, type: x }))} className={`py-2.5 rounded-xl text-sm border ${form.type === x ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`platform.leaves.types.${x}`)}</button>)}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('leaveRequest.pickup')}</label>
              <select value={form.pickupId} onChange={(e) => { set('pickupId')(e); setIdImage(null); }} className={inputCls}>
                {ctx.pickups.map((p) => <option key={p.id} value={p.id}>{p.name} — {t(`platform.relations.${p.relation}`, p.relation)}</option>)}
                <option value="">{t('leaveRequest.newPickup')}</option>
              </select>
              {!ctx.pickups.length && <p className="text-xs text-slate-500 mt-1">{t('leaveRequest.noAuthorized')}</p>}
            </div>
            {!form.pickupId && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.pickupName')} <span className="text-red-500">*</span></label><input value={form.pickupName} onChange={set('pickupName')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.relation')}</label><select value={form.pickupRelation} onChange={set('pickupRelation')} className={inputCls}>{PICKUP_RELATIONS.map((r) => <option key={r} value={r}>{t(`platform.relations.${r}`)}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.nationalId')} <span className="text-red-500">*</span></label><input inputMode="numeric" maxLength={10} value={form.pickupNationalId} onChange={set('pickupNationalId')} className={inputCls} dir="ltr" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('common.phone')}</label><input inputMode="tel" value={form.pickupPhone} onChange={set('pickupPhone')} className={inputCls} dir="ltr" /></div>
                <p className="sm:col-span-2 text-xs text-sky-700">{t('leaveRequest.newPickupNote')}</p>
              </div>
            )}
            {(!form.pickupId || (chosen && !chosen.hasIdImage)) && (
              <label className={`flex items-center gap-2 text-sm cursor-pointer rounded-xl border border-dashed p-3 ${idImage ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-primary/40 text-primary'}`}>
                <IdCard className="w-5 h-5 shrink-0" />
                <span className="flex-1">{idImage ? idImage.name : `${t('leaveRequest.idImage')}${form.pickupId ? ` (${t('leaveRequest.optional')})` : ' *'}`}</span>
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={pickFile(setIdImage)} />
              </label>
            )}
            <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.notes')}</label><textarea rows={2} value={form.note} onChange={set('note')} className={inputCls} /></div>
            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer"><Paperclip className="w-4 h-4" />{file ? file.name : t('leaveRequest.attach')}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={pickFile(setFile)} />
            </label>
            {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('leaveRequest.submit')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
