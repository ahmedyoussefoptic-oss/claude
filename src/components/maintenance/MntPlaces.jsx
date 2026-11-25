import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Plus, Loader2, Pencil, Trash2, QrCode, ListPlus, Printer } from 'lucide-react';
import { Modal, Field, inputCls, btn } from '../platform/ui';
import { callMnt, PLACE_KINDS } from '../../config/maintenance';
import { printPage, escapeHtml as e } from '../../utils/printPage';

// A filter drop-down sized to its content.
const selCls = `${inputCls.replace('w-full ', '')} w-auto`;

// The places of each branch (building · floor · room) and their QR labels:
// a staff member scans one to report a fault there without signing in.
export default function MntPlaces({ branchName, manageBranches }) {
  const { t, i18n } = useTranslation();
  const [places, setPlaces] = useState(null);
  const [error, setError] = useState(null);
  const [picked0, setBranch] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => callMnt('places').then((r) => setPlaces(r.places.filter((p) => p.qr))).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const branches = useMemo(() => [...new Set([...(places || []).map((p) => p.branch), ...manageBranches.filter((b) => b !== '*')])], [places, manageBranches]);
  const branch = picked0 || branches[0] || '';
  const list = (places || []).filter((p) => p.branch === branch);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const remove = async (p) => {
    if (!window.confirm(t('mnt.places.deleteConfirm', { name: p.label }))) return;
    setBusy(true);
    try { await callMnt('deletePlace', { id: p.id }); await load(); } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  };
  // QR labels, six to an A4 page.
  const printLabels = async () => {
    const chosen = list.filter((p) => !picked.size || picked.has(p.id));
    const win = window.open('', '_blank');
    const codes = await Promise.all(chosen.map((p) => QRCode.toDataURL(p.qr, { margin: 1, width: 360 })));
    const body = `<div class="grid">${chosen.map((p, i) => `<div class="lbl"><img src="${codes[i]}" alt=""><b>${e(p.label)}</b><span>${e(branchName(p.branch))}</span><small>${e(t('mnt.places.scanHint'))}</small></div>`).join('')}</div>`;
    const css = `.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.lbl{border:1px dashed #94a3b8;border-radius:6px;padding:6mm;text-align:center;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:2mm}.lbl img{width:45mm;height:45mm}.lbl b{font-size:13pt}.lbl small{color:#475569}`;
    printPage({ title: t('mnt.places.labelsTitle'), subtitle: branchName(branch), school: t('trips.print.school'), body, css, dir: i18n.dir(), lang: i18n.language, win });
  };

  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!places) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {branches.length > 1 && <select value={branch} onChange={(ev) => { setBranch(ev.target.value); setPicked(new Set()); }} className={selCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <button type="button" onClick={() => setEditing({ branch })} className={btn.primary}><Plus className="w-4 h-4" />{t('mnt.places.add')}</button>
        <button type="button" onClick={() => setImporting(true)} className={btn.ghost}><ListPlus className="w-4 h-4" />{t('mnt.places.bulk')}</button>
        <button type="button" disabled={!list.length} onClick={printLabels} className={btn.ghost}><Printer className="w-4 h-4" />{picked.size ? t('mnt.places.printPicked', { n: picked.size }) : t('mnt.places.printAll')}</button>
      </div>
      <p className="text-xs text-slate-500">{t('mnt.places.hint')}</p>
      {!list.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('mnt.places.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {list.map((p) => (
            <div key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <QrCode className="w-4 h-4 text-slate-400" />
              <span className="flex-1 min-w-40 text-sm"><span className="font-medium text-slate-900">{p.label}</span> <span className="text-xs text-slate-400">{t(`mnt.placeKinds.${p.kind}`)}</span></span>
              <a href={p.qr} target="_blank" rel="noreferrer" className="text-xs text-primary" dir="ltr">{t('mnt.places.openLink')}</a>
              <button type="button" onClick={() => setEditing(p)} className="p-1.5 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>
              <button type="button" disabled={busy} onClick={() => remove(p)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {editing && <PlaceEditor initial={editing} branches={branches} branchName={branchName} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {importing && <PlaceImport branch={branch} branchName={branchName} onClose={() => setImporting(false)} onSaved={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function PlaceEditor({ initial, branches, branchName, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branch: initial.branch || branches[0] || '', building: initial.building || '', floor: initial.floor || '', room: initial.room || '', kind: initial.kind || 'CLASSROOM' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await callMnt('savePlace', { ...f, id: initial.id || '' }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? t('mnt.places.edit') : t('mnt.places.add')} onClose={onClose} size="max-w-lg"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || (!f.room.trim() && !f.building.trim())} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        {!initial.id && branches.length > 1 && <Field label={t('mnt.branch')} className="col-span-2"><select value={f.branch} onChange={(ev) => set('branch', ev.target.value)} className={inputCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></Field>}
        <Field label={t('mnt.places.building')}><input value={f.building} onChange={(ev) => set('building', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.places.floor')}><input value={f.floor} onChange={(ev) => set('floor', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.places.room')} required><input value={f.room} onChange={(ev) => set('room', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.places.kind')}><select value={f.kind} onChange={(ev) => set('kind', ev.target.value)} className={inputCls}>{PLACE_KINDS.map((k) => <option key={k} value={k}>{t(`mnt.placeKinds.${k}`)}</option>)}</select></Field>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}

// Many rooms at once, one per line: «المبنى / الدور / الغرفة» (or just the room).
function PlaceImport({ branch, branchName, onClose, onSaved }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [kind, setKind] = useState('CLASSROOM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const rows = text.split('\n').map((l) => l.split(/[/|\t،,]/).map((x) => x.trim())).filter((p) => p.some(Boolean))
    .map((p) => (p.length === 1 ? { room: p[0] } : p.length === 2 ? { building: p[0], room: p[1] } : { building: p[0], floor: p[1], room: p.slice(2).join(' ') }));
  const save = async () => {
    setBusy(true);
    try { await callMnt('importPlaces', { branch, kind, rows }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={t('mnt.places.bulk')} subtitle={branchName(branch)} onClose={onClose} size="max-w-lg"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !rows.length} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('mnt.places.addN', { n: rows.length })}</button></>}>
      <p className="text-xs text-slate-500">{t('mnt.places.bulkHint')}</p>
      <textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={10} className={inputCls} placeholder={t('mnt.places.bulkExample')} />
      <Field label={t('mnt.places.kind')}><select value={kind} onChange={(ev) => setKind(ev.target.value)} className={inputCls}>{PLACE_KINDS.map((k) => <option key={k} value={k}>{t(`mnt.placeKinds.${k}`)}</option>)}</select></Field>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}
