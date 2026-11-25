import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Printer, UserCog, Play, PackageOpen, CheckCircle2, BadgeCheck, RotateCcw, XCircle, MessageSquare, Star, AlertTriangle, ShoppingCart, Coins, CheckSquare, Square } from 'lucide-react';
import { Modal, Pill, Field, inputCls, btn } from '../platform/ui';
import { callMnt, photoPayload, MNT_CATEGORIES, MNT_PRIORITIES, MNT_OPEN, STATUS_STYLE, PRIORITY_STYLE, CATEGORY_ICON, fmtDateTime, isOverdue } from '../../config/maintenance';
import PhotoPicker, { PhotoStrip } from './PhotoPicker';
import { printWorkOrder } from './printWorkOrder';
import RequestForm from '../procurement/RequestForm';
import useAuthStore from '../../stores/useAuthStore';
import { canSeeModule } from '../../utils/scope';

// One work order: its details, photos, the history (append-only, kept by
// the server), and what the viewer may do — assign, move the work along,
// approve, reopen, cancel, comment — plus the printed work order.
export default function TicketDetails({ id, branchName, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [tk, setTk] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [panel, setPanel] = useState('');
  const [note, setNote] = useState('');
  const [parts, setParts] = useState('');
  const [files, setFiles] = useState([]);
  const [rating, setRating] = useState(0);
  const [techs, setTechs] = useState(null);
  const [techId, setTechId] = useState('');
  const [buying, setBuying] = useState(false);
  const [ticks, setTicks] = useState([]);
  const [cost, setCost] = useState({ labor: '', parts: '', contractor: '' });
  const { userData } = useAuthStore();
  const navigate = useNavigate();

  const load = useCallback(() => callMnt('get', { id }).then((r) => { setTk(r.ticket); setError(null); }).catch((err) => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (panel === 'assign' && !techs) callMnt('techs').then((r) => setTechs(r.techs)).catch((err) => setError(err.message));
  }, [panel, techs]);

  const run = async (action, data = {}) => {
    setBusy(action);
    setError(null);
    try {
      const photos = files.length ? await Promise.all(files.map(photoPayload)) : [];
      const r = await callMnt(action, { id, ...data, photos });
      setTk(r.ticket);
      setPanel(''); setNote(''); setParts(''); setFiles([]); setRating(0); setTicks([]);
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  if (!tk) {
    return (
      <Modal title={t('mnt.ticket')} onClose={onClose} size="max-w-3xl">
        {error ? <p className="text-sm text-rose-700">{error}</p> : <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}
      </Modal>
    );
  }
  const open = MNT_OPEN.includes(tk.status);
  const late = isOverdue(tk);
  const fit = (x) => (!x.branches.length || x.branches.includes(tk.branch));
  const techList = (techs || []).filter(fit).sort((a, b) => Number(b.categories.includes(tk.category)) - Number(a.categories.includes(tk.category)));
  const actions = [
    tk.canManage && open && ['assign', UserCog, tk.techId ? t('mnt.reassign') : t('mnt.assign')],
    tk.canManage && ['ASSIGNED', 'WAITING_PARTS'].includes(tk.status) && ['IN_PROGRESS', Play, t('mnt.toInProgress')],
    tk.canManage && ['ASSIGNED', 'IN_PROGRESS'].includes(tk.status) && ['WAITING_PARTS', PackageOpen, t('mnt.toWaitingParts')],
    tk.canManage && open && tk.status !== 'NEW' && ['DONE', CheckCircle2, t('mnt.toDone')],
    tk.canApprove && tk.status === 'DONE' && ['approve', BadgeCheck, t('mnt.approve')],
    tk.canApprove && ['DONE', 'CLOSED'].includes(tk.status) && ['reopen', RotateCcw, t('mnt.reopen')],
    open && (tk.canManage || tk.status === 'NEW') && ['cancel', XCircle, t('mnt.cancel')],
    tk.canManage && open && canSeeModule(userData, 'procurement') && ['buy', ShoppingCart, t('mnt.buyParts')],
    tk.canManage && tk.status !== 'CANCELLED' && ['cost', Coins, t('mnt.costs.title')],
    ['comment', MessageSquare, t('mnt.comment')],
  ].filter(Boolean);
  const submitPanel = () => {
    if (panel === 'assign') return run('assign', { techId, note });
    if (['IN_PROGRESS', 'WAITING_PARTS', 'DONE'].includes(panel)) return run('status', { to: panel, note, parts, ...(tk.checklist.length ? { checklist: tk.checklist.map((_, i) => !!ticks[i]) } : {}) });
    if (panel === 'cost') return run('cost', { ...cost, note });
    if (panel === 'approve') return run('approve', { rating, note });
    return run(panel, { note });
  };
  const allTicked = tk.checklist.length > 0 && tk.checklist.every((_, i) => ticks[i]);
  const needsNote = (panel === 'DONE' && !allTicked) || ['reopen', 'cancel', 'comment'].includes(panel);
  const rows = [
    [t('mnt.branch'), branchName(tk.branch)],
    [t('mnt.place'), tk.place || '—'],
    ...(tk.assetName ? [[t('mnt.assets.one'), tk.assetName]] : []),
    [t('mnt.category'), `${CATEGORY_ICON[tk.category]} ${t(`mnt.categories.${tk.category}`)}`],
    [t('mnt.reporter'), `${tk.reporterName || '—'}${tk.source !== 'APP' ? ` · ${t(`mnt.sources.${tk.source}`)}` : ''}${tk.complaintNumber ? ` (${tk.complaintNumber})` : ''}`],
    [t('mnt.createdAt'), <span key="c" dir="ltr">{fmtDateTime(tk.createdAt)}</span>],
    [t('mnt.dueAt'), <span key="d" dir="ltr" className={late ? 'text-rose-700 font-bold' : ''}>{fmtDateTime(tk.dueAt)}</span>],
    [t('mnt.assignee'), tk.techName ? `${tk.techName}${tk.techKind === 'CONTRACTOR' ? ` · ${t('mnt.techKinds.CONTRACTOR')}` : ''}` : '—'],
    ...(tk.doneAt ? [[t('mnt.doneAt'), <span key="n" dir="ltr">{fmtDateTime(tk.doneAt)}</span>]] : []),
    ...(tk.cost ? [[t('mnt.costs.title'), `${tk.cost.total.toLocaleString('en-US')} ${t('proc.sar')} (${t('mnt.costs.labor')} ${tk.cost.labor} · ${t('mnt.costs.parts')} ${tk.cost.parts} · ${t('mnt.costs.contractor')} ${tk.cost.contractor})`]] : []),
    ...(tk.rating ? [[t('mnt.rating'), `${'★'.repeat(tk.rating)}${'☆'.repeat(5 - tk.rating)}${tk.ratingNote ? ` — ${tk.ratingNote}` : ''}`]] : []),
  ];

  return (
    <Modal onClose={onClose} size="max-w-3xl"
      title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr">{tk.number}</span><Pill className={STATUS_STYLE[tk.status]}>{t(`mnt.status.${tk.status}`)}</Pill><Pill className={PRIORITY_STYLE[tk.priority]}>{t(`mnt.priorities.${tk.priority}`)}</Pill>{late && <Pill className="bg-rose-50 text-rose-700 border-rose-200">{t('mnt.overdue')}</Pill>}</span>}
      subtitle={tk.title}
      footer={<button type="button" onClick={() => printWorkOrder({ tk, t, i18n, branchName })} className={btn.ghost}><Printer className="w-4 h-4" />{t('mnt.printOrder')}</button>}>
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-slate-500 shrink-0">{k}:</dt><dd className="text-slate-900">{v}</dd></div>)}
      </dl>
      {tk.description && <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3">{tk.description}</p>}
      <PhotoStrip photos={tk.photos} />
      {tk.procRequests.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {tk.procRequests.map((p) => <button key={p.id} type="button" onClick={() => navigate(`/procurement?openId=${encodeURIComponent(p.id)}`)} className="px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 flex items-center gap-1"><ShoppingCart className="w-3.5 h-3.5" />{t('mnt.procRequest', { n: p.number })}</button>)}
        </div>
      )}
      {tk.checklist.length > 0 && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-1">
          <p className="text-sm font-bold text-slate-800">{t('mnt.checklist')}</p>
          {tk.checklist.map((c, i) => <p key={i} className={`text-sm flex items-center gap-1.5 ${c.done ? 'text-emerald-700' : 'text-slate-500'}`}>{c.done ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}{c.text}</p>)}
        </div>
      )}
      {(tk.workNote || tk.parts || tk.workPhotos.length > 0) && (
        <div className="border border-emerald-100 bg-emerald-50/40 rounded-xl p-3 space-y-2">
          <p className="text-sm font-bold text-emerald-800">{t('mnt.workDone')}</p>
          {tk.workNote && <p className="text-sm text-slate-700 whitespace-pre-wrap">{tk.workNote}</p>}
          {tk.parts && <p className="text-xs text-slate-600">{t('mnt.parts')}: {tk.parts}</p>}
          <PhotoStrip photos={tk.workPhotos} />
        </div>
      )}

      {tk.canManage && open && (
        <div className="flex flex-wrap gap-2 items-end">
          <Field label={t('mnt.priority')}>
            <select value={tk.priority} disabled={!!busy} onChange={(e) => run('update', { priority: e.target.value })} className={inputCls}>{MNT_PRIORITIES.map((p) => <option key={p} value={p}>{t(`mnt.priorities.${p}`)}</option>)}</select>
          </Field>
          <Field label={t('mnt.category')}>
            <select value={tk.category} disabled={!!busy} onChange={(e) => run('update', { category: e.target.value })} className={inputCls}>{MNT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`mnt.categories.${c}`)}</option>)}</select>
          </Field>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.map(([k, Icon, label]) => (
          <button key={k} type="button" onClick={() => { if (k === 'buy') { setBuying(true); return; } if (k === 'cost') setCost({ labor: tk.cost?.labor ?? '', parts: tk.cost?.parts ?? '', contractor: tk.cost?.contractor ?? '' }); if (k === 'DONE') setTicks(tk.checklist.map((c) => c.done)); setPanel(panel === k ? '' : k); }} className={`${btn.small} px-3 py-2 border ${panel === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'}`}><Icon className="w-4 h-4" />{label}</button>
        ))}
      </div>
      {panel && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-3 bg-slate-50/60">
          {panel === 'assign' && (
            !techs ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : !techList.length ? <p className="text-sm text-amber-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{t('mnt.noTechs')}</p> : (
              <Field label={t('mnt.chooseTech')}>
                <select value={techId} onChange={(e) => setTechId(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {techList.map((x) => <option key={x.id} value={x.id}>{x.name}{x.company ? ` — ${x.company}` : ''}{x.categories.includes(tk.category) ? ` ✓ ${t(`mnt.categories.${tk.category}`)}` : ''}</option>)}
                </select>
              </Field>
            )
          )}
          {panel === 'approve' && (
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-600 me-2">{t('mnt.rateWork')}</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setRating(n)}><Star className={`w-6 h-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}
            </div>
          )}
          {panel === 'DONE' && tk.checklist.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">{t('mnt.checklist')}</p>
              {tk.checklist.map((c, i) => <label key={i} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!ticks[i]} onChange={(ev) => setTicks((x) => { const n = [...x]; n[i] = ev.target.checked; return n; })} />{c.text}</label>)}
            </div>
          )}
          {panel === 'cost' && (
            <div className="grid grid-cols-3 gap-2">
              {['labor', 'parts', 'contractor'].map((k) => <Field key={k} label={t(`mnt.costs.${k}`)}><input type="number" min="0" step="any" dir="ltr" value={cost[k]} onChange={(ev) => setCost((c) => ({ ...c, [k]: ev.target.value }))} className={inputCls} /></Field>)}
            </div>
          )}
          {['WAITING_PARTS', 'DONE'].includes(panel) && <Field label={panel === 'WAITING_PARTS' ? t('mnt.partsNeeded') : t('mnt.partsUsed')}><input value={parts} onChange={(e) => setParts(e.target.value)} className={inputCls} /></Field>}
          <Field label={t(`mnt.noteFor.${panel}`, { defaultValue: t('mnt.note') })} required={needsNote}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} /></Field>
          {['DONE', 'IN_PROGRESS', 'WAITING_PARTS'].includes(panel) && <PhotoPicker files={files} setFiles={setFiles} label={t('mnt.workPhotos')} />}
          <div className="flex gap-2">
            <button type="button" disabled={!!busy || (needsNote && !note.trim()) || (panel === 'assign' && !techId)} onClick={submitPanel} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('mnt.confirm')}</button>
            <button type="button" onClick={() => setPanel('')} className={btn.ghost}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {buying && <RequestForm initial={{ branch: tk.branch, mntTicketId: tk.id, mntTicketNumber: tk.number, title: t('mnt.buyTitle', { n: tk.number, title: tk.title }), items: tk.parts ? [{ name: tk.parts, qty: 1, unit: '', estPrice: '' }] : [] }} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); load(); onChanged?.(); }} />}
      <div>
        <p className="text-sm font-bold text-slate-800 mb-2">{t('mnt.history')}</p>
        <ol className="space-y-1.5 border-s-2 border-slate-200 ps-3">
          {[...tk.log].reverse().map((l) => (
            <li key={`${l.at}-${l.action}`} className="text-xs text-slate-600">
              <span className="font-bold text-slate-800">{t(`mnt.log.${l.action}`, { defaultValue: l.action })}</span>
              {l.to ? ` → ${l.to}` : ''} · {l.byName || '—'} · <span dir="ltr">{fmtDateTime(l.at)}</span>
              {l.note && <span className="block text-slate-700 whitespace-pre-wrap">{l.note}</span>}
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
