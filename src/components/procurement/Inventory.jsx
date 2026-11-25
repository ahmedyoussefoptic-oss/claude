import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Search, PackageMinus, PackagePlus, ClipboardCheck, ArrowLeftRight, History, AlertTriangle, ShoppingCart, FileDown, Pencil, Trash2 } from 'lucide-react';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { useBranches } from '../../hooks/useOrgData';
import { callProc, money, round2, PROC_CATEGORIES } from '../../config/procurement';
import { fmtDateTime } from '../../config/maintenance';
import { exportXlsx } from '../../utils/exportXlsx';
import RequestForm from './RequestForm';

const selCls = `${inputCls.replace('w-full ', '')} w-auto`;
const MOVES = [['OUT', PackageMinus], ['IN', PackagePlus], ['COUNT', ClipboardCheck], ['TRANSFER', ArrowLeftRight]];

// Consumables: one store per branch. Receipts of catalogue items add to it;
// the storekeeper issues to a work order (its cost grows) or a department,
// counts, and transfers between branches. At the reorder level the
// storekeepers and procurement are told, and a purchase request for the low
// items is one click away.
export default function Inventory({ settings, onRequested }) {
  const { t } = useTranslation();
  const allBranches = useBranches();
  const branchName = (b) => allBranches.find((x) => x.id === b)?.name || b;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [move, setMove] = useState(null);
  const [itemEdit, setItemEdit] = useState(null);
  const [history, setHistory] = useState(null);
  const [reorder, setReorder] = useState(null);
  const load = useCallback(() => callProc('invList').then((r) => { setData(r); setError(null); }).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);
  const branches = useMemo(() => {
    if (!data) return [];
    const seen = new Set(data.stock.map((s) => s.branch));
    (data.moveBranches.includes('*') ? allBranches.map((b) => b.id) : data.moveBranches).forEach((b) => seen.add(b));
    return [...seen];
  }, [data, allBranches]);
  const branch = picked || branches[0] || '';
  const canMove = !!data && (data.moveBranches.includes('*') || data.moveBranches.includes(branch));
  const rows = useMemo(() => (data?.items || []).map((it) => {
    const s = data.stock.find((x) => x.itemId === it.id && x.branch === branch);
    const min = s?.min ?? it.minQty ?? 0;
    const qty = s?.qty || 0;
    return { ...it, qty, min, low: min > 0 && qty <= min, value: round2(qty * (it.lastPrice || 0)) };
  }), [data, branch]);
  const shown = rows.filter((r) => (!onlyLow || r.low) && (!q || [r.name, r.code].join(' ').toLowerCase().includes(q.toLowerCase())));
  const low = rows.filter((r) => r.low);

  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const toExcel = () => exportXlsx(`stock-${branch}.xlsx`, t('proc.inv.tab'),
    [t('proc.inv.item'), t('proc.inv.code'), t('proc.category'), t('proc.unit'), t('proc.inv.qty'), t('proc.inv.min'), t('proc.inv.lastPrice'), t('proc.inv.value')],
    shown.map((r) => [r.name, r.code, t(`proc.categories.${r.category}`), r.unit, r.qty, r.min, r.lastPrice, r.value]));
  const openReorder = () => setReorder({
    branch, category: low.length && low.every((r) => r.category === low[0].category) ? low[0].category : 'OTHER', title: t('proc.inv.reorderTitle', { branch: branchName(branch) }),
    items: low.map((r) => ({ name: r.name, unit: r.unit, itemId: r.id, qty: Math.max(1, round2(r.min * 2 - r.qty)), estPrice: r.lastPrice || '' })),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {branches.length > 1 && <select value={branch} onChange={(e) => setBranch(e.target.value)} className={selCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <div className="relative min-w-48"><Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('proc.inv.search')} className={`${inputCls} ps-9`} /></div>
        <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />{t('proc.inv.onlyLow', { n: low.length })}</label>
        {data.canCatalog && <button type="button" onClick={() => setItemEdit({})} className={btn.primary}><Plus className="w-4 h-4" />{t('proc.inv.newItem')}</button>}
        {low.length > 0 && <button type="button" onClick={openReorder} className={btn.ghost}><ShoppingCart className="w-4 h-4" />{t('proc.inv.reorder', { n: low.length })}</button>}
        <button type="button" onClick={() => setHistory({ branch })} className={btn.ghost}><History className="w-4 h-4" />{t('proc.inv.moves')}</button>
        <button type="button" disabled={!shown.length} onClick={toExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('mnt.excel')}</button>
      </div>
      {!shown.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('proc.inv.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-100">
              {['item', 'qty', 'min', 'lastPrice', 'value'].map((k) => <th key={k} className="py-2 text-start font-medium">{t(`proc.inv.${k}`)}</th>)}<th />
            </tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="py-2"><span className="font-medium text-slate-900">{r.name}</span>{r.low && <Pill className="ms-1.5 bg-rose-50 text-rose-700 border-rose-200"><AlertTriangle className="w-3 h-3 me-1" />{t('proc.inv.low')}</Pill>}<span className="block text-xs text-slate-500">{[r.code, t(`proc.categories.${r.category}`)].filter(Boolean).join(' · ')}</span></td>
                <td className={`tabular-nums font-bold ${r.low ? 'text-rose-700' : ''}`}>{r.qty} <span className="text-xs font-normal text-slate-500">{r.unit}</span></td>
                <td className="tabular-nums">{canMove ? <button type="button" onClick={() => setMove({ item: r, type: 'MIN' })} className="text-primary hover:underline">{r.min}</button> : r.min}</td>
                <td className="tabular-nums" dir="ltr">{r.lastPrice ? money(r.lastPrice) : '—'}</td>
                <td className="tabular-nums" dir="ltr">{r.value ? money(r.value) : '—'}</td>
                <td className="whitespace-nowrap">
                  {canMove && MOVES.map(([k, Icon]) => <button key={k} type="button" title={t(`proc.inv.types.${k}`)} onClick={() => setMove({ item: r, type: k })} className="p-1.5 text-slate-500 hover:text-primary"><Icon className="w-4 h-4" /></button>)}
                  <button type="button" title={t('proc.inv.moves')} onClick={() => setHistory({ itemId: r.id, name: r.name })} className="p-1.5 text-slate-500 hover:text-primary"><History className="w-4 h-4" /></button>
                  {data.canCatalog && <button type="button" onClick={() => setItemEdit(r)} className="p-1.5 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {move && <MoveForm move={move} branch={branch} branches={allBranches} onClose={() => setMove(null)} onDone={(r) => { setData(r); setMove(null); }} />}
      {itemEdit && <ItemEditor initial={itemEdit} onClose={() => setItemEdit(null)} onSaved={() => { setItemEdit(null); load(); }} />}
      {history && <MovesModal query={history} branchName={branchName} onClose={() => setHistory(null)} />}
      {reorder && <RequestForm initial={reorder} settings={settings} onClose={() => setReorder(null)} onSaved={(r) => { setReorder(null); onRequested?.(r); }} />}
    </div>
  );
}

function MoveForm({ move, branch, branches, onClose, onDone }) {
  const { t } = useTranslation();
  const { item, type } = move;
  const [f, setF] = useState({ qty: type === 'COUNT' ? item.qty : type === 'MIN' ? item.min : '', to: '', ticketNumber: '', toBranch: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(type === 'MIN'
        ? await callProc('invSetMin', { itemId: item.id, branch, min: f.qty })
        : await callProc('invMove', { itemId: item.id, branch, type, qty: Number(f.qty), to: f.to, ticketNumber: f.ticketNumber.trim(), toBranch: f.toBranch, note: f.note }));
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const ready = f.qty !== '' && Number(f.qty) >= 0 && (type === 'MIN' || type === 'COUNT' || Number(f.qty) > 0)
    && (type !== 'OUT' || f.to.trim() || f.ticketNumber.trim()) && (type !== 'TRANSFER' || f.toBranch) && (type !== 'COUNT' || f.note.trim());
  return (
    <Modal title={`${t(`proc.inv.types.${type}`)} — ${item.name}`} subtitle={t('proc.inv.current', { n: item.qty, unit: item.unit })} onClose={onClose} size="max-w-md"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !ready} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('proc.confirm')}</button></>}>
      <Field label={type === 'COUNT' ? t('proc.inv.counted') : type === 'MIN' ? t('proc.inv.min') : t('proc.inv.qty')} required><input type="number" min="0" step="any" dir="ltr" value={f.qty} onChange={(e) => set('qty', e.target.value)} className={inputCls} /></Field>
      {type === 'OUT' && <>
        <Field label={t('proc.inv.ticket')} hint={t('proc.inv.ticketHint')}><input value={f.ticketNumber} onChange={(e) => set('ticketNumber', e.target.value)} placeholder="MT-2026-10001" dir="ltr" className={inputCls} /></Field>
        <Field label={t('proc.inv.to')}><input value={f.to} onChange={(e) => set('to', e.target.value)} placeholder={t('proc.inv.toHint')} className={inputCls} /></Field>
      </>}
      {type === 'TRANSFER' && <Field label={t('proc.inv.toBranch')} required><select value={f.toBranch} onChange={(e) => set('toBranch', e.target.value)} className={inputCls}><option value="">—</option>{branches.filter((b) => b.id !== branch).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
      {type !== 'MIN' && <Field label={t('proc.note')} required={type === 'COUNT'}><textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={2} className={inputCls} /></Field>}
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}

function ItemEditor({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: '', unit: '', code: '', category: 'OTHER', minQty: 0, lastPrice: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await callProc('invSaveItem', { ...f, id: initial.id || '' }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(t('proc.inv.deleteConfirm', { name: initial.name }))) return;
    try { await callProc('invDeleteItem', { id: initial.id }); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={initial.id ? t('proc.inv.editItem') : t('proc.inv.newItem')} onClose={onClose} size="max-w-lg"
      footer={<>{initial.id && <button type="button" onClick={remove} className={`${btn.danger} me-auto`}><Trash2 className="w-4 h-4" />{t('proc.inv.deleteItem')}</button>}<button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !f.name.trim()} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('proc.inv.item')} required className="col-span-2"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
        <Field label={t('proc.unit')}><input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder={t('proc.unitHint')} className={inputCls} /></Field>
        <Field label={t('proc.inv.code')}><input value={f.code} onChange={(e) => set('code', e.target.value)} dir="ltr" className={inputCls} /></Field>
        <Field label={t('proc.category')}><select value={f.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>{PROC_CATEGORIES.map((c) => <option key={c} value={c}>{t(`proc.categories.${c}`)}</option>)}</select></Field>
        <Field label={t('proc.inv.minDefault')} hint={t('proc.inv.minHint')}><input type="number" min="0" step="any" dir="ltr" value={f.minQty} onChange={(e) => set('minQty', e.target.value)} className={inputCls} /></Field>
        {!initial.id && <Field label={t('proc.inv.lastPrice')}><input type="number" min="0" step="any" dir="ltr" value={f.lastPrice} onChange={(e) => set('lastPrice', e.target.value)} className={inputCls} /></Field>}
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}

function MovesModal({ query, branchName, onClose }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { callProc('invMoves', query.itemId ? { itemId: query.itemId } : { branch: query.branch }).then((r) => setRows(r.moves)).catch((err) => setError(err.message)); }, [query]);
  return (
    <Modal title={query.name ? t('proc.inv.movesOf', { name: query.name }) : t('proc.inv.movesBranch', { branch: branchName(query.branch) })} onClose={onClose} size="max-w-3xl">
      {error ? <p className="text-sm text-rose-700">{error}</p> : !rows ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : !rows.length ? <p className="text-sm text-slate-400">{t('proc.inv.noMoves')}</p> : (
        <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-100"><th className="text-start font-medium py-1">{t('proc.inv.when')}</th><th className="text-start font-medium">{t('proc.inv.item')}</th><th className="text-start font-medium">{t('proc.inv.move')}</th><th className="text-start font-medium">{t('proc.inv.qty')}</th><th className="text-start font-medium">{t('proc.inv.after')}</th><th className="text-start font-medium">{t('proc.inv.details')}</th></tr></thead>
          <tbody>{rows.map((m, i) => (
            <tr key={`${m.at}-${i}`} className="border-b border-slate-50 align-top">
              <td className="text-xs py-1.5" dir="ltr">{fmtDateTime(m.at)}</td>
              <td>{m.itemName}{!query.branch && <span className="block text-xs text-slate-500">{branchName(m.branch)}</span>}</td>
              <td>{t(`proc.inv.moveTypes.${m.type}`)}</td>
              <td className={`tabular-nums ${m.qty < 0 ? 'text-rose-700' : 'text-emerald-700'}`} dir="ltr">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
              <td className="tabular-nums">{m.after}</td>
              <td className="text-xs text-slate-600">{[m.ticketNumber, m.to, m.ref, m.toBranch && branchName(m.toBranch), m.fromBranch && branchName(m.fromBranch), m.note].filter(Boolean).join(' · ')}<span className="block text-slate-400">{m.byName}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}
