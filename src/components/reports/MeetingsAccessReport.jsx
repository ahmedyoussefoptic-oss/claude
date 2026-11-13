import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Users, LogIn, UserX, Activity, Search, Info } from 'lucide-react';
import { callMeeting } from '../../config/meetings';
import { pct } from '../../utils/meetingsStats';
import { normalizeArabic } from '../../utils/students';

// «دخول المعلمين» in «التقارير»: for the meetings in the period, how many of
// their teachers (and named staff) opened their link and who did not —
// counts by branch, then the names, filterable, for printing or Excel.
const fold = (x) => normalizeArabic(String(x || '')).toLowerCase();
const when = (msv, lang) => (msv ? new Date(msv).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

// One row per teacher per meeting.
export function accessRows(data, branchName) {
  return (data?.meetings || []).flatMap((m) => m.teachers.map((tc) => ({
    ...tc, meetingId: m.id, meetingTitle: m.title, date: m.date, branch: (m.branches || []).map(branchName).join(' + '),
  })));
}
export function accessByBranch(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const b = map.get(r.branch) || map.set(r.branch, { name: r.branch, total: 0, login: 0, activity: 0, none: 0 }).get(r.branch);
    b.total++;
    if (r.entered === 'login') b.login++; else if (r.entered === 'activity') b.activity++; else b.none++;
  });
  return [...map.values()].sort((a, b) => pct(b.login + b.activity, b.total) - pct(a.login + a.activity, a.total) || b.total - a.total);
}

function Tile({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`rounded-2xl p-4 border ${tone[0]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-bold ${tone[1]}`}>{label}</p>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${tone[2]}`}><Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-3xl font-extrabold text-slate-900 mt-2 tabular-nums"><span dir="ltr">{value}</span></p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

export function EnteredBadge({ entered }) {
  const { t } = useTranslation();
  const cls = entered === 'login' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : entered === 'activity' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-rose-50 text-rose-700 border-rose-200';
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-bold whitespace-nowrap ${cls}`}>{t(`meetingsAccess.state.${entered || 'none'}`)}</span>;
}

const th = 'p-2 text-start font-bold text-slate-600 bg-slate-100 whitespace-nowrap';
const td = 'p-2 border-t border-slate-100';

export default function MeetingsAccessReport({ filters, branches, onData }) {
  const { t, i18n } = useTranslation();
  const k = (key, o) => t(`meetingsAccess.${key}`, o);
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState('none');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    callMeeting('meetingsAccessReport', { from: filters.from || '', to: filters.to || '', branch: filters.branch || '' })
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters.from, filters.to, filters.branch]);

  const rows = useMemo(() => accessRows(data, branchName), [data, branches]); // eslint-disable-line react-hooks/exhaustive-deps
  const byBranch = useMemo(() => accessByBranch(rows), [rows]);
  useEffect(() => { onData?.(data ? { ...data, rows, byBranch } : null); }, [data, rows, byBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = rows.filter((r) => r.entered === 'login').length;
  const activity = rows.filter((r) => r.entered === 'activity').length;
  const entered = login + activity;
  const none = rows.length - entered;
  const people = new Set(rows.map((r) => fold(r.name))).size;
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return rows.filter((r) => (show === 'all' || (show === 'none' ? !r.entered : !!r.entered))
      && (!f || fold(`${r.name} ${r.subject} ${r.branch}`).includes(f)))
      .sort((a, b) => a.branch.localeCompare(b.branch, 'ar') || (a.role === b.role ? 0 : a.role === 'TEACHER' ? -1 : 1) || a.name.localeCompare(b.name, 'ar'));
  }, [rows, show, q]);

  if (loading && !data) return <div className="flex justify-center p-10"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  if (error) return <p className="text-center text-rose-600 py-6">{error}</p>;
  if (!rows.length) return <p className="text-center text-slate-500 py-10">{k('empty')}</p>;

  return (
    <div className="space-y-8">
      {loading && <p className="no-print text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('meetingsReport.updating')}</p>}
      <p className="text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-xl p-3 flex gap-2 leading-relaxed"><Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />{k('note', { date: data.accessSince })}</p>

      <section className="break-inside-avoid">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile icon={Users} tone={['bg-slate-50 border-slate-200', 'text-slate-600', 'bg-[#1b345a]']} label={k('total')} value={rows.length} sub={k('totalSub', { people, meetings: data.meetings.length })} />
          <Tile icon={LogIn} tone={['bg-emerald-50 border-emerald-200', 'text-emerald-700', 'bg-emerald-500']} label={k('entered')} value={entered} sub={`${pct(entered, rows.length)}%`} />
          <Tile icon={UserX} tone={['bg-rose-50 border-rose-200', 'text-rose-700', 'bg-rose-500']} label={k('notEntered')} value={none} sub={`${pct(none, rows.length)}%`} />
          <Tile icon={Activity} tone={['bg-sky-50 border-sky-200', 'text-sky-700', 'bg-sky-500']} label={k('byActivity')} value={activity} sub={k('byLoginN', { n: login })} />
        </div>
      </section>

      <section className="break-inside-avoid">
        <h3 className="text-base font-bold text-slate-900 mb-3 ps-3 border-s-4 border-[#1b345a]">{k('byBranch')}</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead><tr>{['branch', 'total', 'entered', 'notEntered', 'rate'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
            <tbody>
              {byBranch.map((b) => {
                const p = pct(b.login + b.activity, b.total);
                return (
                  <tr key={b.name}>
                    <td className={`${td} font-medium text-slate-800`}>{b.name}</td>
                    <td className={`${td} tabular-nums`}>{b.total}</td>
                    <td className={`${td} tabular-nums text-emerald-700 font-bold`}>{b.login + b.activity}</td>
                    <td className={`${td} tabular-nums text-rose-700 font-bold`}>{b.none}</td>
                    <td className={`${td} min-w-[140px]`}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-rose-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p}%` }} /></div>
                        <span className="text-xs font-bold tabular-nums w-9 text-end">{p}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-base font-bold text-slate-900 mb-3 ps-3 border-s-4 border-rose-500">{k(`listTitle.${show}`)} <span className="text-slate-400 font-normal">({shown.length})</span></h3>
        <div className="no-print flex flex-wrap items-center gap-2 mb-3">
          {['none', 'entered', 'all'].map((s) => (
            <button key={s} type="button" onClick={() => setShow(s)} className={`px-3 py-1.5 rounded-xl border text-sm ${show === s ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
              {k(`show.${s}`)} <span className="tabular-nums opacity-80">({s === 'none' ? none : s === 'entered' ? entered : rows.length})</span>
            </button>
          ))}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input type="text" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={k('search')} className="w-full ps-9 pe-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
        {!shown.length ? <p className="text-sm text-slate-500 py-4">{k('noRows')}</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead><tr>{['n', 'name', 'subject', 'branch', 'meeting', 'state', 'firstAt', 'lastAt', 'requests'].map((c) => <th key={c} className={th}>{k(`col.${c}`)}</th>)}</tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.meetingId}_${r.id}`} className={r.entered ? '' : 'bg-rose-50/30'}>
                    <td className={`${td} text-slate-400 tabular-nums`}>{i + 1}</td>
                    <td className={`${td} font-medium text-slate-900 min-w-[130px]`}>{r.name}</td>
                    <td className={`${td} text-slate-600`}>{r.role === 'TEACHER' ? r.subject : `${t(`meetings.roles.${r.role}`)}${r.subject ? ` · ${r.subject}` : ''}`}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.branch}</td>
                    <td className={`${td} text-slate-600 min-w-[200px]`}>{r.meetingTitle}<span className="block text-xs text-slate-400" dir="ltr">{r.date}</span></td>
                    <td className={td}><EnteredBadge entered={r.entered} /></td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-600`}>{when(r.firstAt, i18n.language)}</td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-600`}>{when(r.lastAt, i18n.language)}</td>
                    <td className={`${td} tabular-nums text-xs`}><span dir="ltr">{r.done} / {r.asked}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-2">{k('requestsHint')}</p>
      </section>
    </div>
  );
}

export function addAccessSheets(XLSX, addSheet, d, t, lang) {
  const k = (key, o) => t(`meetingsAccess.${key}`, o);
  addSheet(XLSX.utils.json_to_sheet(d.byBranch.map((b) => ({
    [k('col.branch')]: b.name, [k('col.total')]: b.total, [k('col.entered')]: b.login + b.activity, [k('col.notEntered')]: b.none, [k('col.rate')]: `${pct(b.login + b.activity, b.total)}%`,
  }))), k('byBranch'));
  const row = (r) => ({
    [k('col.name')]: r.name, [k('col.subject')]: r.role === 'TEACHER' ? r.subject : `${t(`meetings.roles.${r.role}`)}${r.subject ? ` · ${r.subject}` : ''}`,
    [k('col.branch')]: r.branch, [k('col.meeting')]: r.meetingTitle, [k('col.date')]: r.date, [k('col.state')]: k(`state.${r.entered || 'none'}`),
    [k('col.firstAt')]: when(r.firstAt, lang), [k('col.lastAt')]: when(r.lastAt, lang), [k('col.asked')]: r.asked, [k('col.done')]: r.done,
  });
  const sorted = [...d.rows].sort((a, b) => a.branch.localeCompare(b.branch, 'ar') || a.name.localeCompare(b.name, 'ar'));
  addSheet(XLSX.utils.json_to_sheet(sorted.filter((r) => !r.entered).map(row)), k('show.none'));
  addSheet(XLSX.utils.json_to_sheet(sorted.map(row)), k('show.all'));
}
