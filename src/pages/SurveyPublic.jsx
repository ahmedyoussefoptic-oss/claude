import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, ClipboardCheck, AlertTriangle, RotateCcw, UserCheck } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { useBranches } from '../hooks/useOrgData';
import { callSurvey, surveyBranchList, CURRICULA, GRADES, CLASSES, gradeLabel, pick, other } from '../config/surveys';
import SurveyQuestions, { Bi, card, inputCls, pill, missBox, missingOf } from '../components/surveys/SurveyQuestions';

const doneKey = (code) => `survey:done:${code}`;
const LANG_KEY = 'survey-language';
const APP_LANG_KEY = 'mis-language';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage unavailable */ } } };
const digits = (v) => String(v || '').replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf)).replace(/\D/g, '');

// «/survey/:code» — the parents' feedback form (no sign-in). The parent types
// the student's national ID (form.identify "ID"): the student's name and
// details come from the school's record and are shown to confirm; only what
// the record lacks is asked. An ID not in the record falls back to typing the
// details. A branch can be fixed by the link (?branch=<id>). After sending,
// the same device can rate another child.
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
  const [nid, setNid] = useState('');
  const [who, setWho] = useState(null);
  const [looking, setLooking] = useState(false);
  const [idError, setIdError] = useState(null);
  const idMode = form?.identify !== 'NAME';

  // The page opens in English unless the link says ?lang=ar or the parent
  // switched language here before (remembered apart from the CRM's own
  // choice, which is put back on leaving so staff testing the link keep theirs).
  useEffect(() => {
    const prev = store.get(APP_LANG_KEY);
    const q = params.get('lang');
    const want = q === 'ar' || q === 'en' ? q : store.get(LANG_KEY) === 'ar' ? 'ar' : 'en';
    let ready = false;
    Promise.resolve(i18n.language === want || i18n.changeLanguage(want)).then(() => { ready = true; });
    const remember = (l) => { if (ready) store.set(LANG_KEY, l); };
    const restore = () => store.set(APP_LANG_KEY, prev);
    i18n.on('languageChanged', remember);
    window.addEventListener('pagehide', restore);
    return () => { i18n.off('languageChanged', remember); window.removeEventListener('pagehide', restore); restore(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const allBranches = useMemo(() => surveyBranchList(orgBranches), [orgBranches]);
  const branches = useMemo(() => {
    const all = allBranches;
    return form?.branches?.length ? all.filter((b) => form.branches.includes(b.id)) : all.filter((b) => orgBranches.some((o) => o.id === b.id));
  }, [allBranches, orgBranches, form]);
  const branchFixed = lockedBranch && branches.some((b) => b.id === lockedBranch) ? lockedBranch : (branches.length === 1 ? branches[0].id : '');
  useEffect(() => { if (branchFixed) setInfo((x) => (x.branch === branchFixed ? x : { ...x, branch: branchFixed })); }, [branchFixed]);

  const setI = (k, v) => { setInfo((x) => ({ ...x, [k]: v })); setMissing((m) => { const n = new Set(m); n.delete(k); return n; }); };
  const setA = (id, v) => {
    setAnswers((x) => { const n = { ...x }; if (v === undefined || v === '') delete n[id]; else n[id] = v; return n; });
    setMissing((m) => { const n = new Set(m); n.delete(id); return n; });
  };

  // What the record gave (shown, not asked) for the student behind the ID.
  const rec = idMode && who?.found ? who : null;
  const ask = {
    studentName: !rec?.studentName, branch: !rec?.branch && !branchFixed, curriculum: !rec?.curriculum, grade: !rec?.grade,
    className: form?.askClass && !rec?.className,
  };
  const ready = !idMode || (who && !who.done);

  const lookup = async () => {
    setIdError(null);
    const id = digits(nid);
    if (!/^\d{6,15}$/.test(id)) { setIdError(t('surveys.public.idInvalid')); return; }
    setLooking(true);
    try {
      const r = await callSurvey('surveyStudentLookup', { code, nationalId: id });
      setWho(r);
      setInfo((x) => (r.found
        ? { studentName: r.studentName || '', branch: r.branch || x.branch, curriculum: r.curriculum || '', grade: r.grade || '', className: r.className || '' }
        : emptyInfo({ branch: x.branch })));
      setClassOther(false);
      setMissing(new Set());
    } catch (err) { setIdError(err.message); } finally { setLooking(false); }
  };
  const changeId = () => { setWho(null); setIdError(null); setAnswers({}); setInfo((x) => emptyInfo({ branch: branchFixed || x.branch })); };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!ready) { if (idMode && !who) lookup(); return; }
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
      const r = await callSurvey('submitSurveyResponse', { code, info, answers, lang, ...(idMode ? { nationalId: digits(nid) } : {}) });
      const list = [...sent, (r?.studentName || info.studentName).trim()].slice(-10);
      setSent(list);
      try { localStorage.setItem(doneKey(code), JSON.stringify(list)); } catch { /* storage unavailable */ }
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const another = () => {
    setInfo(emptyInfo({ branch: branchFixed || (idMode ? '' : info.branch), curriculum: idMode ? '' : info.curriculum }));
    setNid('');
    setWho(null);
    setIdError(null);
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
                  {idMode && (
                    <div>
                      <Bi x={{ ar: 'رقم هوية الطالب/ة', en: "Student's ID Number" }} lang={lang} required />
                      <div className="flex gap-2 mt-1.5">
                        <input value={nid} onChange={(e) => { setNid(e.target.value); setIdError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!who) lookup(); } }}
                          inputMode="numeric" autoComplete="off" maxLength={20} dir="ltr" disabled={!!who || looking} className={`${inputCls} max-w-xs tracking-wider disabled:bg-slate-50`} />
                        {who
                          ? <button type="button" onClick={changeId} className="px-3 py-2 border border-slate-300 text-slate-700 rounded-xl text-sm shrink-0">{t('surveys.public.changeId')}</button>
                          : <button type="button" onClick={lookup} disabled={looking} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-60">{looking && <Loader2 className="w-4 h-4 animate-spin" />}{t('surveys.public.continue')}</button>}
                      </div>
                      {idError && <p className="text-xs text-rose-700 mt-1.5">{idError}</p>}
                      {!who && !idError && <p className="text-xs text-slate-500 mt-1.5">{t('surveys.public.idHint')}</p>}
                    </div>
                  )}
                  {rec && (
                    <div className={`rounded-xl border p-3 text-sm flex items-start gap-2 ${who.done ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                      <UserCheck className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <b className="block">{rec.studentName}</b>
                        <span className="text-xs opacity-80">{[pick(allBranches.find((b) => b.id === rec.branch), lang), gradeLabel(rec.grade, lang) + (rec.className ? ` ${rec.className}` : ''), pick(CURRICULA.find((c) => c.id === rec.curriculum), lang)].filter((x) => x && x.trim()).join(' · ')}</span>
                        {who.done && <p className="mt-1">{t('surveys.public.alreadyDone')}</p>}
                      </div>
                    </div>
                  )}
                  {idMode && who && !who.found && (
                    <p className={`text-sm rounded-xl border px-3 py-2 ${who.done ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>{who.done ? t('surveys.public.alreadyDone') : t('surveys.public.idNotFound')}</p>
                  )}
                  {ready && (<>
                  {ask.studentName && <div id="q-studentName" className={box('studentName')}>
                    <Bi x={{ ar: 'اسم الطالب/ة', en: "Student's Name" }} lang={lang} required />
                    <input value={info.studentName} onChange={(e) => setI('studentName', e.target.value)} maxLength={120} autoComplete="off" className={`${inputCls} mt-1.5`} />
                  </div>}
                  {ask.branch && (
                    <div id="q-branch" className={box('branch')}>
                      <Bi x={{ ar: 'الفرع', en: 'Branch' }} lang={lang} required />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                        {branches.map((b) => <button key={b.id} type="button" onClick={() => setI('branch', b.id)} className={`${pill(info.branch === b.id)} leading-tight`}>{pick(b, lang)}<span className="block text-[10px] opacity-70">{other(b, lang)}</span></button>)}
                      </div>
                    </div>
                  )}
                  {branchFixed && !rec?.branch && <p className="text-sm text-slate-600">{t('surveys.public.branch')}: <b>{pick(branches.find((b) => b.id === branchFixed), lang)}</b></p>}
                  {ask.curriculum && <div id="q-curriculum" className={box('curriculum')}>
                    <Bi x={{ ar: 'المنهج', en: 'Curriculum' }} lang={lang} required />
                    <div className="grid grid-cols-2 gap-2 mt-1.5 max-w-sm">{CURRICULA.map((c) => <button key={c.id} type="button" onClick={() => setI('curriculum', c.id)} className={pill(info.curriculum === c.id)}>{pick(c, lang)} · {other(c, lang)}</button>)}</div>
                  </div>}
                  {ask.grade && <div id="q-grade" className={box('grade')}>
                    <Bi x={{ ar: 'المرحلة الدراسية', en: 'Grade Level' }} lang={lang} required />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">{GRADES.map((g) => <button key={g} type="button" onClick={() => setI('grade', g)} className={pill(info.grade === g)}>{gradeLabel(g, lang)}</button>)}</div>
                  </div>}
                  {ask.className && (
                    <div>
                      <Bi x={{ ar: 'الفصل', en: 'Class' }} lang={lang} />
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {CLASSES.map((c) => <button key={c} type="button" onClick={() => { setClassOther(false); setI('className', info.className === c ? '' : c); }} className={`${pill(!classOther && info.className === c)} min-w-[2.6rem]`}>{c}</button>)}
                        <button type="button" onClick={() => { setClassOther(true); setI('className', ''); }} className={pill(classOther)}>{t('surveys.public.otherClass')}</button>
                      </div>
                      {classOther && <input value={info.className} onChange={(e) => setI('className', e.target.value)} maxLength={20} className={`${inputCls} mt-2 max-w-xs`} autoFocus />}
                    </div>
                  )}
                  </>)}
                </div>

                {ready && (<>
                  <SurveyQuestions items={form.items} answers={answers} setA={setA} missing={missing} lang={lang} />

                  {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
                  <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('surveys.public.submit')}</button>
                </>)}
                <p className="text-center text-xs text-slate-400 pb-6">#مستعدون_للغد · <span dir="ltr">#ReadyForTomorrow</span></p>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
