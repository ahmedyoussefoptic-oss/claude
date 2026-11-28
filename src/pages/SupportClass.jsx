import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, KeyRound, BookOpen, Save, LogOut, UserRound, CircleCheck, Award, CalendarDays } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { callSupport, TYPE_STYLE, CURRICULUM_STYLE, RATINGS, RATING_STYLE, FINALS, FINAL_STYLE, MARK_STYLE, attRate } from '../config/support';

const card = 'w-full max-w-3xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';
const inp = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
const NAME_KEY = 'mis-support-class-teacher';
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const keepName = (v) => { try { if (v) localStorage.setItem(NAME_KEY, v); else localStorage.removeItem(NAME_KEY); } catch { /* private mode */ } };
const timeOf = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// «/support-class/:token» — the teachers who teach the remedial / enrichment
// classes, one link and PIN per cycle, without accounts: a teacher picks
// their name (as written on the cycle's groups) and, for each class of their
// groups, writes what was taught and rates each student; at the end of the
// cycle, a final evaluation of each student with a recommendation.
export default function SupportClass() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [pick, setPick] = useState(null);
  const [state, setState] = useState(null);
  const [teacher, setTeacher] = useState('');
  const [tab, setTab] = useState('lesson');
  const [lessons, setLessons] = useState({});
  const [finals, setFinals] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState({});

  const apply = (s) => {
    setState(s);
    setLessons(Object.fromEntries(s.groups.map((g) => [g.id, {
      topic: g.lesson?.topic || '', note: g.lesson?.note || '',
      ratings: Object.fromEntries(g.students.filter((x) => x.rating).map((x) => [x.k, { r: x.rating.r, note: x.rating.note || '' }])),
    }])));
    setFinals(Object.fromEntries(s.groups.map((g) => [g.id, Object.fromEntries(g.students.filter((x) => x.final).map((x) => [x.k, { r: x.final.r, note: x.final.note || '' }]))])));
  };
  const open = async ({ name = teacher, day } = {}) => {
    setBusy(name && !state ? `t:${name}` : 'open');
    setError(null);
    try {
      const r = await callSupport('supportClass', { token, pin, teacher: name, day });
      if (r.pick) {
        setPick(r); setState(null); setTeacher('');
        if (r.notFound) keepName('');
      } else {
        setTeacher(r.teacher); keepName(r.teacher); apply(r); setNotice({});
      }
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const leave = () => { keepName(''); setTeacher(''); setState(null); setNotice({}); open({ name: '' }); };

  const setLesson = (gid, patch) => setLessons((m) => ({ ...m, [gid]: { ...m[gid], ...patch } }));
  const rate = (gid, k, r) => setLessons((m) => {
    const cur = m[gid]?.ratings || {};
    const next = { ...cur };
    if (cur[k]?.r === r) delete next[k]; else next[k] = { note: cur[k]?.note || '', r };
    return { ...m, [gid]: { ...m[gid], ratings: next } };
  });
  const rateNote = (gid, k, note) => setLessons((m) => ({ ...m, [gid]: { ...m[gid], ratings: { ...m[gid].ratings, [k]: { ...m[gid].ratings[k], note } } } }));
  const allGood = (g) => setLessons((m) => {
    const cur = m[g.id]?.ratings || {};
    const next = { ...cur };
    g.students.forEach((x) => { if (!next[x.k] && !['A', 'E'].includes(x.mark)) next[x.k] = { r: 'GOOD', note: '' }; });
    return { ...m, [g.id]: { ...m[g.id], ratings: next } };
  });
  const setFinal = (gid, k, patch) => setFinals((m) => {
    const cur = m[gid]?.[k] || { r: '', note: '' };
    const v = { ...cur, ...patch };
    if (patch.r && cur.r === patch.r) v.r = '';
    return { ...m, [gid]: { ...m[gid], [k]: v } };
  });

  const saveLesson = async (g) => {
    const l = lessons[g.id] || {};
    if (!l.topic?.trim()) { setError(t('support.cls.needTopic')); return; }
    setBusy(g.id);
    setError(null);
    try {
      const r = await callSupport('supportClassSave', { token, pin, teacher, what: 'lesson', groupId: g.id, day: state.day, topic: l.topic, note: l.note, ratings: l.ratings });
      apply(r.state);
      setNotice((x) => ({ ...x, [g.id]: t('support.cls.saved', { n: r.rated }) }));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const saveFinal = async (g) => {
    setBusy(`f:${g.id}`);
    setError(null);
    try {
      const r = await callSupport('supportClassSave', { token, pin, teacher, what: 'final', groupId: g.id, day: state.day, finals: finals[g.id] || {} });
      apply(r.state);
      setNotice((x) => ({ ...x, [`f:${g.id}`]: t('support.cls.finalSaved', { n: r.saved }) }));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const chip = (on, style) => `px-2.5 py-1.5 rounded-lg border text-xs font-bold ${on ? style.on : style.off}`;
  const groupHead = (g) => (
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-bold text-slate-900">{g.name}</p>
      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${TYPE_STYLE[g.type]}`}>{t(`support.types.${g.type}`)}</span>
      {g.curriculum && <span className={`text-[11px] px-2 py-0.5 rounded-full border ${CURRICULUM_STYLE[g.curriculum]}`}>{t(`support.curriculum.${g.curriculum}`)}</span>}
      <span className="text-xs text-slate-500">{[g.subject, g.room, t('support.groups.count', { n: g.students.length })].filter(Boolean).join(' · ')}</span>
    </div>
  );

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-3xl" />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!pick && !state ? (
          <form onSubmit={(e) => { e.preventDefault(); open({ name: readName() }); }} className={`${card} max-w-sm text-center space-y-3 mt-6`}>
            <KeyRound className="w-10 h-10 text-primary mx-auto" />
            <p className="font-bold text-slate-900">{t('support.cls.title')}</p>
            <p className="text-sm text-slate-500">{t('support.cls.pinPrompt')}</p>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} dir="ltr" placeholder="PIN" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono" />
            {error && <p className="text-sm text-rose-700">{error}</p>}
            <button disabled={!!busy || pin.length < 4} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.cls.enter')}</button>
          </form>
        ) : !state ? (
          <div className={`${card} max-w-md space-y-3 mt-6`}>
            <p className="font-bold text-slate-900 flex items-center gap-2"><UserRound className="w-5 h-5 text-primary" />{t('support.cls.pick')}</p>
            <p className="text-xs text-slate-500">{pick.cycle} · {pick.when}</p>
            {pick.notFound && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{t('support.cls.notFound')}</p>}
            {error && <p className="text-sm text-rose-700">{error}</p>}
            {!pick.teachers.length ? <p className="text-sm text-slate-500 text-center py-4">{t('support.cls.noTeachers')}</p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {pick.teachers.map((n) => (
                  <button key={n} type="button" disabled={!!busy} onClick={() => open({ name: n })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 hover:border-primary hover:bg-primary/5 flex items-center justify-center gap-2 disabled:opacity-60">
                    {busy === `t:${n}` && <Loader2 className="w-4 h-4 animate-spin" />}{n}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400">{t('support.cls.pickHint')}</p>
          </div>
        ) : (
          <>
            <div className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900 flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" />{state.cycle}</p>
                  <p className="text-xs text-slate-500 mt-1">{state.teacher} · {state.when} · <span dir="ltr">{state.from} → {state.to}</span></p>
                </div>
                <button type="button" onClick={leave} className="text-xs text-slate-500 hover:text-primary flex items-center gap-1"><LogOut className="w-3.5 h-3.5" />{t('support.cls.notMe')}</button>
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mt-3 w-fit">
                {[['lesson', CalendarDays], ['final', Award]].map(([k, Icon]) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${tab === k ? 'bg-white text-primary shadow-sm font-bold' : 'text-slate-600'}`}><Icon className="w-4 h-4" />{t(`support.cls.tabs.${k}`)}</button>)}
              </div>
            </div>
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 w-full max-w-3xl">{error}</p>}

            {tab === 'lesson' && (!state.day ? <div className={`${card} text-center text-slate-500`}>{t('support.cls.notStarted')}</div> : (
              <>
                <div className={`${card} flex flex-wrap items-center gap-2`}>
                  <span className="text-sm text-slate-600">{t('support.cls.day')}</span>
                  <select value={state.day} disabled={busy === 'open'} onChange={(e) => open({ day: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white" dir="ltr">
                    {[...state.days].reverse().map((d) => {
                      const all = state.groups.every((g) => g.written.includes(d));
                      return <option key={d} value={d}>{all ? '✓ ' : ''}{d}{d === state.today ? ` (${t('support.attend.today')})` : ''}</option>;
                    })}
                  </select>
                  {busy === 'open' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  {!state.isClassDay && <span className="text-xs text-amber-700">{t('support.cls.noClassToday')}</span>}
                </div>
                {state.groups.map((g) => {
                  const l = lessons[g.id] || { topic: '', note: '', ratings: {} };
                  const rated = g.students.filter((x) => l.ratings?.[x.k]).length;
                  return (
                    <section key={g.id} className={`${card} space-y-3`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        {groupHead(g)}
                        <span className="text-xs text-slate-500">{t('support.cls.written', { n: g.written.length, total: state.days.length })}</span>
                      </div>
                      <div className="space-y-2">
                        <input value={l.topic} onChange={(e) => setLesson(g.id, { topic: e.target.value })} placeholder={t('support.cls.topic')} className={`${inp} font-medium`} />
                        <textarea rows={2} value={l.note} onChange={(e) => setLesson(g.id, { note: e.target.value })} placeholder={t('support.cls.note')} className={inp} />
                      </div>
                      {!g.students.length ? <p className="text-sm text-slate-400">{t('support.cls.noStudents')}</p> : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-bold text-slate-800">{t('support.cls.rateTitle')}</p>
                            <button type="button" onClick={() => allGood(g)} className="text-xs px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700">{t('support.cls.allGood')}</button>
                          </div>
                          <ul className="divide-y divide-slate-100">
                            {g.students.map((x) => {
                              const r = l.ratings?.[x.k];
                              const away = ['A', 'E'].includes(x.mark);
                              return (
                                <li key={x.k} className="py-2 space-y-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-slate-900">{x.name} <span className="text-xs text-slate-400" dir="ltr">{`${x.grade} ${x.className}`.trim()}</span>
                                      {x.mark && <span className={`ms-1.5 text-[11px] px-1.5 py-0.5 rounded-md border ${MARK_STYLE[x.mark]?.on || ''}`}>{t(`support.marks.${x.mark}`)}</span>}
                                    </span>
                                    <span className="flex gap-1">
                                      {RATINGS.map((k) => <button key={k} type="button" disabled={away && !r} onClick={() => rate(g.id, x.k, k)} className={`${chip(r?.r === k, RATING_STYLE[k])} disabled:opacity-40`}>{t(`support.ratings.${k}`)}</button>)}
                                    </span>
                                  </div>
                                  {(x.subjects.length > 0 || x.reason) && <p className="text-[11px] text-slate-400">{[x.subjects.join('، '), x.reason].filter(Boolean).join(' — ')}</p>}
                                  {r && <input value={r.note} onChange={(e) => rateNote(g.id, x.k, e.target.value)} placeholder={t('support.cls.studentNote')} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs" />}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={busy === g.id || !l.topic.trim()} onClick={() => saveLesson(g)} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                          {busy === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('support.cls.save', { n: rated, total: g.students.length })}
                        </button>
                        {g.lesson && <span className="text-xs text-emerald-700 flex items-center gap-1"><CircleCheck className="w-3.5 h-3.5" />{t('support.cls.savedAt', { time: timeOf(g.lesson.at) })}{notice[g.id] ? ` · ${notice[g.id]}` : ''}</span>}
                      </div>
                    </section>
                  );
                })}
              </>
            ))}

            {tab === 'final' && (
              <>
                <p className="text-sm text-slate-600 w-full max-w-3xl">{t('support.cls.finalHint')}</p>
                {state.groups.map((g) => {
                  const f = finals[g.id] || {};
                  const done = g.students.filter((x) => f[x.k]?.r).length;
                  return (
                    <section key={g.id} className={`${card} space-y-3`}>
                      {groupHead(g)}
                      {!g.students.length ? <p className="text-sm text-slate-400">{t('support.cls.noStudents')}</p> : (
                        <ul className="divide-y divide-slate-100">
                          {g.students.map((x) => {
                            const v = f[x.k] || { r: '', note: '' };
                            const rateNow = attRate(x.att);
                            return (
                              <li key={x.k} className="py-2.5 space-y-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">{x.name} <span className="text-xs text-slate-400" dir="ltr">{`${x.grade} ${x.className}`.trim()}</span></p>
                                    <p className="text-[11px] text-slate-500">
                                      {rateNow != null && <span className={rateNow < 75 ? 'text-rose-700' : ''}>{t('support.cls.att', { rate: rateNow })}</span>}
                                      {RATINGS.filter((k) => x.perf[k]).map((k) => <span key={k} className="ms-2">{t(`support.ratings.${k}`)}: {x.perf[k]}</span>)}
                                    </p>
                                  </div>
                                  <span className="flex flex-wrap gap-1">
                                    {FINALS.map((k) => <button key={k} type="button" onClick={() => setFinal(g.id, x.k, { r: k })} className={chip(v.r === k, FINAL_STYLE[k])}>{t(`support.finals.${k}`)}</button>)}
                                  </span>
                                </div>
                                {v.r && <input value={v.note} onChange={(e) => setFinal(g.id, x.k, { note: e.target.value })} placeholder={t('support.cls.recommend')} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs" />}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {g.students.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" disabled={busy === `f:${g.id}`} onClick={() => saveFinal(g)} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                            {busy === `f:${g.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('support.cls.saveFinal', { n: done, total: g.students.length })}
                          </button>
                          {notice[`f:${g.id}`] && <span className="text-xs text-emerald-700">{notice[`f:${g.id}`]}</span>}
                        </div>
                      )}
                    </section>
                  );
                })}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
