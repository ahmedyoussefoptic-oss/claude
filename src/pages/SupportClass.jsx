import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, KeyRound, BookOpen, Save, LogOut, CircleCheck, Award, CalendarDays, Search, ArrowRight, Users, AlertTriangle } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { callSupport, SUPPORT_TYPES, TYPE_STYLE, CURRICULUM_STYLE, RATINGS, RATING_STYLE, FINALS, FINAL_STYLE, MARK_STYLE, SUBJECTS, attRate } from '../config/support';

const card = 'w-full max-w-3xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';
const inp = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
const KEY = 'mis-support-class-teacher';
// The teacher's name and last subject, kept on this device for next time.
const readMe = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { name: String(v.name || ''), subject: String(v.subject || '') }; } catch { return { name: '', subject: '' }; } };
const keepMe = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const timeOf = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// «/support-class/:token» — whoever teaches a remedial / enrichment class
// (a group's teacher changes from class to class), one link and PIN per
// cycle, without accounts: the teacher enters their name, picks the class
// day, the group and the subject they teach that day, writes what was taught
// and rates each student; and gives a group's students a final evaluation.
export default function SupportClass() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [me, setMe] = useState(readMe);
  const [pin, setPin] = useState('');
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('lesson');
  const [groupId, setGroupId] = useState('');
  const [lesson, setLesson] = useState({ subject: '', topic: '', note: '', ratings: {} });
  const [finals, setFinals] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [branch, setBranch] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

  const apply = (s) => {
    setState(s);
    const g = s.group;
    const info = s.groups.find((x) => x.id === g?.id);
    setLesson({
      subject: g?.lesson?.subject || readMe().subject || info?.subject || '', topic: g?.lesson?.topic || '', note: g?.lesson?.note || '',
      ratings: Object.fromEntries((g?.students || []).filter((x) => x.rating).map((x) => [x.k, { r: x.rating.r, note: x.rating.note || '' }])),
    });
    setFinals(Object.fromEntries((g?.students || []).filter((x) => x.final).map((x) => [x.k, { r: x.final.r, note: x.final.note || '' }])));
  };
  const load = async ({ day = state?.day, gid = groupId, what = 'load' } = {}) => {
    setBusy(what);
    setError(null);
    try {
      const s = await callSupport('supportClass', { token, pin, teacher: me.name, day, groupId: gid });
      apply(s);
      setGroupId(s.group?.id || '');
      setNotice('');
      if (!state) { keepMe({ ...readMe(), name: s.teacher }); setMe((x) => ({ ...x, name: s.teacher })); }
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const leave = () => { setState(null); setGroupId(''); setPin(''); setError(null); setNotice(''); };

  const rate = (k, r) => setLesson((l) => {
    const next = { ...l.ratings };
    if (next[k]?.r === r) delete next[k]; else next[k] = { note: next[k]?.note || '', r };
    return { ...l, ratings: next };
  });
  const rateNote = (k, note) => setLesson((l) => ({ ...l, ratings: { ...l.ratings, [k]: { ...l.ratings[k], note } } }));
  const restGood = () => setLesson((l) => {
    const next = { ...l.ratings };
    (state.group?.students || []).forEach((x) => { if (!next[x.k] && !['A', 'E'].includes(x.mark)) next[x.k] = { r: 'GOOD', note: '' }; });
    return { ...l, ratings: next };
  });
  const setFinal = (k, patch) => setFinals((m) => {
    const cur = m[k] || { r: '', note: '' };
    const v = { ...cur, ...patch };
    if (patch.r && cur.r === patch.r) v.r = '';
    return { ...m, [k]: v };
  });

  const saveLesson = async () => {
    setBusy('save');
    setError(null);
    try {
      const r = await callSupport('supportClassSave', { token, pin, teacher: me.name, what: 'lesson', groupId, day: state.day, subject: lesson.subject, topic: lesson.topic, note: lesson.note, ratings: lesson.ratings });
      keepMe({ name: me.name, subject: lesson.subject.trim() });
      apply(r.state);
      setNotice(t('support.cls.saved', { n: r.rated }));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const saveFinal = async () => {
    setBusy('saveFinal');
    setError(null);
    try {
      const r = await callSupport('supportClassSave', { token, pin, teacher: me.name, what: 'final', groupId, day: state.day, finals });
      apply(r.state);
      setNotice(t('support.cls.finalSaved', { n: r.saved }));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const groups = useMemo(() => state?.groups || [], [state]);
  const branches = useMemo(() => [...new Map(groups.map((g) => [g.branch, g.branchName])).entries()], [groups]);
  const shown = useMemo(() => groups.filter((g) => (!branch || g.branch === branch) && (!type || g.type === type)
    && (!q.trim() || `${g.name} ${g.subject} ${g.grades.join(' ')}`.includes(q.trim()))), [groups, branch, type, q]);
  const info = groups.find((g) => g.id === groupId);
  const detail = state?.group;
  const subjects = useMemo(() => [...new Set([info?.subject, ...SUBJECTS].filter(Boolean))], [info]);

  const chip = (on, style) => `px-2.5 py-1.5 rounded-lg border text-xs font-bold ${on ? style.on : style.off}`;
  const pill = (on) => `px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;
  const ready = pin.length >= 4 && me.name.trim();

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-3xl" />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!state ? (
          <form onSubmit={(e) => { e.preventDefault(); load({ gid: '' }); }} className={`${card} max-w-sm text-center space-y-3 mt-6`}>
            <KeyRound className="w-10 h-10 text-primary mx-auto" />
            <p className="font-bold text-slate-900">{t('support.cls.title')}</p>
            <p className="text-sm text-slate-500">{t('support.cls.pinPrompt')}</p>
            <input value={me.name} onChange={(e) => setMe((x) => ({ ...x, name: e.target.value }))} placeholder={t('support.tnom.teacherName')} className={`${inp} text-center py-3`} />
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} dir="ltr" placeholder="PIN" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono" />
            {error && <p className="text-sm text-rose-700">{error}</p>}
            <button disabled={!!busy || !ready} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.cls.enter')}</button>
          </form>
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
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                  {[['lesson', CalendarDays], ['final', Award]].map(([k, Icon]) => <button key={k} type="button" onClick={() => { setTab(k); setNotice(''); }} className={`px-4 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${tab === k ? 'bg-white text-primary shadow-sm font-bold' : 'text-slate-600'}`}><Icon className="w-4 h-4" />{t(`support.cls.tabs.${k}`)}</button>)}
                </div>
                {tab === 'lesson' && state.day && (
                  <label className="flex items-center gap-2 text-sm text-slate-600 ms-auto">
                    {t('support.cls.day')}
                    <select value={state.day} disabled={!!busy} onChange={(e) => load({ day: e.target.value, what: 'day' })} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white" dir="ltr">
                      {[...state.days].reverse().map((d) => <option key={d} value={d}>{d}{d === state.today ? ` (${t('support.attend.today')})` : ''}</option>)}
                    </select>
                    {busy === 'day' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  </label>
                )}
              </div>
              {tab === 'lesson' && state.day && !state.isClassDay && <p className="text-xs text-amber-700 mt-2">{t('support.cls.noClassToday')}</p>}
            </div>
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 w-full max-w-3xl">{error}</p>}

            {tab === 'lesson' && !state.day ? <div className={`${card} text-center text-slate-500`}>{t('support.cls.notStarted')}</div>
              : !info || !detail ? (
                <section className={`${card} space-y-3`}>
                  <p className="font-bold text-slate-900">{tab === 'lesson' ? t('support.cls.pickGroup') : t('support.cls.pickGroupFinal')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setType('')} className={pill(!type)}>{t('support.cls.allTypes')}</button>
                    {SUPPORT_TYPES.map((x) => <button key={x} type="button" onClick={() => setType(x)} className={pill(type === x)}>{t(`support.types.${x}`)}</button>)}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {branches.length > 1 && (
                      <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inp}>
                        <option value="">{t('support.tnom.branch')}</option>
                        {branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    )}
                    <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('support.cls.searchGroup')} className={`${inp} pr-9`} /></div>
                  </div>
                  {!shown.length ? <p className="text-sm text-slate-400 text-center py-6">{t('support.cls.noGroups')}</p> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {shown.map((g) => (
                        <button key={g.id} type="button" disabled={!!busy} onClick={() => load({ gid: g.id, what: `g:${g.id}` })} className="text-start border border-slate-200 rounded-xl p-3 hover:border-primary hover:bg-primary/5 disabled:opacity-60 space-y-1">
                          <p className="font-medium text-slate-900 flex items-center gap-1.5">{busy === `g:${g.id}` && <Loader2 className="w-4 h-4 animate-spin text-primary" />}{g.name}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={`px-2 py-0.5 rounded-full border ${TYPE_STYLE[g.type]}`}>{t(`support.types.${g.type}`)}</span>
                            {g.curriculum && <span className={`px-2 py-0.5 rounded-full border ${CURRICULUM_STYLE[g.curriculum]}`}>{t(`support.curriculum.${g.curriculum}`)}</span>}
                            <span className="text-slate-500">{[g.subject, g.branchName, g.room].filter(Boolean).join(' · ')}</span>
                            <span className="text-slate-500 flex items-center gap-0.5"><Users className="w-3 h-3" />{g.students}</span>
                          </p>
                          {tab === 'lesson' && (g.dayBy
                            ? <p className={`text-[11px] ${g.dayMine ? 'text-emerald-700' : 'text-sky-700'}`}>✓ {t('support.cls.dayBy', { name: g.dayBy, subject: g.daySubject })}</p>
                            : <p className="text-[11px] text-slate-400">{t('support.cls.dayNone')}</p>)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                <section className={`${card} space-y-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-bold text-slate-900">{info.name}</p>
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`px-2 py-0.5 rounded-full border ${TYPE_STYLE[info.type]}`}>{t(`support.types.${info.type}`)}</span>
                        {info.curriculum && <span className={`px-2 py-0.5 rounded-full border ${CURRICULUM_STYLE[info.curriculum]}`}>{t(`support.curriculum.${info.curriculum}`)}</span>}
                        <span className="text-slate-500">{[info.subject, info.branchName, info.room, t('support.groups.count', { n: info.students })].filter(Boolean).join(' · ')}</span>
                      </p>
                    </div>
                    <button type="button" onClick={() => { setGroupId(''); setNotice(''); setState((s) => ({ ...s, group: null })); }} className="text-xs text-primary flex items-center gap-1"><ArrowRight className="w-3.5 h-3.5" />{t('support.cls.otherGroup')}</button>
                  </div>

                  {tab === 'lesson' ? (
                    <>
                      {detail.lesson && detail.lesson.byName !== state.teacher && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{t('support.cls.byOther', { name: detail.lesson.byName })}</p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-xs text-slate-500 space-y-1">{t('support.cls.subject')}
                          <input list="cls-subjects" value={lesson.subject} onChange={(e) => setLesson((l) => ({ ...l, subject: e.target.value }))} className={`${inp} mt-1`} />
                        </label>
                        <label className="text-xs text-slate-500 space-y-1">{t('support.cls.topic')}
                          <input value={lesson.topic} onChange={(e) => setLesson((l) => ({ ...l, topic: e.target.value }))} className={`${inp} mt-1 font-medium`} />
                        </label>
                      </div>
                      <datalist id="cls-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
                      <textarea rows={2} value={lesson.note} onChange={(e) => setLesson((l) => ({ ...l, note: e.target.value }))} placeholder={t('support.cls.note')} className={inp} />
                      {!detail.students.length ? <p className="text-sm text-slate-400">{t('support.cls.noStudents')}</p> : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-bold text-slate-800">{t('support.cls.rateTitle')}</p>
                            <button type="button" onClick={restGood} className="text-xs px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700">{t('support.cls.allGood')}</button>
                          </div>
                          <ul className="divide-y divide-slate-100">
                            {detail.students.map((x) => {
                              const r = lesson.ratings[x.k];
                              const away = ['A', 'E'].includes(x.mark);
                              return (
                                <li key={x.k} className="py-2 space-y-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-slate-900">{x.name} <span className="text-xs text-slate-400" dir="ltr">{`${x.grade} ${x.className}`.trim()}</span>
                                      {x.mark && <span className={`ms-1.5 text-[11px] px-1.5 py-0.5 rounded-md border ${MARK_STYLE[x.mark]?.on || ''}`}>{t(`support.marks.${x.mark}`)}</span>}
                                    </span>
                                    <span className="flex gap-1">
                                      {RATINGS.map((k) => <button key={k} type="button" disabled={away && !r} onClick={() => rate(x.k, k)} className={`${chip(r?.r === k, RATING_STYLE[k])} disabled:opacity-40`}>{t(`support.ratings.${k}`)}</button>)}
                                    </span>
                                  </div>
                                  {(x.subjects.length > 0 || x.reason) && <p className="text-[11px] text-slate-400">{[x.subjects.join('، '), x.reason].filter(Boolean).join(' — ')}</p>}
                                  {r && <input value={r.note} onChange={(e) => rateNote(x.k, e.target.value)} placeholder={t('support.cls.studentNote')} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs" />}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={busy === 'save' || !lesson.topic.trim() || !lesson.subject.trim()} onClick={saveLesson} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('support.cls.save', { n: Object.keys(lesson.ratings).length, total: detail.students.length })}
                        </button>
                        {detail.lesson && <span className="text-xs text-emerald-700 flex items-center gap-1"><CircleCheck className="w-3.5 h-3.5" />{t('support.cls.savedBy', { name: detail.lesson.byName, time: timeOf(detail.lesson.at) })}{notice ? ` · ${notice}` : ''}</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">{t('support.cls.finalHint')}</p>
                      {!detail.students.length ? <p className="text-sm text-slate-400">{t('support.cls.noStudents')}</p> : (
                        <ul className="divide-y divide-slate-100">
                          {detail.students.map((x) => {
                            const v = finals[x.k] || { r: '', note: '' };
                            const rateNow = attRate(x.att);
                            return (
                              <li key={x.k} className="py-2.5 space-y-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">{x.name} <span className="text-xs text-slate-400" dir="ltr">{`${x.grade} ${x.className}`.trim()}</span></p>
                                    <p className="text-[11px] text-slate-500">
                                      {rateNow != null && <span className={rateNow < 75 ? 'text-rose-700' : ''}>{t('support.cls.att', { rate: rateNow })}</span>}
                                      {RATINGS.filter((k) => x.perf[k]).map((k) => <span key={k} className="ms-2">{t(`support.ratings.${k}`)}: {x.perf[k]}</span>)}
                                      {x.final?.byName && <span className="ms-2 text-slate-400">· {x.final.byName}</span>}
                                    </p>
                                  </div>
                                  <span className="flex flex-wrap gap-1">
                                    {FINALS.map((k) => <button key={k} type="button" onClick={() => setFinal(x.k, { r: k })} className={chip(v.r === k, FINAL_STYLE[k])}>{t(`support.finals.${k}`)}</button>)}
                                  </span>
                                </div>
                                {v.r && <input value={v.note} onChange={(e) => setFinal(x.k, { note: e.target.value })} placeholder={t('support.cls.recommend')} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs" />}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {detail.students.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" disabled={busy === 'saveFinal'} onClick={saveFinal} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                            {busy === 'saveFinal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('support.cls.saveFinal', { n: detail.students.filter((x) => finals[x.k]?.r).length, total: detail.students.length })}
                          </button>
                          {notice && <span className="text-xs text-emerald-700">{notice}</span>}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}
          </>
        )}
      </main>
    </div>
  );
}
