import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, FileDown, AlertTriangle } from 'lucide-react';
import { callSupport, riyadhDay, attRate, MARK_STYLE } from '../../config/support';
import { Pill } from '../platform/ui';

// Attendance: each class day × group (taken or not, present / absent), the
// marks of one class, and the students absent most.
export default function SupportAttendance({ data, groupName }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [sessions, setSessions] = useState(null);
  const [open, setOpen] = useState('');
  useEffect(() => { callSupport('supportAttendance', { id: c.id }).then((r) => setSessions(r.sessions)).catch(() => setSessions([])); }, [c.id]);
  const today = riyadhDay();
  const days = c.sessions.filter((d) => d <= today).reverse();
  const byKey = useMemo(() => Object.fromEntries((sessions || []).map((s) => [`${s.day}_${s.groupId}`, s])), [sessions]);
  const studentName = useMemo(() => Object.fromEntries(data.students.map((s) => [s.studentId, s.name])), [data]);
  const absentees = data.students.filter((s) => (s.att.A || 0) > 0).sort((a, b) => (b.att.A || 0) - (a.att.A || 0)).slice(0, 30);
  const count = (s, k) => Object.values(s.marks || {}).filter((m) => m.s === k).length;

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = [];
    (sessions || []).forEach((s) => Object.entries(s.marks || {}).forEach(([sid, m]) => rows.push({ [t('support.att.day')]: s.day, [t('support.col.group')]: groupName[s.groupId] || '', [t('support.col.student')]: studentName[sid] || sid, ID: sid, [t('support.att.mark')]: t(`support.marks.${m.s}`), [t('support.att.note')]: m.note || '', [t('support.att.by')]: s.byName })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Attendance');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.students.filter((s) => s.status === 'CONSENTED').map((s) => ({ [t('support.col.student')]: s.name, ID: s.studentId, [t('support.col.group')]: groupName[s.groupId] || '', [t('support.marks.P')]: s.att.P || 0, [t('support.marks.L')]: s.att.L || 0, [t('support.marks.A')]: s.att.A || 0, [t('support.marks.E')]: s.att.E || 0, [t('support.col.rate')]: attRate(s.att) ?? '' }))), 'Students');
    XLSX.writeFile(wb, `${c.title.slice(0, 30)}-attendance.xlsx`);
  };

  if (!sessions) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  if (!data.groups.length) return <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.att.noGroups')}</div>;
  const opened = open && byKey[open];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button type="button" onClick={exportExcel} className="px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl flex items-center gap-1.5"><FileDown className="w-4 h-4" />Excel</button></div>
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="px-3 py-2 text-start">{t('support.att.day')}</th>{data.groups.map((g) => <th key={g.id} className="px-3 py-2 text-start whitespace-nowrap">{g.name}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {days.map((d) => (
              <tr key={d}>
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{d}{d === today && <span className="text-primary text-xs"> ●</span>}</td>
                {data.groups.map((g) => {
                  const s = byKey[`${d}_${g.id}`];
                  return (
                    <td key={g.id} className="px-3 py-2">
                      {s ? (
                        <button type="button" onClick={() => setOpen(open === `${d}_${g.id}` ? '' : `${d}_${g.id}`)} className="flex gap-1 text-xs">
                          <Pill className="bg-emerald-50 text-emerald-700 border-emerald-200">{count(s, 'P') + count(s, 'L')}</Pill>
                          {count(s, 'A') > 0 && <Pill className="bg-rose-50 text-rose-700 border-rose-200">{count(s, 'A')}</Pill>}
                        </button>
                      ) : <span className={`text-xs ${d < today ? 'text-amber-700' : 'text-slate-400'}`}>{d < today ? t('support.att.notTaken') : '—'}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!days.length && <p className="py-8 text-center text-sm text-slate-400">{t('support.att.notStarted', { day: c.sessions[0] || c.startDay })}</p>}
      </section>
      {opened && (
        <section className="bg-white rounded-2xl border border-primary/30 shadow-sm p-4">
          <p className="font-bold text-slate-900 mb-2">{groupName[opened.groupId]} · <span dir="ltr">{opened.day}</span> <span className="text-xs text-slate-500 font-normal">— {opened.byName}</span></p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
            {Object.entries(opened.marks).map(([sid, m]) => <li key={sid} className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded-md border text-xs ${MARK_STYLE[m.s].on}`}>{t(`support.marks.${m.s}`)}</span>{studentName[sid] || sid}{m.note && <span className="text-xs text-slate-500">— {m.note}</span>}</li>)}
          </ul>
        </section>
      )}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-rose-600" />{t('support.att.mostAbsent')}</p>
        {absentees.length ? (
          <table className="w-full text-sm"><tbody>{absentees.map((s) => <tr key={s.id} className="border-t border-slate-50"><td className="py-1.5">{s.name}</td><td className="text-xs text-slate-500">{groupName[s.groupId] || ''}</td><td className="text-rose-700 font-bold">{t('support.absentN', { n: s.att.A })}</td><td className="text-xs text-slate-500">{attRate(s.att)}%</td><td className="text-xs text-slate-400" dir="ltr">{s.att.lastAbsent || ''}</td></tr>)}</tbody></table>
        ) : <p className="text-sm text-emerald-700">{t('support.att.noAbsence')}</p>}
      </section>
    </div>
  );
}
