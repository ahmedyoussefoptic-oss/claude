import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, AlarmClock } from 'lucide-react';
import { Pill, inputCls } from '../platform/ui';
import { MNT_CATEGORIES, MNT_PRIORITIES, MNT_OPEN, STATUS_STYLE, PRIORITY_STYLE, CATEGORY_ICON, fmtDateTime, isOverdue } from '../../config/maintenance';

// A filter drop-down sized to its content.
const selCls = `${inputCls.replace('w-full ', '')} w-auto`;

const STATUS_FILTERS = ['OPEN', 'LATE', 'NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'CLOSED', 'CANCELLED', 'ALL'];
const PRI_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

// The work orders with their filters (status group, branch, category,
// priority, text). Open work sorts by urgency then deadline.
export default function MntTickets({ tickets, branchName, filter, setFilter, onOpen, now }) {
  const { t } = useTranslation();
  const branches = useMemo(() => [...new Set(tickets.map((x) => x.branch))], [tickets]);
  const f = { status: 'OPEN', branch: '', category: '', priority: '', q: '', ...filter };
  const set = (k, v) => setFilter({ ...f, [k]: v });
  const rows = (() => {
    const q = f.q.trim().toLowerCase();
    const list = tickets.filter((x) => (f.status === 'ALL' || (f.status === 'OPEN' ? MNT_OPEN.includes(x.status) : f.status === 'LATE' ? isOverdue(x, now) : x.status === f.status))
      && (!f.branch || x.branch === f.branch) && (!f.category || x.category === f.category) && (!f.priority || x.priority === f.priority)
      && (!q || [x.number, x.title, x.place, x.reporterName, x.techName, x.description].join(' ').toLowerCase().includes(q)));
    const openish = ['OPEN', 'LATE', 'NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(f.status);
    return openish ? list.sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority] || (a.dueAt || Infinity) - (b.dueAt || Infinity)) : list;
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((k) => {
          const n = k === 'ALL' ? tickets.length : tickets.filter((x) => (k === 'OPEN' ? MNT_OPEN.includes(x.status) : k === 'LATE' ? isOverdue(x, now) : x.status === k)).length;
          return <button key={k} type="button" onClick={() => set('status', k)} className={`px-3 py-1.5 rounded-lg text-xs border ${f.status === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`mnt.filters.${k}`)} <span className="tabular-nums opacity-70">{n}</span></button>;
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={t('mnt.searchHint')} className={`${inputCls} ps-9`} />
        </div>
        {branches.length > 1 && <select value={f.branch} onChange={(e) => set('branch', e.target.value)} className={selCls}><option value="">{t('common.allBranches')}</option>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <select value={f.category} onChange={(e) => set('category', e.target.value)} className={selCls}><option value="">{t('mnt.allCategories')}</option>{MNT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`mnt.categories.${c}`)}</option>)}</select>
        <select value={f.priority} onChange={(e) => set('priority', e.target.value)} className={selCls}><option value="">{t('mnt.allPriorities')}</option>{MNT_PRIORITIES.map((p) => <option key={p} value={p}>{t(`mnt.priorities.${p}`)}</option>)}</select>
      </div>
      {!rows.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('mnt.noTickets')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {rows.slice(0, 500).map((x) => {
            const late = isOverdue(x, now);
            return (
              <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="w-full text-start px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-lg">{CATEGORY_ICON[x.category]}</span>
                <span className="flex-1 min-w-56">
                  <span className="font-medium text-slate-900">{x.title}</span>
                  <span className="block text-xs text-slate-500"><span dir="ltr">{x.number}</span> · {branchName(x.branch)}{x.place ? ` · ${x.place}` : ''}{x.techName ? ` · ${x.techName}` : ''}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {x.priority !== 'NORMAL' && <Pill className={PRIORITY_STYLE[x.priority]}>{t(`mnt.priorities.${x.priority}`)}</Pill>}
                  <Pill className={STATUS_STYLE[x.status]}>{t(`mnt.status.${x.status}`)}</Pill>
                  {late && <Pill className="bg-rose-50 text-rose-700 border-rose-200"><AlarmClock className="w-3 h-3 me-1" />{t('mnt.overdue')}</Pill>}
                  <span className="text-[11px] text-slate-400" dir="ltr">{fmtDateTime(x.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
