import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Loader2, Link2, MessageCircle, KeyRound, Copy } from 'lucide-react';
import { callSupport } from '../../config/support';
import { waLink } from '../../utils/whatsapp';
import { Modal, Field, inputCls, btn } from '../platform/ui';

// The supervisors who take attendance: each has a link and a PIN (sent to
// them once); the attendance page shows only their groups.
export default function SupportSupervisors({ data, branchName, reload }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  const groupsOf = (id) => data.groups.filter((g) => g.supervisorId === id);
  const message = (s) => t('support.sup.message', { name: s.name, cycle: c.title, link: s.link, pin: s.pin });
  const copy = async (s) => { try { await navigator.clipboard.writeText(message(s)); setCopied(s.id); setTimeout(() => setCopied(''), 2000); } catch { window.prompt('', message(s)); } };
  const call = async (name, payload, key) => {
    setBusy(key);
    try { await callSupport(name, { id: c.id, ...payload }); await reload(); } catch (err) { window.alert(err.message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({})} className={btn.primary}><Plus className="w-4 h-4" />{t('support.sup.add')}</button>
        <p className="text-sm text-slate-500">{t('support.sup.hint')}</p>
      </div>
      {!data.supervisors.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.sup.empty')}</div> : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          {data.supervisors.map((s) => (
            <div key={s.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48">
                <p className="font-medium text-slate-900">{s.name}</p>
                <p className="text-xs text-slate-500">{[branchName(s.branch), s.phone && <span key="p" dir="ltr">{s.phone}</span>].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}</p>
                <p className="text-xs text-slate-600 mt-1">{groupsOf(s.id).length ? groupsOf(s.id).map((g) => g.name).join('، ') : <span className="text-amber-700">{t('support.sup.noGroups')}</span>}</p>
              </div>
              <div className="text-sm flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-slate-400" /><span className="font-mono font-bold tracking-widest" dir="ltr">{s.pin}</span></div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => copy(s)} className={btn.ghost}>{copied === s.id ? <Copy className="w-4 h-4 text-emerald-600" /> : <Link2 className="w-4 h-4" />}{copied === s.id ? t('support.sup.copied') : t('support.sup.copy')}</button>
                {s.phone && <a href={waLink(s.phone, message(s))} target="_blank" rel="noreferrer" className={btn.ghost}><MessageCircle className="w-4 h-4 text-emerald-600" />{t('support.act.whatsapp')}</a>}
                <button type="button" title={t('support.edit')} onClick={() => setEditing(s)} className="p-2 rounded-lg border border-slate-200 text-slate-500"><Pencil className="w-4 h-4" /></button>
                <button type="button" title={t('support.sup.delete')} disabled={busy === s.id} onClick={() => { if (window.confirm(t('support.sup.deleteConfirm', { name: s.name }))) call('supportDeleteSupervisor', { supervisorId: s.id }, s.id); }} className="p-2 rounded-lg border border-slate-200 text-rose-600">{busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SupervisorEditor cycle={c} branchName={branchName} sup={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </div>
  );
}

function SupervisorEditor({ cycle, branchName, sup, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: sup.name || '', phone: sup.phone || '', branch: sup.branch || cycle.branches[0] || '', newPin: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await callSupport('supportSaveSupervisor', { id: cycle.id, supervisorId: sup.id, ...f }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={sup.id ? t('support.sup.editTitle') : t('support.sup.newTitle')} onClose={onClose} size="max-w-md"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <Field label={t('support.sup.name')} required><input value={f.name} onChange={set('name')} className={inputCls} /></Field>
      <Field label={t('support.sup.phone')}><input value={f.phone} onChange={set('phone')} className={inputCls} dir="ltr" /></Field>
      {cycle.branches.length > 0 && <Field label={t('common.branch')}><select value={f.branch} onChange={set('branch')} className={inputCls}>{cycle.branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></Field>}
      {sup.id && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.newPin} onChange={(e) => setF((x) => ({ ...x, newPin: e.target.checked }))} />{t('support.sup.newPin')}</label>}
    </Modal>
  );
}
