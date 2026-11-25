import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Plus, Loader2, Pencil, Trash2, Printer, ShieldAlert, FileDown } from 'lucide-react';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { callMnt, ASSET_TYPES, ASSET_ICON, daysFromToday } from '../../config/maintenance';
import { printPage, escapeHtml as e } from '../../utils/printPage';
import { exportXlsx } from '../../utils/exportXlsx';

const selCls = `${inputCls.replace('w-full ', '')} w-auto`;

// The equipment register: each device with its place, serial, warranty and
// maintenance contract, how many faults and what they cost; a QR label
// on the device opens a report already tied to it.
export default function MntAssets({ branchName, manageBranches, tickets, onOpenTicket }) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState(null);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState(null);
  const [picked0, setBranch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);
  const [shown, setShown] = useState('');
  const load = () => Promise.all([callMnt('assets'), callMnt('places')]).then(([a, p]) => { setList(a.assets); setPlaces(p.places); }).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const branches = useMemo(() => [...new Set([...(list || []).map((a) => a.branch), ...manageBranches.filter((b) => b !== '*')])], [list, manageBranches]);
  const branch = picked0 || branches[0] || '';
  const stats = useMemo(() => {
    const m = {};
    tickets.forEach((x) => { if (!x.assetId) return; const s = m[x.assetId] || (m[x.assetId] = { faults: 0, cost: 0 }); if (x.source !== 'PM') s.faults += 1; s.cost += x.cost?.total || 0; });
    return m;
  }, [tickets]);
  const rows = (list || []).filter((a) => a.branch === branch && (!type || a.type === type));

  const remove = async (a) => {
    if (!window.confirm(t('mnt.assets.deleteConfirm', { name: a.name }))) return;
    try { await callMnt('deleteAsset', { id: a.id }); load(); } catch (err) { window.alert(err.message); }
  };
  const printLabels = async () => {
    const win = window.open('', '_blank');
    const chosen = rows.filter((a) => a.qr);
    const codes = await Promise.all(chosen.map((a) => QRCode.toDataURL(a.qr, { margin: 1, width: 320 })));
    const body = `<div class="grid">${chosen.map((a, i) => `<div class="lbl"><img src="${codes[i]}" alt=""><b>${e(a.name)}</b><span>${e(a.place || branchName(a.branch))}</span>${a.serial ? `<span dir="ltr">${e(a.serial)}</span>` : ''}<small>${e(t('mnt.places.scanHint'))}</small></div>`).join('')}</div>`;
    const css = `.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm}.lbl{border:1px dashed #94a3b8;border-radius:6px;padding:4mm;text-align:center;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:1.5mm;font-size:9pt}.lbl img{width:36mm;height:36mm}.lbl b{font-size:11pt}.lbl small{color:#475569}`;
    printPage({ title: t('mnt.assets.labelsTitle'), subtitle: branchName(branch), school: t('trips.print.school'), body, css, dir: i18n.dir(), lang: i18n.language, win });
  };
  const toExcel = () => exportXlsx(`assets-${branch}.xlsx`, t('mnt.tabs.assets'),
    [t('mnt.assets.name'), t('mnt.assets.type'), t('mnt.place'), t('mnt.assets.brand'), t('mnt.assets.model'), t('mnt.assets.serial'), t('mnt.assets.installDate'), t('mnt.assets.warrantyEnd'), t('mnt.assets.contractEnd'), t('mnt.assets.contractor'), t('mnt.assets.faults'), t('mnt.assets.cost')],
    rows.map((a) => [a.name, t(`mnt.assetTypes.${a.type}`), a.place, a.brand, a.model, a.serial, a.installDate, a.warrantyEnd, a.contractEnd, a.contractor, stats[a.id]?.faults || 0, stats[a.id]?.cost || 0]));

  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!list) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const expiry = (day, label) => {
    const d = daysFromToday(day);
    if (d == null || d > 30) return null;
    return <Pill className={d < 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200'}><ShieldAlert className="w-3 h-3 me-1" />{t(d < 0 ? 'mnt.assets.expired' : 'mnt.assets.expires', { what: label, date: `\u2066${day}\u2069` })}</Pill>;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {branches.length > 1 && <select value={branch} onChange={(ev) => setBranch(ev.target.value)} className={selCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <select value={type} onChange={(ev) => setType(ev.target.value)} className={selCls}><option value="">{t('mnt.assets.allTypes')}</option>{ASSET_TYPES.map((k) => <option key={k} value={k}>{ASSET_ICON[k]} {t(`mnt.assetTypes.${k}`)}</option>)}</select>
        <button type="button" onClick={() => setEditing({ branch })} className={btn.primary}><Plus className="w-4 h-4" />{t('mnt.assets.add')}</button>
        <button type="button" disabled={!rows.length} onClick={printLabels} className={btn.ghost}><Printer className="w-4 h-4" />{t('mnt.assets.printLabels')}</button>
        <button type="button" disabled={!rows.length} onClick={toExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('mnt.excel')}</button>
      </div>
      {!rows.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('mnt.assets.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {rows.map((a) => {
            const st = stats[a.id] || { faults: 0, cost: 0 };
            const hist = shown === a.id ? tickets.filter((x) => x.assetId === a.id) : [];
            return (
              <div key={a.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">{ASSET_ICON[a.type]}</span>
                  <span className="flex-1 min-w-48 text-sm">
                    <span className="font-medium text-slate-900">{a.name}</span>
                    <span className="block text-xs text-slate-500">{[t(`mnt.assetTypes.${a.type}`), a.place, [a.brand, a.model].filter(Boolean).join(' '), a.serial && `S/N ${a.serial}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  {expiry(a.warrantyEnd, t('mnt.assets.warranty'))}
                  {expiry(a.contractEnd, t('mnt.assets.contract'))}
                  <button type="button" onClick={() => setShown(shown === a.id ? '' : a.id)} className="text-xs text-primary">{t('mnt.assets.faultsN', { n: st.faults })}{st.cost ? ` · ${st.cost.toLocaleString('en-US')} ${t('proc.sar')}` : ''}</button>
                  <button type="button" onClick={() => setEditing(a)} className="p-1.5 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>
                  <button type="button" onClick={() => remove(a)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </div>
                {shown === a.id && (hist.length ? (
                  <ul className="text-xs space-y-1 ps-8">{hist.map((x) => <li key={x.id}><button type="button" onClick={() => onOpenTicket(x.id)} className="text-primary hover:underline"><span dir="ltr">{x.number}</span> — {x.title}</button> <span className="text-slate-400">· {t(`mnt.status.${x.status}`)}{x.cost?.total ? ` · ${x.cost.total}` : ''}</span></li>)}</ul>
                ) : <p className="text-xs text-slate-400 ps-8">{t('mnt.assets.noHistory')}</p>)}
              </div>
            );
          })}
        </div>
      )}
      {editing && <AssetEditor initial={editing} branches={branches} branchName={branchName} places={places} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AssetEditor({ initial, branches, branchName, places, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branch: branches[0] || '', name: '', type: 'AC', placeId: '', brand: '', model: '', serial: '', installDate: '', warrantyEnd: '', contractEnd: '', contractor: '', supplier: '', notes: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await callMnt('saveAsset', { ...f, id: initial.id || '' }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  const date = (k) => <input type="date" dir="ltr" value={f[k]} onChange={(ev) => set(k, ev.target.value)} className={inputCls} />;
  return (
    <Modal title={initial.id ? t('mnt.assets.edit') : t('mnt.assets.add')} onClose={onClose} size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !f.name.trim()} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!initial.id && branches.length > 1 && <Field label={t('mnt.branch')}><select value={f.branch} onChange={(ev) => setF((p) => ({ ...p, branch: ev.target.value, placeId: '' }))} className={inputCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></Field>}
        <Field label={t('mnt.assets.name')} required><input value={f.name} onChange={(ev) => set('name', ev.target.value)} placeholder={t('mnt.assets.nameHint')} className={inputCls} /></Field>
        <Field label={t('mnt.assets.type')}><select value={f.type} onChange={(ev) => set('type', ev.target.value)} className={inputCls}>{ASSET_TYPES.map((k) => <option key={k} value={k}>{ASSET_ICON[k]} {t(`mnt.assetTypes.${k}`)}</option>)}</select></Field>
        <Field label={t('mnt.place')}><select value={f.placeId} onChange={(ev) => set('placeId', ev.target.value)} className={inputCls}><option value="">—</option>{places.filter((p) => p.branch === f.branch).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label={t('mnt.assets.brand')}><input value={f.brand} onChange={(ev) => set('brand', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.assets.model')}><input value={f.model} onChange={(ev) => set('model', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.assets.serial')}><input value={f.serial} onChange={(ev) => set('serial', ev.target.value)} className={inputCls} dir="ltr" /></Field>
        <Field label={t('mnt.assets.installDate')}>{date('installDate')}</Field>
        <Field label={t('mnt.assets.warrantyEnd')}>{date('warrantyEnd')}</Field>
        <Field label={t('mnt.assets.contractEnd')}>{date('contractEnd')}</Field>
        <Field label={t('mnt.assets.contractor')}><input value={f.contractor} onChange={(ev) => set('contractor', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.assets.supplier')}><input value={f.supplier} onChange={(ev) => set('supplier', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.assets.notes')} className="sm:col-span-2"><textarea value={f.notes} onChange={(ev) => set('notes', ev.target.value)} rows={2} className={inputCls} /></Field>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}
