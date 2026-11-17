import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Loader2, FileDown, ChevronDown, AlertTriangle, Clock, Phone, CheckCircle2, PhoneMissed, Timer, ShieldCheck, FileText, ExternalLink, Printer } from 'lucide-react';
import { functions } from '../../config/firebase';
import { printPage, escapeHtml } from '../../utils/printPage';
import { Tile, inputCls, btn } from '../platform/ui';

// Where a note filed from a call opens (the finance section for a financial one).
export const notePath = (n) => `${n.finance ? '/finance' : '/complaints'}?openId=${encodeURIComponent(n.id)}`;
const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const hm = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }) : '—');
function shift(day, n) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function preset(id, today) {
  if (id === 'yesterday') return [shift(today, -1), shift(today, -1)];
  if (id === 'week') { const d = new Date(`${today}T12:00:00Z`); return [shift(today, -d.getUTCDay()), today]; }
  if (id === 'month') return [`${today.slice(0, 7)}-01`, today];
  return [today, today];
}

// «أداء الموظفات»: each call agent's detailed activity for a period (and
// optionally one campaign) — what they did, what is waiting and late, and a
// drill-down per agent: by day, by campaign, by hour, and the late / overdue
// calls to follow up.
export default function CallPerformance() {
  const { t, i18n } = useTranslation();
  const today = riyadhDay();
  const [range, setRange] = useState(() => preset('today', today));
  const [rangeId, setRangeId] = useState('today');
  const [campaignId, setCampaignId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState('');
  const [sort, setSort] = useState('attempts');

  const load = useCallback(() => {
    setData(null);
    setError(null);
    httpsCallable(functions, 'callAgentPerformance')({ from: range[0], to: range[1], campaignId })
      .then((r) => setData(r.data)).catch((err) => setError(err.message));
  }, [range, campaignId]);
  useEffect(() => { load(); }, [load]);

  const agents = useMemo(() => {
    const list = [...(data?.agents || [])];
    const v = (a) => (sort === 'rate' ? pct(a.answered, a.attempts) : a[sort]);
    return list.sort((a, b) => v(b) - v(a));
  }, [data, sort]);
  const total = useMemo(() => {
    const keys = ['attempts', 'answered', 'noAnswer', 'callback', 'wrong', 'done', 'failed', 'verified', 'unverified', 'verifyPending', 'talkSec', 'talked', 'whatsapp', 'complaints', 'pending', 'dueToday', 'late', 'callbacksWaiting', 'callbacksOverdue', 'finishedAttempts'];
    return Object.fromEntries(keys.map((k) => [k, (data?.agents || []).reduce((n, a) => n + (a[k] || 0), 0)]));
  }, [data]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const c = (k) => t(`callTasks.perf.col.${k}`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agents.map((a) => ({
      [c('agent')]: a.name, [c('attempts')]: a.attempts, [c('answered')]: a.answered, [c('rate')]: `${pct(a.answered, a.attempts)}%`, [c('noAnswer')]: a.noAnswer,
      [c('callback')]: a.callback, [c('wrong')]: a.wrong, [c('done')]: a.done, [c('failed')]: a.failed, [c('avgAttempts')]: (a.done + a.failed) ? Math.round((a.finishedAttempts / (a.done + a.failed)) * 10) / 10 : '',
      [c('verified')]: a.verified, [c('unverified')]: a.unverified, [c('talk')]: a.talked ? mmss(a.talkSec / a.talked) : '', [c('whatsapp')]: a.whatsapp, [c('complaints')]: a.complaints,
      [c('pending')]: a.pending, [c('dueToday')]: a.dueToday, [c('late')]: a.late, [c('oldest')]: a.oldestLateDays, [c('callbacksWaiting')]: a.callbacksWaiting, [c('callbacksOverdue')]: a.callbacksOverdue,
      [c('activeDays')]: a.activeDays, [c('first')]: hm(a.firstAt), [c('last')]: hm(a.lastAt),
    }))), t('callTasks.perf.sheetAgents').slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agents.flatMap((a) => a.days.map((d) => ({
      [c('agent')]: a.name, [c('day')]: d.day, [c('attempts')]: d.attempts, [c('answered')]: d.answered, [c('noAnswer')]: d.noAnswer, [c('done')]: d.done, [c('first')]: hm(d.first), [c('last')]: hm(d.last),
    })))), t('callTasks.perf.sheetDays').slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agents.flatMap((a) => [...a.lateList.map((x) => ({ k: 'late', x })), ...a.overdueList.map((x) => ({ k: 'overdue', x }))].map(({ k, x }) => ({
      [c('agent')]: a.name, [c('kind')]: t(`callTasks.perf.kind.${k}`), [c('student')]: x.studentName, [c('phone')]: x.phone, [c('campaign')]: x.campaign, [c('due')]: x.dueAt ? format(new Date(x.dueAt), 'yyyy-MM-dd HH:mm') : x.dueDay, [c('attemptsN')]: x.attempts,
    })))), t('callTasks.perf.sheetFollow').slice(0, 31));
    XLSX.writeFile(wb, `call-performance-${range[0]}-${range[1]}.xlsx`);
  };

  // The report as a printable page (the browser saves it as PDF): the team
  // totals, every agent's row, then each agent's days, campaigns, notes and
  // the calls to follow up.
  const printReport = () => {
    const c = (k) => t(`callTasks.perf.col.${k}`);
    const e = escapeHtml;
    const campaign = (data?.campaigns || []).find((x) => x.id === campaignId);
    const cols = ['agent', 'attempts', 'answered', 'rate', 'noAnswer', 'callback', 'wrong', 'done', 'failed', 'avgAttempts', 'talk', 'verified', 'whatsapp', 'complaints', 'pending', 'late', 'callbacksOverdue', 'firstLast'];
    const cell = (a, k) => {
      const fin = a.done + a.failed;
      if (k === 'agent') return e(a.name || '—');
      if (k === 'rate') return a.attempts ? `${pct(a.answered, a.attempts)}%` : '—';
      if (k === 'avgAttempts') return fin ? Math.round((a.finishedAttempts / fin) * 10) / 10 : '—';
      if (k === 'talk') return a.talked ? mmss(a.talkSec / a.talked) : '—';
      if (k === 'verified') return a.verified + a.unverified ? `${a.verified}/${a.verified + a.unverified}` : '—';
      if (k === 'firstLast') return `<span dir="ltr">${hm(a.firstAt)} – ${hm(a.lastAt)}</span>`;
      return a[k] ?? 0;
    };
    const warn = (a, k) => (k === 'late' && a.late) || (k === 'callbacksOverdue' && a.callbacksOverdue) || (k === 'rate' && a.attempts && pct(a.answered, a.attempts) < 40);
    const tile = (label, value, sub = '') => `<div class="tile"><div class="tl">${e(label)}</div><div class="tv">${e(value)}</div>${sub ? `<div class="ts">${e(sub)}</div>` : ''}</div>`;
    const totals = `<div class="tiles">${[
      tile(c('attempts'), total.attempts, t('callTasks.perf.agentsN', { n: agents.length })),
      tile(c('answered'), total.answered, `${pct(total.answered, total.attempts)}%`),
      tile(c('noAnswer'), total.noAnswer),
      tile(c('done'), total.done, t('callTasks.perf.failedN', { n: total.failed })),
      tile(c('pending'), total.pending, t('callTasks.perf.dueTodayN', { n: total.dueToday })),
      tile(c('late'), total.late),
      tile(c('callbacksOverdue'), total.callbacksOverdue, t('callTasks.perf.waitingN', { n: total.callbacksWaiting })),
      tile(c('verified'), `${pct(total.verified, total.verified + total.unverified)}%`),
    ].join('')}</div>`;
    const table = `<table><thead><tr>${cols.map((k) => `<th>${e(c(k))}</th>`).join('')}</tr></thead><tbody>${agents.map((a) => `<tr>${cols.map((k) => `<td class="${warn(a, k) ? 'bad' : ''}">${cell(a, k)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const perAgent = agents.map((a) => `
      <section class="agent"><h3>${e(a.name || '—')}</h3>
      ${a.days.length ? `<h4>${e(t('callTasks.perf.byDay'))}</h4><table><thead><tr>${['day', 'attempts', 'answered', 'noAnswer', 'done', 'firstLast'].map((k) => `<th>${e(c(k))}</th>`).join('')}</tr></thead><tbody>${a.days.map((d) => `<tr><td dir="ltr">${d.day}</td><td>${d.attempts}</td><td>${d.answered}</td><td>${d.noAnswer}</td><td>${d.done}</td><td dir="ltr">${hm(d.first)} – ${hm(d.last)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${a.campaigns.length ? `<h4>${e(t('callTasks.perf.byCampaign'))}</h4><table><thead><tr>${['campaign', 'attempts', 'done', 'pending', 'late'].map((k) => `<th>${e(c(k))}</th>`).join('')}</tr></thead><tbody>${a.campaigns.map((x) => `<tr><td>${e(x.title)}</td><td>${x.attempts}</td><td>${x.done}</td><td>${x.pending}</td><td class="${x.late ? 'bad' : ''}">${x.late}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(a.notes || []).length ? `<h4>${e(t('callTasks.perf.notesTitle', { n: a.notes.length }))}</h4><table><tbody>${a.notes.map((n) => `<tr><td dir="ltr">${e(n.no)}</td><td>${e(n.studentName)}</td><td>${e(n.campaign)}</td><td dir="ltr">${n.at ? format(new Date(n.at), 'yyyy-MM-dd HH:mm') : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      ${a.lateList.length + a.overdueList.length ? `<h4>${e(t('callTasks.perf.followUp', { late: a.late, overdue: a.callbacksOverdue }))}</h4><table><tbody>${[...a.overdueList.map((x) => ['overdue', x]), ...a.lateList.map((x) => ['late', x])].map(([k, x]) => `<tr><td class="bad">${e(t(`callTasks.perf.kind.${k}`))}</td><td>${e(x.studentName)}</td><td dir="ltr">${e(x.phone)}</td><td>${e(x.campaign)}</td><td dir="ltr">${x.dueAt ? format(new Date(x.dueAt), 'yyyy-MM-dd HH:mm') : x.dueDay}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>`).join('');
    printPage({
      title: t('callTasks.perf.reportTitle'),
      subtitle: `${range[0] === range[1] ? range[0] : `${range[0]} — ${range[1]}`} · ${campaign ? campaign.title : t('callTasks.perf.allCampaigns')}`,
      school: t('trips.print.school'), dir: i18n.dir(), lang: i18n.language, landscape: true,
      body: `${totals}${table}${perAgent}<p class="note">${e(t('callTasks.perf.notes'))}</p>`,
      css: `.tiles { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 10px } .tile { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px } .tl { color: #64748b; font-size: 8pt } .tv { font-size: 15pt; font-weight: bold } .ts { color: #94a3b8; font-size: 7.5pt }
        table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 8px } th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: start } th { background: #f1f5f9 } td.bad { color: #be123c; font-weight: bold }
        .agent { break-inside: avoid-page; margin-top: 12px; border-top: 2px solid #0369a1; padding-top: 4px } h3 { margin: 4px 0; color: #0369a1; font-size: 12pt } h4 { margin: 6px 0 3px; font-size: 9.5pt; color: #334155 } .note { color: #64748b; font-size: 8pt; margin-top: 10px }`,
    });
  };

  const th = 'px-2 py-2 text-start font-medium whitespace-nowrap';
  const td = 'px-2 py-2 whitespace-nowrap tabular-nums';
  const sortTh = (k, label) => <th className={`${th} cursor-pointer select-none ${sort === k ? 'text-primary' : ''}`} onClick={() => setSort(k)}>{label}{sort === k ? ' ▾' : ''}</th>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {['today', 'yesterday', 'week', 'month', 'custom'].map((id) => (
            <button key={id} type="button" onClick={() => { setRangeId(id); if (id !== 'custom') setRange(preset(id, today)); }} className={`px-3 py-1.5 rounded-lg text-sm ${rangeId === id ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500'}`}>{t(`callTasks.perf.range.${id}`)}</button>
          ))}
        </div>
        {rangeId === 'custom' && (
          <>
            <label className="text-xs text-slate-500">{t('common.fromDate')}<input type="date" value={range[0]} max={range[1]} onChange={(e) => setRange([e.target.value, range[1]])} className={`${inputCls} mt-1`} /></label>
            <label className="text-xs text-slate-500">{t('common.toDate')}<input type="date" value={range[1]} min={range[0]} onChange={(e) => setRange([range[0], e.target.value])} className={`${inputCls} mt-1`} /></label>
          </>
        )}
        <label className="text-xs text-slate-500 min-w-56">{t('callTasks.perf.campaign')}
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">{t('callTasks.perf.allCampaigns')}</option>
            {(data?.campaigns || []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== 'ACTIVE' ? ` (${t(`callTasks.status.${c.status}`)})` : ''}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <button type="button" onClick={printReport} disabled={!data} className={btn.ghost}><Printer className="w-4 h-4" />{t('callTasks.perf.pdf')}</button>
        <button type="button" onClick={exportExcel} disabled={!data} className={btn.ghost}><FileDown className="w-4 h-4" />{t('platform.exportExcel')}</button>
      </div>

      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      {!data && !error ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Tile label={t('callTasks.perf.col.attempts')} value={total.attempts} sub={t('callTasks.perf.agentsN', { n: agents.length })} tone="text-slate-900" />
            <Tile label={t('callTasks.perf.col.answered')} value={total.answered} sub={`${pct(total.answered, total.attempts)}%`} tone="text-emerald-700" />
            <Tile label={t('callTasks.perf.col.noAnswer')} value={total.noAnswer} sub={`${pct(total.noAnswer, total.attempts)}%`} tone="text-amber-700" />
            <Tile label={t('callTasks.perf.col.done')} value={total.done} sub={t('callTasks.perf.failedN', { n: total.failed })} tone="text-sky-700" />
            <Tile label={t('callTasks.perf.col.pending')} value={total.pending} sub={t('callTasks.perf.dueTodayN', { n: total.dueToday })} tone="text-slate-900" />
            <Tile label={t('callTasks.perf.col.late')} value={total.late} tone={total.late ? 'text-rose-700' : 'text-slate-900'} />
            <Tile label={t('callTasks.perf.col.callbacksOverdue')} value={total.callbacksOverdue} sub={t('callTasks.perf.waitingN', { n: total.callbacksWaiting })} tone={total.callbacksOverdue ? 'text-rose-700' : 'text-slate-900'} />
            <Tile label={t('callTasks.perf.col.verified')} value={`${pct(total.verified, total.verified + total.unverified)}%`} sub={t('callTasks.perf.verifiedSub', { v: total.verified, u: total.unverified })} tone="text-emerald-700" />
          </div>

          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className={th} />
                  <th className={th}>{t('callTasks.perf.col.agent')}</th>
                  {sortTh('attempts', t('callTasks.perf.col.attempts'))}
                  {sortTh('answered', t('callTasks.perf.col.answered'))}
                  {sortTh('rate', t('callTasks.perf.col.rate'))}
                  <th className={th}>{t('callTasks.perf.col.noAnswer')}</th>
                  <th className={th}>{t('callTasks.perf.col.callback')}</th>
                  <th className={th}>{t('callTasks.perf.col.wrong')}</th>
                  {sortTh('done', t('callTasks.perf.col.done'))}
                  <th className={th}>{t('callTasks.perf.col.failed')}</th>
                  <th className={th}>{t('callTasks.perf.col.avgAttempts')}</th>
                  <th className={th}>{t('callTasks.perf.col.talk')}</th>
                  <th className={th}>{t('callTasks.perf.col.verified')}</th>
                  <th className={th}>{t('callTasks.perf.col.whatsapp')}</th>
                  <th className={th}>{t('callTasks.perf.col.complaints')}</th>
                  {sortTh('pending', t('callTasks.perf.col.pending'))}
                  {sortTh('late', t('callTasks.perf.col.late'))}
                  {sortTh('callbacksOverdue', t('callTasks.perf.col.callbacksOverdue'))}
                  <th className={th}>{t('callTasks.perf.col.firstLast')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((a) => {
                  const isOpen = open === a.id;
                  const rate = pct(a.answered, a.attempts);
                  const fin = a.done + a.failed;
                  return (
                    <Fragment key={a.id}>
                      <tr className={`hover:bg-slate-50 cursor-pointer ${isOpen ? 'bg-primary/5' : ''}`} onClick={() => setOpen(isOpen ? '' : a.id)}>
                        <td className={td}><ChevronDown className={`w-4 h-4 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} /></td>
                        <td className={`${td} font-medium text-slate-900`}>{a.name || '—'}<span className="block text-[11px] text-slate-400 font-normal">{t('callTasks.perf.activeDaysN', { n: a.activeDays })}</span></td>
                        <td className={td}>{a.attempts}</td>
                        <td className={`${td} text-emerald-700`}>{a.answered}</td>
                        <td className={`${td} ${a.attempts && rate < 40 ? 'text-rose-700 font-bold' : ''}`}>{a.attempts ? `${rate}%` : '—'}</td>
                        <td className={`${td} text-amber-700`}>{a.noAnswer}</td>
                        <td className={td}>{a.callback}</td>
                        <td className={td}>{a.wrong}</td>
                        <td className={`${td} text-sky-700 font-medium`}>{a.done}</td>
                        <td className={td}>{a.failed}</td>
                        <td className={td}>{fin ? Math.round((a.finishedAttempts / fin) * 10) / 10 : '—'}</td>
                        <td className={td}>{a.talked ? mmss(a.talkSec / a.talked) : '—'}</td>
                        <td className={td}>{a.verified + a.unverified ? <span className={a.unverified > a.verified ? 'text-rose-700' : 'text-emerald-700'}>{a.verified}/{a.verified + a.unverified}</span> : '—'}</td>
                        <td className={td}>{a.whatsapp}</td>
                        <td className={td}>{a.complaints > 0 ? <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(a.id); setTimeout(() => document.getElementById('perf-notes')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }} className="text-primary font-medium underline decoration-dotted">{a.complaints}</button> : 0}</td>
                        <td className={td}>{a.pending}<span className="block text-[11px] text-slate-400">{t('callTasks.perf.todayN', { n: a.dueToday })}</span></td>
                        <td className={`${td} ${a.late ? 'text-rose-700 font-bold' : ''}`}>{a.late}{a.late > 0 && <span className="block text-[11px] font-normal">{t('callTasks.perf.oldestN', { n: a.oldestLateDays })}</span>}</td>
                        <td className={`${td} ${a.callbacksOverdue ? 'text-rose-700 font-bold' : ''}`}>{a.callbacksOverdue}<span className="block text-[11px] text-slate-400 font-normal">{t('callTasks.perf.waitingN', { n: a.callbacksWaiting })}</span></td>
                        <td className={`${td} text-xs`} dir="ltr">{hm(a.firstAt)} – {hm(a.lastAt)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!agents.length && <p className="py-10 text-center text-sm text-slate-400">{t('callTasks.perf.none')}</p>}
          </section>
          {agents.find((a) => a.id === open) && (
            <section className="bg-white rounded-2xl border border-primary/30 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-900">{agents.find((a) => a.id === open).name} — {t('callTasks.perf.details')}</p>
                <button type="button" onClick={() => setOpen('')} className="text-xs text-slate-500 hover:text-slate-800">✕</button>
              </div>
              <AgentDetails agent={agents.find((a) => a.id === open)} />
            </section>
          )}
          <p className="text-xs text-slate-500">{t('callTasks.perf.notes')}</p>
        </>
      )}
    </div>
  );
}

// One agent's drill-down: by day, by hour, by campaign, and the calls to
// follow up (late, overdue callbacks).
function AgentDetails({ agent: a }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const maxHour = Math.max(1, ...Object.values(a.hours || {}));
  const hours = Object.keys(a.hours || {}).map(Number).sort((x, y) => x - y);
  const box = 'bg-white rounded-xl border border-slate-100 p-3';
  const mini = 'w-full text-xs';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
      <div className={box}>
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Phone className="w-4 h-4 text-primary" />{t('callTasks.perf.byDay')}</p>
        {a.days.length ? (
          <table className={mini}>
            <thead className="text-slate-500"><tr>{['day', 'attempts', 'answered', 'noAnswer', 'done', 'firstLast'].map((k) => <th key={k} className="text-start py-1 px-1">{t(`callTasks.perf.col.${k}`)}</th>)}</tr></thead>
            <tbody>{a.days.map((d) => <tr key={d.day} className="border-t border-slate-50"><td className="py-1 px-1" dir="ltr">{d.day}</td><td className="px-1">{d.attempts}</td><td className="px-1 text-emerald-700">{d.answered}</td><td className="px-1 text-amber-700">{d.noAnswer}</td><td className="px-1">{d.done}</td><td className="px-1" dir="ltr">{hm(d.first)} – {hm(d.last)}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-xs text-slate-400">—</p>}
      </div>
      <div className={box}>
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Timer className="w-4 h-4 text-primary" />{t('callTasks.perf.byHour')}</p>
        {hours.length ? (
          <div className="space-y-1">
            {hours.map((h) => (
              <div key={h} className="flex items-center gap-2 text-xs">
                <span className="w-12 tabular-nums text-slate-500" dir="ltr">{String(h).padStart(2, '0')}:00</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${(a.hours[h] / maxHour) * 100}%` }} /></div>
                <span className="w-8 text-end tabular-nums">{a.hours[h]}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-400">—</p>}
      </div>
      <div className={box}>
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-primary" />{t('callTasks.perf.byCampaign')}</p>
        {a.campaigns.length ? (
          <table className={mini}>
            <thead className="text-slate-500"><tr>{['campaign', 'attempts', 'done', 'pending', 'late'].map((k) => <th key={k} className="text-start py-1 px-1">{t(`callTasks.perf.col.${k}`)}</th>)}</tr></thead>
            <tbody>{a.campaigns.map((c) => <tr key={c.id} className="border-t border-slate-50"><td className="py-1 px-1">{c.title || '—'}</td><td className="px-1">{c.attempts}</td><td className="px-1">{c.done}</td><td className="px-1">{c.pending}</td><td className={`px-1 ${c.late ? 'text-rose-700 font-bold' : ''}`}>{c.late}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-xs text-slate-400">—</p>}
        <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />{t('callTasks.perf.verifyLine', { v: a.verified, u: a.unverified, p: a.verifyPending })}</p>
      </div>
      <div className={box}>
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-rose-600" />{t('callTasks.perf.followUp', { late: a.late, overdue: a.callbacksOverdue })}</p>
        {a.lateList.length + a.overdueList.length ? (
          <ul className="divide-y divide-slate-50 text-xs max-h-64 overflow-y-auto">
            {[...a.overdueList.map((x) => ({ k: 'overdue', x })), ...a.lateList.map((x) => ({ k: 'late', x }))].map(({ k, x }) => (
              <li key={`${k}-${x.id}`} className="py-1.5 flex flex-wrap items-center gap-x-2">
                <span className={`px-1.5 rounded border ${k === 'late' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{k === 'late' ? <AlertTriangle className="w-3 h-3 inline" /> : <Clock className="w-3 h-3 inline" />} {t(`callTasks.perf.kind.${k}`)}</span>
                <b className="text-slate-800">{x.studentName}</b>
                <span className="text-slate-500" dir="ltr">{x.phone}</span>
                <span className="text-slate-400">{x.campaign}</span>
                <span className="text-slate-500 ms-auto" dir="ltr">{x.dueAt ? format(new Date(x.dueAt), 'MM-dd HH:mm') : x.dueDay}</span>
                {x.attempts > 0 && <span className="text-slate-400"><PhoneMissed className="w-3 h-3 inline" /> {x.attempts}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-emerald-700">{t('callTasks.perf.nothingLate')}</p>}
      </div>
      <div id="perf-notes" className={`${box} lg:col-span-2`}>
        <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><FileText className="w-4 h-4 text-primary" />{t('callTasks.perf.notesTitle', { n: (a.notes || []).length })}</p>
        {(a.notes || []).length ? (
          <ul className="divide-y divide-slate-50 text-xs">
            {a.notes.map((n, i) => (
              <li key={`${n.id}-${i}`} className="py-1.5 flex flex-wrap items-center gap-x-2">
                {n.id
                  ? <button type="button" onClick={() => navigate(notePath(n))} className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1" dir="ltr"><ExternalLink className="w-3 h-3" />{n.no || n.id}</button>
                  : <span className="font-mono text-slate-500" dir="ltr">{n.no}</span>}
                {n.finance && <span className="px-1.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">{t('callTasks.perf.financeNote')}</span>}
                <b className="text-slate-800">{n.studentName}</b>
                <span className="text-slate-500" dir="ltr">{n.phone}</span>
                <span className="text-slate-400">{n.campaign}</span>
                <span className="text-slate-500 ms-auto" dir="ltr">{n.at ? format(new Date(n.at), 'yyyy-MM-dd HH:mm') : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-400">—</p>}
      </div>
    </div>
  );
}
