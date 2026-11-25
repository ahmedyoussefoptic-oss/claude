import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send } from 'lucide-react';
import { Modal, Field, inputCls, btn } from '../platform/ui';
import { useBranches } from '../../hooks/useOrgData';
import useAuthStore from '../../stores/useAuthStore';
import { userBranches } from '../../utils/scope';
import { callMnt, photoPayload, MNT_CATEGORIES, MNT_PRIORITIES, CATEGORY_ICON } from '../../config/maintenance';
import PhotoPicker from './PhotoPicker';

// A new work order from the app: the place (from the branch's list, or typed),
// the category, the urgency, a description and photos. `initial` prefills it
// (a parent's complaint turned into a work order carries complaintId).
export default function TicketForm({ onClose, onSaved, initial = {}, canManage = false }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const branches = useMemo(() => (userData?.role === 'ADMIN' || userData?.access === 'all' ? allBranches : allBranches.filter((b) => userBranches(userData).includes(b.id))), [allBranches, userData]);
  const [form, setForm] = useState({ branch: initial.branch || '', placeId: '', placeText: '', category: initial.category || 'OTHER', priority: 'NORMAL', title: initial.title || '', description: initial.description || '' });
  const [files, setFiles] = useState([]);
  const [places, setPlaces] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => { callMnt('places').then((r) => setPlaces(r.places)).catch(() => setPlaces([])); }, []);
  // One branch: chosen already.
  const branchId = form.branch || (branches.length === 1 ? branches[0].id : '');
  const branchPlaces = (places || []).filter((p) => p.branch === branchId);
  // Raising the urgency to «طارئ» is for managers and safety hazards.
  const priorities = canManage || form.category === 'SAFETY' ? MNT_PRIORITIES : MNT_PRIORITIES.filter((p) => p !== 'URGENT');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const photos = await Promise.all(files.map(photoPayload));
      const r = await callMnt('create', { ...form, branch: branchId, placeId: form.placeId || '', complaintId: initial.complaintId || '', photos });
      onSaved?.(r);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={initial.complaintId ? t('mnt.fromComplaintTitle', { n: initial.complaintNumber || '' }) : t('mnt.newTicket')} onClose={onClose} size="max-w-2xl"
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
        <button type="submit" form="mnt-ticket-form" disabled={busy || !form.title.trim() || !branchId} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('mnt.send')}</button>
      </>}>
      <form id="mnt-ticket-form" onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={t('mnt.branch')} required>
          <select value={branchId} onChange={(e) => setForm((p) => ({ ...p, branch: e.target.value, placeId: '' }))} className={inputCls}>
            <option value="">{t('mnt.chooseBranch')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label={t('mnt.place')}>
          {branchPlaces.length > 0 ? (
            <select value={form.placeId} onChange={(e) => set('placeId', e.target.value)} className={inputCls}>
              <option value="">{t('mnt.placeOther')}</option>
              {branchPlaces.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          ) : <input value={form.placeText} onChange={(e) => set('placeText', e.target.value)} placeholder={t('mnt.placeTextHint')} className={inputCls} />}
        </Field>
        {branchPlaces.length > 0 && !form.placeId && (
          <Field label={t('mnt.placeText')} className="md:col-span-2"><input value={form.placeText} onChange={(e) => set('placeText', e.target.value)} placeholder={t('mnt.placeTextHint')} className={inputCls} /></Field>
        )}
        <Field label={t('mnt.category')} className="md:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {MNT_CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => set('category', c)} className={`px-3 py-1.5 rounded-xl border text-sm ${form.category === c ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'}`}>{CATEGORY_ICON[c]} {t(`mnt.categories.${c}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('mnt.priority')} className="md:col-span-2" hint={!canManage ? t('mnt.priorityHint') : ''}>
          <div className="flex flex-wrap gap-1.5">
            {priorities.map((p) => (
              <button key={p} type="button" onClick={() => set('priority', p)} className={`px-3 py-1.5 rounded-xl border text-sm ${form.priority === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`mnt.priorities.${p}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('mnt.titleField')} required className="md:col-span-2"><input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={140} placeholder={t('mnt.titleHint')} className={inputCls} /></Field>
        <Field label={t('mnt.description')} className="md:col-span-2"><textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={3000} className={inputCls} /></Field>
        <div className="md:col-span-2"><PhotoPicker files={files} setFiles={setFiles} /></div>
        {error && <p className="md:col-span-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      </form>
    </Modal>
  );
}
