import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, UserX, AlarmClock, Siren, CheckCircle2, Timer, Star, Printer, Coins, FileDown, CalendarCheck } from 'lucide-react';
import { Tile, inputCls, btn } from '../platform/ui';
import { MNT_CATEGORIES, MNT_OPEN, CATEGORY_ICON, isOverdue } from '../../config/maintenance';
import { printPage, escapeHtml as e } from '../../utils/printPage';
import { exportXlsx } from '../../utils/exportXlsx';
import { fmtDateTime } from '../../config/maintenance';

// A filter drop-down sized to its content.
const selCls = `${inputCls.replace('w-full ', '')} w-auto`;

const PERIODS = [30, 90, 365];
const hours = (a, b) => (a && b && b > a ? (b - a) / 3600e3 : null);
const avg = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : null);
const fmtH = (h) => (h == null ? '—' : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);

// The follow-up board: what is open (unassigned, late, urgent), what got
// done in the period and how fast, by branch, category, place and technician.
export default function MntDashboard({ tickets, branchName, onFilter, now }) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30);
  const [branch, setBranch] = useState('');
  const branches = useMemo(() => [...new Set(tickets.map((x) => x.branch))], [tickets]);
  const s = useMemo(() => {
    const scoped = tickets.filter((x) => !branch || x.branch === branch);
    const since = now - days * 86400e3;
    const period = scoped.filter((x) => x.createdAt >= since && x.status !== 'CANCELLED');
    const open = scoped.filter((x) => MNT_OPEN.includes(x.status));
    const done = scoped.filter((x) => x.doneAt >= since);
    const group = (list, key) => {
      const m = new Map();
      list.forEach((x) => { const k = key(x); if (!k) return; m.set(k, [...(m.get(k) || []), x]); });
      return m;
    };
    const line = (list) => ({
      total: list.length, open: list.filter((x) => MNT_OPEN.includes(x.status)).length, late: list.filter((x) => isOverdue(x, now)).length,
      done: list.filter((x) => x.doneAt >= since).length, avgH: avg(list.filter((x) => x.doneAt >= since).map((x) => hours(x.createdAt, x.doneAt)).filter((h) => h != null)),
    });
    const rated = period.filter((x) => x.rating > 0);
    const costed = scoped.filter((x) => x.cost?.total > 0 && Math.max(x.doneAt || 0, x.cost.at || 0) >= since);
    const sumBy = (key) => { const m = new Map(); costed.forEach((x) => { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + x.cost.total); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const pm = scoped.filter((x) => x.source === 'PM' && x.createdAt >= since);
    return {
      open: open.length, unassigned: open.filter((x) => x.status === 'NEW').length, late: open.filter((x) => isOverdue(x, now)).length,
      urgent: open.filter((x) => x.priority === 'URGENT').length, done: done.length, created: period.length,
      avgH: avg(done.map((x) => hours(x.createdAt, x.doneAt)).filter((h) => h != null)),
      onTime: done.length ? Math.round((done.filter((x) => !x.dueAt || x.doneAt <= x.dueAt).length / done.length) * 100) : null,
      cost: costed.reduce((n, x) => n + x.cost.total, 0), costByBranch: sumBy((x) => x.branch), costByCat: sumBy((x) => x.category), costByAsset: sumBy((x) => x.assetName).slice(0, 10),
      pmTotal: pm.length, pmDone: pm.filter((x) => ['DONE', 'CLOSED'].includes(x.status)).length, pmLate: pm.filter((x) => isOverdue(x, now)).length,
      byAsset: [...group(period.filter((x) => x.source !== 'PM'), (x) => x.assetName)].map(([k, l]) => ({ k, n: l.length })).sort((a, b) => b.n - a.n).slice(0, 10),
      scoped,
      rating: rated.length ? (rated.reduce((n, x) => n + x.rating, 0) / rated.length).toFixed(1) : null, ratedN: rated.length,
      byBranch: [...group([...period, ...open.filter((x) => x.createdAt < since)], (x) => x.branch)].map(([k, l]) => ({ k, ...line(l) })).sort((a, b) => b.open - a.open || b.total - a.total),
      byCat: MNT_CATEGORIES.map((c) => ({ k: c, ...line(period.filter((x) => x.category === c)) })).filter((r) => r.total),
      byPlace: [...group(period, (x) => (x.place ? `${x.branch}|${x.place}` : ''))].map(([k, l]) => ({ k, n: l.length })).sort((a, b) => b.n - a.n).slice(0, 10),
      byTech: [...group([...period, ...open.filter((x) => x.createdAt < since)], (x) => x.techName)].map(([k, l]) => ({ k, ...line(l) })).sort((a, b) => b.open - a.open || b.done - a.done),
    };
  }, [tickets, days, branch, now]);
  const maxCat = Math.max(1, ...s.byCat.map((r) => r.total));

  const print = () => {
    const table = (head, rows) => `<table style="width:100%;border-collapse:collapse;margin-bottom:12px">${`<tr>${head.map((h) => `<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:4px">${e(h)}</th>`).join('')}</tr>`}${rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:4px">${e(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    const head = [t('mnt.dash.name'), t('mnt.dash.total'), t('mnt.dash.open'), t('mnt.dash.late'), t('mnt.dash.done'), t('mnt.dash.avgTime')];
    const body = `
<p>${e(t('mnt.dash.created'))}: ${s.created} · ${e(t('mnt.dash.done'))}: ${s.done} · ${e(t('mnt.dash.open'))}: ${s.open} · ${e(t('mnt.dash.late'))}: ${s.late} · ${e(t('mnt.dash.avgTime'))}: <span dir="ltr">${fmtH(s.avgH)}</span> · ${e(t('mnt.dash.onTime'))}: ${s.onTime ?? '—'}%${s.rating ? ` · ${e(t('mnt.dash.rating'))}: ${s.rating}/5` : ''}</p>
<h3>${e(t('mnt.dash.byBranch'))}</h3>${table(head, s.byBranch.map((r) => [branchName(r.k), r.total, r.open, r.late, r.done, fmtH(r.avgH)]))}
<h3>${e(t('mnt.dash.byCategory'))}</h3>${table(head, s.byCat.map((r) => [t(`mnt.categories.${r.k}`), r.total, r.open, r.late, r.done, fmtH(r.avgH)]))}
<h3>${e(t('mnt.dash.byTech'))}</h3>${table(head, s.byTech.map((r) => [r.k, r.total, r.open, r.late, r.done, fmtH(r.avgH)]))}
<h3>${e(t('mnt.dash.topPlaces'))}</h3>${table([t('mnt.place'), t('mnt.dash.total')], s.byPlace.map((r) => { const [b, p] = r.k.split('|'); return [`${branchName(b)} — ${p}`, r.n]; }))}`;
    printPage({ title: t('mnt.dash.reportTitle'), subtitle: `${t('mnt.dash.lastDays', { n: days })}${branch ? ` · ${branchName(branch)}` : ''}`, school: t('trips.print.school'), body, dir: i18n.dir(), lang: i18n.language });
  };

  // Every work order of the period (and the open ones), for Excel.
  const toExcel = () => {
    const since = now - days * 86400e3;
    const rows = s.scoped.filter((x) => x.createdAt >= since || MNT_OPEN.includes(x.status));
    exportXlsx(`maintenance-${days}d.xlsx`, t('mnt.title'),
      [t('mnt.number'), t('mnt.branch'), t('mnt.place'), t('mnt.assets.one'), t('mnt.category'), t('mnt.priority'), t('mnt.titleField'), t('mnt.statusLabel'), t('mnt.dash.source'), t('mnt.reporter'), t('mnt.assignee'), t('mnt.createdAt'), t('mnt.dueAt'), t('mnt.doneAt'), t('mnt.dash.hours'), t('mnt.overdue'), t('mnt.costs.title'), t('mnt.rating')],
      rows.map((x) => [x.number, branchName(x.branch), x.place, x.assetName, t(`mnt.categories.${x.category}`), t(`mnt.priorities.${x.priority}`), x.title, t(`mnt.status.${x.status}`), t(`mnt.sources.${x.source}`), x.reporterName, x.techName,
        fmtDateTime(x.createdAt), fmtDateTime(x.dueAt), fmtDateTime(x.doneAt), x.doneAt ? Math.round(hours(x.createdAt, x.doneAt) * 10) / 10 : '', isOverdue(x, now) || (x.doneAt && x.dueAt && x.doneAt > x.dueAt) ? '✓' : '', x.cost?.total || '', x.rating || '']));
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={days} onChange={(ev) => setDays(Number(ev.target.value))} className={selCls}>{PERIODS.map((d) => <option key={d} value={d}>{t('mnt.dash.lastDays', { n: d })}</option>)}</select>
        {branches.length > 1 && <select value={branch} onChange={(ev) => setBranch(ev.target.value)} className={selCls}><option value="">{t('common.allBranches')}</option>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <button type="button" onClick={print} className={btn.ghost}><Printer className="w-4 h-4" />{t('mnt.dash.print')}</button>
        <button type="button" onClick={toExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('mnt.excel')}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Inbox} label={t('mnt.dash.open')} value={s.open} onClick={() => onFilter({ status: 'OPEN', branch })} />
        <Tile icon={UserX} label={t('mnt.dash.unassigned')} value={s.unassigned} tone={s.unassigned ? 'text-sky-700' : undefined} onClick={() => onFilter({ status: 'NEW', branch })} />
        <Tile icon={AlarmClock} label={t('mnt.dash.late')} value={s.late} tone={s.late ? 'text-rose-700' : undefined} onClick={() => onFilter({ status: 'LATE', branch })} />
        <Tile icon={Siren} label={t('mnt.dash.urgent')} value={s.urgent} tone={s.urgent ? 'text-rose-700' : undefined} onClick={() => onFilter({ status: 'OPEN', priority: 'URGENT', branch })} />
        <Tile icon={CheckCircle2} label={t('mnt.dash.done')} value={s.done} sub={t('mnt.dash.ofCreated', { n: s.created })} tone="text-emerald-700" />
        <Tile icon={Timer} label={t('mnt.dash.avgTime')} value={<span dir="ltr">{fmtH(s.avgH)}</span>} />
        <Tile icon={AlarmClock} label={t('mnt.dash.onTime')} value={s.onTime == null ? '—' : `${s.onTime}%`} />
        <Tile icon={Star} label={t('mnt.dash.rating')} value={s.rating ? `${s.rating}/5` : '—'} sub={s.ratedN ? t('mnt.dash.ratedN', { n: s.ratedN }) : ''} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Coins} label={t('mnt.dash.cost')} value={<span dir="ltr">{s.cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>} sub={t('proc.sar')} />
        <Tile icon={CalendarCheck} label={t('mnt.dash.pm')} value={`${s.pmDone}/${s.pmTotal}`} sub={s.pmLate ? t('mnt.dash.pmLate', { n: s.pmLate }) : ''} tone={s.pmLate ? 'text-rose-700' : undefined} />
      </div>
      {s.cost > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <MoneyList title={t('mnt.dash.costByBranch')} rows={s.costByBranch.map(([k, v]) => [branchName(k), v])} />
          <MoneyList title={t('mnt.dash.costByCategory')} rows={s.costByCat.map(([k, v]) => [t(`mnt.categories.${k}`), v])} />
          <MoneyList title={t('mnt.dash.costByAsset')} rows={s.costByAsset} />
        </div>
      )}
      <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-3">{t('mnt.dash.byCategory')}</p>
        {!s.byCat.length ? <p className="text-sm text-slate-400">{t('mnt.dash.none')}</p> : (
          <div className="space-y-2">
            {s.byCat.map((r) => (
              <button key={r.k} type="button" onClick={() => onFilter({ category: r.k, branch })} className="w-full flex items-center gap-3 text-sm text-start">
                <span className="w-28 shrink-0">{CATEGORY_ICON[r.k]} {t(`mnt.categories.${r.k}`)}</span>
                <span className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><span className="block h-full bg-primary/70 rounded-full" style={{ width: `${(r.total / maxCat) * 100}%` }} /></span>
                <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">{r.total} · {t('mnt.dash.open')} {r.open}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Table title={t('mnt.dash.byBranch')} rows={s.byBranch} name={branchName} />
        <Table title={t('mnt.dash.byTech')} rows={s.byTech} name={(k) => k} />
      </div>
      {s.byAsset.length > 0 && (
        <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
          <p className="font-bold text-slate-800 mb-2">{t('mnt.dash.topAssets')}</p>
          <ol className="text-sm space-y-1">{s.byAsset.map((r) => <li key={r.k} className="flex justify-between gap-2"><span>{r.k}</span><span className="tabular-nums font-bold">{r.n}</span></li>)}</ol>
        </section>
      )}
      <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-2">{t('mnt.dash.topPlaces')}</p>
        {!s.byPlace.length ? <p className="text-sm text-slate-400">{t('mnt.dash.none')}</p> : (
          <ol className="text-sm space-y-1">{s.byPlace.map((r) => { const [b, p] = r.k.split('|'); return <li key={r.k} className="flex justify-between gap-2"><span>{p} <span className="text-xs text-slate-400">{branchName(b)}</span></span><span className="tabular-nums font-bold">{r.n}</span></li>; })}</ol>
        )}
      </section>
    </div>
  );
}

function Table({ title, rows, name }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 overflow-x-auto">
      <p className="font-bold text-slate-800 mb-2">{title}</p>
      {!rows.length ? <p className="text-sm text-slate-400">{t('mnt.dash.none')}</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 text-start">{['name', 'total', 'open', 'late', 'done', 'avgTime'].map((h) => <th key={h} className="py-1 text-start font-medium">{t(`mnt.dash.${h}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.k} className="border-t border-slate-100">
              <td className="py-1.5">{name(r.k)}</td><td className="tabular-nums">{r.total}</td><td className="tabular-nums">{r.open}</td>
              <td className={`tabular-nums ${r.late ? 'text-rose-700 font-bold' : ''}`}>{r.late}</td><td className="tabular-nums">{r.done}</td><td dir="ltr" className="text-start">{fmtH(r.avgH)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

function MoneyList({ title, rows }) {
  const max = Math.max(1, ...rows.map((x) => x[1]));
  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
      <p className="font-bold text-slate-800 mb-2">{title}</p>
      {rows.slice(0, 10).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-sm py-0.5">
          <span className="w-32 shrink-0 truncate">{k}</span>
          <span className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><span className="block h-full bg-amber-500/70" style={{ width: `${(v / max) * 100}%` }} /></span>
          <span className="w-20 shrink-0 text-xs tabular-nums text-end" dir="ltr">{Math.round(v).toLocaleString('en-US')}</span>
        </div>
      ))}
    </section>
  );
}
