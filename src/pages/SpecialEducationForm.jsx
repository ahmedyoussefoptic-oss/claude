import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { HeartHandshake, Loader2, CheckCircle2, AlertTriangle, Pencil, Plus } from 'lucide-react';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-xl bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6';
const STUDENT = { studentName: '', studentId: '', studentDob: '' };
const GUARDIAN = { guardianName: '', guardianId: '', guardianDob: '', relation: '', email: '', phone: '', altPhone: '' };
const ENROLL = { grade: '', inclusionType: '', disability: '' };
const today = new Date().toISOString().slice(0, 10);

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

// Public special-education data form (/sped/<formId>): the columns of the
// ministry's import template, filled by the parent. Sending again with the
// same student and guardian IDs updates the entry; «تعديل بيانات أرسلتها»
// loads it back.
export default function SpecialEducationForm() {
  const { formId } = useParams();
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ ...STUDENT, ...GUARDIAN, ...ENROLL });
  const [editLookup, setEditLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    call('getSpedForm', { formId }).then(setInfo).catch((err) => setLoadError(err.message));
  }, [formId]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await call('submitSpedEntry', { formId, ...form });
      setDone({ updated: r.updated, name: form.studentName });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const loadEntry = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await call('getSpedEntry', { formId, ...editLookup });
      setForm({ ...STUDENT, ...GUARDIAN, ...ENROLL, ...entry });
      setEditLookup(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // Another child of the same guardian: keep the guardian's part.
  const another = () => {
    setForm((f) => ({ ...f, ...STUDENT, ...ENROLL }));
    setDone(null);
  };

  const select = (k, list) => (
    <select required value={form[k]} onChange={set(k)} className={inputCls}>
      <option value="">{t('spedForm.choose')}</option>
      {(info?.lists?.[list] || []).map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
  const section = (title) => <h2 className="font-bold text-slate-900 border-b border-slate-100 pb-2">{title}</h2>;

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
        <h1 className="text-2xl font-bold text-slate-900 mt-4 flex items-center gap-2 text-center"><HeartHandshake className="w-7 h-7 text-primary shrink-0" />{info?.title || t('spedForm.title')}</h1>
        {info && <p className="text-sm text-slate-500 text-center max-w-md">{t('spedForm.subtitle', { stage: info.stageName, year: info.year })}</p>}

        {loadError ? (
          <div className={`${card} text-sm text-amber-800 bg-amber-50 border-amber-100 flex gap-2`}><AlertTriangle className="w-5 h-5 shrink-0" />{loadError}</div>
        ) : !info ? (
          <Loader2 className="w-6 h-6 animate-spin text-primary mt-8" />
        ) : done ? (
          <div className={`${card} text-center space-y-4`}>
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <p className="font-bold text-slate-900">{t(done.updated ? 'spedForm.updated' : 'spedForm.received', { name: done.name })}</p>
            <p className="text-sm text-slate-500">{t('spedForm.editLater')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" onClick={another} className="py-2.5 rounded-xl text-sm bg-primary text-white flex items-center justify-center gap-2"><Plus className="w-4 h-4" />{t('spedForm.another')}</button>
              <button type="button" onClick={() => setDone(null)} className="py-2.5 rounded-xl text-sm border border-slate-300 text-slate-700 flex items-center justify-center gap-2"><Pencil className="w-4 h-4" />{t('spedForm.review')}</button>
            </div>
          </div>
        ) : editLookup ? (
          <form onSubmit={loadEntry} className={`${card} space-y-4`}>
            <h2 className="font-bold text-slate-900">{t('spedForm.editTitle')}</h2>
            <p className="text-sm text-slate-500">{t('spedForm.editHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('spedForm.studentId')} required><input required inputMode="numeric" dir="ltr" maxLength={10} value={editLookup.studentId} onChange={(e) => setEditLookup((x) => ({ ...x, studentId: e.target.value }))} className={inputCls} /></Field>
              <Field label={t('spedForm.guardianId')} required><input required inputMode="numeric" dir="ltr" maxLength={10} value={editLookup.guardianId} onChange={(e) => setEditLookup((x) => ({ ...x, guardianId: e.target.value }))} className={inputCls} /></Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button disabled={busy} className="flex-1 py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('spedForm.load')}</button>
              <button type="button" onClick={() => { setEditLookup(null); setError(null); }} className="px-4 rounded-xl text-sm text-slate-500">{t('common.cancel')}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className={`${card} space-y-5`}>
            <button type="button" onClick={() => { setEditLookup({ studentId: '', guardianId: '' }); setError(null); }} className="w-full text-sm text-primary bg-primary/5 border border-primary/10 rounded-xl p-2.5 flex items-center justify-center gap-2"><Pencil className="w-4 h-4" />{t('spedForm.editSent')}</button>

            {section(t('spedForm.student'))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Field label={t('spedForm.studentName')} required hint={t('spedForm.nameHint')}><input required maxLength={120} value={form.studentName} onChange={set('studentName')} className={inputCls} /></Field></div>
              <Field label={t('spedForm.studentId')} required><input required inputMode="numeric" dir="ltr" maxLength={10} value={form.studentId} onChange={set('studentId')} className={inputCls} /></Field>
              <Field label={t('spedForm.studentDob')} required hint={t('spedForm.dobHint')}><input required type="date" min="1990-01-01" max={today} dir="ltr" value={form.studentDob} onChange={set('studentDob')} className={inputCls} /></Field>
            </div>

            {section(t('spedForm.guardian'))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Field label={t('spedForm.guardianName')} required><input required maxLength={120} value={form.guardianName} onChange={set('guardianName')} className={inputCls} /></Field></div>
              <Field label={t('spedForm.guardianId')} required><input required inputMode="numeric" dir="ltr" maxLength={10} value={form.guardianId} onChange={set('guardianId')} className={inputCls} /></Field>
              <Field label={t('spedForm.guardianDob')} required hint={t('spedForm.dobHint')}><input required type="date" min="1930-01-01" max={today} dir="ltr" value={form.guardianDob} onChange={set('guardianDob')} className={inputCls} /></Field>
              <Field label={t('spedForm.relation')} required>{select('relation', 'relations')}</Field>
              <Field label={t('spedForm.email')} required><input required type="email" dir="ltr" maxLength={120} value={form.email} onChange={set('email')} className={inputCls} /></Field>
              <Field label={t('spedForm.phone')} required><input required inputMode="tel" dir="ltr" maxLength={14} placeholder="05xxxxxxxx" value={form.phone} onChange={set('phone')} className={inputCls} /></Field>
              <Field label={t('spedForm.altPhone')}><input inputMode="tel" dir="ltr" maxLength={14} value={form.altPhone} onChange={set('altPhone')} className={inputCls} /></Field>
            </div>

            {section(t('spedForm.enrollment'))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('spedForm.grade')} required>{select('grade', 'grades')}</Field>
              <Field label={t('spedForm.inclusionType')} required>{select('inclusionType', 'inclusionTypes')}</Field>
              <div className="sm:col-span-2"><Field label={t('spedForm.disability')} required>{select('disability', 'disabilities')}</Field></div>
            </div>

            {error && <p className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('spedForm.submit')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
