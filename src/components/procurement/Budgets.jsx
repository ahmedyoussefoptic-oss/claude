import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Trash2, FileDown, Pencil } from 'lucide-react';
import { Field, inputCls, btn } from '../platform/ui';
import { useBranches } from '../../hooks/useOrgData';
import { callProc, money, PROC_CATEGORIES } from '../../config/procurement';
import { exportXlsx } from '../../utils/exportXlsx';

const selCls = `${inputCls.replace('w-full ', '')} w-auto`;
const barTone = (pct) => (pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500');

// Yearly budgets of each branch (the whole branch, or one category): what is
// committed (approved, not yet received), spent (received) and left.
// Finance sets them; principals see their branches.
export default function Budgets() {
  const { t } = useTranslation();
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b;
  const [data, setData] = useState(null);
  const [fy, setFy] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((y) => callProc('budgets', y ? { fy: y } : {}).then((r) => { setData(r); setFy(r.fy); setError(null); }).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);
  const fyLabel = (y) => (data?.fiscalStartMonth > 1 ? `${y}/${y + 1}` : String(y));
  const save = async () => {
    setBusy(true);
    try { setData(await callProc('saveBudget', { ...form, fy, amount: Number(form.amount) })); setForm(null); } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  };
  const remove = async (l) => {
    if (!window.confirm(t('proc.budget.deleteConfirm'))) return;
    try { setData(await callProc('deleteBudget', { lineId: l.id })); } catch (err) { window.alert(err.message); }
  };
  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const lines = [...data.lines].sort((a, b) => branchName(a.branch).localeCompare(branchName(b.branch), 'ar') || (a.category === 'ALL' ? -1 : b.category === 'ALL' ? 1 : a.category.localeCompare(b.category)));
  const toExcel = () => exportXlsx(`budgets-${fy}.xlsx`, t('proc.budget.tab'),
    [t('proc.branch'), t('proc.budget.line'), t('proc.budget.amount'), t('proc.budget.committed'), t('proc.budget.spent'), t('proc.budget.remaining'), '%'],
    lines.map((l) => [branchName(l.branch), l.category === 'ALL' ? t('proc.budget.allCategories') : t(`proc.categories.${l.category}`), l.amount, l.committed, l.spent, l.remaining, l.pct]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={fy} onChange={(e) => load(Number(e.target.value))} className={selCls}>{[data.current - 1, data.current, data.current + 1].map((y) => <option key={y} value={y}>{t('proc.budget.year', { y: fyLabel(y) })}</option>)}</select>
        {data.canEdit && <button type="button" onClick={() => setForm({ branch: branches[0]?.id || '', category: 'ALL', amount: '' })} className={btn.primary}><Plus className="w-4 h-4" />{t('proc.budget.add')}</button>}
        <button type="button" disabled={!lines.length} onClick={toExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('mnt.excel')}</button>
        <p className="text-xs text-slate-500">{t('proc.budget.hint')}</p>
      </div>
      {form && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label={t('proc.branch')}><select value={form.branch} onChange={(e) => setForm((p) => ({ ...p, branch: e.target.value }))} className={inputCls}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label={t('proc.budget.line')}><select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} className={inputCls}><option value="ALL">{t('proc.budget.allCategories')}</option>{PROC_CATEGORIES.map((c) => <option key={c} value={c}>{t(`proc.categories.${c}`)}</option>)}</select></Field>
          <Field label={t('proc.budget.amount')}><input type="number" min="0" step="any" dir="ltr" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inputCls} /></Field>
          <div className="flex gap-2"><button type="button" disabled={busy || form.amount === ''} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button><button type="button" onClick={() => setForm(null)} className={btn.ghost}>{t('common.cancel')}</button></div>
        </div>
      )}
      {!lines.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('proc.budget.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {lines.map((l) => (
            <div key={l.id} className="px-4 py-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 min-w-48"><span className="font-medium text-slate-900">{branchName(l.branch)}</span> · {l.category === 'ALL' ? t('proc.budget.allCategories') : t(`proc.categories.${l.category}`)}</span>
                <span className="text-xs text-slate-600">{t('proc.budget.committed')} <b dir="ltr">{money(l.committed)}</b> · {t('proc.budget.spent')} <b dir="ltr">{money(l.spent)}</b> · {t('proc.budget.remaining')} <b dir="ltr" className={l.remaining < 0 ? 'text-rose-700' : ''}>{money(l.remaining)}</b> / <span dir="ltr">{money(l.amount)}</span></span>
                <span className={`text-xs font-bold tabular-nums ${l.pct >= 100 ? 'text-rose-700' : l.pct >= 80 ? 'text-amber-700' : 'text-emerald-700'}`}>{l.pct}%</span>
                {data.canEdit && <button type="button" onClick={() => setForm({ branch: l.branch, category: l.category, amount: l.amount })} className="p-1 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>}
                {data.canEdit && <button type="button" onClick={() => remove(l)} className="p-1 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                <span className={`h-full ${barTone(l.pct)}`} style={{ width: `${Math.min(100, (l.spent / Math.max(1, l.amount)) * 100)}%` }} />
                <span className={`h-full ${barTone(l.pct)} opacity-40`} style={{ width: `${Math.max(0, Math.min(100, l.pct) - Math.min(100, (l.spent / Math.max(1, l.amount)) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
