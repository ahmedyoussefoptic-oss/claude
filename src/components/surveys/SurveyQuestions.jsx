import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { pick, other } from '../../config/surveys';

// The questions of a feedback form (teachers, then the rest by section) —
// on the form's own link (/survey/:code) and on a meeting's page when the
// meeting links the form.
export const card = 'w-full max-w-2xl bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-200';
export const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
export const pill = (on) => `px-3 py-2 rounded-xl text-sm border transition ${on ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'}`;

// A question's text in the page's language, the other language under it.
export function Bi({ x, lang, className = 'text-sm font-bold text-slate-800', required }) {
  const sub = other(x, lang);
  return (
    <div>
      <p className={`${className} whitespace-pre-line`}>{pick(x, lang)}{required && <span className="text-rose-600"> *</span>}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-line" dir="auto" style={{ textAlign: lang === 'en' ? 'left' : 'right' }}>{sub}</p>}
    </div>
  );
}

// 1 … 5 (and «لم أقابله» / «لا ينطبق» when allowed).
export function Scale({ value, onChange, naLabel, low, high }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(value === n ? undefined : n)} aria-pressed={value === n}
            className={`w-11 h-11 rounded-xl text-base font-bold border transition ${value === n ? 'bg-primary text-white border-primary shadow' : 'bg-white text-slate-700 border-slate-200 hover:border-primary/50'}`}>{n}</button>
        ))}
        {naLabel && <button type="button" onClick={() => onChange(value === 'NA' ? undefined : 'NA')} aria-pressed={value === 'NA'} className={`px-3 h-11 rounded-xl text-xs border transition ${value === 'NA' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200'}`}>{naLabel}</button>}
      </div>
      {(low || high) && <div className="flex justify-between text-[11px] text-slate-400 mt-1" style={{ maxWidth: '15.5rem' }}><span>{low}</span><span>{high}</span></div>}
    </div>
  );
}

// The ring around a question left out.
export const missBox = (missing, id) => (missing.has(id) ? 'ring-2 ring-rose-300 rounded-xl' : '');
// The required questions with no answer.
export const missingOf = (items, answers) => items.filter((it) => it.required && (answers[it.id] === undefined || answers[it.id] === '')).map((it) => it.id);

export default function SurveyQuestions({ items, answers, setA, missing, lang }) {
  const { t } = useTranslation();
  const box = (id) => missBox(missing, id);
  const teacherItems = items.filter((it) => it.type === 'teacher');
  const restItems = items.filter((it) => it.type !== 'teacher');
  return (
    <>
      {!!teacherItems.length && (
        <div className={`${card} space-y-1`}>
          <Bi x={{ ar: 'تقييم الاجتماع مع المعلمين', en: 'Your Meetings with the Teachers' }} lang={lang} className="text-base font-bold text-primary" />
          <p className="text-xs text-slate-500 pb-2">{t('surveys.public.teachersHint')}</p>
          {teacherItems.map((it) => (
            <div key={it.id} id={`q-${it.id}`} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-t border-slate-100 ${box(it.id)}`}>
              <Bi x={it} lang={lang} required={it.required} />
              <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={t('surveys.public.didNotMeet')} />
            </div>
          ))}
        </div>
      )}

      {restItems.length > 0 && (
        <div className={`${card} space-y-5`}>
          {restItems.map((it, i) => {
            const head = pick(it.group, lang) && pick(it.group, lang) !== pick(restItems[i - 1]?.group, lang);
            return (
              <Fragment key={it.id}>
                {head && <div className={i ? 'pt-3 border-t border-slate-100' : ''}><Bi x={it.group} lang={lang} className="text-base font-bold text-primary" /></div>}
                <div id={`q-${it.id}`} className={`space-y-2 ${box(it.id)}`}>
                  <Bi x={it} lang={lang} required={it.required} />
                  {it.type === 'rating' && <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={it.na ? t('surveys.public.na') : ''} low={t('surveys.public.lowest')} high={t('surveys.public.highest')} />}
                  {it.type === 'agree' && <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={it.na ? t('surveys.public.na') : ''} low={t('surveys.public.disagree')} high={t('surveys.public.agree')} />}
                  {it.type === 'choice' && (
                    <div className="flex flex-wrap gap-2">{it.options.map((o) => <button key={o.id} type="button" onClick={() => setA(it.id, answers[it.id] === o.id ? undefined : o.id)} className={pill(answers[it.id] === o.id)}>{pick(o, lang)}{other(o, lang) && <span className="opacity-70"> · {other(o, lang)}</span>}</button>)}</div>
                  )}
                  {it.type === 'text' && <textarea rows={3} maxLength={1500} value={answers[it.id] || ''} onChange={(e) => setA(it.id, e.target.value)} className={inputCls} />}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}
