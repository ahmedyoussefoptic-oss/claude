import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Loader2, Link2, Pencil, Lock, LockOpen, Download, Trash2, AlertTriangle, ChevronDown, Search, MessageSquareText } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';
import { normalizeArabic } from '../../utils/students';
import SurveyShare from './SurveyShare';
import SurveyEditor from './SurveyEditor';
import { callSurvey, summarize, responseAverages, mean, surveyBranchList, CURRICULA, GRADES, gradeLabel, pick, RATED, scoreTone, barTone } from '../../config/surveys';

const fold = (x) => normalizeArabic(String(x || '')).toLowerCase().replace(/\s+/g, ' ').trim();
const th = 'p-2 text-start font-bold text-slate-600 bg-slate-100 whitespace-nowrap text-xs';
const td = 'p-2 border-t border-slate-100 align-top';
const PAGE = 100;
// The same child sent more than once (same name, branch and grade).
const dupKey = (r) => `${fold(r.info.studentName)}|${r.info.branch}|${r.info.grade}`;

// An average out of 5 with a thin bar.
function Score({ v, n }) {
  if (!n) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-2 min-w-[120px]">
      <b className={`tabular-nums w-9 ${scoreTone(v)}`}>{v.toFixed(2)}</b>
      <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-[60px]"><span className={`block h-full rounded-full ${barTone(v)}`} style={{ width: `${(v / 5) * 100}%` }} /></span>
    </span>
  );
}

// How many chose 1 … 5.
function Spread({ dist }) {
  const top = Math.max(...dist) || 1;
  return (
    <span className="flex gap-[2px] items-end h-5" title={dist.map((c, i) => `${i + 1}: ${c}`).join(' · ')}>
      {dist.map((c, i) => <span key={i} className={`w-2.5 rounded-sm ${i < 2 ? 'bg-rose-300' : i === 2 ? 'bg-amber-300' : 'bg-emerald-400'}`} style={{ height: `${Math.max(12, (c / top) * 100)}%`, opacity: c ? 1 : 0.25 }} />)}
    </span>
  );
}

// One feedback form: its link, the averages (teachers, school questions, by
// branch), the comments, every response, and the Excel file.
export default function SurveyResults({ id, onBack }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const orgBranches = useBranches();
  const blist = useMemo(() => surveyBranchList(orgBranches), [orgBranches]);
  const branchName = (b) => pick(blist.find((x) => x.id === b), lang) || b;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fCur, setFCur] = useState('');
  const [fGrade, setFGrade] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState('');

  const load = useCallback(async () => {
    try { setData(await callSurvey('getSurveyForm', { id })); setError(null); } catch (err) { setError(err.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const form = data?.form;
  const items = useMemo(() => form?.items || [], [form]);
  const all = useMemo(() => data?.responses || [], [data]);
  const dups = useMemo(() => {
    const c = {};
    all.forEach((r) => { const k = dupKey(r); c[k] = (c[k] || 0) + 1; });
    return c;
  }, [all]);
  const rows = useMemo(() => all.filter((r) => (!fBranch || r.info.branch === fBranch) && (!fCur || r.info.curriculum === fCur) && (!fGrade || r.info.grade === fGrade)), [all, fBranch, fCur, fGrade]);
  const sum = useMemo(() => summarize(items, rows), [items, rows]);
  const teachers = sum.filter((s) => s.item.type === 'teacher');
  const school = sum.filter((s) => ['rating', 'agree'].includes(s.item.type));
  const choices = sum.filter((s) => s.item.type === 'choice');
  const texts = items.filter((it) => it.type === 'text');
  const avgs = useMemo(() => rows.map((r) => responseAverages(items, r)), [rows, items]);
  const kpi = {
    teachers: mean(avgs.map((a) => a.teachers).filter(Boolean)),
    school: mean(avgs.map((a) => a.school).filter(Boolean)),
    low: rows.filter((r) => r.low).length,
  };
  const byBranch = useMemo(() => {
    const m = {};
    rows.forEach((r, i) => {
      const b = m[r.info.branch] || (m[r.info.branch] = { branch: r.info.branch, n: 0, t: [], s: [], low: 0 });
      b.n++;
      if (avgs[i].teachers) b.t.push(avgs[i].teachers);
      if (avgs[i].school) b.s.push(avgs[i].school);
      if (r.low) b.low++;
    });
    return Object.values(m).map((b) => ({ ...b, t: mean(b.t), tn: b.t.length, s: mean(b.s), sn: b.s.length })).sort((a, b) => b.n - a.n);
  }, [rows, avgs]);
  const comments = useMemo(() => rows.flatMap((r) => texts.filter((it) => r.answers[it.id]).map((it) => ({ r, it, text: r.answers[it.id] }))), [rows, texts]);
  const listed = useMemo(() => {
    const f = fold(q);
    return rows.filter((r) => (!onlyLow || r.low) && (!f || fold(`${r.info.studentName} ${r.info.className} ${Object.values(r.answers).filter((v) => typeof v === 'string').join(' ')}`).includes(f)));
  }, [rows, q, onlyLow]);

  const answerText = (it, v) => {
    if (v === undefined) return '';
    if (v === 'NA') return it.type === 'teacher' ? t('surveys.public.didNotMeet') : t('surveys.public.na');
    if (it.type === 'choice') return pick(it.options.find((o) => o.id === v), lang) || v;
    return v;
  };
  const who = (r) => `${r.info.studentName} — ${branchName(r.info.branch)} · ${gradeLabel(r.info.grade, lang)}${r.info.className ? ` ${r.info.className}` : ''}`;
  const when = (ms) => (ms ? new Date(ms).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

  const act = async (action, extra = {}) => {
    setBusy(action + (extra.responseId || ''));
    try { await callSurvey('surveyFormAction', { action, id, ...extra }); await load(); } catch (err) { window.alert(err.message); } finally { setBusy(''); }
  };
  const removeResponse = (r) => { if (window.confirm(t('surveys.results.deleteConfirm', { name: r.info.studentName }))) act('deleteResponse', { responseId: r.id }); };
  const removeForm = async () => {
    if (!window.confirm(t('surveys.results.deleteFormConfirm'))) return;
    setBusy('delete');
    try { await callSurvey('surveyFormAction', { action: 'delete', id }); onBack(); } catch (err) { window.alert(err.message); setBusy(''); }
  };

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const col = (it) => (it.type === 'teacher' ? `${t('surveys.results.teacherOf')} ${pick(it, 'ar')}` : pick(it, 'ar')).slice(0, 120);
    const sheetRows = rows.map((r) => ({
      [t('surveys.results.col.date')]: when(r.createdAt), [t('surveys.results.col.student')]: r.info.studentName,
      [t('surveys.results.col.branch')]: branchName(r.info.branch), [t('surveys.results.col.curriculum')]: pick(CURRICULA.find((c) => c.id === r.info.curriculum), lang),
      [t('surveys.results.col.grade')]: gradeLabel(r.info.grade, lang), [t('surveys.results.col.class')]: r.info.className || '',
      ...Object.fromEntries(items.map((it) => [col(it), answerText(it, r.answers[it.id])])),
      [t('surveys.results.col.low')]: r.low ? '✓' : '', [t('surveys.results.col.duplicate')]: dups[dupKey(r)] > 1 ? '✓' : '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), t('surveys.results.sheetResponses').slice(0, 31));
    const summary = sum.filter((s) => RATED.includes(s.item.type)).map((s) => ({
      [t('surveys.results.col.question')]: col(s.item), [t('surveys.results.col.avg')]: s.avg, [t('surveys.results.col.n')]: s.n, [t('surveys.results.col.na')]: s.na,
      ...Object.fromEntries(s.dist.map((c, i) => [String(i + 1), c])),
    }));
    if (summary.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), t('surveys.results.sheetSummary').slice(0, 31));
    if (byBranch.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byBranch.map((b) => ({
        [t('surveys.results.col.branch')]: branchName(b.branch), [t('surveys.results.col.n')]: b.n, [t('surveys.results.teachersAvg')]: b.t, [t('surveys.results.schoolAvg')]: b.s, [t('surveys.results.col.low')]: b.low,
      }))), t('surveys.results.sheetBranches').slice(0, 31));
    }
    XLSX.writeFile(wb, `survey-${form.code}.xlsx`);
  };

  if (error) return <div className="space-y-3"><button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('common.back')}</button><div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div></div>;
  if (!data) return <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const sel = 'px-3 py-1.5 border border-slate-200 rounded-xl text-sm bg-white';
  const box = 'bg-white border border-slate-200 rounded-2xl p-4';
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('surveys.title')}</button>
      <div className={`${box} flex flex-wrap items-start justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">{form.title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className={`px-2 py-0.5 rounded-md border me-2 ${form.status === 'OPEN' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{t(`surveys.status.${form.status}`)}</span>
            {form.date && <span dir="ltr">{form.date}</span>} · {form.branches.length ? form.branches.map(branchName).join('، ') : t('surveys.allBranches')}{form.createdByName ? ` · ${form.createdByName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSharing(true)} className="px-3 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-1.5"><Link2 className="w-4 h-4" />{t('surveys.share.button')}</button>
          <button type="button" onClick={exportXlsx} disabled={!rows.length} className="px-3 py-2 border border-slate-200 rounded-xl text-sm flex items-center gap-1.5 text-slate-700 disabled:opacity-50"><Download className="w-4 h-4" />{t('surveys.results.excel')}</button>
          {form.canManage && (
            <>
              <button type="button" onClick={() => setEditing(true)} className="px-3 py-2 border border-slate-200 rounded-xl text-sm flex items-center gap-1.5 text-slate-700"><Pencil className="w-4 h-4" />{t('surveys.results.edit')}</button>
              <button type="button" disabled={!!busy} onClick={() => act(form.status === 'OPEN' ? 'close' : 'open')} className="px-3 py-2 border border-slate-200 rounded-xl text-sm flex items-center gap-1.5 text-slate-700 disabled:opacity-60">
                {busy === 'open' || busy === 'close' ? <Loader2 className="w-4 h-4 animate-spin" /> : form.status === 'OPEN' ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}{form.status === 'OPEN' ? t('surveys.results.close') : t('surveys.results.reopen')}
              </button>
              {!form.responses && <button type="button" disabled={!!busy} onClick={removeForm} className="px-3 py-2 border border-rose-200 text-rose-700 rounded-xl text-sm flex items-center gap-1.5"><Trash2 className="w-4 h-4" />{t('common.delete')}</button>}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className={sel}><option value="">{t('surveys.results.allBranches')}</option>{[...new Set(all.map((r) => r.info.branch))].map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>
        <select value={fCur} onChange={(e) => setFCur(e.target.value)} className={sel}><option value="">{t('surveys.results.allCurricula')}</option>{CURRICULA.map((c) => <option key={c.id} value={c.id}>{pick(c, lang)}</option>)}</select>
        <select value={fGrade} onChange={(e) => setFGrade(e.target.value)} className={sel}><option value="">{t('surveys.results.allGrades')}</option>{GRADES.filter((g) => all.some((r) => r.info.grade === g)).map((g) => <option key={g} value={g}>{gradeLabel(g, lang)}</option>)}</select>
        {data.hidden > 0 && <span className="text-xs text-slate-500">{t('surveys.results.hidden', { count: data.hidden })}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[[t('surveys.results.responses'), rows.length, 'text-slate-900'], [t('surveys.results.teachersAvg'), kpi.teachers ? `${kpi.teachers.toFixed(2)} / 5` : '—', scoreTone(kpi.teachers)], [t('surveys.results.schoolAvg'), kpi.school ? `${kpi.school.toFixed(2)} / 5` : '—', scoreTone(kpi.school)], [t('surveys.results.low'), kpi.low, kpi.low ? 'text-rose-700' : 'text-slate-900']].map(([k, v, tone]) => (
          <div key={k} className={box}><p className="text-xs text-slate-500">{k}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone}`}><span dir="ltr">{v}</span></p></div>
        ))}
      </div>

      {!rows.length ? <div className={`${box} text-center text-slate-500 py-10`}>{all.length ? t('surveys.results.noneFiltered') : t('surveys.results.none')}</div> : (
        <>
          {byBranch.length > 1 && (
            <div className={box}>
              <p className="font-bold text-slate-800 mb-2 text-sm">{t('surveys.results.byBranch')}</p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr>{['col.branch', 'responses', 'teachersAvg', 'schoolAvg', 'low'].map((c) => <th key={c} className={th}>{t(`surveys.results.${c}`)}</th>)}</tr></thead>
                <tbody>{byBranch.map((b) => (
                  <tr key={b.branch}><td className={td}>{branchName(b.branch)}</td><td className={`${td} tabular-nums`}>{b.n}</td><td className={td}><Score v={b.t} n={b.tn} /></td><td className={td}><Score v={b.s} n={b.sn} /></td><td className={`${td} tabular-nums ${b.low ? 'text-rose-700' : ''}`}>{b.low}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          {[[teachers, 'teachers'], [school, 'school']].filter(([l]) => l.length).map(([list, key]) => (
            <div key={key} className={box}>
              <p className="font-bold text-slate-800 mb-2 text-sm">{t(`surveys.results.${key}Title`)}</p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr><th className={th}>{key === 'teachers' ? t('surveys.results.col.subject') : t('surveys.results.col.question')}</th><th className={th}>{t('surveys.results.col.avg')}</th><th className={th}>{t('surveys.results.col.n')}</th><th className={th}>{t('surveys.results.col.spread')}</th><th className={th}>{key === 'teachers' ? t('surveys.public.didNotMeet') : t('surveys.public.na')}</th></tr></thead>
                <tbody>{list.map((s, i) => (
                  <tr key={s.item.id}>
                    <td className={`${td} ${key === 'school' ? 'min-w-[260px]' : 'whitespace-nowrap'}`}>
                      {key === 'school' && pick(s.item.group, lang) && pick(s.item.group, lang) !== pick(list[i - 1]?.item.group, lang) && <span className="block text-[11px] font-bold text-primary mb-0.5">{pick(s.item.group, lang)}</span>}
                      {pick(s.item, lang)}
                    </td>
                    <td className={td}><Score v={s.avg} n={s.n} /></td>
                    <td className={`${td} tabular-nums text-slate-600`}>{s.n}</td>
                    <td className={td}><Spread dist={s.dist} /></td>
                    <td className={`${td} tabular-nums text-slate-500`}>{s.na || '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          ))}

          {choices.map((s) => (
            <div key={s.item.id} className={box}>
              <p className="font-bold text-slate-800 mb-3 text-sm">{pick(s.item, lang)}</p>
              <div className="space-y-2">{s.item.options.map((o, k) => {
                const c = s.counts[o.id] || 0;
                const p = s.n ? Math.round((c / s.n) * 100) : 0;
                return (
                  <div key={o.id} className="flex items-center gap-3 text-sm">
                    <span className="w-36 shrink-0 text-slate-700">{pick(o, lang)}</span>
                    <span className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${['bg-emerald-500', 'bg-sky-500', 'bg-amber-400', 'bg-rose-400', 'bg-slate-400'][k] || 'bg-slate-400'}`} style={{ width: `${p}%` }} /></span>
                    <span className="w-20 text-end tabular-nums text-slate-600">{c} · {p}%</span>
                  </div>
                );
              })}</div>
            </div>
          ))}

          {!!comments.length && (
            <div className={box}>
              <p className="font-bold text-slate-800 mb-2 text-sm flex items-center gap-1.5"><MessageSquareText className="w-4 h-4 text-primary" />{t('surveys.results.comments', { count: comments.length })}</p>
              <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                {comments.map(({ r, it, text }) => (
                  <div key={`${r.id}_${it.id}`} className="border border-slate-100 rounded-lg p-2.5">
                    <p className="text-[11px] text-slate-500">{texts.length > 1 && <b className="text-slate-700">{pick(it, lang)} · </b>}{who(r)}</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap mt-0.5" dir="auto">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={box}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <p className="font-bold text-slate-800 text-sm">{t('surveys.results.list')}</p>
              <div className="relative flex-1 min-w-[180px] max-w-sm ms-auto">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={t('surveys.results.search')} className="w-full ps-9 pe-3 py-1.5 border border-slate-200 rounded-xl text-sm" />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />{t('surveys.results.onlyLow')}</label>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
              {listed.slice(0, limit).map((r) => {
                const a = responseAverages(items, r);
                const isOpen = open === r.id;
                return (
                  <div key={r.id}>
                    <button type="button" onClick={() => setOpen(isOpen ? '' : r.id)} className="w-full text-start p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:bg-slate-50">
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                      <b className="text-slate-900">{r.info.studentName}</b>
                      <span className="text-xs text-slate-500">{branchName(r.info.branch)} · {pick(CURRICULA.find((c) => c.id === r.info.curriculum), lang)} · {gradeLabel(r.info.grade, lang)}{r.info.className ? ` ${r.info.className}` : ''}</span>
                      {a.teachers > 0 && <span className={`text-xs tabular-nums ${scoreTone(a.teachers)}`}>{t('surveys.results.teachersShort')} {a.teachers.toFixed(1)}</span>}
                      {a.school > 0 && <span className={`text-xs tabular-nums ${scoreTone(a.school)}`}>{t('surveys.results.schoolShort')} {a.school.toFixed(1)}</span>}
                      {r.low && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t('surveys.results.lowBadge')}</span>}
                      {dups[dupKey(r)] > 1 && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px]">{t('surveys.results.dupBadge')}</span>}
                      <span className="text-[11px] text-slate-400 ms-auto">{when(r.createdAt)}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 space-y-1">
                        {items.filter((it) => r.answers[it.id] !== undefined).map((it) => (
                          <p key={it.id} className="text-xs text-slate-600 flex gap-2">
                            <span className="text-slate-500 shrink-0 max-w-[65%]">{it.type === 'teacher' ? `${t('surveys.results.teacherOf')} ${pick(it, lang)}` : pick(it, lang)}:</span>
                            <b className={`whitespace-pre-wrap ${typeof r.answers[it.id] === 'number' ? scoreTone(r.answers[it.id]) : 'text-slate-800 font-normal'}`} dir="auto">{answerText(it, r.answers[it.id])}</b>
                          </p>
                        ))}
                        {form.canManage && <button type="button" disabled={!!busy} onClick={() => removeResponse(r)} className="mt-2 text-xs text-rose-600 hover:underline flex items-center gap-1">{busy === `deleteResponse${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}{t('surveys.results.deleteResponse')}</button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!listed.length && <p className="p-4 text-sm text-slate-500 text-center">{t('surveys.results.noneFiltered')}</p>}
            </div>
            {listed.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="mt-2 text-sm text-primary hover:underline">{t('surveys.results.more', { count: listed.length - limit })}</button>}
          </div>
        </>
      )}

      {sharing && <SurveyShare form={form} onClose={() => setSharing(false)} />}
      {editing && <SurveyEditor initial={form} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}
