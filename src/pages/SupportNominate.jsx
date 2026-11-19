import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, KeyRound, UserPlus, Check, X, Search, Send, CircleCheck, LogOut } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { callSupport, SUPPORT_TYPES, TYPE_STYLE, SUBJECTS } from '../config/support';

const card = 'w-full max-w-3xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';
const inp = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
const TEACHER_KEY = 'mis-support-teacher';
const STAGES = ['KG', 'PRIMARY', 'MIDDLE', 'SECONDARY'];
const byGrade = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
// The teacher's name, subject and stage, kept on this device for next time.
const readTeacher = () => {
  try {
    const v = JSON.parse(localStorage.getItem(TEACHER_KEY) || '{}');
    return { name: String(v.name || ''), subject: String(v.subject || ''), stage: STAGES.includes(v.stage) ? v.stage : '' };
  } catch { return { name: '', subject: '', stage: '' }; }
};

// «/support-nominate/:token» — a teacher, without an account (teachers
// change), enters with the PIN, their name, subject and stage, then
// nominates students of that stage: picks a class, ticks students, and gives
// each the programme, subject and reason. A student already in this cycle or
// another active one can't be picked again.
export default function SupportNominate() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [teacher, setTeacher] = useState(readTeacher);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [branch, setBranch] = useState('');
  const [grade, setGrade] = useState('');
  const [cls, setCls] = useState('');
  const [q, setQ] = useState('');
  const [def, setDef] = useState({ type: 'REMEDIAL', subject: '', reason: '' });
  const [picked, setPicked] = useState([]);

  const open = async (e) => {
    e.preventDefault();
    setBusy('open');
    setError(null);
    try {
      const who = { name: teacher.name.trim(), subject: teacher.subject.trim(), stage: teacher.stage };
      const s = await callSupport('supportTeacherOpen', { token, pin, teacher: who });
      try { localStorage.setItem(TEACHER_KEY, JSON.stringify(who)); } catch { /* private mode */ }
      setTeacher(who);
      setState(s);
      setDef((d) => ({ ...d, subject: who.subject }));
      if (s.branches.length === 1) setBranch(s.branches[0].id);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  // Another teacher on the same device: back to the entry form.
  const leave = () => {
    setState(null); setPin(''); setPicked([]); setResult(null); setError(null);
    setBranch(''); setGrade(''); setCls(''); setQ('');
  };
  const ready = pin.length >= 4 && teacher.name.trim() && teacher.subject.trim() && teacher.stage;

  const students = useMemo(() => state?.students || [], [state]);
  const inBranch = useMemo(() => students.filter((s) => !branch || s.branch === branch), [students, branch]);
  const grades = useMemo(() => [...new Set(inBranch.map((s) => s.grade).filter(Boolean))].sort(byGrade), [inBranch]);
  const classes = useMemo(() => [...new Set(inBranch.filter((s) => s.grade === grade).map((s) => s.className).filter(Boolean))].sort(byGrade), [inBranch, grade]);
  const query = q.trim();
  const shown = useMemo(() => {
    if (query.length >= 2) return inBranch.filter((s) => s.name.includes(query)).slice(0, 60);
    if (!grade) return [];
    return inBranch.filter((s) => s.grade === grade && (!cls || s.className === cls));
  }, [inBranch, grade, cls, query]);

  const isPicked = (k) => picked.some((x) => x.k === k);
  const toggle = (s) => setPicked((list) => (list.some((x) => x.k === s.k) ? list.filter((x) => x.k !== s.k)
    : [...list, { k: s.k, name: s.name, grade: s.grade, className: s.className, type: def.type, subject: def.subject, reason: def.reason }]));
  const edit = (k, patch) => setPicked((list) => list.map((x) => (x.k === k ? { ...x, ...patch } : x)));

  const submit = async () => {
    setError(null);
    setBusy('send');
    try {
      const r = await callSupport('supportTeacherNominate', {
        token, pin, teacher,
        entries: picked.map((x) => ({ k: x.k, type: x.type, subjects: x.subject.split(/[،,]/).map((y) => y.trim()).filter(Boolean), reason: x.reason })),
      });
      setState(r.state);
      setResult(r.result);
      setPicked([]);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const chip = (on, tone = 'bg-primary text-white border-primary') => `px-3 py-1.5 rounded-lg text-sm border ${on ? tone : 'bg-white text-slate-600 border-slate-200'}`;

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-3xl" />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!state ? (
          <form onSubmit={open} className={`${card} max-w-sm text-center space-y-3 mt-6`}>
            <KeyRound className="w-10 h-10 text-primary mx-auto" />
            <p className="font-bold text-slate-900">{t('support.tnom.title')}</p>
            <p className="text-sm text-slate-500">{t('support.tnom.prompt')}</p>
            <input value={teacher.name} onChange={(e) => setTeacher((x) => ({ ...x, name: e.target.value }))} placeholder={t('support.tnom.teacherName')} className={`${inp} text-center py-3`} />
            <input list="tnom-subjects" value={teacher.subject} onChange={(e) => setTeacher((x) => ({ ...x, subject: e.target.value }))} placeholder={t('support.tnom.mySubject')} className={`${inp} text-center py-3`} />
            <div className="text-start space-y-1.5">
              <p className="text-xs text-slate-500">{t('support.tnom.myStage')}</p>
              <div className="grid grid-cols-2 gap-2">
                {STAGES.map((st) => <button key={st} type="button" onClick={() => setTeacher((x) => ({ ...x, stage: st }))} className={chip(teacher.stage === st)}>{t(`support.groups.stages.${st}`)}</button>)}
              </div>
            </div>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} dir="ltr" placeholder="PIN" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono" />
            {error && <p className="text-sm text-rose-700">{error}</p>}
            <datalist id="tnom-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
            <button disabled={busy === 'open' || !ready} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy === 'open' && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.tnom.enter')}</button>
          </form>
        ) : (
          <>
            <div className={card}>
              <p className="font-bold text-slate-900 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" />{t('support.tnom.title')} — {state.cycle}</p>
              <p className="text-xs text-slate-500 mt-1">{state.when} · <span dir="ltr">{state.from} → {state.to}</span></p>
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-xs text-slate-500">{t('support.tnom.as', { name: teacher.name, subject: teacher.subject, stage: t(`support.groups.stages.${teacher.stage}`) })}</p>
                <button type="button" onClick={leave} className="text-xs text-slate-500 hover:text-primary flex items-center gap-1 shrink-0"><LogOut className="w-3.5 h-3.5" />{t('support.tnom.leave')}</button>
              </div>
            </div>

            {result && (
              <div className="w-full max-w-3xl text-sm rounded-xl p-3 border bg-emerald-50 text-emerald-800 border-emerald-100 space-y-1">
                <p className="font-bold flex items-center gap-1"><CircleCheck className="w-4 h-4" />{t('support.tnom.done', { n: result.added })}</p>
                {state.needsApproval && result.added > 0 && <p className="text-xs">{t('support.tnom.needsApproval')}</p>}
                {result.already > 0 && <p className="text-xs text-amber-800">{t('support.tnom.already', { n: result.already })}</p>}
                {result.otherCycleList?.length > 0 && <p className="text-xs text-amber-800">{t('support.nom.otherCycleList')}: {result.otherCycleList.map((x) => `${x.name} (${x.cycle})`).join('، ')}</p>}
              </div>
            )}
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 w-full max-w-3xl">{error}</p>}

            <section className={`${card} space-y-3`}>
              <p className="font-bold text-slate-900">{t('support.tnom.step1')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {state.branches.length > 1 && (
                  <select value={branch} onChange={(e) => { setBranch(e.target.value); setGrade(''); setCls(''); }} className={inp}>
                    <option value="">{t('support.tnom.branch')}</option>
                    {state.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
                <select value={grade} onChange={(e) => { setGrade(e.target.value); setCls(''); }} className={inp} dir="ltr">
                  <option value="">{t('support.tnom.grade')}</option>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={cls} onChange={(e) => setCls(e.target.value)} disabled={!grade} className={inp} dir="ltr">
                  <option value="">{t('support.tnom.allClasses')}</option>
                  {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('support.tnom.search')} className={`${inp} pr-9`} /></div>
              {!shown.length ? <p className="text-sm text-slate-400 text-center py-6">{grade || query.length >= 2 ? t('support.tnom.none') : t('support.tnom.pickClass')}</p> : (
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl max-h-[28rem] overflow-y-auto">
                  {shown.map((s) => {
                    const blocked = s.inThis || s.inOther;
                    const on = isPicked(s.k);
                    return (
                      <button key={s.k} type="button" disabled={!!blocked} onClick={() => toggle(s)} className={`w-full flex items-center gap-3 px-3 py-2.5 text-start ${on ? 'bg-primary/5' : ''} ${blocked ? 'opacity-70 cursor-not-allowed' : 'hover:bg-slate-50'}`}>
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary text-white' : 'border-slate-300'}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{s.name}</span>
                          <span className="block text-xs text-slate-500"><span dir="ltr">{`${s.grade} ${s.className}`.trim()}</span></span>
                        </span>
                        {s.inThis && <span className={`text-[11px] px-2 py-0.5 rounded-full border ${TYPE_STYLE[s.inThis]}`}>{t('support.tnom.nominated', { type: t(`support.types.${s.inThis}`) })}</span>}
                        {!s.inThis && s.inOther && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">{t('support.tnom.inOther', { cycle: s.inOther })}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={`${card} space-y-3`}>
              <p className="font-bold text-slate-900">{t('support.tnom.step2')}</p>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                <p className="text-xs text-slate-500">{t('support.tnom.defaults')}</p>
                <div className="flex flex-wrap gap-2">{SUPPORT_TYPES.map((x) => <button key={x} type="button" onClick={() => setDef((d) => ({ ...d, type: x }))} className={chip(def.type === x)}>{t(`support.types.${x}`)}</button>)}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input list="tnom-subjects" value={def.subject} onChange={(e) => setDef((d) => ({ ...d, subject: e.target.value }))} placeholder={t('support.tnom.subject')} className={inp} />
                  <input value={def.reason} onChange={(e) => setDef((d) => ({ ...d, reason: e.target.value }))} placeholder={t('support.tnom.reason')} className={inp} />
                </div>
              </div>
              {!picked.length ? <p className="text-sm text-slate-400 text-center py-4">{t('support.tnom.nonePicked')}</p> : (
                <div className="space-y-2">
                  {picked.map((x) => (
                    <div key={x.k} className="border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">{x.name} <span className="text-xs text-slate-500" dir="ltr">{`${x.grade} ${x.className}`.trim()}</span></p>
                        <button type="button" onClick={() => setPicked((l) => l.filter((y) => y.k !== x.k))} className="text-slate-400 hover:text-rose-600"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="flex flex-wrap gap-2">{SUPPORT_TYPES.map((y) => <button key={y} type="button" onClick={() => edit(x.k, { type: y })} className={chip(x.type === y, TYPE_STYLE[y])}>{t(`support.types.${y}`)}</button>)}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input list="tnom-subjects" value={x.subject} onChange={(e) => edit(x.k, { subject: e.target.value })} placeholder={t('support.tnom.subject')} className={inp} />
                        <input value={x.reason} onChange={(e) => edit(x.k, { reason: e.target.value })} placeholder={t('support.tnom.reason')} className={inp} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <datalist id="tnom-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
              <button type="button" disabled={!picked.length || busy === 'send'} onClick={submit} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('support.tnom.submit', { n: picked.length })}
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
