import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, KeyRound, ClipboardCheck, Check, Save } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { callSupport, MARKS, MARK_STYLE } from '../config/support';

const card = 'w-full max-w-2xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';

// «/support-attend/:token» — a supervisor takes attendance of their groups
// after the PIN: today's class (or a past class day of the last week),
// present / late / absent / excused for each student, with a note.
export default function SupportAttend() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [state, setState] = useState(null);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState({});

  const apply = (s) => {
    setState(s);
    setMarks(Object.fromEntries(s.groups.map((g) => [g.id, { ...g.marks }])));
  };
  const load = async (day) => {
    setBusy('load');
    setError(null);
    try { apply(await callSupport('supportSupervisor', { token, pin, day })); setSaved({}); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const setMark = (gid, sid, s) => setMarks((m) => ({ ...m, [gid]: { ...m[gid], [sid]: { ...(m[gid]?.[sid] || {}), s } } }));
  const setNote = (gid, sid, note) => setMarks((m) => ({ ...m, [gid]: { ...m[gid], [sid]: { ...(m[gid]?.[sid] || { s: 'P' }), note } } }));
  const allPresent = (g) => setMarks((m) => ({ ...m, [g.id]: Object.fromEntries(g.students.map((s) => [s.id, m[g.id]?.[s.id]?.s ? m[g.id][s.id] : { s: 'P' }])) }));
  const save = async (g) => {
    setBusy(g.id);
    setError(null);
    try {
      const r = await callSupport('supportMark', { token, pin, day: state.day, groupId: g.id, marks: marks[g.id] || {} });
      apply(r.state);
      setSaved((x) => ({ ...x, [g.id]: r.notified }));
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-2xl" />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!state ? (
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className={`${card} max-w-sm text-center space-y-3 mt-6`}>
            <KeyRound className="w-10 h-10 text-primary mx-auto" />
            <p className="font-bold text-slate-900">{t('support.attend.title')}</p>
            <p className="text-sm text-slate-500">{t('support.attend.pinPrompt')}</p>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} dir="ltr" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono" />
            {error && <p className="text-sm text-rose-700">{error}</p>}
            <button disabled={busy === 'load' || pin.length < 4} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy === 'load' && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.attend.enter')}</button>
          </form>
        ) : (
          <>
            <div className={`${card} flex flex-wrap items-center justify-between gap-2`}>
              <div>
                <p className="font-bold text-slate-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-primary" />{state.cycle}</p>
                <p className="text-xs text-slate-500">{state.supervisor} · {state.when}</p>
              </div>
              <select value={state.day} onChange={(e) => load(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white" dir="ltr">
                {[...new Set([...state.days, state.day])].sort().reverse().map((d) => <option key={d} value={d}>{d}{d === state.today ? ` (${t('support.attend.today')})` : ''}</option>)}
              </select>
            </div>
            {!state.isClassDay && state.day === state.today && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 w-full max-w-2xl">{t('support.attend.noClassToday')}</p>}
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 w-full max-w-2xl">{error}</p>}
            {!state.groups.length && <div className={`${card} text-center text-slate-500`}>{t('support.attend.noGroups')}</div>}
            {state.groups.map((g) => {
              const m = marks[g.id] || {};
              const done = g.students.filter((s) => m[s.id]?.s).length;
              return (
                <section key={g.id} className={`${card} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{g.name}</p>
                      <p className="text-xs text-slate-500">{[t(`support.types.${g.type}`), g.subject, g.room, g.teacher].filter(Boolean).join(' · ')}</p>
                    </div>
                    <button type="button" onClick={() => allPresent(g)} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" />{t('support.attend.allPresent')}</button>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {g.students.map((s) => (
                      <li key={s.id} className="py-2 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900">{s.name} <span className="text-xs text-slate-400" dir="ltr">{s.grade} {s.className}</span></span>
                          <span className="flex gap-1">
                            {MARKS.map((k) => <button key={k} type="button" onClick={() => setMark(g.id, s.id, k)} className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold ${m[s.id]?.s === k ? MARK_STYLE[k].on : MARK_STYLE[k].off}`}>{t(`support.marks.${k}`)}</button>)}
                          </span>
                        </div>
                        {['A', 'E', 'L'].includes(m[s.id]?.s) && <input value={m[s.id]?.note || ''} onChange={(e) => setNote(g.id, s.id, e.target.value)} placeholder={t('support.attend.note')} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs" />}
                      </li>
                    ))}
                  </ul>
                  {!g.students.length && <p className="text-sm text-slate-400">{t('support.attend.noStudents')}</p>}
                  {g.students.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={busy === g.id || !done} onClick={() => save(g)} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60">{busy === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('support.attend.save', { done, total: g.students.length })}</button>
                      {g.savedAt > 0 && <span className="text-xs text-emerald-700">{t('support.attend.savedAt', { time: new Date(g.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}{saved[g.id] ? ` · ${t('support.attend.notified', { n: saved[g.id] })}` : ''}</span>}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
