import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2 } from 'lucide-react';
import SurveyQuestions, { Bi, card, pill, missBox, missingOf } from './SurveyQuestions';
import { CURRICULA, GRADES, gradeLabel, pick, other } from '../../config/surveys';

// A meeting's linked feedback form on the family's page: one answer per
// child, the child's details already known (curriculum / grade asked only
// when the student record lacks them). `send(payload)` calls the meeting's
// own function; `onSent` reloads the page's state.
export default function MeetingFeedback({ feedback, send, onSent }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const firstOpen = () => feedback.students.find((s) => !s.done)?.id || feedback.students[0]?.id;
  const [sid, setSid] = useState(firstOpen);
  const [answers, setAnswers] = useState({});
  const [extra, setExtra] = useState({ curriculum: '', grade: '' });
  const [missing, setMissing] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [justSent, setJustSent] = useState('');
  const st = feedback.students.find((s) => s.id === sid) || feedback.students[0];

  const setA = (id, v) => {
    setAnswers((x) => { const n = { ...x }; if (v === undefined || v === '') delete n[id]; else n[id] = v; return n; });
    setMissing((m) => { const n = new Set(m); n.delete(id); return n; });
  };
  const choose = (id) => { setSid(id); setAnswers({}); setExtra({ curriculum: '', grade: '' }); setMissing(new Set()); setError(null); setJustSent(''); };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const miss = new Set(missingOf(feedback.items, answers));
    if (!st.curriculum && !extra.curriculum) miss.add('curriculum');
    if (!st.grade && !extra.grade) miss.add('grade');
    if (miss.size) {
      setMissing(miss);
      setError(t('surveys.public.missing'));
      document.getElementById(`q-${[...miss][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!Object.keys(answers).length) { setError(t('surveys.public.answerOne')); return; }
    setBusy(true);
    try {
      await send({ forStudent: st.id, answers, curriculum: extra.curriculum, grade: extra.grade, lang });
      setJustSent(st.studentName);
      const next = feedback.students.find((s) => !s.done && s.id !== st.id);
      setAnswers({});
      setExtra({ curriculum: '', grade: '' });
      if (next) setSid(next.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await onSent();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-2xl space-y-4">
      <div className={card}>
        <p className="text-lg font-bold text-primary">{feedback.title}</p>
        {(feedback.intro?.ar || feedback.intro?.en) && <p className="text-sm text-slate-700 leading-7 whitespace-pre-line mt-2">{pick(feedback.intro, lang)}</p>}
      </div>
      {justSent && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t('surveys.meeting.sent', { name: justSent })}</p>}

      <div className={`${card} space-y-3`}>
        {feedback.students.length > 1 && (
          <div>
            <p className="text-sm font-bold text-slate-800 mb-2">{t('surveys.meeting.whichChild')}</p>
            <div className="flex flex-wrap gap-2">
              {feedback.students.map((s) => (
                <button key={s.id} type="button" disabled={s.done} onClick={() => choose(s.id)} className={`${pill(s.id === st.id && !s.done)} flex items-center gap-1.5 disabled:opacity-60`}>
                  {s.done && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}{s.studentName}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="text-sm text-slate-700">
          <Bi x={{ ar: 'بيانات الطالب/ة', en: 'Student Information' }} lang={lang} className="text-base font-bold text-primary" />
          <span className="block mt-2"><b>{st.studentName}</b>{st.grade ? ` · ${gradeLabel(st.grade, lang)}` : ''}{st.className ? ` ${st.className}` : ''}{st.curriculum ? ` · ${pick(CURRICULA.find((c) => c.id === st.curriculum), lang)}` : ''}</span>
        </div>
        {!st.curriculum && (
          <div id="q-curriculum" className={missBox(missing, 'curriculum')}>
            <Bi x={{ ar: 'المنهج', en: 'Curriculum' }} lang={lang} required />
            <div className="grid grid-cols-2 gap-2 mt-1.5 max-w-sm">{CURRICULA.map((c) => <button key={c.id} type="button" onClick={() => { setExtra((x) => ({ ...x, curriculum: c.id })); setA('curriculum'); }} className={pill(extra.curriculum === c.id)}>{pick(c, lang)} · {other(c, lang)}</button>)}</div>
          </div>
        )}
        {!st.grade && (
          <div id="q-grade" className={missBox(missing, 'grade')}>
            <Bi x={{ ar: 'المرحلة الدراسية', en: 'Grade Level' }} lang={lang} required />
            <div className="flex flex-wrap gap-1.5 mt-1.5">{GRADES.map((g) => <button key={g} type="button" onClick={() => { setExtra((x) => ({ ...x, grade: g })); setA('grade'); }} className={pill(extra.grade === g)}>{gradeLabel(g, lang)}</button>)}</div>
          </div>
        )}
      </div>

      <SurveyQuestions items={feedback.items} answers={answers} setA={setA} missing={missing} lang={lang} />

      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{feedback.students.length > 1 ? t('surveys.meeting.submitFor', { name: st.studentName }) : t('surveys.public.submit')}
      </button>
    </form>
  );
}
