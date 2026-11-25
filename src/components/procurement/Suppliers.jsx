import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Pencil, Trash2, Building2, Star, AlertTriangle } from 'lucide-react';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { callProc, money, PROC_CATEGORIES } from '../../config/procurement';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const in30 = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() + 30 * 86400e3));

// The suppliers: CR and VAT numbers, contact, categories, CR expiry,
// rating from past orders and what was spent with them.
export default function Suppliers() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const load = () => callProc('suppliers').then(setData).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const remove = async (s) => {
    if (!window.confirm(t('proc.sup.deleteConfirm', { name: s.name }))) return;
    try { await callProc('deleteSupplier', { id: s.id }); load(); } catch (err) { window.alert(err.message); }
  };
  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const list = data.suppliers.filter((s) => !q || [s.name, s.crNumber, s.vatNumber, s.contactName].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {data.canEdit && <button type="button" onClick={() => setEditing({})} className={btn.primary}><Plus className="w-4 h-4" />{t('proc.sup.add')}</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('proc.sup.search')} className={`${inputCls} max-w-xs`} />
      </div>
      {!list.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('proc.sup.empty')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((s) => {
            const expired = s.crExpiry && s.crExpiry < today();
            const soon = s.crExpiry && !expired && s.crExpiry <= in30();
            return (
              <div key={s.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-primary" />{s.name}</p>
                  {s.rating > 0 && <span className="text-xs text-amber-700 flex items-center gap-0.5"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{s.rating} ({s.ratingCount})</span>}
                </div>
                <p className="text-xs text-slate-500">{t('proc.vatNumber')}: <span dir="ltr">{s.vatNumber || '—'}</span> · {t('proc.crNumber')}: <span dir="ltr">{s.crNumber || '—'}</span></p>
                {(s.contactName || s.phone) && <p className="text-xs text-slate-600">{s.contactName} <span dir="ltr">{s.phone}</span></p>}
                <div className="flex flex-wrap gap-1">{s.categories.map((c) => <Pill key={c} className="bg-slate-50 text-slate-600 border-slate-200">{t(`proc.categories.${c}`)}</Pill>)}</div>
                {(expired || soon) && <p className={`text-xs flex items-center gap-1 ${expired ? 'text-rose-700' : 'text-amber-700'}`}><AlertTriangle className="w-3.5 h-3.5" />{t(expired ? 'proc.sup.crExpired' : 'proc.sup.crSoon', { date: `\u2066${s.crExpiry}\u2069` })}</p>}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{t('proc.sup.orders', { n: s.orders })} · <span dir="ltr">{money(s.spent)}</span></span>
                  <span className="flex-1" />
                  {data.canEdit && <button type="button" onClick={() => setEditing(s)} className="p-1.5 hover:text-primary"><Pencil className="w-4 h-4" /></button>}
                  {data.canEdit && <button type="button" onClick={() => remove(s)} className="p-1.5 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <SupplierEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SupplierEditor({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: '', crNumber: '', vatNumber: '', contactName: '', phone: '', email: '', crExpiry: '', notes: '', categories: [], ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await callProc('saveSupplier', { ...f, id: initial.id || '' }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? t('proc.sup.edit') : t('proc.sup.add')} onClose={onClose} size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !f.name.trim()} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('proc.sup.name')} required className="sm:col-span-2"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
        <Field label={t('proc.crNumber')}><input value={f.crNumber} onChange={(e) => set('crNumber', e.target.value)} className={inputCls} dir="ltr" /></Field>
        <Field label={t('proc.sup.crExpiry')}><input type="date" dir="ltr" value={f.crExpiry} onChange={(e) => set('crExpiry', e.target.value)} className={inputCls} /></Field>
        <Field label={t('proc.vatNumber')} hint={t('proc.sup.vatHint')}><input value={f.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} className={inputCls} dir="ltr" /></Field>
        <Field label={t('proc.sup.contactName')}><input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} className={inputCls} /></Field>
        <Field label={t('proc.sup.phone')}><input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} dir="ltr" /></Field>
        <Field label={t('proc.sup.email')}><input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} dir="ltr" /></Field>
      </div>
      <Field label={t('proc.sup.categories')}>
        <div className="flex flex-wrap gap-1.5">{PROC_CATEGORIES.map((c) => <button key={c} type="button" onClick={() => set('categories', f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c])} className={`px-3 py-1.5 rounded-xl border text-sm ${f.categories.includes(c) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`proc.categories.${c}`)}</button>)}</div>
      </Field>
      <Field label={t('proc.sup.notes')}><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inputCls} /></Field>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}
