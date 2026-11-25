import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Hammer, FileDown } from 'lucide-react';
import { Pill, inputCls } from '../platform/ui';
import { money, PROC_STATUS_STYLE, PROC_CATEGORIES, PROC_ACTIVE } from '../../config/procurement';
import { fmtDateTime } from '../../config/maintenance';
import { exportXlsx } from '../../utils/exportXlsx';

const selCls = `${inputCls.replace('w-full ', '')} w-auto`;
const FILTERS = ['ACTIVE', 'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'INCOMING', 'RECEIVED', 'INVOICED', 'PAID', 'REJECTED', 'CANCELLED', 'ALL'];
const fits = (r, k) => (k === 'ALL' ? true : k === 'ACTIVE' ? PROC_ACTIVE.includes(r.status) : k === 'INCOMING' ? ['ORDERED', 'PARTIAL'].includes(r.status) : r.status === k);

// The requests with their filters (stage, branch, category, text).
export default function ProcRequests({ requests, branchName, filter, setFilter, onOpen }) {
  const { t } = useTranslation();
  const f = { status: 'ACTIVE', branch: '', category: '', q: '', ...filter };
  const set = (k, v) => setFilter({ ...f, [k]: v });
  const branches = useMemo(() => [...new Set(requests.map((r) => r.branch))], [requests]);
  const q = f.q.trim().toLowerCase();
  const rows = requests.filter((r) => fits(r, f.status) && (!f.branch || r.branch === f.branch) && (!f.category || r.category === f.category)
    && (!q || [r.number, r.title, r.requesterName, r.po?.number, r.po?.supplierName, ...r.items.map((it) => it.name)].join(' ').toLowerCase().includes(q)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((k) => <button key={k} type="button" onClick={() => set('status', k)} className={`px-3 py-1.5 rounded-lg text-xs border ${f.status === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`proc.filters.${k}`)} <span className="opacity-70 tabular-nums">{requests.filter((r) => fits(r, k)).length}</span></button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={t('proc.searchHint')} className={`${inputCls} ps-9`} />
        </div>
        {branches.length > 1 && <select value={f.branch} onChange={(e) => set('branch', e.target.value)} className={selCls}><option value="">{t('common.allBranches')}</option>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <select value={f.category} onChange={(e) => set('category', e.target.value)} className={selCls}><option value="">{t('proc.allCategories')}</option>{PROC_CATEGORIES.map((c) => <option key={c} value={c}>{t(`proc.categories.${c}`)}</option>)}</select>
        <button type="button" disabled={!rows.length} onClick={() => exportXlsx('procurement.xlsx', t('proc.title'),
          [t('proc.requestNumber'), t('proc.branch'), t('proc.category'), t('proc.titleField'), t('proc.excel.requester'), t('proc.excel.status'), t('proc.estTotal'), t('proc.poNumber'), t('proc.supplier'), t('proc.orderTotal'), t('proc.invoice'), t('proc.excel.paid'), t('proc.excel.submitted'), t('proc.excel.approved'), t('proc.excel.ordered'), t('proc.excel.received')],
          rows.map((r) => [r.number, branchName(r.branch), t(`proc.categories.${r.category}`), r.title, r.requesterName, t(`proc.status.${r.status}`), r.estTotal, r.po?.number || '', r.po?.supplierName || '', r.po?.total ?? '', r.invoice?.amount ?? '', r.payment?.date || '',
            fmtDateTime(r.submittedAt), fmtDateTime(r.approvedAt), fmtDateTime(r.orderedAt), fmtDateTime(r.receivedAt)]))} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5 disabled:opacity-50"><FileDown className="w-4 h-4" />{t('mnt.excel')}</button>
      </div>
      {!rows.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('proc.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {rows.slice(0, 500).map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="w-full text-start px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex-1 min-w-56">
                <span className="font-medium text-slate-900">{r.title}</span>{r.mntTicketNumber && <Hammer className="inline w-3.5 h-3.5 text-amber-600 ms-1" />}
                <span className="block text-xs text-slate-500"><span dir="ltr">{r.number}</span> · {branchName(r.branch)} · {t(`proc.categories.${r.category}`)} · {r.requesterName}{r.po ? ` · ${r.po.supplierName}` : ''}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {r.urgent && <Pill className="bg-rose-600 text-white border-rose-600">{t('proc.urgentTag')}</Pill>}
                <Pill className={PROC_STATUS_STYLE[r.status]}>{t(`proc.status.${r.status}`)}{r.status === 'PENDING_APPROVAL' && r.steps[r.stepIdx] ? ` · ${t(`proc.steps.${r.steps[r.stepIdx].role}`)}` : ''}</Pill>
                <span className="text-sm tabular-nums w-28 text-end" dir="ltr">{money(r.po?.total ?? r.estTotal)}</span>
                <span className="text-[11px] text-slate-400" dir="ltr">{fmtDateTime(r.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
