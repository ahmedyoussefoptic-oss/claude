import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, ClipboardCheck, AlertTriangle, RotateCcw } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { useBranches } from '../hooks/useOrgData';
import { callSurvey, surveyBranchList, CURRICULA, GRADES, CLASSES, gradeLabel, pick, other } from '../config/surveys';
import SurveyQuestions, { Bi, card, inputCls, pill, missBox, missingOf } from '../components/surveys/SurveyQuestions';

const doneKey = (code) => `survey:done:${code}`;

// «/survey/:code» — the parents' feedback form (no sign-in). A branch can be
// fixed by the link (?branch=<id>). After sending, the same device can rate
// another child.
export default function SurveyPublic() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const orgBranches = useBranches();
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const lockedBranch = params.get('branch') || '';
  const emptyInfo = (keep = {}) => ({ studentName: '', branch: keep.branch || '', curriculum: keep.curriculum || '', grade: '', className: '' });
  const [info, setInfo] = useState(() => emptyInfo({ branch: lockedBranch }));
  const [classOther, setClassOther] = useState(false);
  const [answers, setAnswers] = useState({});
  const [missing, setMissing] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(() => { try { return JSON.parse(localStorage.getItem(doneKey(code)) || '[]'); } catch { return []; } });

  useEffect(() => {
    callSurvey('surveyFormPublic', { code }).then((f) => {
      setForm(f);
      if (lockedBranch && f.branches.length && !f.branches.includes(lockedBranch)) setInfo((x) => ({ ...x, branch: '' }));
    }).catch((err) => setLoadError(err.message));
  }, [code, lockedBranch]);
  useEffect(() => {
    if (!form) return undefined;
    const prev = document.title;
    document.title = form.title;
    return () => { document.title = prev; };
  }, [form]);

  const branches = useMemo(() => {
    const all = surveyBranchList(orgBranches);
    return form?.branches?.length ? all.filter((b) => form.branches.includes(b.id)) : all.filter((b) => orgBranches.some((o) => o.id === b.id));
  }, [orgBranches, form]);
  const branchFixed = lockedBranch && branches.some((b) => b.id === lockedBranch) ? lockedBranch : (branches.length === 1 ? branches[0].id : '');
  useEffect(() => { if (branchFixed) setInfo((x) => (x.branch === branchFixed ? x : { ...x, branch: branchFixed })); }, [branchFixed]);

  const setI = (k, v) => { setInfo((x) => ({ ...x, [k]: v })); setMissing((m) => { const n = new Set(m); n.delete(k); return n; }); };
  const setA = (id, v) => {
    setAnswers((x) => { const n = { ...x }; if (v === undefined || v === '') delete n[id]; else n[id] = v; return n; });
    setMissing((m) => { const n = new Set(m); n.delete(id); return n; });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const miss = new Set();
    if (info.studentName.trim().length < 2) miss.add('studentName');
    ['branch', 'curriculum', 'grade'].forEach((k) => { if (!info[k]) miss.add(k); });
    missingOf(form.items, answers).forEach((id) => miss.add(id));
    if (!miss.size && !Object.keys(answers).length) { setError(t('surveys.public.answerOne')); return; }
    if (miss.size) {
      setMissing(miss);
      setError(t('surveys.public.missing'));
      const first = [...miss][0];
      document.getElementById(`q-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      await callSurvey('submitSurveyResponse', { code, info, answers, lang });
      const list = [...sent, info.studentName.trim()].slice(-10);
      setSent(list);
      try { localStorage.setItem(doneKey(code), JSON.stringify(list)); } catch { /* storage unavailable */ }
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const another = () => {
    setInfo(emptyInfo({ branch: info.branch, curriculum: info.curriculum }));
    setAnswers({});
    setClassOther(false);
    setMissing(new Set());
    setDone(false);
    window.scrollTo({ top: 0 });
  };

  const box = (id) => missBox(missing, id);

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-2xl" title={form?.title} icon={ClipboardCheck} />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {loadError ? (
          <div className={`${card} text-center`}><AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" /><p className="text-slate-700">{loadError}</p></div>
        ) : !form ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mt-16" />
        ) : (
          <>
            <h1 className="public-title text-2xl md:text-3xl font-bold text-primary mt-4 text-center">{form.title}</h1>
            {form.date && <p className="text-xs text-slate-500 -mt-2">{new Date(`${form.date}T12:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
            {done ? (
              <div className={`${card} text-center`}>
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">{t('surveys.public.thanks')}</h2>
                <p className="text-sm text-slate-600">{t('surveys.public.thanksBody')}</p>
                <button type="button" onClick={another} className="mt-5 px-4 py-2.5 border border-primary/40 text-primary rounded-xl text-sm inline-flex items-center gap-2"><RotateCcw className="w-4 h-4" />{t('surveys.public.another')}</button>
              </div>
            ) : !form.open ? (
              <div className={`${card} text-center`}><p className="text-slate-700">{t('surveys.public.closed')}</p></div>
            ) : (
              <form onSubmit={submit} noValidate className="w-full max-w-2xl space-y-4">
                {(form.intro.ar || form.intro.en) && (
                  <div className={`${card} grid gap-4 ${form.intro.ar && form.intro.en ? 'md:grid-cols-2' : ''}`}>
                    {[lang, lang === 'en' ? 'ar' : 'en'].filter((l) => form.intro[l]).map((l) => (
                      <p key={l} dir={l === 'en' ? 'ltr' : 'rtl'} className={`text-sm leading-7 whitespace-pre-line ${l === lang ? 'text-slate-800' : 'text-slate-500'}`}>{form.intro[l]}</p>
                    ))}
                  </div>
                )}
                {!!sent.length && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{t('surveys.public.sentBefore', { names: sent.join('، ') })}</p>}

                <div className={`${card} space-y-4`}>
                  <Bi x={{ ar: 'بيانات الطالب/ة', en: 'Student Information' }} lang={lang} className="text-base font-bold text-primary" />
                  <div id="q-studentName" className={box('studentName')}>
                    <Bi x={{ ar: 'اسم الطالب/ة', en: "Student's Name" }} lang={lang} required />
                    <input value={info.studentName} onChange={(e) => setI('studentName', e.target.value)} maxLength={120} autoComplete="off" className={`${inputCls} mt-1.5`} />
                  </div>
                  {!branchFixed && (
                    <div id="q-branch" className={box('branch')}>
                      <Bi x={{ ar: 'الفرع', en: 'Branch' }} lang={lang} required />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                        {branches.map((b) => <button key={b.id} type="button" onClick={() => setI('branch', b.id)} className={`${pill(info.branch === b.id)} leading-tight`}>{pick(b, lang)}<span className="block text-[10px] opacity-70">{other(b, lang)}</span></button>)}
                      </div>
                    </div>
                  )}
                  {branchFixed && <p className="text-sm text-slate-600">{t('surveys.public.branch')}: <b>{pick(branches.find((b) => b.id === branchFixed), lang)}</b></p>}
                  <div id="q-curriculum" className={box('curriculum')}>
                    <Bi x={{ ar: 'المنهج', en: 'Curriculum' }} lang={lang} required />
                    <div className="grid grid-cols-2 gap-2 mt-1.5 max-w-sm">{CURRICULA.map((c) => <button key={c.id} type="button" onClick={() => setI('curriculum', c.id)} className={pill(info.curriculum === c.id)}>{pick(c, lang)} · {other(c, lang)}</button>)}</div>
                  </div>
                  <div id="q-grade" className={box('grade')}>
                    <Bi x={{ ar: 'المرحلة الدراسية', en: 'Grade Level' }} lang={lang} required />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">{GRADES.map((g) => <button key={g} type="button" onClick={() => setI('grade', g)} className={pill(info.grade === g)}>{gradeLabel(g, lang)}</button>)}</div>
                  </div>
                  {form.askClass && (
                    <div>
                      <Bi x={{ ar: 'الفصل', en: 'Class' }} lang={lang} />
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {CLASSES.map((c) => <button key={c} type="button" onClick={() => { setClassOther(false); setI('className', info.className === c ? '' : c); }} className={`${pill(!classOther && info.className === c)} min-w-[2.6rem]`}>{c}</button>)}
                        <button type="button" onClick={() => { setClassOther(true); setI('className', ''); }} className={pill(classOther)}>{t('surveys.public.otherClass')}</button>
                      </div>
                      {classOther && <input value={info.className} onChange={(e) => setI('className', e.target.value)} maxLength={20} className={`${inputCls} mt-2 max-w-xs`} autoFocus />}
                    </div>
                  )}
                </div>

                <SurveyQuestions items={form.items} answers={answers} setA={setA} missing={missing} lang={lang} />

                {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
                <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('surveys.public.submit')}</button>
                <p className="text-center text-xs text-slate-400 pb-6">#مستعدون_للغد · <span dir="ltr">#ReadyForTomorrow</span></p>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
