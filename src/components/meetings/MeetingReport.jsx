import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Printer, FileDown, Star, Filter } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';
import { printPage } from '../../utils/printPage';
import { callMeeting, pct } from '../../config/meetings';

function Card({ title, children, className = '' }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl p-4 break-inside-avoid ${className}`}>
      <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>
      {children}
    </section>
  );
}
function Bar({ label, value, max, text }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-slate-600 truncate">{label}</span>
      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>
      <span className="w-24 shrink-0 text-end text-slate-700 tabular-nums">{text ?? value}</span>
    </div>
  );
}
const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100 : 0);

// The final report of one meeting: participation, satisfaction, topics,
// follow-ups, absentees and the comparison with earlier meetings.
export default function MeetingReport({ id }) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b || '—';
  const [data, setData] = useState(null);
  const [others, setOthers] = useState([]);
  const [error, setError] = useState(null);
  const [groupBy, setGroupBy] = useState('className');
  const area = useRef(null);

  useEffect(() => {
    callMeeting('getMeetingReport', { id }).then(setData).catch((err) => setError(err.message));
    callMeeting('listMeetings', {}).then((r) => setOthers(r.meetings || [])).catch(() => {});
  }, [id]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    data.students.forEach((s) => {
      const key = groupBy === 'branch' ? branchName(s.branch) : groupBy === 'grade' ? s.grade || '—' : `${s.grade || ''} ${s.className || ''}`.trim() || '—';
      const g = map.get(key) || { key, invited: 0, responded: 0, confirmed: 0, attended: 0 };
      g.invited++;
      if (s.response) g.responded++;
      if (s.response === 'ATTEND' || s.response === 'REMOTE') g.confirmed++;
      if (s.attended) g.attended++;
      map.set(key, g);
    });
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  }, [data, groupBy, branches]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>;
  if (!data) return <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const { stats: s, meeting: m, surveys } = data;
  const funnel = [
    [t('meetings.report.invited'), s.families],
    [t('meetings.report.responded'), s.responded],
    [t('meetings.report.confirmed'), (s.attend || 0) + (s.remote || 0)],
    [t('meetings.report.attended'), s.attended],
  ];
  const axes = ['overall', 'organization', 'usefulness'].map((k) => [k, avg(surveys.map((x) => x[k]).filter(Boolean))]);
  const answered = ['YES', 'PARTLY', 'NO'].map((k) => [k, surveys.filter((x) => x.answered === k).length]);
  const satisfied = surveys.filter((x) => x.overall >= 4).length;
  const fuStatus = data.followUps.reduce((acc, f) => { const closed = ['SOLVED', 'CLOSED'].includes(f.status); acc[closed ? 'closed' : 'open']++; return acc; }, { open: 0, closed: 0 });
  const bySubject = data.topics.reduce((acc, x) => { const k = x.subject || x.teacher || t('meetings.report.general'); (acc[k] = acc[k] || []).push(x); return acc; }, {});
  const compare = others.filter((o) => o.status === 'COMPLETED' || o.id === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31)); };
    const h = (k) => t(`meetings.report.${k}`);
    add(h('sheetSummary'), [
      ...funnel.map(([k, v]) => ({ [h('item')]: k, [h('value')]: v, '%': pct(v, s.families) })),
      ...axes.map(([k, v]) => ({ [h('item')]: t(`meetings.survey.${k}`), [h('value')]: v })),
      { [h('item')]: h('satisfaction'), [h('value')]: `${pct(satisfied, surveys.length)}%` },
      { [h('item')]: h('avgDelay'), [h('value')]: data.punctuality.avgDelay },
      { [h('item')]: h('followUps'), [h('value')]: data.followUps.length },
    ]);
    add(h('sheetStudents'), data.students.map((x) => ({
      [t('meetings.report.student')]: x.name, ID: x.id, [t('common.branch')]: branchName(x.branch), [t('meetings.report.grade')]: x.grade, [t('meetings.report.class')]: x.className,
      [t('meetings.report.response')]: t(`meetings.response.${x.response || 'NONE'}`), [t('meetings.report.attended')]: x.attended ? '✓' : '',
    })));
    add(h('sheetTeachers'), data.teachers.map((x) => ({ [h('teacher')]: x.name, [h('subject')]: x.subject, [h('booked')]: x.booked, [h('done')]: x.done, [h('minutes')]: x.minutes, [h('rating')]: x.rating, [h('ratings')]: x.ratings })));
    add(h('sheetSurveys'), surveys.map((x) => ({ [h('parent')]: x.studentNames, [t('meetings.survey.overall')]: x.overall, [t('meetings.survey.organization')]: x.organization, [t('meetings.survey.usefulness')]: x.usefulness, [t('meetings.survey.answered')]: t(`meetings.survey.answers.${x.answered}`), [h('comment')]: x.comment })));
    add(h('sheetTopics'), data.topics.map((x) => ({ [h('subject')]: x.subject, [h('teacher')]: x.teacher, [h('parent')]: x.students, [h('topic')]: x.topic })));
    add(h('sheetFollowUps'), data.followUps.map((x) => ({ '#': x.number, [h('student')]: x.studentName, [h('type')]: t(`businessData.complaintTypes.${x.type}`, x.type), [t('common.status')]: t(`statuses.complaint.${x.status}`, x.status) })));
    if (data.requests) {
      add(h('sheetRequests'), data.requests.perStaff.map((x) => ({ [h('person')]: x.name, [h('role')]: t(`meetings.roles.${x.role}`), [h('asked')]: x.asked, [h('done')]: x.done, [h('notMet')]: x.notMet, [h('rejected')]: x.rejected || 0, [h('avgWait')]: x.avgWait, [h('avgLength')]: x.avgLength })));
      add(h('sheetPurposes'), data.requests.purposes.map((x) => ({ [h('person')]: x.staff, [h('role')]: t(`meetings.roles.${x.role}`), [h('student')]: x.student, [h('purpose')]: x.purpose, [t('common.status')]: t(`meetings.request.${x.status}`), [h('rejectReason')]: x.rejectReason || '' })));
    }
    add(h('sheetAbsent'), data.absent.map((x) => ({ [h('parent')]: x.names, [h('class')]: x.classes, [h('response')]: t(`meetings.response.${x.response || 'NONE'}`), [h('call')]: x.callStatus ? t(`meetings.report.callStatus.${x.callStatus}`, x.callStatus) : '', [h('callResult')]: x.callResult })));
    XLSX.writeFile(wb, `${m.code}-report.xlsx`);
  };
  const print = () => printPage({
    title: t('meetings.report.title'), subtitle: `${m.title} · ${m.date} · ${m.code}`, school: t('trips.print.school'),
    body: area.current?.outerHTML || '', copyStyles: true, dir: i18n.dir(), lang: i18n.language,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={exportExcel} className="px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl flex items-center gap-1.5"><FileDown className="w-4 h-4" />Excel</button>
        <button type="button" onClick={print} className="px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl flex items-center gap-1.5"><Printer className="w-4 h-4" />{t('common.print')}</button>
      </div>
      <div ref={area} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={t('meetings.report.funnel')}>
          <div className="space-y-2">{funnel.map(([k, v]) => <Bar key={k} label={k} value={v || 0} max={s.families} text={`${v || 0} · ${pct(v, s.families)}%`} />)}</div>
          <p className="text-xs text-slate-500 mt-3">{t('meetings.report.kpis', { response: pct(s.responded, s.families), attendance: pct(s.attended, s.families), ofConfirmed: pct(s.attended, s.attend), delay: data.punctuality.avgDelay, slots: data.punctuality.count })}</p>
        </Card>

        <Card title={t('meetings.report.satisfactionTitle')}>
          {surveys.length ? (
            <div className="space-y-2">
              {axes.map(([k, v]) => <Bar key={k} label={t(`meetings.survey.${k}`)} value={v} max={5} text={`${v} / 5`} />)}
              <p className="text-sm text-slate-700 pt-1">{t('meetings.report.satisfied', { pct: pct(satisfied, surveys.length), count: surveys.length })}</p>
              <p className="text-xs text-slate-500">{t('meetings.survey.answered')}: {answered.map(([k, v]) => `${t(`meetings.survey.answers.${k}`)} ${v}`).join(' · ')}</p>
            </div>
          ) : <p className="text-sm text-slate-500">{t('meetings.report.noSurveys')}</p>}
        </Card>

        <Card title={t('meetings.report.byGroup')} className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-2 text-xs"><Filter className="w-3.5 h-3.5 text-slate-400" />
            {['branch', 'grade', 'className'].map((g) => <button key={g} type="button" onClick={() => setGroupBy(g)} className={`px-2 py-1 rounded-lg border ${groupBy === g ? 'bg-primary text-white border-primary' : 'border-slate-200 text-slate-600'}`}>{t(`meetings.report.group.${g}`)}</button>)}
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-100">{['', 'invited', 'responded', 'confirmed', 'attended'].map((k) => <th key={k} className="p-2 text-start font-medium">{k && t(`meetings.report.${k}`)}</th>)}<th className="p-2 text-start font-medium">%</th></tr></thead>
            <tbody>{groups.map((g) => <tr key={g.key} className="border-b border-slate-50"><td className="p-2" dir="ltr">{g.key}</td><td className="p-2">{g.invited}</td><td className="p-2">{g.responded}</td><td className="p-2">{g.confirmed}</td><td className="p-2">{g.attended}</td><td className="p-2">{pct(g.attended, g.invited)}%</td></tr>)}</tbody>
          </table></div>
        </Card>

        {data.requests && (
          <Card title={t('meetings.report.requestsTitle')} className="lg:col-span-2">
            <div className="flex flex-wrap gap-3 mb-3">
              {data.requests.byRole.map((r) => (
                <div key={r.role} className="bg-slate-50 rounded-xl px-3 py-2 text-sm"><b>{t(`meetings.roles.${r.role}`)}</b>: {t('meetings.report.doneOf', { done: r.done, asked: r.asked })}</div>
              ))}
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-500 border-b border-slate-100">{['person', 'role', 'asked', 'done', 'notMet', 'rejected', 'avgWait', 'avgLength'].map((k) => <th key={k} className="p-2 text-start font-medium">{t(`meetings.report.${k}`)}</th>)}</tr></thead>
              <tbody>{data.requests.perStaff.filter((x) => x.asked).map((x) => (
                <tr key={x.id} className="border-b border-slate-50"><td className="p-2">{x.name}<p className="text-xs text-slate-400">{x.subject}</p></td><td className="p-2">{t(`meetings.roles.${x.role}`)}</td><td className="p-2">{x.asked}</td><td className="p-2">{x.done}</td><td className="p-2">{x.notMet}</td><td className="p-2">{x.rejected || 0}</td><td className="p-2">{x.avgWait}</td><td className="p-2">{x.avgLength}</td></tr>
              ))}</tbody>
            </table></div>
            {data.requests.purposes.length > 0 && (
              <div className="mt-3 max-h-80 overflow-y-auto">
                <p className="text-xs font-bold text-slate-700 mb-1">{t('meetings.report.purposes', { count: data.requests.purposes.length })}</p>
                {data.requests.purposes.map((x, i) => <p key={i} className="text-sm text-slate-600 border-s-2 border-slate-200 ps-2 my-1">{x.purpose} <span className="text-xs text-slate-400">— {x.student} ← {x.staff}</span></p>)}
              </div>
            )}
          </Card>
        )}

        <Card title={t('meetings.report.teachersTitle')}>
          {data.teachers.length ? <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-100">{['teacher', 'booked', 'done', 'minutes', 'rating'].map((k) => <th key={k} className="p-2 text-start font-medium">{t(`meetings.report.${k}`)}</th>)}</tr></thead>
            <tbody>{data.teachers.map((x) => <tr key={x.id} className="border-b border-slate-50"><td className="p-2">{x.name}<p className="text-xs text-slate-400">{x.subject}</p></td><td className="p-2">{x.booked}</td><td className="p-2">{x.done}</td><td className="p-2">{x.minutes}</td><td className="p-2">{x.ratings ? <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{x.rating} <span className="text-xs text-slate-400">({x.ratings})</span></span> : '—'}</td></tr>)}</tbody>
          </table> : <p className="text-sm text-slate-500">—</p>}
        </Card>

        <Card title={t('meetings.report.topicsTitle', { count: data.topics.length })}>
          {data.topics.length ? <div className="space-y-3 max-h-96 overflow-y-auto">{Object.entries(bySubject).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => (
            <div key={k}><p className="text-xs font-bold text-slate-700">{k} ({list.length})</p>{list.map((x, i) => <p key={i} className="text-sm text-slate-600 border-s-2 border-slate-200 ps-2 my-1">{x.topic} <span className="text-xs text-slate-400">— {x.students}</span></p>)}</div>
          ))}</div> : <p className="text-sm text-slate-500">—</p>}
        </Card>

        <Card title={t('meetings.report.followUpsTitle', { count: data.followUps.length, open: fuStatus.open, closed: fuStatus.closed })}>
          {data.followUps.length ? data.followUps.map((f) => (
            <div key={f.id} className="flex justify-between gap-2 py-1.5 border-b border-slate-50 text-sm">
              <span><span dir="ltr" className="text-xs text-slate-500">{f.number}</span> · {f.studentName} · {t(`businessData.complaintTypes.${f.type}`, f.type)}</span>
              <span className="text-xs text-slate-600 shrink-0">{t(`statuses.complaint.${f.status}`, f.status)}</span>
            </div>
          )) : <p className="text-sm text-slate-500">{t('meetings.report.noFollowUps')}</p>}
        </Card>

        <Card title={t('meetings.report.absentTitle', { count: data.absent.length })}>
          <div className="max-h-96 overflow-y-auto">{data.absent.map((x) => (
            <div key={x.id} className="flex justify-between gap-2 py-1.5 border-b border-slate-50 text-sm">
              <span>{x.names} <span className="text-xs text-slate-400" dir="ltr">{x.classes}</span></span>
              <span className="text-xs text-slate-500 shrink-0">{t(`meetings.response.${x.response || 'NONE'}`)}{x.callStatus ? ` · ${t(`meetings.report.callStatus.${x.callStatus}`, x.callStatus)}` : ''}{x.callResult ? ` · ${x.callResult}` : ''}</span>
            </div>
          ))}</div>
        </Card>

        {surveys.some((x) => x.comment || x.low) && (
          <Card title={t('meetings.report.comments')} className="lg:col-span-2">
            {surveys.filter((x) => x.comment || x.low).map((x, i) => (
              <div key={i} className={`text-sm py-1.5 border-b border-slate-50 ${x.low ? 'text-rose-700' : 'text-slate-700'}`}>
                <b>{x.overall}/5</b> · {x.studentNames}{x.comment ? ` — ${x.comment}` : ''}
              </div>
            ))}
          </Card>
        )}

        <Card title={t('meetings.report.compare')} className="lg:col-span-2">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-100">{['meeting', 'invited', 'responseRate', 'attendanceRate', 'avgRating'].map((k) => <th key={k} className="p-2 text-start font-medium">{t(`meetings.report.${k}`)}</th>)}</tr></thead>
            <tbody>{compare.map((o) => (
              <tr key={o.id} className={`border-b border-slate-50 ${o.id === id ? 'bg-primary/5 font-medium' : ''}`}>
                <td className="p-2">{o.title}<p className="text-xs text-slate-400">{o.date}</p></td>
                <td className="p-2">{o.stats?.families || 0}</td>
                <td className="p-2">{pct(o.stats?.responded, o.stats?.families)}%</td>
                <td className="p-2">{pct(o.stats?.attended, o.stats?.families)}%</td>
                <td className="p-2">{o.stats?.avgOverall ? `${o.stats.avgOverall}/5` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      </div>
    </div>
  );
}
