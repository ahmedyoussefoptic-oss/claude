import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, Hourglass, ShoppingCart, Truck, Receipt, Wallet, Timer, Printer } from 'lucide-react';
import { Tile, Pill, inputCls, btn } from '../platform/ui';
import { money, PROC_STATUS_STYLE } from '../../config/procurement';
import { printPage, escapeHtml as e } from '../../utils/printPage';

const selCls = `${inputCls.replace('w-full ', '')} w-auto`;
const PERIODS = [30, 90, 365];
const days = (a, b) => (a && b && b > a ? (b - a) / 86400e3 : null);
const avg = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
const fmtD = (d) => (d == null ? '—' : `${d.toFixed(1)}d`);

// What waits for the viewer (an approval, an order to issue, a delivery to
// receive, an invoice, a payment), then the spending of the period by
// branch, category and supplier, and how long each stage takes.
export default function ProcDashboard({ requests, now, branchName, onOpen, onFilter }) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState(90);
  const mine = requests.filter((r) => r.can.approve || r.can.edit || r.can.order || r.can.receive || r.can.invoice || r.can.pay);
  const whyMine = (r) => (r.can.approve ? 'approve' : r.can.edit ? 'edit' : r.can.order ? 'order' : r.can.receive ? 'receive' : r.can.invoice ? 'invoice' : 'pay');
  const s = useMemo(() => {
    const since = now - period * 86400e3;
    const ordered = requests.filter((r) => r.po && r.orderedAt >= since && r.status !== 'CANCELLED');
    const group = (key) => {
      const m = new Map();
      ordered.forEach((r) => { const k = key(r); m.set(k, (m.get(k) || 0) + r.po.total); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const pendingBy = ['BRANCH', 'FINANCE', 'EXEC'].map((role) => {
      const l = requests.filter((r) => r.status === 'PENDING_APPROVAL' && r.steps[r.stepIdx]?.role === role);
      return { role, n: l.length, oldest: l.length ? Math.max(...l.map((r) => days(Math.max(r.submittedAt, ...r.steps.map((x) => x.at || 0)), now) || 0)) : 0 };
    });
    return {
      pending: requests.filter((r) => r.status === 'PENDING_APPROVAL').length,
      toOrder: requests.filter((r) => r.status === 'APPROVED').length,
      incoming: requests.filter((r) => ['ORDERED', 'PARTIAL'].includes(r.status)).length,
      toInvoice: requests.filter((r) => r.status === 'RECEIVED').length,
      toPay: requests.filter((r) => r.status === 'INVOICED').length,
      spent: ordered.reduce((n, r) => n + r.po.total, 0),
      approveDays: avg(requests.filter((r) => r.approvedAt >= since).map((r) => days(r.submittedAt, r.approvedAt)).filter((x) => x != null)),
      orderDays: avg(requests.filter((r) => r.orderedAt >= since).map((r) => days(r.approvedAt, r.orderedAt)).filter((x) => x != null)),
      deliverDays: avg(requests.filter((r) => r.receivedAt >= since).map((r) => days(r.orderedAt, r.receivedAt)).filter((x) => x != null)),
      byBranch: group((r) => branchName(r.branch)), byCat: group((r) => t(`proc.categories.${r.category}`)), bySupplier: group((r) => r.po.supplierName), pendingBy,
    };
  }, [requests, period, now, branchName, t]);

  const print = () => {
    const tbl = (title, rows) => `<h3>${e(title)}</h3><table style="width:100%;border-collapse:collapse;margin-bottom:10px">${rows.map(([k, v]) => `<tr><td style="border:1px solid #cbd5e1;padding:4px">${e(k)}</td><td style="border:1px solid #cbd5e1;padding:4px;direction:ltr;text-align:end">${money(v)}</td></tr>`).join('')}</table>`;
    const body = `<p>${e(t('proc.dash.spent'))}: <b dir="ltr">${money(s.spent)}</b> ${e(t('proc.sar'))} · ${e(t('proc.dash.approveDays'))}: ${fmtD(s.approveDays)} · ${e(t('proc.dash.orderDays'))}: ${fmtD(s.orderDays)} · ${e(t('proc.dash.deliverDays'))}: ${fmtD(s.deliverDays)}</p>
${tbl(t('proc.dash.byBranch'), s.byBranch)}${tbl(t('proc.dash.byCategory'), s.byCat)}${tbl(t('proc.dash.bySupplier'), s.bySupplier)}`;
    printPage({ title: t('proc.dash.reportTitle'), subtitle: t('proc.dash.lastDays', { n: period }), school: t('trips.print.school'), body, dir: i18n.dir(), lang: i18n.language });
  };
  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-2">{t('proc.dash.mine', { n: mine.length })}</p>
        {!mine.length ? <p className="text-sm text-slate-400">{t('proc.dash.nothingMine')}</p> : (
          <div className="divide-y divide-slate-100">
            {mine.slice(0, 30).map((r) => (
              <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="w-full text-start py-2 flex flex-wrap items-center gap-2 hover:bg-slate-50">
                <Pill className="bg-primary/10 text-primary border-primary/20">{t(`proc.dash.why.${whyMine(r)}`)}</Pill>
                <span className="flex-1 min-w-48 text-sm"><span className="font-medium">{r.title}</span> <span className="text-xs text-slate-500" dir="ltr">{r.number}</span> <span className="text-xs text-slate-500">· {branchName(r.branch)} · {r.requesterName}</span></span>
                <span className="text-sm tabular-nums" dir="ltr">{money(r.po?.total ?? r.estTotal)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile icon={Hourglass} label={t('proc.status.PENDING_APPROVAL')} value={s.pending} onClick={() => onFilter({ status: 'PENDING_APPROVAL' })} />
        <Tile icon={ShoppingCart} label={t('proc.dash.toOrder')} value={s.toOrder} onClick={() => onFilter({ status: 'APPROVED' })} />
        <Tile icon={Truck} label={t('proc.dash.incoming')} value={s.incoming} onClick={() => onFilter({ status: 'INCOMING' })} />
        <Tile icon={Receipt} label={t('proc.dash.toInvoice')} value={s.toInvoice} onClick={() => onFilter({ status: 'RECEIVED' })} />
        <Tile icon={Inbox} label={t('proc.dash.toPay')} value={s.toPay} onClick={() => onFilter({ status: 'INVOICED' })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={period} onChange={(ev) => setPeriod(Number(ev.target.value))} className={selCls}>{PERIODS.map((d) => <option key={d} value={d}>{t('proc.dash.lastDays', { n: d })}</option>)}</select>
        <button type="button" onClick={print} className={btn.ghost}><Printer className="w-4 h-4" />{t('proc.dash.print')}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Wallet} label={t('proc.dash.spent')} value={<span dir="ltr">{money(s.spent)}</span>} sub={t('proc.sar')} />
        <Tile icon={Timer} label={t('proc.dash.approveDays')} value={<span dir="ltr">{fmtD(s.approveDays)}</span>} />
        <Tile icon={Timer} label={t('proc.dash.orderDays')} value={<span dir="ltr">{fmtD(s.orderDays)}</span>} />
        <Tile icon={Timer} label={t('proc.dash.deliverDays')} value={<span dir="ltr">{fmtD(s.deliverDays)}</span>} />
      </div>
      <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-2">{t('proc.dash.pendingBy')}</p>
        <div className="flex flex-wrap gap-2">{s.pendingBy.map((x) => <Pill key={x.role} className={x.n ? PROC_STATUS_STYLE.PENDING_APPROVAL : 'bg-slate-50 text-slate-500 border-slate-200'}>{t(`proc.steps.${x.role}`)}: {x.n}{x.n ? ` · ${t('proc.dash.oldest', { d: x.oldest.toFixed(1) })}` : ''}</Pill>)}</div>
      </section>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Bars title={t('proc.dash.byBranch')} rows={s.byBranch} />
        <Bars title={t('proc.dash.byCategory')} rows={s.byCat} />
        <Bars title={t('proc.dash.bySupplier')} rows={s.bySupplier} />
      </div>
    </div>
  );
}

function Bars({ title, rows }) {
const { t } = useTranslation();
  const max = Math.max(1, ...rows.map((x) => x[1]));
  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
      <p className="font-bold text-slate-800 mb-2">{title}</p>
      {!rows.length ? <p className="text-sm text-slate-400">{t('proc.dash.none')}</p> : rows.slice(0, 10).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-sm py-0.5">
          <span className="w-32 shrink-0 truncate">{k}</span>
          <span className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><span className="block h-full bg-primary/70" style={{ width: `${(v / max) * 100}%` }} /></span>
          <span className="w-28 shrink-0 text-xs tabular-nums text-end" dir="ltr">{money(v)}</span>
        </div>
      ))}
    </section>
  );
}
