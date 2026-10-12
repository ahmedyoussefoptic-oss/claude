import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { DoorOpen, ShieldCheck, Loader2, CheckCircle2, Paperclip, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from '../utils/publicSubmission';
import { LEAVE_REASONS, PICKUP_RELATIONS } from '../config/platform';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

// Public leave request (/leave): the parent identifies the student (national
// ID + last 4 digits of the registered mobile), then asks for the student to
// leave school, naming who will collect them.
export default function LeaveRequest() {
  const { t } = useTranslation();
  const [studentId, setStudentId] = useState('');
  const [last4, setLast4] = useState('');
  const [ctx, setCtx] = useState(null);
  const [form, setForm] = useState({ reason: 'MEDICAL', type: 'FULL', time: format(new Date(Date.now() + 3600e3), 'HH:mm'), pickupId: '', pickupName: '', pickupRelation: 'FATHER', pickupNationalId: '', pickupPhone: '', note: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await call('getLeaveContext', { studentId, last4 });
      setCtx(data);
      if (data.pickups[0]) setForm((f) => ({ ...f, pickupId: data.pickups[0].id }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.pickupId && !form.pickupName.trim()) { setError(t('leaveRequest.pickupRequired')); return; }
    const [h, m] = form.time.split(':').map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    setBusy(true);
    try {
      const attachment = file ? { fileName: file.name, mimeType: file.type || 'application/octet-stream', base64Data: await fileToBase64(file) } : null;
      const data = await call('submitLeaveRequest', {
        studentId, last4, reason: form.reason, type: form.type, requestedAt: at.getTime(), note: form.note,
        pickupId: form.pickupId || null, pickupName: form.pickupName, pickupRelation: form.pickupRelation, pickupNationalId: form.pickupNationalId, pickupPhone: form.pickupPhone,
        attachment,
      });
      setDone(data.code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const card = 'w-full max-w-xl bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';
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
        {done ? (
          <div className={`${card} text-center`}>
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('leaveRequest.doneTitle')}</h2>
            <p className="text-sm text-slate-600">{t('leaveRequest.doneBody')}</p>
            <p className="font-mono font-bold text-lg mt-3" dir="ltr">{done}</p>
          </div>
        ) : !ctx ? (
          <form onSubmit={verify} className={`${card} space-y-4`}>
            <h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />{t('tripConsent.verifyTitle')}</h2>
            <p className="text-sm text-slate-500">{t('tripConsent.verifyHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.studentId')}</label><input required inputMode="numeric" dir="ltr" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.last4')}</label><input required inputMode="numeric" maxLength={4} dir="ltr" value={last4} onChange={(e) => setLast4(e.target.value)} className={inputCls} /></div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.continue')}</button>
          </form>
        ) : (
          <form onSubmit={submit} className={`${card} space-y-4`}>
            <div><p className="text-xs text-slate-500">{t('tripConsent.student')}</p><p className="font-bold text-slate-900">{ctx.studentName} <span className="text-sm font-normal text-slate-500" dir="ltr">{ctx.grade} {ctx.className}</span></p></div>
            {ctx.open.length > 0 && <p className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3">{t('leaveRequest.openExists', { code: ctx.open[0].code })}</p>}
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
              <select value={form.pickupId} onChange={set('pickupId')} className={inputCls}>
                {ctx.pickups.map((p) => <option key={p.id} value={p.id}>{p.name} — {t(`platform.relations.${p.relation}`, p.relation)}</option>)}
                <option value="">{t('platform.leaves.otherPerson')}</option>
              </select>
              {!ctx.pickups.length && <p className="text-xs text-slate-500 mt-1">{t('leaveRequest.noAuthorized')}</p>}
            </div>
            {!form.pickupId && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.pickupName')}</label><input value={form.pickupName} onChange={set('pickupName')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.relation')}</label><select value={form.pickupRelation} onChange={set('pickupRelation')} className={inputCls}>{PICKUP_RELATIONS.map((r) => <option key={r} value={r}>{t(`platform.relations.${r}`)}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leaves.nationalId')}</label><input value={form.pickupNationalId} onChange={set('pickupNationalId')} className={inputCls} dir="ltr" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('common.phone')}</label><input value={form.pickupPhone} onChange={set('pickupPhone')} className={inputCls} dir="ltr" /></div>
                <p className="sm:col-span-2 text-xs text-amber-700">{t('leaveRequest.unauthorizedNote')}</p>
              </div>
            )}
            <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.notes')}</label><textarea rows={2} value={form.note} onChange={set('note')} className={inputCls} /></div>
            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer"><Paperclip className="w-4 h-4" />{file ? file.name : t('leaveRequest.attach')}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size > MAX_PUBLIC_FILE_BYTES) setError(t('tripConsent.fileTooBig')); else setFile(f || null); }} />
            </label>
            {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('leaveRequest.submit')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
