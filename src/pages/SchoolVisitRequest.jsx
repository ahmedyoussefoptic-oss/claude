import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { School, Loader2, CheckCircle2, Plus, Trash2, AlertTriangle, Users as UsersIcon, UserPlus, CalendarPlus } from 'lucide-react';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import PublicComplaintFields from '../components/publicReport/PublicComplaintFields';
import AppointmentPicker from '../components/appointments/AppointmentPicker';
import logo from '../assets/logo.png';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import { STAGES } from '../config/complaintTypes';
import { LEAD_SOURCES } from '../config/platform';

const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const emptyStudent = () => ({ name: '', gender: '', birthDate: '', grade: '', curriculum: '', currentSchool: '' });

// School visit request link (/school-visit?branch=<id>), sent to parents:
// a parent of current students books a visit appointment (the usual
// feedback record with a slot, confirmed by the principal); a family
// visiting for a new registration enters the new students and picks a slot
// (submitNewStudentVisit → العملاء الجدد + a pending visit for the principal).
export default function SchoolVisitRequest() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const branches = useBranches();
  const departments = useDepartments();
  const lockedBranch = params.get('branch') || '';
  const [mode, setMode] = useState(null); // 'current' | 'new'
  const [form, setForm] = useState({ parentName: '', phone: '', district: '', branch: lockedBranch, visitType: 'VISIT_TOUR', notes: '' });
  const [students, setStudents] = useState([emptyStudent()]);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [savedCurrent, setSavedCurrent] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setStudent = (i, k, v) => setStudents((l) => l.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const branchLabel = (id) => t(`tripConsent.branchNames.${id}`, { defaultValue: branches.find((b) => b.id === id)?.name || id });

  useEffect(() => {
    const prev = document.title;
    document.title = t('schoolVisit.pageTitle');
    return () => { document.title = prev; };
  }, [t]);

  const submit = async (e) => {
    e.preventDefault();
    if (!slot) { setError(t('schoolVisit.pickSlot')); return; }
    setBusy(true);
    setError(null);
    try {
      const src = params.get('src');
      const { data } = await httpsCallable(functions, 'submitNewStudentVisit')({
        ...form, students, slot, source: LEAD_SOURCES.includes(src) ? src : 'WEBSITE', campaign: params.get('c') || '',
      });
      setDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const card = 'w-full max-w-2xl bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';
  const success = (title, body, extra) => (
    <div className={`${card} text-center`}>
      <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">{title}</h2>
      <p className="text-sm text-slate-600">{body}</p>
      {extra}
    </div>
  );

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary"><img src={logo} alt="" className="h-8 w-auto" /><span className="font-bold text-lg">{t('tripConsent.schoolName')}</span></div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-primary mt-4 text-center flex items-center gap-2"><CalendarPlus className="w-8 h-8" />{t('schoolVisit.title')}</h1>
        {lockedBranch && <p className="text-sm font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">{branchLabel(lockedBranch)}</p>}

        {done ? success(t('schoolVisit.doneTitle'), t('schoolVisit.doneBody', { when: done.when }), <p className="font-mono font-bold text-lg mt-3" dir="ltr">{done.code}</p>)
          : savedCurrent ? success(t('schoolVisit.doneTitle'), t('schoolVisit.doneCurrent'), (
            <div className="mt-3 space-y-1">{savedCurrent.map((x) => <p key={x.id} className="font-mono font-bold" dir="ltr">{x.id}</p>)}</div>
          ))
          : mode === null ? (
            <>
              <p className="text-sm text-slate-500 text-center max-w-lg">{t('schoolVisit.subtitle')}</p>
              <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setMode('current')} className="bg-white border-2 border-slate-200 hover:border-primary rounded-2xl p-6 text-center shadow-sm">
                  <UsersIcon className="w-9 h-9 text-primary mx-auto mb-2" />
                  <p className="font-bold text-slate-900">{t('schoolVisit.current')}</p>
                  <p className="text-xs text-slate-500 mt-1">{t('schoolVisit.currentHint')}</p>
                </button>
                <button type="button" onClick={() => setMode('new')} className="bg-white border-2 border-slate-200 hover:border-primary rounded-2xl p-6 text-center shadow-sm">
                  <UserPlus className="w-9 h-9 text-emerald-600 mx-auto mb-2" />
                  <p className="font-bold text-slate-900">{t('schoolVisit.newReg')}</p>
                  <p className="text-xs text-slate-500 mt-1">{t('schoolVisit.newRegHint')}</p>
                </button>
              </div>
            </>
          ) : mode === 'current' ? (
            <>
              <button type="button" onClick={() => setMode(null)} className="self-center px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm">{t('common.back')}</button>
              <PublicComplaintFields bookAppointment lockBranch={!!lockedBranch} initialBranch={lockedBranch} onSuccess={(items) => setSavedCurrent(items)} />
            </>
          ) : (
            <form onSubmit={submit} className={`${card} space-y-5`}>
              <div className="flex items-center justify-between">
                <p className="font-bold text-slate-900 flex items-center gap-2"><School className="w-5 h-5 text-emerald-600" />{t('schoolVisit.newReg')}</p>
                <button type="button" onClick={() => setMode(null)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm">{t('common.back')}</button>
              </div>
              <section className="space-y-3">
                <h2 className="text-sm font-bold text-slate-800">{t('join.parent')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.parentName')} *</label><input required value={form.parentName} onChange={set('parentName')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.phone')} *</label><input required inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={form.phone} onChange={set('phone')} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('platform.leads.form.district')}</label><input value={form.district} onChange={set('district')} className={inputCls} /></div>
                  {!lockedBranch && (
                    <div><label className="block text-sm font-medium text-slate-700 mb-1">{t('join.branch')} *</label><select required value={form.branch} onChange={(e) => { set('branch')(e); setSlot(null); }} className={inputCls}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{branchLabel(b.id)}</option>)}</select></div>
                  )}
                </div>
              </section>
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-800">{t('schoolVisit.newStudents')}</h2>
                  {students.length < 6 && <button type="button" onClick={() => setStudents((l) => [...l, emptyStudent()])} className="text-sm text-primary flex items-center gap-1"><Plus className="w-4 h-4" />{t('platform.leads.form.addStudent')}</button>}
                </div>
                {students.map((s, i) => (
                  <div key={i} className="border border-slate-100 rounded-xl p-3 grid grid-cols-2 gap-2">
                    <div className="col-span-2"><label className="block text-xs text-slate-600 mb-1">{t('platform.leads.form.studentName')} *</label><input required value={s.name} onChange={(e) => setStudent(i, 'name', e.target.value)} className={inputCls} /></div>
                    <div><label className="block text-xs text-slate-600 mb-1">{t('schoolVisit.gradeWanted')} *</label><select required value={s.grade} onChange={(e) => setStudent(i, 'grade', e.target.value)} className={inputCls}><option value="">—</option>{STAGES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
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
              <section className="space-y-3">
                <h2 className="text-sm font-bold text-slate-800">{t('schoolVisit.visit')}</h2>
                <div className="flex gap-2">
                  {['VISIT_TOUR', 'VISIT'].map((v) => (
                    <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, visitType: v }))} className={`flex-1 py-2.5 rounded-xl text-sm border ${form.visitType === v ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`schoolVisit.type.${v}`)}</button>
                  ))}
                </div>
                <AppointmentPicker branch={form.branch} value={slot} onChange={setSlot} />
                <div><label className="block text-xs text-slate-600 mb-1">{t('schoolVisit.notes')}</label><input value={form.notes} maxLength={300} onChange={set('notes')} className={inputCls} /></div>
              </section>
              {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
              <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('schoolVisit.submit')}</button>
              <p className="text-[11px] text-slate-400 text-center">{t('schoolVisit.confirmNote')}</p>
            </form>
          )}
      </main>
    </div>
  );
}
