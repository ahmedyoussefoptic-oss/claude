import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { normalizeArabic } from '../../utils/students';

// The results teachers (and managers) wrote for each student — in a
// meeting's report and in the general report of «التقارير».
const fold = (x) => normalizeArabic(String(x || '')).toLowerCase();
const PAGE = 150;

// Who wrote it: the teacher's subject, or the manager's title.
const whoOf = (t, r) => (r.role === 'TEACHER' ? r.subject : [t(`meetings.roles.${r.role}`), r.subject].filter(Boolean).join(' · '));

export function resultSheetRows(rows, t, branchName, withMeeting) {
  const k = (key) => t(`meetings.results.col.${key}`);
  return rows.map((r) => ({
    ...(withMeeting ? { [k('date')]: r.date, [k('meeting')]: r.meetingTitle } : {}),
    [k('branch')]: branchName(r.branch), [k('student')]: r.studentName, [k('class')]: [r.grade, r.className].filter(Boolean).join(' '),
    [k('teacher')]: r.teacherName, [k('who')]: whoOf(t, r), [k('purpose')]: r.purpose,
    [k('result')]: r.autoClosed ? t('meetings.results.autoClosed') : r.result, [k('recommendations')]: r.recommendations, [k('agreements')]: r.agreements,
    [k('followUp')]: r.followUpNo ? `${r.followUpNo} — ${t(`businessData.complaintTypes.${r.followUpType}`, r.followUpType)}` : '',
  }));
}

export default function MeetingResultsTable({ rows, branchName, withMeeting = false }) {
  const { t } = useTranslation();
  const k = (key, o) => t(`meetings.results.${key}`, o);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => ({ ALL: rows.length, TEACHER: rows.filter((r) => r.role === 'TEACHER').length, STAFF: rows.filter((r) => r.role !== 'TEACHER').length }), [rows]);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return rows.filter((r) => (who === 'ALL' || (who === 'TEACHER' ? r.role === 'TEACHER' : r.role !== 'TEACHER'))
      && (!f || fold(`${r.studentName} ${r.teacherName} ${r.subject} ${r.className} ${r.purpose} ${r.result} ${r.recommendations}`).includes(f)));
  }, [rows, q, who]);

  if (!rows.length) return <p className="text-sm text-slate-500">{k('none')}</p>;
  const th = 'p-2 text-start font-bold text-slate-600 bg-slate-100 whitespace-nowrap';
  const td = 'p-2 border-t border-slate-100 align-top';
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        {counts.STAFF > 0 && ['ALL', 'TEACHER', 'STAFF'].map((w) => (
          <button key={w} type="button" onClick={() => { setWho(w); setLimit(PAGE); }} className={`px-3 py-1.5 rounded-xl border text-xs ${who === w ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
            {k(`who.${w}`)} <span className="tabular-nums opacity-80">({counts[w]})</span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input type="text" inputMode="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={k('search')} className="w-full ps-9 pe-8 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white" />
          {q && <button type="button" onClick={() => setQ('')} aria-label={t('meetings.directory.clear')} className="absolute top-1/2 -translate-y-1/2 end-2 p-0.5 text-slate-400"><X className="w-4 h-4" /></button>}
        </div>
        {q.trim() && <span className="text-xs text-slate-500">{k('found', { count: shown.length })}</span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead><tr>{[...(withMeeting ? ['meeting'] : []), 'student', 'teacher', 'purpose', 'result', 'recommendations', 'followUp'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
          <tbody>
            {shown.slice(0, limit).map((r, i) => (
              <tr key={`${r.meetingId}_${r.teacherName}_${r.studentName}_${i}`} className="break-inside-avoid">
                {withMeeting && <td className={`${td} text-xs text-slate-500 min-w-[130px]`}>{r.meetingTitle}<span className="block" dir="ltr">{r.date}</span>{branchName(r.branch)}</td>}
                <td className={`${td} min-w-[130px]`}><b className="text-slate-900">{r.studentName}</b><span className="block text-xs text-slate-500" dir="ltr">{r.grade} {r.className}</span>{!withMeeting && r.branch && <span className="block text-xs text-slate-400">{branchName(r.branch)}</span>}</td>
                <td className={`${td} min-w-[120px]`}>{r.teacherName}<span className="block text-xs text-slate-500">{whoOf(t, r)}</span></td>
                <td className={`${td} text-xs text-slate-600 min-w-[140px] whitespace-pre-wrap`}>{r.purpose || '—'}</td>
                <td className={`${td} min-w-[200px] whitespace-pre-wrap ${r.autoClosed ? 'text-amber-700 text-xs' : 'text-slate-800'}`}>{r.autoClosed ? k('autoClosed') : r.result || '—'}{r.agreements && <span className="block text-xs text-slate-500 mt-1">{t('meetings.teacher.agreements')}: {r.agreements}</span>}</td>
                <td className={`${td} text-xs text-slate-700 min-w-[140px] whitespace-pre-wrap`}>{r.recommendations || '—'}</td>
                <td className={`${td} text-xs whitespace-nowrap`}>{r.followUpNo ? <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">{r.followUpNo}<span className="block text-[10px]">{t(`businessData.complaintTypes.${r.followUpType}`, r.followUpType)}</span></span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="no-print text-sm text-primary hover:underline">{k('more', { count: shown.length - limit })}</button>}
    </div>
  );
}
