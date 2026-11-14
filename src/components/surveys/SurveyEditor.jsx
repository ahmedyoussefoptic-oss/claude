import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ArrowUp, ArrowDown, Trash2, Plus, FileText } from 'lucide-react';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { userBranches } from '../../utils/scope';
import { callSurvey, SURVEY_TEMPLATES, ITEM_TYPES, newItem, surveyBranchList, pick } from '../../config/surveys';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const TYPE_TONE = { teacher: 'bg-blue-50 text-blue-700 border-blue-200', rating: 'bg-amber-50 text-amber-800 border-amber-200', agree: 'bg-violet-50 text-violet-700 border-violet-200', choice: 'bg-teal-50 text-teal-700 border-teal-200', text: 'bg-slate-50 text-slate-600 border-slate-200' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

// Create or edit a feedback form: a template to start from, then every
// question (Arabic + English) can be changed, moved, removed or added.
export default function SurveyEditor({ initial, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { userData } = useAuthStore();
  const orgBranches = useBranches();
  const all = userData?.role === 'ADMIN' || userData?.access === 'all';
  const branchOptions = useMemo(() => {
    const mine = userBranches(userData);
    return surveyBranchList(orgBranches).filter((b) => orgBranches.some((o) => o.id === b.id) && (all || mine.includes(b.id)));
  }, [orgBranches, userData, all]);
  const start = (tpl) => {
    const x = tpl.make();
    return { title: x.title, intro: x.intro, items: x.items };
  };
  const [template, setTemplate] = useState(initial ? '' : SURVEY_TEMPLATES[0].id);
  const [f, setF] = useState(() => (initial
    ? { title: initial.title, date: initial.date, branches: initial.branches, intro: initial.intro, items: initial.items, askClass: initial.askClass }
    : { ...start(SURVEY_TEMPLATES[0]), date: today(), branches: [], askClass: true }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setItem = (i, patch) => setF((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const move = (i, d) => setF((x) => {
    const items = [...x.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return x;
    [items[i], items[j]] = [items[j], items[i]];
    return { ...x, items };
  });
  const remove = (i) => setF((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }));
  const add = (type) => setF((x) => {
    const it = newItem(type);
    // A new teacher goes after the last teacher; anything else at the end,
    // in the section of the question before it.
    const lastT = x.items.map((y) => y.type).lastIndexOf('teacher');
    if (type === 'teacher') { const items = [...x.items]; items.splice(lastT + 1, 0, it); return { ...x, items }; }
    const prev = [...x.items].reverse().find((y) => y.type !== 'teacher');
    return { ...x, items: [...x.items, { ...it, group: prev?.group || it.group }] };
  });
  const applyTemplate = (id) => {
    const tpl = SURVEY_TEMPLATES.find((x) => x.id === id);
    setTemplate(id);
    setF((x) => ({ ...x, ...start(tpl) }));
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!f.title.trim()) { setError(t('surveys.editor.needTitle')); return; }
    if (!f.items.some((it) => it.ar.trim() || it.en.trim())) { setError(t('surveys.editor.needItem')); return; }
    setBusy(true);
    try {
      const r = await callSurvey('saveSurveyForm', { ...f, id: initial?.id });
      onSaved(r.id);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[120] flex items-start justify-center p-2 sm:p-4 overflow-y-auto">
      <form onSubmit={save} className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl my-4">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="font-bold text-slate-900">{initial ? t('surveys.editor.editTitle') : t('surveys.editor.newTitle')}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-5">
          {!initial && (
            <div>
              <p className="text-sm font-bold text-slate-700 mb-2">{t('surveys.editor.template')}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {SURVEY_TEMPLATES.map((tpl) => (
                  <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl.id)} className={`text-start p-3 rounded-xl border transition ${template === tpl.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-slate-200 hover:border-primary/40'}`}>
                    <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><FileText className="w-4 h-4 text-primary" />{t(`surveys.templates.${tpl.id}.name`)}</p>
                    <p className="text-xs text-slate-500 mt-1">{t(`surveys.templates.${tpl.id}.hint`)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {initial?.responses > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{t('surveys.editor.hasResponses', { count: initial.responses })}</p>}

          <div className="grid sm:grid-cols-3 gap-3">
            <label className="sm:col-span-2 text-sm"><span className="text-slate-600">{t('surveys.editor.title')}</span><input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} className={`${inputCls} mt-1`} /></label>
            <label className="text-sm"><span className="text-slate-600">{t('surveys.editor.date')}</span><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={`${inputCls} mt-1`} /></label>
          </div>
          <div>
            <p className="text-sm text-slate-600 mb-1.5">{t('surveys.editor.branches')} <span className="text-xs text-slate-400">— {all ? t('surveys.editor.branchesHint') : t('surveys.editor.branchesMine')}</span></p>
            <div className="flex flex-wrap gap-1.5">
              {branchOptions.map((b) => {
                const on = f.branches.includes(b.id);
                return <button key={b.id} type="button" onClick={() => set('branches', on ? f.branches.filter((x) => x !== b.id) : [...f.branches, b.id])} className={`px-3 py-1.5 rounded-lg text-xs border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{pick(b, i18n.language)}</button>;
              })}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-sm"><span className="text-slate-600">{t('surveys.editor.introAr')}</span><textarea rows={6} dir="rtl" value={f.intro.ar} onChange={(e) => set('intro', { ...f.intro, ar: e.target.value })} className={`${inputCls} mt-1`} /></label>
            <label className="text-sm"><span className="text-slate-600">{t('surveys.editor.introEn')}</span><textarea rows={6} dir="ltr" value={f.intro.en} onChange={(e) => set('intro', { ...f.intro, en: e.target.value })} className={`${inputCls} mt-1`} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.askClass} onChange={(e) => set('askClass', e.target.checked)} />{t('surveys.editor.askClass')}</label>

          <div>
            <p className="text-sm font-bold text-slate-700">{t('surveys.editor.questions', { count: f.items.length })}</p>
            <p className="text-xs text-slate-500 mb-2">{t('surveys.editor.fixedInfo')}</p>
            <div className="space-y-2">
              {f.items.map((it, i) => (
                <div key={it.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400 tabular-nums w-5">{i + 1}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[11px] border ${TYPE_TONE[it.type]}`}>{t(`surveys.types.${it.type}`)}</span>
                    <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={it.required} onChange={(e) => setItem(i, { required: e.target.checked })} />{t('surveys.editor.required')}</label>
                    {['rating', 'agree'].includes(it.type) && <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={!!it.na} onChange={(e) => setItem(i, { na: e.target.checked })} />{t('surveys.editor.allowNa')}</label>}
                    <span className="flex-1" />
                    <button type="button" onClick={() => move(i, -1)} disabled={!i} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label={t('surveys.editor.up')}><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === f.items.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label={t('surveys.editor.down')}><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(i)} className="p-1 text-rose-400 hover:text-rose-700" aria-label={t('surveys.editor.remove')}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid md:grid-cols-2 gap-2">
                    <input dir="rtl" value={it.ar} onChange={(e) => setItem(i, { ar: e.target.value })} maxLength={300} placeholder={it.type === 'teacher' ? t('surveys.editor.subjectAr') : t('surveys.editor.textAr')} className={inputCls} />
                    <input dir="ltr" value={it.en} onChange={(e) => setItem(i, { en: e.target.value })} maxLength={300} placeholder={it.type === 'teacher' ? t('surveys.editor.subjectEn') : t('surveys.editor.textEn')} className={inputCls} />
                  </div>
                  {it.type !== 'teacher' && (
                    <div className="grid md:grid-cols-2 gap-2">
                      <input dir="rtl" value={it.group?.ar || ''} onChange={(e) => setItem(i, { group: { ...it.group, ar: e.target.value } })} maxLength={120} placeholder={t('surveys.editor.groupAr')} className={`${inputCls} text-xs py-1.5 bg-slate-50`} />
                      <input dir="ltr" value={it.group?.en || ''} onChange={(e) => setItem(i, { group: { ...it.group, en: e.target.value } })} maxLength={120} placeholder={t('surveys.editor.groupEn')} className={`${inputCls} text-xs py-1.5 bg-slate-50`} />
                    </div>
                  )}
                  {it.type === 'choice' && (
                    <div className="space-y-1.5 ps-4 border-s-2 border-teal-100">
                      {it.options.map((o, k) => (
                        <div key={k} className="flex items-center gap-2">
                          <input dir="rtl" value={o.ar} onChange={(e) => setItem(i, { options: it.options.map((y, z) => (z === k ? { ...y, ar: e.target.value } : y)) })} maxLength={80} placeholder={t('surveys.editor.optionAr')} className={`${inputCls} py-1.5`} />
                          <input dir="ltr" value={o.en} onChange={(e) => setItem(i, { options: it.options.map((y, z) => (z === k ? { ...y, en: e.target.value } : y)) })} maxLength={80} placeholder={t('surveys.editor.optionEn')} className={`${inputCls} py-1.5`} />
                          <button type="button" disabled={it.options.length <= 2} onClick={() => setItem(i, { options: it.options.filter((_, z) => z !== k) })} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"><X className="w-4 h-4" /></button>
                        </div>
                      ))}
                      {it.options.length < 8 && <button type="button" onClick={() => setItem(i, { options: [...it.options, { id: `O${Date.now().toString(36)}`, ar: '', en: '' }] })} className="text-xs text-primary hover:underline">+ {t('surveys.editor.addOption')}</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {ITEM_TYPES.map((type) => <button key={type} type="button" onClick={() => add(type)} className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1 ${TYPE_TONE[type]}`}><Plus className="w-3.5 h-3.5" />{t(`surveys.types.${type}`)}</button>)}
            </div>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-700">{t('common.cancel')}</button>
          <button disabled={busy} className="px-5 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{initial ? t('surveys.editor.save') : t('surveys.editor.create')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
