import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Loader2, FileDown, Printer, Users as UsersIcon, MousePointerClick, Clock, Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import { functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { ROLE_LABELS } from '../../config/roles';
import { printPage, escapeHtml } from '../../utils/printPage';

const MODULES = ['complaints', 'techSupport', 'lostFound', 'trips', 'visits', 'platform', 'other'];
const ACTION_LABELS = { complaints: 'actions.complaint', visits: 'actions.complaint', techSupport: 'actions.techSupport', lostFound: 'actions.lostFound', trips: 'trips.log', platform: 'platform.leads.activityTypes' };
const inputCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const daysAgo = (n) => riyadhDay(new Date(Date.now() - n * 86400e3));
const PRESETS = {
  today: () => ({ from: riyadhDay(), to: riyadhDay() }),
  week: () => ({ from: daysAgo(6), to: riyadhDay() }),
  month: () => ({ from: `${riyadhDay().slice(0, 8)}01`, to: riyadhDay() }),
  days30: () => ({ from: daysAgo(29), to: riyadhDay() }),
};

// «نشاط المستخدمين» › التقرير: what each user did in a period — actions per
// section (from the records' logs), active days and time on the system.
export default function ActivityReport() {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(PRESETS.week);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!range.from || !range.to || range.to < range.from) return;
    let live = true;
    setLoading(true);
    setError(null);
    httpsCallable(functions, 'getUserActivityReport')(range)
      .then(({ data: d }) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range]);

  const branchLabel = (list) => (list.includes('*') ? t('common.allBranches') : list.map((id) => branches.find((b) => b.id === id)?.name || id).join('، ') || '—');
  const duration = (m) => (m ? t('activity.report.duration', { h: Math.floor(m / 60), m: m % 60 }) : '—');
  const moduleName = (m) => t(`activity.report.modules.${m}`);
  const actionName = (module, action) => (ACTION_LABELS[module] ? t(`${ACTION_LABELS[module]}.${action}`, action) : action);
  const when = (ms) => (ms ? format(ms, 'yyyy-MM-dd HH:mm') : '—');
  const pickPreset = (k) => { setPreset(k); setRange(PRESETS[k]()); };

  const inBranch = (u) => !branch || u.branches.includes('*') || u.branches.includes(branch);
  const all = useMemo(() => (data?.users || []).filter(inBranch).sort((a, b) => (b.actions - a.actions) || (b.minutes - a.minutes) || a.name.localeCompare(b.name)), [data, branch]);
  const isActive = (u) => u.actions > 0 || u.minutes > 0;
  const shown = all.filter((u) => filter === 'ALL' || (filter === 'ACTIVE' ? isActive(u) : !isActive(u) && u.active));
  const usedModules = MODULES.filter((m) => all.some((u) => u.modules[m]));
  const sum = (f) => all.reduce((a, u) => a + f(u), 0);
  const stats = {
    activeUsers: all.filter(isActive).length,
    staff: all.filter((u) => u.active).length,
    actions: sum((u) => u.actions),
    minutes: sum((u) => u.minutes),
    top: all[0]?.actions ? all[0] : null,
    modules: Object.fromEntries(MODULES.map((m) => [m, sum((u) => u.modules[m] || 0)])),
  };
  const maxModule = Math.max(1, ...Object.values(stats.modules));
  const daily = data?.daily || [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.actions));
  const subtitle = `${t('activity.report.period', { from: range.from, to: range.to })}${branch ? ` · ${branchLabel([branch])}` : ''}`;

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shown.map((u) => ({
      [t('activity.col.user')]: u.name || u.email, [t('activity.report.role')]: u.jobTitle || t(`roles.${u.role}`, ROLE_LABELS[u.role] || u.role), [t('activity.col.branches')]: branchLabel(u.branches),
      [t('activity.report.activeDays')]: u.activeDays, [t('activity.report.usage')]: duration(u.minutes), [t('activity.report.minutes')]: u.minutes,
      [t('activity.report.actions')]: u.actions, [t('activity.report.kinds.created')]: u.kinds.created, [t('activity.report.kinds.updates')]: u.kinds.updates, [t('activity.report.kinds.comments')]: u.kinds.comments,
      ...Object.fromEntries(usedModules.map((m) => [moduleName(m), u.modules[m] || 0])),
      [t('activity.report.lastAction')]: when(u.lastActionAt),
    }))), 'Users');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily.map((d) => ({
      [t('common.date')]: d.day, [t('activity.report.actions')]: d.actions, [t('activity.report.activeUsers')]: d.users, [t('activity.report.usage')]: duration(d.minutes),
    }))), 'Daily');
    XLSX.writeFile(wb, `user-activity-${range.from}_${range.to}.xlsx`);
  };

  const print = () => {
    const card = (label, value, sub = '') => `<div class="card"><div class="l">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ''}</div>`;
    const head = [t('activity.col.user'), t('activity.col.branches'), t('activity.report.activeDays'), t('activity.report.usage'), t('activity.report.actions'),
      t('activity.report.kinds.created'), t('activity.report.kinds.updates'), t('activity.report.kinds.comments'), ...usedModules.map(moduleName), t('activity.report.lastAction')];
    const row = (u) => `<tr class="${isActive(u) ? '' : 'idle'}"><td><b>${escapeHtml(u.name || u.email)}</b><div class="s">${escapeHtml(u.jobTitle || t(`roles.${u.role}`, ROLE_LABELS[u.role] || u.role))}</div></td>
      <td>${escapeHtml(branchLabel(u.branches))}</td><td>${u.activeDays}</td><td>${escapeHtml(duration(u.minutes))}</td><td><b>${u.actions}</b></td><td>${u.kinds.created}</td><td>${u.kinds.updates}</td><td>${u.kinds.comments}</td>
      ${usedModules.map((m) => `<td>${u.modules[m] || ''}</td>`).join('')}<td>${escapeHtml(when(u.lastActionAt))}</td></tr>`;
    printPage({
      title: t('activity.report.title'),
      subtitle: `${subtitle} · ${t('activity.report.count', { count: shown.length })}`,
      school: t('trips.print.school'),
      landscape: true,
      dir: i18n.dir(),
      lang: i18n.language,
      body: `<div class="cards">${card(t('activity.report.activeUsers'), `${stats.activeUsers} / ${stats.staff}`)}${card(t('activity.report.actions'), String(stats.actions))}${card(t('activity.report.usage'), duration(stats.minutes))}${card(t('activity.report.mostActive'), stats.top ? stats.top.name : '—', stats.top ? t('activity.report.actionsCount', { count: stats.top.actions }) : '')}</div>
<h3>${escapeHtml(t('activity.report.bySection'))}</h3><table class="narrow"><tbody>${MODULES.filter((m) => stats.modules[m]).map((m) => `<tr><td>${escapeHtml(moduleName(m))}</td><td><b>${stats.modules[m]}</b></td></tr>`).join('') || '<tr><td>—</td></tr>'}</tbody></table>
<h3>${escapeHtml(t('activity.report.byUser'))}</h3><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(row).join('')}</tbody></table>
<p class="s">${escapeHtml(t('activity.report.note'))}</p>`,
      css: `.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px } .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #f8fafc }
  .card .l { font-size: 8.5pt; color: #64748b } .card .v { font-size: 15pt; font-weight: bold; margin-top: 2px } .s { font-size: 8pt; color: #64748b }
  h3 { color: #0369a1; font-size: 11pt; margin: 12px 0 5px } table { width: 100%; border-collapse: collapse; font-size: 8.5pt } table.narrow { width: 50% }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: start; vertical-align: top } th { background: #f1f5f9 } thead { display: table-header-group }
  tr { break-inside: avoid } tr.idle td { color: #94a3b8 }`,
    });
  };

  const th = 'px-3 py-2 text-start font-medium whitespace-nowrap';
  const td = 'px-3 py-2 whitespace-nowrap';
  const statCard = (label, value, Icon, cls, sub) => (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
      <p className="text-xs text-slate-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-xl font-bold mt-1 truncate ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
  const chip = (k, label, active, onClick) => <button key={k} onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1">{Object.keys(PRESETS).map((k) => chip(k, t(`activity.report.presets.${k}`), preset === k, () => pickPreset(k)))}</div>
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.fromDate')}</label><input type="date" value={range.from} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, from: e.target.value })); }} className={inputCls} /></div>
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.toDate')}</label><input type="date" value={range.to} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, to: e.target.value })); }} className={inputCls} /></div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t('activity.col.branches')}</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>
            <option value="">{t('common.allBranches')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={!shown.length} className="px-3 py-2 rounded-xl text-sm border border-emerald-300 text-emerald-700 bg-white flex items-center gap-1.5 disabled:opacity-50"><FileDown className="w-4 h-4" />{t('activity.report.excel')}</button>
        <button onClick={print} disabled={!shown.length} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" />{t('activity.report.print')}</button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}
      {!data && !error ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : data && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {statCard(t('activity.report.activeUsers'), `${stats.activeUsers} / ${stats.staff}`, UsersIcon, 'text-slate-800')}
            {statCard(t('activity.report.actions'), String(stats.actions), MousePointerClick, 'text-sky-700', stats.activeUsers ? t('activity.report.avgPerUser', { n: Math.round(stats.actions / stats.activeUsers) }) : '')}
            {statCard(t('activity.report.usage'), duration(stats.minutes), Clock, 'text-indigo-700')}
            {statCard(t('activity.report.mostActive'), stats.top ? stats.top.name : '—', Trophy, 'text-amber-700', stats.top ? t('activity.report.actionsCount', { count: stats.top.actions }) : '')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h3 className="font-bold text-slate-800 mb-3">{t('activity.report.bySection')}</h3>
              <div className="space-y-2">
                {MODULES.filter((m) => stats.modules[m]).map((m) => (
                  <div key={m} className="flex items-center gap-2 text-sm">
                    <span className="w-36 truncate text-slate-700">{moduleName(m)}</span>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-sky-500" style={{ width: `${(stats.modules[m] / maxModule) * 100}%` }} /></div>
                    <span className="w-12 text-end tabular-nums font-medium">{stats.modules[m]}</span>
                  </div>
                ))}
                {!stats.actions && <p className="text-sm text-slate-400 text-center py-4">{t('activity.report.noActions')}</p>}
              </div>
            </section>
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h3 className="font-bold text-slate-800 mb-3">{t('activity.report.daily')}</h3>
              {daily.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">{t('activity.report.noActions')}</p> : (
                <div className="flex items-end gap-1 h-40 overflow-x-auto" dir="ltr">
                  {daily.map((d) => (
                    <div key={d.day} className="flex flex-col items-center justify-end h-full min-w-[22px] flex-1" title={`${d.day}: ${t('activity.report.actionsCount', { count: d.actions })} · ${t('activity.report.usersCount', { count: d.users })}`}>
                      <span className="text-[10px] text-slate-500 tabular-nums">{d.actions || ''}</span>
                      <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${(d.actions / maxDaily) * 100}%`, minHeight: d.actions ? 2 : 0 }} />
                      <span className="text-[9px] text-slate-400 mt-0.5">{d.day.slice(8)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-800 me-2">{t('activity.report.byUser')}</h3>
              {['ALL', 'ACTIVE', 'NONE'].map((k) => chip(k, t(`activity.report.filters.${k}`), filter === k, () => setFilter(k)))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className={th}>{t('activity.col.user')}</th><th className={th}>{t('activity.col.branches')}</th><th className={th}>{t('activity.report.activeDays')}</th>
                    <th className={th}>{t('activity.report.usage')}</th><th className={th}>{t('activity.report.actions')}</th>
                    <th className={th}>{t('activity.report.kinds.created')}</th><th className={th}>{t('activity.report.kinds.updates')}</th><th className={th}>{t('activity.report.kinds.comments')}</th>
                    {usedModules.map((m) => <th key={m} className={th}>{moduleName(m)}</th>)}
                    <th className={th}>{t('activity.report.lastAction')}</th><th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((u) => [
                    <tr key={u.id} className={isActive(u) ? '' : 'text-slate-400'}>
                      <td className={td}><p className={`font-medium ${isActive(u) ? 'text-slate-900' : ''}`}>{u.name || u.email}</p><p className="text-xs text-slate-500">{u.jobTitle || t(`roles.${u.role}`, ROLE_LABELS[u.role] || u.role)}{!u.active ? ` · ${t('activity.inactive')}` : ''}</p></td>
                      <td className={`${td} text-xs max-w-48 truncate`}>{branchLabel(u.branches)}</td>
                      <td className={td}>{u.activeDays || '—'}</td>
                      <td className={td}>{duration(u.minutes)}</td>
                      <td className={`${td} font-bold ${u.actions ? 'text-sky-700' : ''}`}>{u.actions}</td>
                      <td className={td}>{u.kinds.created || ''}</td><td className={td}>{u.kinds.updates || ''}</td><td className={td}>{u.kinds.comments || ''}</td>
                      {usedModules.map((m) => <td key={m} className={td}>{u.modules[m] || ''}</td>)}
                      <td className={`${td} text-xs`}>{when(u.lastActionAt)}</td>
                      <td className={td}>{u.topActions.length > 0 && <button onClick={() => setOpen(open === u.id ? null : u.id)} className="p-1 text-slate-400 hover:text-primary" title={t('activity.report.details')}>{open === u.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>}</td>
                    </tr>,
                    open === u.id && (
                      <tr key={`${u.id}-x`} className="bg-slate-50/60">
                        <td colSpan={10 + usedModules.length} className="px-4 py-3">
                          <p className="text-xs text-slate-500 mb-2">{t('activity.report.topActions')}</p>
                          <div className="flex flex-wrap gap-2">
                            {u.topActions.map((a) => <span key={`${a.module}:${a.action}`} className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs">{moduleName(a.module)} · {actionName(a.module, a.action)} <b className="text-sky-700">{a.count}</b></span>)}
                          </div>
                        </td>
                      </tr>
                    ),
                  ])}
                </tbody>
              </table>
              {shown.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{t('activity.empty')}</p>}
            </div>
          </section>
          <p className="text-xs text-slate-400">{t('activity.report.note')}</p>
        </div>
      )}
    </div>
  );
}
