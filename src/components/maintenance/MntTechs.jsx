import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Pencil, Trash2, Copy, Check, KeyRound, HardHat, MessageCircle } from 'lucide-react';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { useBranches } from '../../hooks/useOrgData';
import { callMnt, MNT_CATEGORIES, CATEGORY_ICON } from '../../config/maintenance';
import { waLink } from '../../utils/whatsapp';

// In-house technicians and contractors. Each works on a link + PIN page
// (no account): the manager sends them both.
export default function MntTechs({ branchName, tickets }) {
  const { t } = useTranslation();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState('');
  const load = () => callMnt('techs').then((r) => setList(r.techs)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const copy = async (x) => {
    try { await navigator.clipboard.writeText(t('mnt.techs.shareText', { name: x.name, link: x.link, pin: x.pin })); setCopied(x.id); setTimeout(() => setCopied(''), 1500); } catch { /* clipboard refused */ }
  };
  const remove = async (x) => {
    if (!window.confirm(t('mnt.techs.deleteConfirm', { name: x.name }))) return;
    try { await callMnt('deleteTech', { id: x.id }); load(); } catch (err) { window.alert(err.message); }
  };
  const openOf = (id) => tickets.filter((x) => x.techId === id && ['ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(x.status)).length;

  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!list) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({})} className={btn.primary}><Plus className="w-4 h-4" />{t('mnt.techs.add')}</button>
        <p className="text-xs text-slate-500">{t('mnt.techs.hint')}</p>
      </div>
      {!list.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('mnt.techs.empty')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((x) => (
            <div key={x.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900 flex items-center gap-1.5"><HardHat className="w-4 h-4 text-primary" />{x.name}</p>
                  <p className="text-xs text-slate-500">{t(`mnt.techKinds.${x.kind}`)}{x.company ? ` · ${x.company}` : ''} · {x.branches.length ? x.branches.map(branchName).join('، ') : t('common.allBranches')}</p>
                </div>
                <Pill className="bg-amber-50 text-amber-800 border-amber-200">{t('mnt.techs.openN', { n: openOf(x.id) })}</Pill>
              </div>
              <div className="flex flex-wrap gap-1">{x.categories.map((c) => <Pill key={c} className="bg-slate-50 text-slate-600 border-slate-200">{CATEGORY_ICON[c]} {t(`mnt.categories.${c}`)}</Pill>)}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-slate-600"><KeyRound className="w-3.5 h-3.5" />{t('mnt.techs.pin')}: <b dir="ltr" className="font-mono">{x.pin}</b></span>
                <button type="button" onClick={() => copy(x)} className={`${btn.small} border border-slate-200 text-slate-600`}>{copied === x.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}{t('mnt.techs.copy')}</button>
                {x.phone && <a href={waLink(x.phone, t('mnt.techs.shareText', { name: x.name, link: x.link, pin: x.pin }))} target="_blank" rel="noreferrer" className={`${btn.small} border border-emerald-200 text-emerald-700`}><MessageCircle className="w-3.5 h-3.5" />{t('mnt.techs.wa')}</a>}
                <span className="flex-1" />
                <button type="button" onClick={() => setEditing(x)} className="p-1.5 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>
                <button type="button" onClick={() => remove(x)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <TechEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function TechEditor({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const [f, setF] = useState({ name: initial.name || '', phone: initial.phone || '', kind: initial.kind || 'TECH', company: initial.company || '', branches: initial.branches || [], categories: initial.categories || [], newPin: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const flip = (k, v) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));
  const save = async () => {
    setBusy(true);
    try { await callMnt('saveTech', { ...f, id: initial.id || '' }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? t('mnt.techs.edit') : t('mnt.techs.add')} onClose={onClose} size="max-w-xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !f.name.trim()} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('mnt.techs.name')} required><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.techs.phone')}><input value={f.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" className={inputCls} /></Field>
        <Field label={t('mnt.techs.kind')}><select value={f.kind} onChange={(e) => set('kind', e.target.value)} className={inputCls}>{['TECH', 'CONTRACTOR'].map((k) => <option key={k} value={k}>{t(`mnt.techKinds.${k}`)}</option>)}</select></Field>
        {f.kind === 'CONTRACTOR' && <Field label={t('mnt.techs.company')}><input value={f.company} onChange={(e) => set('company', e.target.value)} className={inputCls} /></Field>}
      </div>
      <Field label={t('mnt.techs.branches')} hint={t('mnt.techs.branchesHint')}>
        <div className="flex flex-wrap gap-1.5">{branches.map((b) => <button key={b.id} type="button" onClick={() => flip('branches', b.id)} className={`px-3 py-1.5 rounded-xl border text-sm ${f.branches.includes(b.id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{b.name}</button>)}</div>
      </Field>
      <Field label={t('mnt.techs.categories')}>
        <div className="flex flex-wrap gap-1.5">{MNT_CATEGORIES.map((c) => <button key={c} type="button" onClick={() => flip('categories', c)} className={`px-3 py-1.5 rounded-xl border text-sm ${f.categories.includes(c) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{CATEGORY_ICON[c]} {t(`mnt.categories.${c}`)}</button>)}</div>
      </Field>
      {initial.id && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.newPin} onChange={(e) => set('newPin', e.target.checked)} />{t('mnt.techs.newPin')}</label>}
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}
