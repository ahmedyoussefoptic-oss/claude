import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Printer, Users, DoorOpen, UserCheck, GraduationCap, Loader2 } from 'lucide-react';
import { TYPE_STYLE, attRate, callSupport, riyadhDay, MARKS, MARK_STYLE, roundLabel } from '../../config/support';
import RoundPill from './RoundPill';
import { printPage, escapeHtml as esc } from '../../utils/printPage';
import { Pill, btn } from '../platform/ui';

const STAGES = ['KG', 'PRIMARY', 'MIDDLE', 'SECONDARY', 'OTHER'];
// «G4», «4», «KG2» → its stage: KG, 1–6 primary, 7–9 middle, 10–12 secondary.
const stageOf = (grade) => {
  const g = String(grade || '').trim();
  if (/kg|روض|تمهيد/i.test(g)) return 'KG';
  const n = Number((g.match(/\d+/) || [])[0]);
  if (!n) return 'OTHER';
  return n <= 6 ? 'PRIMARY' : n <= 9 ? 'MIDDLE' : n <= 12 ? 'SECONDARY' : 'OTHER';
};
const byGrade = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

// One support group on its own page: its details and its (consented)
// students, split by stage and then by grade, with their attendance totals
// and their mark at each of the group's classes so far.
export default function SupportGroupPage({ data, group: g, branchName, onBack }) {
  const { t, i18n } = useTranslation();
  const c = data.cycle;
  const supName = data.supervisors.find((s) => s.id === g.supervisorId)?.name || '';
  const [sessions, setSessions] = useState(null);
  useEffect(() => { callSupport('supportAttendance', { id: c.id }).then((r) => setSessions(r.sessions || [])).catch(() => setSessions([])); }, [c.id]);
  const today = riyadhDay();
  const days = useMemo(() => c.sessions.filter((d) => d <= today), [c.sessions, today]);
  const byDay = useMemo(() => Object.fromEntries((sessions || []).filter((x) => x.groupId === g.id).map((x) => [x.day, x])), [sessions, g.id]);
  // One student's classes: { day, s } — s a mark, '' unmarked, null not taken.
  const marksOf = (st) => days.map((day) => { const x = byDay[day]; return { day, s: x ? x.marks?.[st.studentId]?.s || '' : null }; });
  const markLetter = (k) => t(`support.marks.${k}`).charAt(0);
  const list = useMemo(() => data.students.filter((s) => s.groupId === g.id && s.status === 'CONSENTED'), [data, g.id]);
  const stages = useMemo(() => STAGES.map((st) => {
    const inStage = list.filter((s) => stageOf(s.grade) === st);
    const grades = [...new Set(inStage.map((s) => s.grade || ''))].sort(byGrade)
      .map((gr) => ({ grade: gr, students: inStage.filter((s) => (s.grade || '') === gr).sort((a, b) => a.name.localeCompare(b.name, 'ar')) }));
    return { stage: st, count: inStage.length, grades };
  }).filter((x) => x.count), [list]);

  const rateText = (s) => { const r = attRate(s.att); return r == null ? '—' : `${r}%`; };
  const info = [g.subject && `${t('support.groups.subject')}: ${g.subject}`, g.grades?.length && `${t('support.groups.grades')}: ${g.grades.join('، ')}`,
    branchName(g.branch), g.room && `${t('support.groups.room')}: ${g.room}`, g.teacher && `${t('support.groups.teacher')}: ${g.teacher}`,
    `${t('support.groups.supervisor')}: ${supName || t('support.groups.noSupervisor')}`].filter(Boolean);

  const print = () => {
    const head = ['#', t('support.col.student'), t('support.col.grade'), t('support.marks.P'), t('support.marks.A'), t('support.col.rate'), ...(days.length ? [t('support.groups.attendance')] : [])];
    const strip = (s) => (days.length ? `<td class="m">${marksOf(s).map((m) => `<span class="k k${m.s ?? 'N'}" title="${m.day}">${m.s ? esc(markLetter(m.s)) : m.s === '' ? '·' : '–'}</span>`).join('')}</td>` : '');
    const body = `<p class="meta">${esc(info.join(' · '))}</p><p class="meta">${esc(g.capacity ? t('support.groups.countOf', { n: list.length, cap: g.capacity }) : t('support.groups.count', { n: list.length }))}</p>
${stages.map((st) => `<h3>${esc(t(`support.groups.stages.${st.stage}`))} (${st.count})</h3>${st.grades.map((gr) => `<h4>${esc(gr.grade || '—')} (${gr.students.length})</h4><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${gr.students.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${esc(s.name)}${s.round ? ` <small dir="ltr">(${esc(roundLabel(s.round))})</small>` : ''}</td><td><span dir="ltr">${esc(`${s.grade} ${s.className}`.trim())}</span></td><td class="c">${(s.att?.P || 0) + (s.att?.L || 0)}</td><td class="c">${s.att?.A || 0}</td><td class="c">${esc(rateText(s))}</td>${strip(s)}</tr>`).join('')}</tbody></table>`).join('')}`).join('')}`;
    printPage({
      title: g.name, subtitle: `${c.title} · ${t(`support.types.${g.type}`)}`, school: t('trips.print.school'), body, dir: i18n.dir(), lang: i18n.language,
      css: 'table{width:100%;border-collapse:collapse;margin:4px 0 10px}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:start;font-size:9pt}th{background:#f1f5f9}h3{margin:12px 0 4px;color:#0369a1;font-size:12pt}h4{margin:6px 0 2px;font-size:10pt;color:#334155}.c{text-align:center}.meta{color:#475569;font-size:9pt;margin:0 0 4px}.m{white-space:nowrap}.k{display:inline-block;width:14px;text-align:center;font-size:8pt;border-radius:3px;margin:0 1px}.kP{background:#d1fae5;color:#047857}.kL{background:#fef3c7;color:#b45309}.kA{background:#ffe4e6;color:#be123c;font-weight:bold}.kE{background:#e2e8f0;color:#475569}.kN,.k{color:#94a3b8}',
      landscape: days.length > 12,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1 mb-1"><ArrowRight className="w-4 h-4" />{t('support.groups.back')}</button>
          <h2 className="text-xl font-bold text-slate-900 flex flex-wrap items-center gap-2">{g.name}<Pill className={TYPE_STYLE[g.type]}>{t(`support.types.${g.type}`)}</Pill></h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 mt-1">
            {g.subject && <span className="flex items-center gap-1"><GraduationCap className="w-4 h-4 text-primary" />{g.subject}{g.grades?.length ? ` · ${g.grades.join('، ')}` : ''}</span>}
            <span className="flex items-center gap-1"><DoorOpen className="w-4 h-4 text-primary" />{[branchName(g.branch), g.room, g.teacher].filter(Boolean).join(' · ') || '—'}</span>
            <span className="flex items-center gap-1"><UserCheck className="w-4 h-4 text-primary" />{supName || <span className="text-amber-700">{t('support.groups.noSupervisor')}</span>}</span>
            <span className="flex items-center gap-1"><Users className="w-4 h-4 text-primary" />{g.capacity ? t('support.groups.countOf', { n: list.length, cap: g.capacity }) : t('support.groups.count', { n: list.length })}</span>
          </div>
        </div>
        {list.length > 0 && <button type="button" onClick={print} className={btn.ghost}><Printer className="w-4 h-4" />{t('support.groups.print')}</button>}
      </div>

      {list.length > 0 && days.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {MARKS.map((k) => <span key={k} className="flex items-center gap-1"><span className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] ${MARK_STYLE[k].on}`}>{markLetter(k)}</span>{t(`support.marks.${k}`)}</span>)}
          <span className="flex items-center gap-1"><span className="w-5 h-5 rounded border border-dashed border-slate-300 flex items-center justify-center text-slate-400">–</span>{t('support.att.notTaken')}</span>
          <span className="text-slate-400">· {t('support.groups.legend')}</span>
        </div>
      )}

      {(stages.length > 1 || list.some((s) => s.round)) && (
        <div className="flex flex-wrap gap-2">
          {stages.length > 1 && stages.map((st) => <Pill key={st.stage} className="bg-white text-slate-700 border-slate-200">{t(`support.groups.stages.${st.stage}`)}: {st.count}</Pill>)}
          {list.some((s) => s.round) && [...new Set(list.map((s) => s.round || 0))].sort().map((r) => <Pill key={`r${r}`} className="bg-white text-slate-700 border-slate-200">{r ? <span dir="ltr">{roundLabel(r)}</span> : t('support.round.untagged')}: {list.filter((s) => (s.round || 0) === r).length}</Pill>)}
        </div>
      )}

      {!list.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.groups.noStudents')}</div> : stages.map((st) => (
        <section key={st.stage} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-900">{t(`support.groups.stages.${st.stage}`)}</h3>
            <span className="text-xs text-slate-500">{t('support.groups.count', { n: st.count })}</span>
          </div>
          {st.grades.map((gr) => (
            <div key={gr.grade} className="border-b border-slate-100 last:border-0">
              <p className="px-4 pt-3 pb-1 text-sm font-semibold text-primary"><span dir="ltr">{gr.grade || '—'}</span> <span className="text-xs text-slate-500 font-normal">({gr.students.length})</span></p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-1.5 text-start w-10">#</th>
                      <th className="px-2 py-1.5 text-start">{t('support.col.student')}</th>
                      <th className="px-2 py-1.5 text-start">{t('support.col.grade')}</th>
                      <th className="px-2 py-1.5 text-center">{t('support.marks.P')}</th>
                      <th className="px-2 py-1.5 text-center">{t('support.marks.A')}</th>
                      <th className="px-2 py-1.5 text-center">{t('support.col.rate')}</th>
                      <th className="px-2 py-1.5 text-start">{t('support.groups.attendance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gr.students.map((s, i) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-2"><p className="font-medium text-slate-900">{s.name}{s.round > 0 && <RoundPill n={s.round} className="ms-1.5" />}</p><p className="text-xs text-slate-500" dir="ltr">{s.studentId}</p></td>
                        <td className="px-2 py-2 text-slate-600"><span dir="ltr">{`${s.grade} ${s.className}`.trim()}</span></td>
                        <td className="px-2 py-2 text-center text-emerald-700">{(s.att?.P || 0) + (s.att?.L || 0)}</td>
                        <td className={`px-2 py-2 text-center ${s.att?.A ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{s.att?.A || 0}</td>
                        <td className="px-2 py-2 text-center">{rateText(s)}</td>
                        <td className="px-2 py-2">
                          {!sessions ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                            : !days.length ? <span className="text-xs text-slate-400">{t('support.groups.noSessions')}</span>
                              : (
                                <div className="flex flex-wrap gap-1 min-w-[8rem]">
                                  {marksOf(s).map((m) => (
                                    <span key={m.day} title={`${m.day} — ${m.s ? t(`support.marks.${m.s}`) : m.s === '' ? t('support.groups.notMarked') : t('support.groups.notTaken')}`}
                                      className={`w-6 h-6 rounded border flex items-center justify-center text-[11px] font-bold ${m.s ? MARK_STYLE[m.s].on : m.s === '' ? 'border-slate-200 text-slate-400' : 'border-dashed border-slate-300 text-slate-300'}`}>
                                      {m.s ? markLetter(m.s) : m.s === '' ? '·' : '–'}
                                    </span>
                                  ))}
                                </div>
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
