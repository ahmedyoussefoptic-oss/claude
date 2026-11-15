import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Angry, Frown, Meh, Smile, Laugh, GraduationCap, School, Sparkles, MessageSquareHeart, Check } from 'lucide-react';
import { pick, other } from '../../config/surveys';

// The questions of a feedback form (teachers, then the rest by section) —
// on the form's own link (/survey/:code) and on a meeting's page when the
// meeting links the form. Each section is a card with its own colour; the
// 1–5 buttons run from red to green with a face each.
export const card = 'w-full max-w-2xl bg-white/90 backdrop-blur p-5 md:p-6 rounded-3xl shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)] border border-white';
export const inputCls = 'w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-2xl text-sm transition focus:outline-none focus:ring-4 focus:ring-violet-100 focus:border-violet-400';
export const pill = (on) => `px-3.5 py-2 rounded-2xl text-sm border-2 font-medium transition active:scale-95 ${on ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white border-transparent shadow-md shadow-fuchsia-200' : 'bg-white text-slate-700 border-slate-200 hover:border-violet-300 hover:bg-violet-50/50'}`;

// Section colours (full class names, so the CSS build keeps them).
export const TONES = {
  sky: { strip: 'from-sky-400 via-cyan-400 to-teal-400', badge: 'bg-gradient-to-br from-sky-400 to-cyan-500', title: 'text-sky-800' },
  violet: { strip: 'from-violet-500 via-purple-500 to-fuchsia-500', badge: 'bg-gradient-to-br from-violet-500 to-fuchsia-500', title: 'text-violet-800' },
  teal: { strip: 'from-emerald-400 via-teal-400 to-cyan-400', badge: 'bg-gradient-to-br from-emerald-400 to-teal-500', title: 'text-teal-800' },
  rose: { strip: 'from-rose-400 via-pink-400 to-fuchsia-400', badge: 'bg-gradient-to-br from-rose-400 to-pink-500', title: 'text-rose-800' },
  amber: { strip: 'from-amber-400 via-orange-400 to-rose-400', badge: 'bg-gradient-to-br from-amber-400 to-orange-500', title: 'text-amber-800' },
};
const GROUP_TONES = ['teal', 'rose', 'sky', 'amber'];

// A card with a coloured strip on top and an icon badge by its title.
export function Section({ tone = 'sky', icon: Icon, title, hint, lang, children, className = '' }) {
  const c = TONES[tone] || TONES.sky;
  return (
    <section className={`${card} relative overflow-hidden !pt-0 ${className}`}>
      <div className={`h-1.5 -mx-5 md:-mx-6 bg-gradient-to-r ${c.strip}`} />
      {title && (
        <div className="flex items-start gap-3 pt-5 pb-1">
          {Icon && <span className={`w-10 h-10 rounded-2xl ${c.badge} text-white flex items-center justify-center shadow-md shrink-0`}><Icon className="w-5 h-5" /></span>}
          <div className="min-w-0 flex-1">
            <Bi x={title} lang={lang} className={`text-base md:text-lg font-extrabold ${c.title}`} />
            {hint && <p className="text-xs text-slate-500 mt-1 leading-5">{hint}</p>}
          </div>
        </div>
      )}
      <div className={title ? 'pt-3' : 'pt-5'}>{children}</div>
    </section>
  );
}

// A question's text in the page's language, the other language under it.
export function Bi({ x, lang, className = 'text-sm font-bold text-slate-800', required }) {
  const sub = other(x, lang);
  return (
    <div>
      <p className={`${className} whitespace-pre-line`}>{pick(x, lang)}{required && <span className="text-rose-500"> *</span>}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-line" dir="auto" style={{ textAlign: lang === 'en' ? 'left' : 'right' }}>{sub}</p>}
    </div>
  );
}

const FACES = [
  { n: 1, Icon: Angry, off: 'bg-rose-50 text-rose-500 border-rose-200 hover:bg-rose-100', on: 'bg-rose-500 text-white border-rose-500 shadow-rose-200' },
  { n: 2, Icon: Frown, off: 'bg-orange-50 text-orange-500 border-orange-200 hover:bg-orange-100', on: 'bg-orange-500 text-white border-orange-500 shadow-orange-200' },
  { n: 3, Icon: Meh, off: 'bg-amber-50 text-amber-500 border-amber-200 hover:bg-amber-100', on: 'bg-amber-400 text-white border-amber-400 shadow-amber-200' },
  { n: 4, Icon: Smile, off: 'bg-lime-50 text-lime-600 border-lime-200 hover:bg-lime-100', on: 'bg-lime-500 text-white border-lime-500 shadow-lime-200' },
  { n: 5, Icon: Laugh, off: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100', on: 'bg-emerald-500 text-white border-emerald-500 shadow-emerald-200' },
];

// 1 … 5 (and «لم أقابله» / «لا ينطبق» when allowed).
export function Scale({ value, onChange, naLabel, low, high }) {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5" dir="ltr">
        <div className="grid grid-cols-5 gap-1.5 sm:flex">
          {FACES.map(({ n, Icon, off, on }) => (
            <button key={n} type="button" onClick={() => onChange(value === n ? undefined : n)} aria-pressed={value === n} aria-label={String(n)}
              className={`sm:w-12 h-14 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition duration-150 active:scale-90 ${value === n ? `${on} shadow-lg scale-105 sm:scale-110` : off}`}>
              <Icon className="w-5 h-5" strokeWidth={2.2} />
              <span className="text-xs font-extrabold leading-none">{n}</span>
            </button>
          ))}
        </div>
        {naLabel && (
          <button type="button" onClick={() => onChange(value === 'NA' ? undefined : 'NA')} aria-pressed={value === 'NA'}
            className={`px-3 h-9 sm:h-14 rounded-2xl text-xs font-medium border-2 border-dashed transition active:scale-95 ${value === 'NA' ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}`}>{naLabel}</button>
        )}
      </div>
      {(low || high) && <div className="flex justify-between text-[11px] font-medium mt-1.5 sm:max-w-[17rem]" dir="ltr"><span className="text-rose-500">{low}</span><span className="text-emerald-600">{high}</span></div>}
    </div>
  );
}

// The ring around a question left out.
export const missBox = (missing, id) => (missing.has(id) ? 'ring-2 ring-rose-300 ring-offset-4 rounded-2xl bg-rose-50/40' : '');
// The required questions with no answer.
export const missingOf = (items, answers) => items.filter((it) => it.required && (answers[it.id] === undefined || answers[it.id] === '')).map((it) => it.id);

// The non-teacher questions cut into sections at each new group title.
function sectionsOf(items, lang) {
  const out = [];
  items.forEach((it) => {
    const g = pick(it.group, lang);
    const last = out[out.length - 1];
    if (last && (g === last.label || (!g && !last.label))) last.items.push(it);
    else out.push({ label: g, group: it.group, items: [it] });
  });
  return out;
}

export default function SurveyQuestions({ items, answers, setA, missing, lang }) {
  const { t } = useTranslation();
  const box = (id) => missBox(missing, id);
  const teacherItems = items.filter((it) => it.type === 'teacher');
  const sections = sectionsOf(items.filter((it) => it.type !== 'teacher'), lang);
  const done = (it) => answers[it.id] !== undefined && answers[it.id] !== '';
  let toneAt = 0;
  return (
    <>
      {!!teacherItems.length && (
        <Section tone="violet" icon={GraduationCap} title={{ ar: 'تقييم الاجتماع مع المعلمين', en: 'Your Meetings with the Teachers' }} hint={t('surveys.public.teachersHint')} lang={lang}>
          <div className="space-y-2">
            {teacherItems.map((it) => (
              <div key={it.id} id={`q-${it.id}`} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-2xl transition ${done(it) ? 'bg-violet-50/70' : 'bg-slate-50/70'} ${box(it.id)}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition ${done(it) ? 'bg-violet-500 text-white' : 'bg-white border-2 border-slate-200'}`}>{done(it) && <Check className="w-3.5 h-3.5" strokeWidth={3} />}</span>
                  <Bi x={it} lang={lang} required={it.required} />
                </div>
                <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={t('surveys.public.didNotMeet')} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {sections.map((sec) => {
        const onlyText = sec.items.every((it) => it.type === 'text');
        const tone = onlyText ? 'amber' : GROUP_TONES[toneAt++ % GROUP_TONES.length];
        const title = sec.label ? sec.group : onlyText ? { ar: 'رأيكم يهمنا', en: 'We Value Your Thoughts' } : null;
        const icon = onlyText ? MessageSquareHeart : /school|مدرس/i.test(`${sec.group?.ar || ''} ${sec.group?.en || ''}`) ? School : Sparkles;
        return (
          <Section key={`${sec.label}-${sec.items[0].id}`} tone={tone} icon={icon} title={title} lang={lang}>
            <div className="space-y-6">
              {sec.items.map((it) => (
                <Fragment key={it.id}>
                  <div id={`q-${it.id}`} className={`space-y-2.5 ${box(it.id)}`}>
                    <Bi x={it} lang={lang} required={it.required} />
                    {it.type === 'rating' && <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={it.na ? t('surveys.public.na') : ''} low={t('surveys.public.lowest')} high={t('surveys.public.highest')} />}
                    {it.type === 'agree' && <Scale value={answers[it.id]} onChange={(v) => setA(it.id, v)} naLabel={it.na ? t('surveys.public.na') : ''} low={t('surveys.public.disagree')} high={t('surveys.public.agree')} />}
                    {it.type === 'choice' && (
                      <div className="flex flex-wrap gap-2">{it.options.map((o) => <button key={o.id} type="button" onClick={() => setA(it.id, answers[it.id] === o.id ? undefined : o.id)} className={pill(answers[it.id] === o.id)}>{pick(o, lang)}{other(o, lang) && <span className="opacity-70"> · {other(o, lang)}</span>}</button>)}</div>
                    )}
                    {it.type === 'text' && <textarea rows={3} maxLength={1500} value={answers[it.id] || ''} onChange={(e) => setA(it.id, e.target.value)} className={`${inputCls} focus:ring-amber-100 focus:border-amber-400`} />}
                  </div>
                </Fragment>
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}
