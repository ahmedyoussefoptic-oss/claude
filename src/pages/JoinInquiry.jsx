import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { School, Loader2, CheckCircle2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import { STAGES } from '../config/complaintTypes';
import { LEAD_SOURCES } from '../config/platform';

const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const emptyStudent = () => ({ name: '', gender: '', birthDate: '', grade: '', curriculum: '', currentSchool: '' });

// Public enrollment inquiry (/join?src=CAMPAIGN&c=<campaign>&ref=<referrer>):
// from the website, ad campaigns, a branch QR code or a parent's referral
// link. Opens (or adds to) the family's file in العملاء الجدد.
export default function JoinInquiry() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const branches = useBranches();
  const departments = useDepartments();
  const [form, setForm] = useState({ parentName: '', phone: '', district: '', branch: params.get('branch') || '', preferredContact: 'CALL' });
  const [students, setStudents] = useState([emptyStudent()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setStudent = (i, k, v) => setStudents((l) => l.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  useEffect(() => {
    const prev = document.title;
    document.title = t('join.pageTitle');
    return () => { document.title = prev; };
  }, [t]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const src = params.get('src');
      const { data } = await httpsCallable(functions, 'submitLeadInquiry')({
        ...form, students, source: LEAD_SOURCES.includes(src) ? src : (params.get('ref') ? 'REFERRAL' : 'WEBSITE'), campaign: params.get('c') || '', ref: params.get('ref') || '',
      });
      setDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const card = 'w-full max-w-2xl bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';
  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary"><img src={logo} alt="" className="h-8 w-auto" /><span className="font-bold text-lg">{t('app.brand')}</span></div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-primary mt-4 text-center flex items-center gap-2"><School className="w-8 h-8" />{t('join.title')}</h1>
        <p className="text-sm text-slate-500 text-center max-w-lg">{t('join.subtitle')}</p>
        {done ? (
          <div className={`${card} text-center`}>
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('join.doneTitle')}</h2>
            <p className="text-sm text-slate-600">{done.existing ? t('join.doneExisting') : t('join.doneBody')}</p>
            <p className="font-mono font-bold text-lg mt-3" dir="ltr">{done.code}</p>
          </div>
        ) : (
          <form onSubmit={submit} className={`${card} space-y-5`}>
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-800">{t('join.parent')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.parentName')} *</label><input required value={form.parentName} onChange={set('parentName')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.phone')} *</label><input required inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={form.phone} onChange={set('phone')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.district')}</label><input value={form.district} onChange={set('district')} className={inputCls} /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('join.branch')}</label><select value={form.branch} onChange={set('branch')} className={inputCls}><option value="">{t('join.anyBranch')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{t(`businessData.branches.${b.id}`, b.name)}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.preferredContact')}</label><select value={form.preferredContact} onChange={set('preferredContact')} className={inputCls}>{['CALL', 'WHATSAPP', 'VISIT'].map((c) => <option key={c} value={c}>{t(`platform.leads.contact.${c}`)}</option>)}</select></div>
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800">{t('join.students')}</h2>
                {students.length < 6 && <button type="button" onClick={() => setStudents((l) => [...l, emptyStudent()])} className="text-sm text-primary flex items-center gap-1"><Plus className="w-4 h-4" />{t('platform.leads.form.addStudent')}</button>}
              </div>
              {students.map((s, i) => (
                <div key={i} className="border border-slate-100 rounded-xl p-3 grid grid-cols-2 gap-2">
                  <div className="col-span-2"><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.studentName')}</label><input value={s.name} onChange={(e) => setStudent(i, 'name', e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-xs text-slate-600 mb-1">{t('platform.grade')} *</label><select required value={s.grade} onChange={(e) => setStudent(i, 'grade', e.target.value)} className={inputCls}><option value="">—</option>{STAGES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
                  <div><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.curriculum')}</label><select value={s.curriculum} onChange={(e) => setStudent(i, 'curriculum', e.target.value)} className={inputCls}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                  <div><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.gender')}</label><select value={s.gender} onChange={(e) => setStudent(i, 'gender', e.target.value)} className={inputCls}><option value="">—</option><option value="M">{t('platform.gender.M')}</option><option value="F">{t('platform.gender.F')}</option></select></div>
                  <div><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.birthDate')}</label><input type="date" value={s.birthDate} onChange={(e) => setStudent(i, 'birthDate', e.target.value)} className={inputCls} /></div>
                  <div className="col-span-2 flex items-end gap-2">
                    <div className="flex-1"><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.currentSchool')}</label><input value={s.currentSchool} onChange={(e) => setStudent(i, 'currentSchool', e.target.value)} className={inputCls} /></div>
                    {students.length > 1 && <button type="button" onClick={() => setStudents((l) => l.filter((_, j) => j !== i))} className="p-2.5 text-rose-500"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              ))}
            </section>
            {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
            <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('join.submit')}</button>
            <p className="text-[11px] text-slate-400 text-center">{t('join.privacy')}</p>
          </form>
        )}
      </main>
    </div>
  );
}
