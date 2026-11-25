import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Printer, Check, X, Undo2, Pencil, Ban, ShoppingCart, PackageCheck, PackageX, Receipt, BadgeDollarSign, Star, MessageSquare, CheckCircle2, AlertTriangle, Hammer, FileSpreadsheet, Trash2, PiggyBank } from 'lucide-react';
import { Modal, Pill, Field, inputCls, btn } from '../platform/ui';
import { callProc, filePayload, money, round2, PROC_STATUS_STYLE, STEP_STYLE } from '../../config/procurement';
import { fmtDateTime } from '../../config/maintenance';
import FilePicker, { FileLinks } from './FilePicker';
import RequestForm from './RequestForm';
import { printPurchaseOrder } from './printPurchaseOrder';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

// One purchase request: its items, the approval steps, the purchase order,
// what arrived, the invoice and payment, the history — and what the viewer
// may do now (the server says which: request.can).
export default function RequestDetails({ id, branchName, settings, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [panel, setPanel] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({});
  const [suppliers, setSuppliers] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => callProc('get', { id }).then((x) => { setR(x.request); setError(null); }).catch((err) => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const open = (k) => {
    if (panel === k) { setPanel(''); return; }
    setPanel(k); setNote(''); setFiles([]); setError(null);
    if (k === 'order') {
      setForm({ supplierId: r.quotes.length ? [...r.quotes].sort((a, b) => a.total - b.total)[0].supplierId : '', prices: r.items.map((it) => it.estPrice), terms: settings?.terms || '', deliveryDate: '', choiceReason: '', soleSource: '' });
      if (!suppliers) callProc('suppliers').then((x) => setSuppliers(x.suppliers)).catch((err) => setError(err.message));
    }
    if (k === 'receive') setForm({ qty: r.items.map((it) => round2(it.qty - it.received)) });
    if (k === 'invoice') setForm({ number: '', amount: r.receivedValue, date: today() });
    if (k === 'pay') setForm({ ref: '', date: today() });
    if (k === 'rate') setForm({ rating: 0 });
    if (k === 'quote') {
      setForm({ supplierId: '', total: '', validUntil: '' });
      if (!suppliers) callProc('suppliers').then((x) => setSuppliers(x.suppliers)).catch((err) => setError(err.message));
    }
  };
  const run = async (action, data) => {
    setBusy(action);
    setError(null);
    try {
      const x = await callProc(action, { id, ...data });
      setR(x.request); setPanel(''); setNote(''); setFiles([]);
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  if (!r) return <Modal title={t('proc.request')} onClose={onClose}>{error ? <p className="text-sm text-rose-700">{error}</p> : <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}</Modal>;
  if (editing) return <RequestForm initial={r} settings={settings} onClose={() => setEditing(false)} onSaved={(x) => { setEditing(false); setR(x.request); onChanged?.(); }} />;
  const c = r.can;
  const vatRate = r.po?.vatRate ?? Number(settings?.vatRate ?? 15);
  const orderSub = form.prices ? round2(r.items.reduce((n, it, i) => n + it.qty * (Number(form.prices[i]) || 0), 0)) : 0;
  const actions = [
    c.approve && ['approve', Check, t('proc.approve')],
    c.approve && ['reject', X, t('proc.reject')],
    c.approve && ['return', Undo2, t('proc.return')],
    c.edit && ['edit', Pencil, t('proc.editAndResubmit')],
    c.quote && ['quote', FileSpreadsheet, t('proc.quotes.add')],
    c.order && ['order', ShoppingCart, t('proc.issueOrder')],
    c.returnBack && ['returnBack', Undo2, t('proc.returnBack')],
    c.receive && ['receive', PackageCheck, t('proc.receive')],
    c.closeReceipt && ['closeReceipt', PackageX, t('proc.closeReceipt')],
    c.invoice && ['invoice', Receipt, t('proc.addInvoice')],
    c.pay && ['pay', BadgeDollarSign, t('proc.markPaid')],
    c.rate && ['rate', Star, t('proc.rateSupplier')],
    c.cancel && ['cancel', Ban, t('proc.cancel')],
    ['comment', MessageSquare, t('proc.comment')],
  ].filter(Boolean);
  const submit = () => {
    if (panel === 'approve') return run('decide', { decision: 'APPROVE', note });
    if (panel === 'reject') return run('decide', { decision: 'REJECT', note });
    if (panel === 'return') return run('decide', { decision: 'RETURN', note });
    if (panel === 'order') return run('order', { ...form, prices: form.prices.map(Number) });
    if (panel === 'quote') return Promise.all(files.map(filePayload)).then((fl) => run('addQuote', { ...form, total: Number(form.total), note, files: fl }));
    if (panel === 'receive') return Promise.all(files.map(filePayload)).then((photos) => run('receive', { qty: form.qty.map(Number), note, photos }));
    if (panel === 'invoice') return Promise.all(files.map(filePayload)).then((fl) => run('invoice', { ...form, amount: Number(form.amount), files: fl }));
    if (panel === 'pay') return run('pay', { ...form, note });
    if (panel === 'rate') return run('rate', { rating: form.rating, note });
    return run(panel, { note });
  };
  const quoteMin = r.quotes.length ? Math.min(...r.quotes.map((q) => q.total)) : 0;
  const needQuotes = !!settings && (r.estTotal >= Number(settings.quoteFrom)) && Number(settings.quoteCount) > 0;
  const quotesOk = r.quotes.length >= Number(settings?.quoteCount || 0);
  const chosenQuote = r.quotes.filter((q) => q.supplierId === form.supplierId).sort((a, b) => a.total - b.total)[0];
  const notCheapest = !!chosenQuote && chosenQuote.total > quoteMin + 0.01;
  const removeQuote = (q) => { if (window.confirm(t('proc.quotes.removeConfirm', { name: q.supplierName }))) run('removeQuote', { quoteId: q.id }); };
  const noteRequired = ['reject', 'return', 'cancel', 'returnBack', 'closeReceipt', 'comment'].includes(panel) || (panel === 'pay' && r.match && !r.match.ok);
  const ready = (!noteRequired || note.trim())
    && (panel !== 'order' || (form.supplierId && form.prices?.every((p) => p !== '' && Number(p) >= 0) && (!needQuotes || quotesOk || form.soleSource?.trim()) && (!notCheapest || form.choiceReason?.trim() || form.soleSource?.trim())))
    && (panel !== 'quote' || (form.supplierId && Number(form.total) > 0))
    && (panel !== 'receive' || form.qty?.some((q) => Number(q) > 0))
    && (panel !== 'invoice' || (form.number?.trim() && Number(form.amount) > 0 && files.length))
    && (panel !== 'rate' || form.rating > 0);

  return (
    <Modal onClose={onClose} size="max-w-4xl"
      title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr">{r.number}</span><Pill className={PROC_STATUS_STYLE[r.status]}>{t(`proc.status.${r.status}`)}</Pill>{r.urgent && <Pill className="bg-rose-600 text-white border-rose-600">{t('proc.urgentTag')}</Pill>}</span>}
      subtitle={`${r.title} · ${branchName(r.branch)} · ${t(`proc.categories.${r.category}`)} · ${r.requesterName}`}
      footer={r.po && <button type="button" onClick={() => printPurchaseOrder({ r, t, i18n, branchName })} className={btn.ghost}><Printer className="w-4 h-4" />{t('proc.printOrder')}</button>}>
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {r.mntTicketNumber && <p className="text-xs text-amber-800 flex items-center gap-1"><Hammer className="w-3.5 h-3.5" />{t('proc.forTicket', { n: r.mntTicketNumber })}</p>}
      {r.justification && <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3">{r.justification}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {r.steps.map((s, i) => (
          <span key={s.role} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">←</span>}
            <Pill className={`${STEP_STYLE[s.status]} ${r.status === 'PENDING_APPROVAL' && i === r.stepIdx ? 'ring-2 ring-amber-300' : ''}`}>{t(`proc.steps.${s.role}`)}{s.byName ? ` · ${s.byName}` : ''}</Pill>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 text-start font-medium">{t('proc.item')}</th><th className="text-start font-medium">{t('proc.qty')}</th>
            <th className="text-start font-medium">{t('proc.estPrice')}</th>{r.po && <th className="text-start font-medium">{t('proc.price')}</th>}{r.po && <th className="text-start font-medium">{t('proc.received')}</th>}
          </tr></thead>
          <tbody>{r.items.map((it, i) => (
            <tr key={i} className="border-b border-slate-50">
              <td className="py-1.5">{it.name}</td><td className="tabular-nums">{it.qty} {it.unit}</td><td className="tabular-nums" dir="ltr">{money(it.estPrice)}</td>
              {r.po && <td className="tabular-nums" dir="ltr">{money(it.price)}</td>}
              {r.po && <td className={`tabular-nums ${it.received >= it.qty ? 'text-emerald-700' : it.received ? 'text-violet-700' : 'text-slate-400'}`}>{it.received}/{it.qty}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-xs text-slate-500">{t('proc.estTotal')}</p><p className="font-bold tabular-nums" dir="ltr">{money(r.estTotal)}</p></div>
        {r.po && <div className="bg-indigo-50 rounded-xl p-2.5"><p className="text-xs text-indigo-700">{t('proc.orderTotal')} · <span dir="ltr">{r.po.number}</span></p><p className="font-bold tabular-nums" dir="ltr">{money(r.po.total)}</p><p className="text-xs text-slate-600">{r.po.supplierName}{r.po.deliveryDate ? <> · {t('proc.delivery')} <span dir="ltr">{r.po.deliveryDate}</span></> : ''}</p></div>}
        {r.invoice && <div className="bg-cyan-50 rounded-xl p-2.5"><p className="text-xs text-cyan-700">{t('proc.invoice')} {r.invoice.number}</p><p className="font-bold tabular-nums" dir="ltr">{money(r.invoice.amount)}</p></div>}
      </div>
      {r.match && (
        <p className={`text-sm rounded-xl px-3 py-2 flex items-center gap-1.5 ${r.match.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {r.match.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {r.match.ok ? t('proc.matchOk') : t('proc.matchBad', { po: money(r.match.po), received: money(r.match.received), invoice: money(r.match.invoice) })}
        </p>
      )}
      {r.budget?.length > 0 && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-1.5">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><PiggyBank className="w-4 h-4 text-primary" />{t('proc.budget.title')}</p>
          {r.budget.map((l) => {
            const after = l.committed + l.spent + (l.thisRequest || 0);
            const pctAfter = l.amount > 0 ? Math.round((after / l.amount) * 100) : 0;
            return (
              <div key={l.id} className="text-xs space-y-0.5">
                <p className="flex flex-wrap justify-between gap-2"><span>{l.category === 'ALL' ? t('proc.budget.allCategories') : t(`proc.categories.${l.category}`)} · {l.fy}</span>
                  <span dir="ltr" className="tabular-nums">{money(l.committed + l.spent)} / {money(l.amount)}{l.thisRequest ? ` → ${money(after)}` : ''}</span></p>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                  <span className="h-full bg-primary/70" style={{ width: `${Math.min(100, ((l.committed + l.spent) / Math.max(1, l.amount)) * 100)}%` }} />
                  {l.thisRequest > 0 && <span className={`h-full ${pctAfter > 100 ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${Math.max(0, Math.min(100, pctAfter) - Math.min(100, ((l.committed + l.spent) / Math.max(1, l.amount)) * 100))}%` }} />}
                </div>
                {pctAfter > 100 && <p className="text-rose-700">{t(l.thisRequest ? 'proc.budget.over' : 'proc.budget.overNow', { n: pctAfter })}</p>}
              </div>
            );
          })}
        </div>
      )}
      {r.quotes.length > 0 && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-1.5">
          <p className="text-sm font-bold text-slate-800">{t('proc.quotes.title', { n: r.quotes.length })}</p>
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead><tr className="text-xs text-slate-500"><th className="text-start font-medium">{t('proc.supplier')}</th><th className="text-start font-medium">{t('proc.quotes.total')}</th><th className="text-start font-medium">{t('proc.quotes.validUntil')}</th><th /></tr></thead>
            <tbody>{[...r.quotes].sort((a, b) => a.total - b.total).map((q) => (
              <tr key={q.id} className={`border-t border-slate-100 ${r.quoteChoice?.quoteId === q.id ? 'bg-emerald-50' : ''}`}>
                <td className="py-1">{q.supplierName}{q.total === quoteMin && <Pill className="ms-1 bg-emerald-50 text-emerald-700 border-emerald-200">{t('proc.quotes.lowest')}</Pill>}{q.note && <span className="block text-xs text-slate-500">{q.note}</span>}<FileLinks files={q.files} /></td>
                <td className="tabular-nums" dir="ltr">{money(q.total)}</td><td dir="ltr" className="text-xs">{q.validUntil || '—'}</td>
                <td>{c.quote && <button type="button" onClick={() => removeQuote(q)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {r.quoteChoice?.reason && <p className="text-xs text-slate-600">{r.quoteChoice.soleSource ? t('proc.quotes.soleSource') : t('proc.quotes.choiceReason')}: {r.quoteChoice.reason}</p>}
        </div>
      )}
      {!r.quotes.length && r.quoteChoice?.soleSource && <p className="text-xs text-slate-600">{t('proc.quotes.soleSource')}: {r.quoteChoice.reason}</p>}
      {r.payment && <p className="text-sm text-emerald-800">{t('proc.paidOn', { date: `\u2066${r.payment.date}\u2069`, by: r.payment.byName })}{r.payment.ref ? ` · ${r.payment.ref}` : ''}</p>}
      <FileLinks files={r.attachments} />
      {r.invoice && <FileLinks files={r.invoice.files} />}
      {r.receipts.map((x) => <div key={x.at} className="text-xs text-slate-600 space-y-1"><p>{t('proc.receiptBy', { by: x.byName })} · <span dir="ltr">{fmtDateTime(x.at)}</span>{x.note ? ` — ${x.note}` : ''}</p><FileLinks files={x.photos} /></div>)}

      <div className="flex flex-wrap gap-2">
        {actions.map(([k, Icon, label]) => (
          <button key={k} type="button" onClick={() => (k === 'edit' ? setEditing(true) : open(k))} className={`${btn.small} px-3 py-2 border ${panel === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'}`}><Icon className="w-4 h-4" />{label}</button>
        ))}
      </div>
      {panel && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-3 bg-slate-50/60">
          {panel === 'quote' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {!suppliers ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
                <Field label={t('proc.supplier')} required><select value={form.supplierId} onChange={(e) => setForm((p) => ({ ...p, supplierId: e.target.value }))} className={inputCls}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              )}
              <Field label={t('proc.quotes.total')} required><input type="number" min="0" step="any" dir="ltr" value={form.total} onChange={(e) => setForm((p) => ({ ...p, total: e.target.value }))} className={inputCls} /></Field>
              <Field label={t('proc.quotes.validUntil')}><input type="date" dir="ltr" value={form.validUntil} onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))} className={inputCls} /></Field>
              <div className="md:col-span-3"><FilePicker files={files} setFiles={setFiles} pdf label={t('proc.quotes.file')} /></div>
            </div>
          )}
          {panel === 'order' && (
            <>
              {needQuotes && <p className={`text-xs rounded-lg px-2 py-1.5 ${quotesOk ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{t('proc.quotes.required', { n: settings.quoteCount, have: r.quotes.length, from: money(settings.quoteFrom) })}</p>}
              {!suppliers ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !suppliers.length ? <p className="text-sm text-amber-800">{t('proc.noSuppliers')}</p> : (
                <Field label={t('proc.supplier')} required>
                  <select value={form.supplierId} onChange={(e) => setForm((p) => ({ ...p, supplierId: e.target.value }))} className={inputCls}>
                    <option value="">—</option>
                    {[...suppliers].filter((s) => !r.quotes.length || form.soleSource?.trim() || r.quotes.some((q) => q.supplierId === s.id)).sort((a, b) => Number(b.categories.includes(r.category)) - Number(a.categories.includes(r.category))).map((s) => { const q = r.quotes.filter((x) => x.supplierId === s.id).sort((a, b) => a.total - b.total)[0]; return <option key={s.id} value={s.id}>{s.name}{q ? ` — ${money(q.total)}` : ''}{s.rating ? ` · ★${s.rating}` : ''}{s.categories.includes(r.category) ? ' ✓' : ''}</option>; })}
                  </select>
                </Field>
              )}
              <div className="space-y-1.5">
                {r.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{it.name} <span className="text-xs text-slate-500">× {it.qty}</span></span>
                    <input type="number" min="0" step="any" value={form.prices?.[i] ?? ''} onChange={(e) => setForm((p) => ({ ...p, prices: p.prices.map((x, j) => (j === i ? e.target.value : x)) }))} className={`${inputCls.replace('w-full ', '')} w-32 shrink-0`} dir="ltr" />
                  </div>
                ))}
              </div>
              <p className="text-sm">{t('proc.subtotal')} <b dir="ltr">{money(orderSub)}</b> · {t('proc.vat', { n: vatRate })} · {t('proc.orderTotal')} <b dir="ltr">{money(orderSub * (1 + vatRate / 100))}</b> <span className="text-xs text-slate-500">({t('proc.approvedTotal')} <span dir="ltr">{money(r.estTotal)}</span>)</span></p>
              {notCheapest && <Field label={t('proc.quotes.choiceReason')} required><input value={form.choiceReason} onChange={(e) => setForm((p) => ({ ...p, choiceReason: e.target.value }))} placeholder={t('proc.quotes.choiceHint', { min: money(quoteMin) })} className={inputCls} /></Field>}
              {needQuotes && !quotesOk && <Field label={t('proc.quotes.soleSource')} hint={t('proc.quotes.soleHint')}><input value={form.soleSource} onChange={(e) => setForm((p) => ({ ...p, soleSource: e.target.value }))} className={inputCls} /></Field>}
              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2">
                <Field label={t('proc.deliveryDate')}><input type="date" dir="ltr" value={form.deliveryDate} onChange={(e) => setForm((p) => ({ ...p, deliveryDate: e.target.value }))} className={inputCls} /></Field>
                <Field label={t('proc.terms')}><textarea value={form.terms} onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))} rows={2} className={inputCls} /></Field>
              </div>
            </>
          )}
          {panel === 'receive' && (
            <>
              <div className="space-y-1.5">{r.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{it.name} <span className="text-xs text-slate-500">{t('proc.remaining', { n: round2(it.qty - it.received) })}</span></span>
                  <input type="number" min="0" max={it.qty - it.received} step="any" value={form.qty?.[i] ?? 0} onChange={(e) => setForm((p) => ({ ...p, qty: p.qty.map((x, j) => (j === i ? e.target.value : x)) }))} className={`${inputCls.replace('w-full ', '')} w-28 shrink-0`} dir="ltr" />
                </div>
              ))}</div>
              <FilePicker files={files} setFiles={setFiles} camera label={t('proc.receiptPhotos')} />
            </>
          )}
          {panel === 'invoice' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Field label={t('proc.invoiceNumber')} required><input value={form.number} onChange={(e) => setForm((p) => ({ ...p, number: e.target.value }))} className={inputCls} dir="ltr" /></Field>
              <Field label={t('proc.invoiceAmount')} required><input type="number" step="any" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inputCls} dir="ltr" /></Field>
              <Field label={t('proc.invoiceDate')}><input type="date" dir="ltr" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className={inputCls} /></Field>
              <div className="md:col-span-3"><FilePicker files={files} setFiles={setFiles} pdf label={t('proc.invoiceFile')} /></div>
            </div>
          )}
          {panel === 'pay' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <p className="md:col-span-2 text-xs text-slate-500">{t('proc.payHint')}</p>
              <Field label={t('proc.payRef')}><input value={form.ref} onChange={(e) => setForm((p) => ({ ...p, ref: e.target.value }))} className={inputCls} dir="ltr" /></Field>
              <Field label={t('proc.payDate')}><input type="date" dir="ltr" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className={inputCls} /></Field>
            </div>
          )}
          {panel === 'rate' && <div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setForm({ rating: n })}><Star className={`w-6 h-6 ${n <= form.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}</div>}
          {!['order', 'invoice'].includes(panel) && <Field label={t(`proc.noteFor.${panel}`, { defaultValue: t('proc.note') })} required={noteRequired}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} /></Field>}
          <div className="flex gap-2">
            <button type="button" disabled={!!busy || !ready} onClick={submit} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('proc.confirm')}</button>
            <button type="button" onClick={() => setPanel('')} className={btn.ghost}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-bold text-slate-800 mb-2">{t('proc.history')}</p>
        <ol className="space-y-1.5 border-s-2 border-slate-200 ps-3">
          {[...r.log].reverse().map((l) => (
            <li key={`${l.at}-${l.action}`} className="text-xs text-slate-600">
              <span className="font-bold text-slate-800">{t(`proc.log.${l.action}`, { defaultValue: l.action })}</span>{l.to ? ` (${l.to})` : ''} · {l.byName || '—'} · <span dir="ltr">{fmtDateTime(l.at)}</span>
              {l.note && <span className="block text-slate-700 whitespace-pre-wrap">{l.note}</span>}
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
