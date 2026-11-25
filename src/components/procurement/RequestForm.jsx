import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Plus, Trash2 } from 'lucide-react';
import { Modal, Field, inputCls, btn } from '../platform/ui';
import { useBranches } from '../../hooks/useOrgData';
import useAuthStore from '../../stores/useAuthStore';
import { userBranches } from '../../utils/scope';
import { callProc, filePayload, money, round2, PROC_CATEGORIES } from '../../config/procurement';
import FilePicker from './FilePicker';

const emptyItem = () => ({ name: '', qty: 1, unit: '', estPrice: '' });

// A purchase request: items with quantities and estimated unit prices (before
// VAT), the reason, attachments (quotes, photos). `initial` prefills it —
// a maintenance work order's parts, or a returned request being edited.
export default function RequestForm({ onClose, onSaved, initial = {}, settings }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const branches = useMemo(() => (userData?.role === 'ADMIN' || userData?.access === 'all' ? allBranches : allBranches.filter((b) => userBranches(userData).includes(b.id))), [allBranches, userData]);
  const editing = !!initial.id;
  const [f, setF] = useState({
    branch: initial.branch || '', title: initial.title || '', justification: initial.justification || '', category: initial.category || (initial.mntTicketId ? 'MAINTENANCE' : 'OTHER'), urgent: initial.urgent === true,
    items: initial.items?.length ? initial.items.map((it) => ({ name: it.name, qty: it.qty, unit: it.unit || '', estPrice: it.estPrice ?? '' })) : [emptyItem()],
  });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (i, k, v) => setF((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const branchId = f.branch || (branches.length === 1 ? branches[0].id : '');
  const vatRate = Number(settings?.vatRate ?? 15);
  const sub = round2(f.items.reduce((n, it) => n + (Number(it.qty) || 0) * (Number(it.estPrice) || 0), 0));
  const total = round2(sub * (1 + vatRate / 100));
  const chain = settings ? ['BRANCH', ...(total >= settings.financeFrom ? ['FINANCE'] : []), ...(total > settings.execAbove ? ['EXEC'] : [])] : [];
  const valid = f.title.trim() && branchId && f.items.some((it) => it.name.trim() && Number(it.qty) > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { ...f, branch: branchId, items: f.items.filter((it) => it.name.trim()).map((it) => ({ ...it, qty: Number(it.qty), estPrice: Number(it.estPrice) || 0 })), files: await Promise.all(files.map(filePayload)) };
      const r = editing ? await callProc('resubmit', { ...payload, id: initial.id }) : await callProc('create', { ...payload, mntTicketId: initial.mntTicketId || '' });
      onSaved?.(r);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={editing ? t('proc.editRequest', { n: initial.number }) : initial.mntTicketId ? t('proc.fromTicket', { n: initial.mntTicketNumber }) : t('proc.newRequest')} onClose={onClose} size="max-w-3xl"
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
        <button type="button" onClick={submit} disabled={busy || !valid} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{editing ? t('proc.resubmit') : t('proc.submit')}</button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={t('proc.branch')} required>
          <select value={branchId} disabled={editing || !!initial.mntTicketId} onChange={(e) => set('branch', e.target.value)} className={inputCls}>
            <option value="">{t('proc.chooseBranch')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label={t('proc.category')}>
          <select value={f.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>{PROC_CATEGORIES.map((c) => <option key={c} value={c}>{t(`proc.categories.${c}`)}</option>)}</select>
        </Field>
        <Field label={t('proc.titleField')} required className="md:col-span-2"><input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} placeholder={t('proc.titleHint')} className={inputCls} /></Field>
        <Field label={t('proc.justification')} className="md:col-span-2"><textarea value={f.justification} onChange={(e) => set('justification', e.target.value)} rows={2} className={inputCls} /></Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-bold text-slate-800">{t('proc.items')}</p>
        <div className="hidden md:grid grid-cols-[1fr_80px_90px_110px_100px_32px] gap-2 text-xs text-slate-500 px-1">
          <span>{t('proc.item')}</span><span>{t('proc.qty')}</span><span>{t('proc.unit')}</span><span>{t('proc.estPrice')}</span><span>{t('proc.lineTotal')}</span><span />
        </div>
        {f.items.map((it, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_80px_90px_110px_100px_32px] gap-2 items-center">
            <input value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} placeholder={t('proc.item')} className={`${inputCls} col-span-2 md:col-span-1`} />
            <input type="number" min="0" step="any" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} placeholder={t('proc.qty')} className={inputCls} dir="ltr" />
            <input value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} placeholder={t('proc.unitHint')} className={inputCls} />
            <input type="number" min="0" step="any" value={it.estPrice} onChange={(e) => setItem(i, 'estPrice', e.target.value)} placeholder={t('proc.estPrice')} className={inputCls} dir="ltr" />
            <span className="text-sm tabular-nums text-slate-700" dir="ltr">{money((Number(it.qty) || 0) * (Number(it.estPrice) || 0))}</span>
            <button type="button" disabled={f.items.length === 1} onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} className="p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setF((p) => ({ ...p, items: [...p.items, emptyItem()] }))} className={`${btn.small} border border-slate-200 text-slate-600 px-3 py-1.5`}><Plus className="w-3.5 h-3.5" />{t('proc.addItem')}</button>
      </div>

      <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
        <p className="flex justify-between"><span>{t('proc.subtotal')}</span><span dir="ltr" className="tabular-nums">{money(sub)}</span></p>
        <p className="flex justify-between text-slate-500"><span>{t('proc.vat', { n: vatRate })}</span><span dir="ltr" className="tabular-nums">{money(total - sub)}</span></p>
        <p className="flex justify-between font-bold"><span>{t('proc.estTotal')}</span><span dir="ltr" className="tabular-nums">{money(total)} {t('proc.sar')}</span></p>
        {chain.length > 0 && <p className="text-xs text-slate-500 pt-1">{t('proc.chainWill')}: {chain.map((x) => t(`proc.steps.${x}`)).join(' ← ')}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm text-rose-700"><input type="checkbox" checked={f.urgent} onChange={(e) => set('urgent', e.target.checked)} />{t('proc.urgent')}</label>
      <FilePicker files={files} setFiles={setFiles} pdf label={t('proc.attachmentsHint')} />
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
    </Modal>
  );
}
