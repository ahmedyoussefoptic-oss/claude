import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, MessageSquareReply, CalendarCheck, UserCheck, CheckCircle2, Star, AlertTriangle, Trophy, CalendarClock } from 'lucide-react';
import { pct, meetingsTotals, meetingsByBranch, LIVE } from '../../utils/meetingsStats';

// The indicators under the meetings page's header: totals of every meeting
// in the user's branches (drafts and cancelled ones left out), the rates,
// the most active branches and the next meeting.
function Kpi({ icon: Icon, label, value, sub, tone, rate }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${tone.box}`}>
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tone.icon}`}><Icon className="w-4 h-4" /></span>
        <p className={`text-xs font-bold ${tone.text}`}>{label}</p>
      </div>
      <p className="text-2xl font-extrabold text-slate-900 mt-2 tabular-nums"><span dir="ltr">{value}</span></p>
      {rate != null && <div className="h-1.5 rounded-full bg-white/80 mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, rate)}%` }} /></div>}
      {sub && <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

const T = {
  sky: { box: 'bg-sky-50 border-sky-100', text: 'text-sky-800', icon: 'bg-sky-500 text-white', bar: 'bg-sky-500' },
  violet: { box: 'bg-violet-50 border-violet-100', text: 'text-violet-800', icon: 'bg-violet-500 text-white', bar: 'bg-violet-500' },
  indigo: { box: 'bg-indigo-50 border-indigo-100', text: 'text-indigo-800', icon: 'bg-indigo-500 text-white', bar: 'bg-indigo-500' },
  emerald: { box: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-800', icon: 'bg-emerald-500 text-white', bar: 'bg-emerald-500' },
  teal: { box: 'bg-teal-50 border-teal-100', text: 'text-teal-800', icon: 'bg-teal-500 text-white', bar: 'bg-teal-500' },
  amber: { box: 'bg-amber-50 border-amber-100', text: 'text-amber-800', icon: 'bg-amber-500 text-white', bar: 'bg-amber-500' },
  rose: { box: 'bg-rose-50 border-rose-100', text: 'text-rose-800', icon: 'bg-rose-500 text-white', bar: 'bg-rose-500' },
};

export default function MeetingsDashboard({ meetings, branchName }) {
  const { t } = useTranslation();
  const k = (key, o) => t(`meetingsReport.${key}`, o);
  const d = (key, o) => t(`meetings.dash.${key}`, o);
  const tot = useMemo(() => meetingsTotals(meetings), [meetings]);
  const branches = useMemo(() => meetingsByBranch(meetings.filter(LIVE), branchName).filter((b) => b.families > 0), [meetings, branchName]);
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const next = useMemo(() => meetings.filter((m) => LIVE(m) && m.status !== 'COMPLETED' && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0], [meetings, today]);
  if (!tot.live) return null;
  const maxScore = Math.max(1, ...branches.map((b) => b.attend));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
        <Kpi icon={Users} tone={T.sky} label={k('invited')} value={tot.families} sub={k('studentsN', { count: tot.students })} />
        <Kpi icon={MessageSquareReply} tone={T.violet} label={k('responseRate')} value={`${pct(tot.responded, tot.families)}%`} rate={pct(tot.responded, tot.families)} sub={k('respondedOf', { n: tot.responded, total: tot.families })} />
        <Kpi icon={CalendarCheck} tone={T.indigo} label={k('confirmed')} value={tot.attend} rate={pct(tot.attend, tot.families)} sub={d('ofInvited', { p: pct(tot.attend, tot.families) })} />
        <Kpi icon={UserCheck} tone={T.emerald} label={k('attended')} value={tot.attended} rate={pct(tot.attended, tot.attend)} sub={k('ofConfirmed', { p: pct(tot.attended, tot.attend) })} />
        <Kpi icon={CheckCircle2} tone={T.teal} label={k('interviews')} value={tot.interviewsDone} rate={pct(tot.interviewsDone, tot.interviews)} sub={k('ofRequested', { total: tot.interviews, p: pct(tot.interviewsDone, tot.interviews) })} />
        <Kpi icon={Star} tone={T.amber} label={k('satisfaction')} value={tot.surveys ? `${tot.avg}/5` : '—'} sub={k('surveysN', { count: tot.surveys })} />
        <Kpi icon={AlertTriangle} tone={T.rose} label={k('lowRatings')} value={tot.low} sub={d('declined', { n: tot.decline, remote: tot.remote })} />
        <Kpi icon={CalendarClock} tone={T.sky} label={d('next')} value={next ? next.date : '—'} sub={next ? `${next.title}` : d('noNext')} />
      </div>

      {branches.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><Trophy className="w-4 h-4 text-amber-500" />{d('topBranches')}</p>
          <div className="space-y-2">
            {branches.slice(0, 6).map((b, i) => (
              <div key={b.name} className="grid grid-cols-[22px_minmax(100px,170px)_1fr_auto] items-center gap-3 text-sm">
                <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-300 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                <span className="font-medium text-slate-800 truncate">{b.name}</span>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-sky-500" style={{ width: `${(b.attend / maxScore) * 100}%` }} /></div>
                <span className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                  {d('branchLine', { confirmed: b.attend, invited: b.families, p: pct(b.attend, b.families), attended: b.attended })}
                  {b.surveys ? ` · ★ ${b.avg}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
