import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MessageCircleQuestion, Presentation, Users, MessageSquareReply, UserCheck, CheckCircle2, Star, AlertTriangle, CalendarDays, Send } from 'lucide-react';
import { callMeeting } from '../../config/meetings';
import { pct, meetingsTotals, meetingsByBranch } from '../../utils/meetingsStats';

// «اجتماعات أولياء الأمور» in «التقارير»: a short report in numbers of every
// meeting of every branch in the period, for the administration. The main
// part is always shown; the sections in OPTIONAL are added when ticked.
export const OPTIONAL = ['purposes', 'messages', 'staff', 'grades', 'survey', 'attendees', 'followUps', 'topStaff'];
const SERVER_SECTIONS = ['purposes', 'staff', 'grades', 'survey', 'attendees', 'followUps', 'topStaff'];
const PICK_KEY = 'reports:meetings:sections';
const readPicked = () => {
  try { const v = JSON.parse(localStorage.getItem(PICK_KEY)); return Array.isArray(v) ? v.filter((x) => OPTIONAL.includes(x)) : []; } catch { return []; }
};

function Bar({ value, tone = 'bg-primary' }) {
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="text-xs font-bold text-slate-700 tabular-nums w-9 text-end">{value}%</span>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`rounded-2xl p-4 border ${tone.box}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-bold ${tone.text}`}>{label}</p>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone.icon}`}><Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums"><span dir="ltr">{value}</span></p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

const TONES = {
  navy: { box: 'bg-slate-50 border-slate-200', text: 'text-slate-600', icon: 'bg-[#1b345a] text-white' },
  sky: { box: 'bg-sky-50 border-sky-200', text: 'text-sky-700', icon: 'bg-sky-500 text-white' },
  violet: { box: 'bg-violet-50 border-violet-200', text: 'text-violet-700', icon: 'bg-violet-500 text-white' },
  emerald: { box: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: 'bg-emerald-500 text-white' },
  teal: { box: 'bg-teal-50 border-teal-200', text: 'text-teal-700', icon: 'bg-teal-500 text-white' },
  amber: { box: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: 'bg-amber-500 text-white' },
  rose: { box: 'bg-rose-50 border-rose-200', text: 'text-rose-700', icon: 'bg-rose-500 text-white' },
  indigo: { box: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', icon: 'bg-indigo-500 text-white' },
};

const STATUS_TONE = { DRAFT: 'bg-slate-100 text-slate-600', OPEN: 'bg-sky-100 text-sky-700', CLOSED: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-rose-100 text-rose-700' };

function Section({ title, tone = 'border-[#1b345a]', children }) {
  return (
    <section className="break-inside-avoid">
      <h3 className={`text-base font-bold text-slate-900 mb-3 ps-3 border-s-4 ${tone}`}>{title}</h3>
      {children}
    </section>
  );
}

// Labelled bars (largest first).
function Bars({ rows, tone = 'bg-primary', total }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((n, r) => n + r.value, 0);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(64px,170px)_minmax(60px,1fr)_auto] items-center gap-3 text-sm">
          <span className="text-slate-700 truncate">{r.label}</span>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${r.tone || tone}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="tabular-nums text-slate-800 font-bold text-xs w-20 text-end">{r.value} <span className="text-slate-400 font-normal">({pct(r.value, sum)}%)</span></span>
        </div>
      ))}
    </div>
  );
}

const th = 'p-2 text-start font-bold text-slate-600 bg-slate-100 whitespace-nowrap';
const td = 'p-2 border-t border-slate-100 tabular-nums';

export default function MeetingsSummaryReport({ filters, branches, onData }) {
  const { t } = useTranslation();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [picked, setPicked] = useState(readPicked);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const k = (key, o) => t(`meetingsReport.${key}`, o);

  const toggle = (id) => setPicked((p) => {
    const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
    try { localStorage.setItem(PICK_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });

  const include = useMemo(() => picked.filter((x) => SERVER_SECTIONS.includes(x)).sort(), [picked]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    callMeeting('meetingsSummaryReport', { from: filters.from || '', to: filters.to || '', branch: filters.branch || '', include })
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters.from, filters.to, filters.branch, include]);

  const meetings = data?.meetings || [];
  const tot = useMemo(() => meetingsTotals(meetings), [meetings]);
  const byBranch = useMemo(() => meetingsByBranch(meetings, branchName), [meetings, branches]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onData?.(data ? { ...data, picked, totals: tot, byBranch } : null); }, [data, picked, tot, byBranch]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = data?.extra || {};
  const on = (id) => picked.includes(id);

  return (
    <div className="space-y-8">
      <div className="no-print bg-slate-50 border border-slate-200 rounded-2xl p-4">
        <p className="text-sm font-bold text-slate-700 mb-2">{k('optionalTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {OPTIONAL.map((id) => (
            <label key={id} className={`px-3 py-1.5 rounded-xl border text-sm cursor-pointer select-none flex items-center gap-2 ${on(id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
              <input type="checkbox" className="hidden" checked={on(id)} onChange={() => toggle(id)} />
              {k(`sections.${id}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">{k('optionalHint')}</p>
      </div>

      {loading && !data ? <div className="flex justify-center p-10"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        : error ? <p className="text-center text-rose-600 py-6">{error}</p>
          : !meetings.length ? <p className="text-center text-slate-500 py-10">{k('empty')}</p> : (
            <>
              {loading && <p className="no-print text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" />{k('updating')}</p>}

              <Section title={k('summary')}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Tile icon={Presentation} tone={TONES.navy} label={k('meetings')} value={tot.count} sub={Object.entries(tot.byStatus).map(([s, n]) => `${t(`meetings.status.${s}`)} ${n}`).join(' · ')} />
                  <Tile icon={Users} tone={TONES.sky} label={k('invited')} value={tot.families} sub={k('studentsN', { count: tot.students })} />
                  <Tile icon={MessageSquareReply} tone={TONES.violet} label={k('responseRate')} value={`${pct(tot.responded, tot.families)}%`} sub={k('respondedOf', { n: tot.responded, total: tot.families })} />
                  <Tile icon={CalendarDays} tone={TONES.indigo} label={k('confirmed')} value={tot.attend} sub={k('remoteDecline', { remote: tot.remote, decline: tot.decline })} />
                  <Tile icon={UserCheck} tone={TONES.emerald} label={k('attended')} value={tot.attended} sub={k('ofConfirmed', { p: pct(tot.attended, tot.attend) })} />
                  <Tile icon={CheckCircle2} tone={TONES.teal} label={k('interviews')} value={tot.interviewsDone} sub={k('ofRequested', { total: tot.interviews, p: pct(tot.interviewsDone, tot.interviews) })} />
                  <Tile icon={Star} tone={TONES.amber} label={k('satisfaction')} value={tot.surveys ? `${tot.avg} / 5` : '—'} sub={k('surveysN', { count: tot.surveys })} />
                  <Tile icon={AlertTriangle} tone={TONES.rose} label={k('lowRatings')} value={tot.low} sub={k('lowHint')} />
                </div>
              </Section>

              <Section title={k('byBranch')}>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead><tr>{['branch', 'meetings', 'invited', 'responseRate', 'confirmed', 'attended', 'attendanceRate', 'interviews', 'satisfaction'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {byBranch.map((b) => (
                        <tr key={b.name}>
                          <td className={`${td} font-bold text-slate-900`}>{b.name}</td>
                          <td className={td}>{b.count}</td>
                          <td className={td}>{b.families}</td>
                          <td className={td}><Bar value={pct(b.responded, b.families)} tone="bg-violet-500" /></td>
                          <td className={td}>{b.attend}</td>
                          <td className={td}>{b.attended}</td>
                          <td className={td}><Bar value={pct(b.attended, b.attend)} tone="bg-emerald-500" /></td>
                          <td className={td}><span dir="ltr">{b.interviewsDone} / {b.interviews}</span></td>
                          <td className={td}>{b.surveys ? <span className="font-bold text-amber-600">★ {b.avg}</span> : '—'}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-bold">
                        <td className={td}>{k('total')}</td><td className={td}>{tot.count}</td><td className={td}>{tot.families}</td>
                        <td className={td}><Bar value={pct(tot.responded, tot.families)} tone="bg-violet-500" /></td>
                        <td className={td}>{tot.attend}</td><td className={td}>{tot.attended}</td>
                        <td className={td}><Bar value={pct(tot.attended, tot.attend)} tone="bg-emerald-500" /></td>
                        <td className={td}><span dir="ltr">{tot.interviewsDone} / {tot.interviews}</span></td>
                        <td className={td}>{tot.surveys ? `★ ${tot.avg}` : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title={k('list')}>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead><tr>{['date', 'meeting', 'branch', 'type', 'status', 'invited', 'confirmed', 'attended', 'interviews', 'satisfaction'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {meetings.map((m) => {
                        const s = m.stats || {};
                        return (
                          <tr key={m.id} className="break-inside-avoid">
                            <td className={`${td} whitespace-nowrap`}>{m.date}</td>
                            <td className={`${td} font-medium text-slate-900`}>{m.title}</td>
                            <td className={td}>{(m.branches || []).map(branchName).join('، ')}</td>
                            <td className={td}>{t(`meetings.type.${m.type}`)}</td>
                            <td className={td}><span className={`px-2 py-0.5 rounded-md whitespace-nowrap ${STATUS_TONE[m.status]}`}>{t(`meetings.status.${m.status}`)}</span></td>
                            <td className={td}>{s.families || 0}</td>
                            <td className={td}>{s.attend || 0}</td>
                            <td className={td}>{s.attended || 0}</td>
                            <td className={td}><span dir="ltr">{(s.requestsDone || 0) + (s.done || 0)} / {(s.requests || 0) + (s.booked || 0)}</span></td>
                            <td className={td}>{s.surveys ? `★ ${s.avgOverall}` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>

              {on('purposes') && x.purposes && (
                <Section title={k('sections.purposes')} tone="border-indigo-500">
                  {!x.purposes.total ? <p className="text-sm text-slate-500">{k('purposes.none')}</p> : (
                    <div className="space-y-6">
                      <p className="text-sm text-slate-600 flex items-center gap-2"><MessageCircleQuestion className="w-4 h-4 text-indigo-500" />{k('purposes.lead', { count: x.purposes.total })}</p>
                      <Bars tone="bg-indigo-500" total={x.purposes.total} rows={x.purposes.topics.map((c) => ({ label: k(`purposes.topic.${c.id}`), value: c.count, tone: c.id === 'OTHER' ? 'bg-slate-300' : undefined }))} />
                      <p className="text-xs text-slate-500 -mt-3">{k('purposes.multi')}</p>
                      <div className="grid md:grid-cols-2 gap-4">
                        {x.purposes.topics.filter((c) => c.id !== 'OTHER' && c.samples.length).slice(0, 4).map((c) => (
                          <div key={c.id} className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 break-inside-avoid">
                            <p className="text-sm font-bold text-indigo-900 mb-1.5">{k(`purposes.topic.${c.id}`)} <span className="font-normal text-indigo-500 tabular-nums">({c.count})</span></p>
                            {c.samples.slice(0, 3).map((q) => <p key={q} className="text-xs text-slate-700 border-s-2 border-indigo-200 ps-2 my-1 leading-relaxed">«{q}»</p>)}
                          </div>
                        ))}
                      </div>
                      {x.purposes.bySubject.length > 0 && (
                        <div>
                          <p className="text-sm font-bold text-slate-700 mb-2">{k('purposes.bySubject')}</p>
                          <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full text-sm">
                              <thead><tr><th className={th}>{k('col.subject')}</th><th className={th}>{k('purposes.requests')}</th><th className={th}>{k('purposes.topTopics')}</th></tr></thead>
                              <tbody>
                                {x.purposes.bySubject.map((sb) => (
                                  <tr key={sb.subject}>
                                    <td className={`${td} font-medium text-slate-800`}>{sb.subject === '—' ? k('purposes.noSubject') : sb.subject}</td>
                                    <td className={td}>{sb.total}</td>
                                    <td className={td}><div className="flex flex-wrap gap-1">{sb.top.map((tp) => <span key={tp.id} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-xs whitespace-nowrap">{k(`purposes.topic.${tp.id}`)} <b className="tabular-nums">{tp.count}</b></span>)}</div></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              )}

              {on('messages') && (
                <Section title={k('sections.messages')} tone="border-sky-500">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Tile icon={Send} tone={TONES.sky} label={k('msg.sent')} value={tot.sent} sub={k('ofInvited', { p: pct(tot.sent, tot.families) })} />
                    <Tile icon={CheckCircle2} tone={TONES.teal} label={k('msg.delivered')} value={tot.delivered} sub={k('ofSent', { p: pct(tot.delivered, tot.sent) })} />
                    <Tile icon={CheckCircle2} tone={TONES.emerald} label={k('msg.read')} value={tot.read} sub={k('ofSent', { p: pct(tot.read, tot.sent) })} />
                    <Tile icon={AlertTriangle} tone={TONES.rose} label={k('msg.failed')} value={tot.failed} />
                    <Tile icon={AlertTriangle} tone={TONES.amber} label={k('msg.noPhone')} value={tot.noPhone} />
                  </div>
                </Section>
              )}

              {on('staff') && x.staff && (
                <Section title={k('sections.staff')} tone="border-violet-500">
                  <div className="grid md:grid-cols-3 gap-3 mb-4">
                    {[['TEACHER', TONES.sky], ['ADMIN', TONES.violet], ['ACADEMIC', TONES.indigo]].map(([r, tone]) => (
                      <Tile key={r} icon={Users} tone={tone} label={k(`staffRole.${r}`)} value={x.staff.byRole[r].done} sub={k('ofRequested', { total: x.staff.byRole[r].requests, p: pct(x.staff.byRole[r].done, x.staff.byRole[r].requests) })} />
                    ))}
                  </div>
                  {x.staff.positions.length > 0 && <Bars tone="bg-violet-500" rows={x.staff.positions.map((p) => ({ label: p.name, value: p.requests }))} />}
                </Section>
              )}

              {on('grades') && x.grades && (
                <Section title={k('sections.grades')} tone="border-sky-500">
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead><tr>{['grade', 'invited', 'confirmed', 'attended', 'attendanceRate'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
                      <tbody>
                        {Object.entries(x.grades).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([g, v]) => (
                          <tr key={g}><td className={`${td} font-bold`}>{g}</td><td className={td}>{v.families}</td><td className={td}>{v.attend}</td><td className={td}>{v.attended}</td><td className={td}><Bar value={pct(v.attended, v.attend)} tone="bg-sky-500" /></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {on('survey') && x.survey && (
                <Section title={k('sections.survey')} tone="border-amber-500">
                  {!x.survey.count ? <p className="text-sm text-slate-500">{k('noSurveys')}</p> : (
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        {['overall', 'organization', 'usefulness'].map((f) => (
                          <div key={f} className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
                            <span className="text-sm text-slate-700">{t(`meetings.survey.${f}`)}</span>
                            <span className="font-extrabold text-amber-600 tabular-nums" dir="ltr">★ {x.survey[f]} / 5</span>
                          </div>
                        ))}
                        <p className="text-xs text-slate-500">{k('surveysN', { count: x.survey.count })} · {k('lowRatings')}: {x.survey.low}</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-700 mb-2">{t('meetings.survey.answered')}</p>
                        <Bars total={x.survey.count} rows={[['YES', 'bg-emerald-500'], ['PARTLY', 'bg-amber-500'], ['NO', 'bg-rose-500']].map(([a, tone]) => ({ label: t(`meetings.survey.answers.${a}`), value: x.survey.answered[a] || 0, tone }))} />
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {on('attendees') && x.attendees && (
                <Section title={k('sections.attendees')} tone="border-emerald-500">
                  {!Object.keys(x.attendees).length ? <p className="text-sm text-slate-500">{k('noData')}</p>
                    : <Bars tone="bg-emerald-500" rows={Object.entries(x.attendees).sort(([, a], [, b]) => b - a).map(([r, v]) => ({ label: r === 'UNKNOWN' ? k('unknownRelation') : t(`meetings.family.relations.${r}`, r), value: v }))} />}
                </Section>
              )}

              {on('followUps') && x.followUps && (
                <Section title={k('sections.followUps')} tone="border-rose-500">
                  {!Object.keys(x.followUps).length ? <p className="text-sm text-slate-500">{k('noFollowUps')}</p>
                    : <Bars tone="bg-rose-500" rows={Object.entries(x.followUps).sort(([, a], [, b]) => b - a).map(([f, v]) => ({ label: t(`businessData.complaintTypes.${f}`, f), value: v }))} />}
                </Section>
              )}

              {on('topStaff') && x.topStaff && (
                <Section title={k('sections.topStaff')} tone="border-teal-500">
                  {!x.topStaff.length ? <p className="text-sm text-slate-500">{k('noData')}</p> : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead><tr>{['#', 'name', 'subject', 'branch', 'done'].map((c) => <th key={c} className={th}>{c === '#' ? '#' : k(`col.${c}`)}</th>)}</tr></thead>
                        <tbody>{x.topStaff.map((s, i) => <tr key={`${s.name}${i}`}><td className={td}>{i + 1}</td><td className={`${td} font-bold`}>{s.name}</td><td className={td}>{s.subject || t(`meetings.roles.${s.role}`)}</td><td className={td}>{s.branches.map(branchName).join('، ')}</td><td className={td}><span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-700 font-bold">{s.count}</span></td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </Section>
              )}
            </>
          )}
    </div>
  );
}

// The same report as Excel sheets (called from the reports page).
export function addMeetingsSheets(XLSX, addSheet, d, t, branchName) {
  const k = (key, o) => t(`meetingsReport.${key}`, o);
  const tot = d.totals;
  addSheet(XLSX.utils.aoa_to_sheet([
    [k('meetings'), tot.count], [k('invited'), tot.families], [k('responseRate'), `${pct(tot.responded, tot.families)}%`],
    [k('confirmed'), tot.attend], [k('attended'), tot.attended], [k('col.attendanceRate'), `${pct(tot.attended, tot.attend)}%`],
    [k('interviews'), `${tot.interviewsDone} / ${tot.interviews}`], [k('satisfaction'), tot.surveys ? tot.avg : '—'], [k('surveysLabel'), tot.surveys], [k('lowRatings'), tot.low],
  ]), k('summary'));
  addSheet(XLSX.utils.json_to_sheet(d.byBranch.map((b) => ({
    [k('col.branch')]: b.name, [k('col.meetings')]: b.count, [k('col.invited')]: b.families, [k('col.responseRate')]: `${pct(b.responded, b.families)}%`,
    [k('col.confirmed')]: b.attend, [k('col.attended')]: b.attended, [k('col.attendanceRate')]: `${pct(b.attended, b.attend)}%`,
    [k('col.interviews')]: `${b.interviewsDone} / ${b.interviews}`, [k('col.satisfaction')]: b.surveys ? b.avg : '',
  }))), k('byBranch'));
  addSheet(XLSX.utils.json_to_sheet(d.meetings.map((m) => {
    const s = m.stats || {};
    return {
      [k('col.date')]: m.date, [k('col.meeting')]: m.title, [k('col.branch')]: (m.branches || []).map(branchName).join('، '), [k('col.type')]: t(`meetings.type.${m.type}`),
      [k('col.status')]: t(`meetings.status.${m.status}`), [k('col.invited')]: s.families || 0, [k('col.confirmed')]: s.attend || 0, [k('col.attended')]: s.attended || 0,
      [k('col.interviews')]: `${(s.requestsDone || 0) + (s.done || 0)} / ${(s.requests || 0) + (s.booked || 0)}`, [k('col.satisfaction')]: s.surveys ? s.avgOverall : '',
    };
  })), k('list'));
  const x = d.extra || {};
  if (x.purposes) {
    addSheet(XLSX.utils.json_to_sheet(x.purposes.topics.map((c) => ({ [k('purposes.topicCol')]: k(`purposes.topic.${c.id}`), [k('purposes.requests')]: c.count, '%': `${pct(c.count, x.purposes.total)}%`, [k('purposes.examples')]: c.samples.join(' | ') }))), k('sections.purposes'));
    addSheet(XLSX.utils.json_to_sheet(x.purposes.bySubject.map((sb) => ({ [k('col.subject')]: sb.subject, [k('purposes.requests')]: sb.total, [k('purposes.topTopics')]: sb.top.map((tp) => `${k(`purposes.topic.${tp.id}`)} (${tp.count})`).join('، ') }))), k('purposes.bySubject'));
  }
  if (x.staff) addSheet(XLSX.utils.aoa_to_sheet([[k('col.who'), k('col.requested'), k('col.done')], ...['TEACHER', 'ADMIN', 'ACADEMIC'].map((r) => [k(`staffRole.${r}`), x.staff.byRole[r].requests, x.staff.byRole[r].done]), ...x.staff.positions.map((p) => [p.name, p.requests, p.done])]), k('sections.staff'));
  if (x.grades) addSheet(XLSX.utils.aoa_to_sheet([[k('col.grade'), k('col.invited'), k('col.confirmed'), k('col.attended')], ...Object.entries(x.grades).map(([g, v]) => [g, v.families, v.attend, v.attended])]), k('sections.grades'));
  if (x.survey) addSheet(XLSX.utils.aoa_to_sheet([[k('surveysLabel'), x.survey.count], ...['overall', 'organization', 'usefulness'].map((f) => [t(`meetings.survey.${f}`), x.survey[f]]), ...['YES', 'PARTLY', 'NO'].map((a) => [t(`meetings.survey.answers.${a}`), x.survey.answered[a] || 0]), [k('lowRatings'), x.survey.low]]), k('sections.survey'));
  if (x.attendees) addSheet(XLSX.utils.aoa_to_sheet(Object.entries(x.attendees).map(([r, v]) => [r === 'UNKNOWN' ? k('unknownRelation') : t(`meetings.family.relations.${r}`, r), v])), k('sections.attendees'));
  if (x.followUps) addSheet(XLSX.utils.aoa_to_sheet(Object.entries(x.followUps).map(([f, v]) => [t(`businessData.complaintTypes.${f}`, f), v])), k('sections.followUps'));
  if (x.topStaff) addSheet(XLSX.utils.json_to_sheet(x.topStaff.map((s) => ({ [k('col.name')]: s.name, [k('col.subject')]: s.subject, [k('col.branch')]: s.branches.map(branchName).join('، '), [k('col.done')]: s.count }))), k('sections.topStaff'));
}
