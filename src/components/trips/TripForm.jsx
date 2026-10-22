import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { X, Save, Loader2, AlertTriangle, ImagePlus, FileText, Trash2 } from 'lucide-react';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from '../../utils/publicSubmission';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { userBranches } from '../../utils/scope';
import { TRIP_STAGES, TRIP_PAY_METHODS, TRIP_GENDERS, tripConflicts, TRIP_BANK_LETTER_URL } from '../../config/trips';

const EMPTY = {
  title: '', destination: '', objective: '', date: '', departTime: '07:30', returnTime: '13:00', meetingPoint: '',
  branches: [], departments: [], stages: [], capacity: '', fee: '', payDeadline: '', payMethods: ['BANK'],
  bankDetails: '', refundPolicy: '', requirements: '', supervisors: [], buses: '', notes: '',
  gender: 'ALL', pledgeRequired: false,
  en: { title: '', destination: '', objective: '', meetingPoint: '', requirements: '', bankDetails: '', refundPolicy: '' },
};

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

function Section({ title, children }) {
  return (
    <section className="border border-slate-100 rounded-2xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children, hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Chips({ options, value, onChange, ltr }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => toggle(id)}
          dir={ltr ? 'ltr' : undefined}
          className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${value.includes(id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Create / edit a trip (saveTrip). A new trip starts as a draft; it's sent
// for the principal's approval from the trip details.
function TripFormInner({ trip, tripPassword, allTrips, onClose, onSaved }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const departments = useDepartments();
  const users = useUsers();
  const scoped = userData?.role === 'ADMIN' || userData?.access === 'all';
  const branches = scoped ? allBranches : allBranches.filter((b) => userBranches(userData).includes(b.id));
  const [form, setForm] = useState(() => (trip
    ? { ...EMPTY, ...trip, en: { ...EMPTY.en, ...(trip.en || {}) }, capacity: trip.capacity || '', fee: trip.fee || '', buses: trip.buses || '' }
    : { ...EMPTY, branches: branches.length === 1 ? [branches[0].id] : [] }));
  const [saving, setSaving] = useState(false);
  // Cover image and pledge sheet template: new file to upload, or 'remove'.
  const [image, setImage] = useState(null);
  const [pledgeFile, setPledgeFile] = useState(null);
  const [error, setError] = useState(null);
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v?.target ? v.target.value : v }));
  // English wording under an Arabic field (shown on the parents' page in English).
  const en = (key, rows) => {
    const props = { dir: 'ltr', value: form.en[key], placeholder: t('trips.form.enPlaceholder'), onChange: (e) => setForm((f) => ({ ...f, en: { ...f.en, [key]: e.target.value } })), className: `${inputCls} mt-1.5 bg-slate-50 text-sm` };
    return rows ? <textarea rows={rows} {...props} /> : <input {...props} />;
  };

  const staff = useMemo(() => users
    .filter((u) => u.active !== false && u.role !== 'RECEPTIONIST' && (u.access === 'all' || u.role === 'ADMIN' || userBranches(u).some((b) => form.branches.includes(b))))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar')), [users, form.branches]);
  const conflicts = tripConflicts({ ...form, id: trip?.id }, allTrips);

  const save = async () => {
    setError(null);
    if (!form.title.trim() || !form.destination.trim() || !form.date || !form.branches.length) {
      setError(t('trips.form.requiredError'));
      return;
    }
    setSaving(true);
    try {
      const { data } = await httpsCallable(functions, 'saveTrip')({ id: trip?.id || null, trip: form, tripPassword });
      const setMedia = httpsCallable(functions, 'setTripMedia');
      for (const [kind, f] of [['image', image], ['pledgeTemplate', pledgeFile]]) {
        if (!f) continue;
        if (f === 'remove') { await setMedia({ id: data.id, kind, file: null }); continue; }
        if (f.size > MAX_PUBLIC_FILE_BYTES) throw new Error(t('trips.form.fileTooBig'));
        await setMedia({ id: data.id, kind, file: { fileName: f.name, mimeType: f.type || 'application/octet-stream', base64Data: await fileToBase64(f) } });
      }
      await onSaved(data.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{trip ? t('trips.form.editTitle') : t('trips.form.newTitle')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('trips.form.subtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          <Section title={t('trips.form.basics')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t('trips.form.titleLabel')}><input value={form.title} onChange={set('title')} className={inputCls} placeholder={t('trips.form.titlePlaceholder')} />{en('title')}</Field>
              <Field label={t('trips.form.destination')}><input value={form.destination} onChange={set('destination')} className={inputCls} />{en('destination')}</Field>
              <Field label={t('trips.form.objective')} className="md:col-span-2"><textarea rows={2} value={form.objective} onChange={set('objective')} className={inputCls} />{en('objective', 2)}</Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.date')}><input type="date" value={form.date} onChange={set('date')} className={inputCls} /></Field>
              <Field label={t('trips.form.departTime')}><input type="time" value={form.departTime} onChange={set('departTime')} className={inputCls} /></Field>
              <Field label={t('trips.form.returnTime')}><input type="time" value={form.returnTime} onChange={set('returnTime')} className={inputCls} /></Field>
              <Field label={t('trips.form.meetingPoint')}><input value={form.meetingPoint} onChange={set('meetingPoint')} className={inputCls} />{en('meetingPoint')}</Field>
            </div>
          </Section>

          <Section title={t('trips.form.targeting')}>
            <Field label={t('trips.form.gender')} hint={t('trips.form.genderHint')}>
              <div className="flex gap-1.5">
                {TRIP_GENDERS.map((g) => (
                  <button key={g} type="button" onClick={() => setForm((f) => ({ ...f, gender: g }))} className={`px-3 py-1.5 rounded-lg text-sm border ${(form.gender || 'ALL') === g ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`trips.gender.${g}`)}</button>
                ))}
              </div>
            </Field>
            <Field label={t('trips.form.branches')}><Chips options={branches.map((b) => [b.id, b.name])} value={form.branches} onChange={set('branches')} /></Field>
            <Field label={t('trips.form.sections')} hint={t('trips.form.sectionsHint')}><Chips options={departments.map((d) => [d.id, d.name])} value={form.departments} onChange={set('departments')} /></Field>
            <Field label={t('trips.form.grades')} hint={t('trips.form.gradesHint')}><Chips ltr options={TRIP_STAGES.map((s) => [s, s])} value={form.stages} onChange={set('stages')} /></Field>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.capacity')} hint={t('trips.form.capacityHint')}><input type="number" min="0" value={form.capacity} onChange={set('capacity')} className={inputCls} /></Field>
            </div>
            {conflicts.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('trips.conflictWarning', { list: conflicts.map((c) => c.title).join('، ') })}</span>
              </div>
            )}
          </Section>

          <Section title={t('trips.form.cost')}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.fee')} hint={t('trips.form.feeHint')}><input type="number" min="0" step="0.5" value={form.fee} onChange={set('fee')} className={inputCls} /></Field>
              <Field label={t('trips.form.payDeadline')} hint={t('trips.form.payDeadlineHint')}><input type="date" value={form.payDeadline} max={form.date || undefined} onChange={set('payDeadline')} className={inputCls} /></Field>
            </div>
            {Number(form.fee) > 0 && (
              <>
                <Field label={t('trips.form.payMethods')}><Chips options={TRIP_PAY_METHODS.map((m) => [m, t(`trips.payMethod.${m}`)])} value={form.payMethods} onChange={set('payMethods')} /></Field>
                {form.payMethods.includes('BANK') && (
                  <Field label={t('trips.form.bankDetails')} hint={t('trips.form.bankDetailsHint')}><textarea rows={2} value={form.bankDetails} onChange={set('bankDetails')} className={inputCls} />{en('bankDetails', 2)}
                    {TRIP_BANK_LETTER_URL && <a href={TRIP_BANK_LETTER_URL} target="_blank" rel="noreferrer" className="mt-1 text-xs text-primary hover:underline inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{t('trips.bankLetterAttached')}</a>}
                  </Field>
                )}
                <Field label={t('trips.form.refundPolicy')}><textarea rows={2} value={form.refundPolicy} onChange={set('refundPolicy')} className={inputCls} />{en('refundPolicy', 2)}</Field>
              </>
            )}
          </Section>

          <Section title={t('trips.form.mediaTitle')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t('trips.form.image')} hint={t('trips.form.imageHint')}>
                {(image && image !== 'remove') || (trip?.imageUrl && image !== 'remove') ? (
                  <div className="flex items-center gap-3">
                    <img src={image && image !== 'remove' ? URL.createObjectURL(image) : trip.imageUrl} alt="" className="w-24 h-16 object-cover rounded-lg border border-slate-200" />
                    <button type="button" onClick={() => setImage(trip?.imageUrl ? 'remove' : null)} className="text-xs text-rose-600 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />{t('common.delete')}</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-600 cursor-pointer hover:bg-slate-50">
                    <ImagePlus className="w-4 h-4 text-slate-400" />{t('trips.form.pickImage')}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setImage(e.target.files?.[0] || null)} />
                  </label>
                )}
              </Field>
              <Field label={t('trips.form.pledgeTemplate')} hint={t('trips.form.pledgeTemplateHint')}>
                {(pledgeFile && pledgeFile !== 'remove') || (trip?.pledgeTemplate && pledgeFile !== 'remove') ? (
                  <div className="flex items-center gap-3 text-sm">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="truncate">{pledgeFile && pledgeFile !== 'remove' ? pledgeFile.name : trip.pledgeTemplate.fileName}</span>
                    <button type="button" onClick={() => setPledgeFile(trip?.pledgeTemplate ? 'remove' : null)} className="text-xs text-rose-600 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />{t('common.delete')}</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-600 cursor-pointer hover:bg-slate-50">
                    <FileText className="w-4 h-4 text-slate-400" />{t('trips.form.pickPledge')}
                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setPledgeFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </Field>
            </div>
          </Section>

          <Section title={t('trips.form.operations')}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.buses')}><input type="number" min="0" value={form.buses} onChange={set('buses')} className={inputCls} /></Field>
            </div>
            <Field label={t('trips.form.requirements')} hint={t('trips.form.requirementsHint')}><textarea rows={2} value={form.requirements} onChange={set('requirements')} className={inputCls} />{en('requirements', 2)}</Field>
            <Field label={t('trips.form.supervisors')} hint={t('trips.form.supervisorsHint')}>
              {form.branches.length === 0
                ? <p className="text-xs text-slate-400">{t('trips.form.pickBranchFirst')}</p>
                : <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2"><Chips options={staff.map((u) => [u.id, u.name || u.email])} value={form.supervisors} onChange={set('supervisors')} /></div>}
            </Field>
            <Field label={t('trips.form.notes')}><textarea rows={2} value={form.notes} onChange={set('notes')} className={inputCls} /></Field>
          </Section>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">{error}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
            <button onClick={save} disabled={saving} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {trip ? t('common.save') : t('trips.form.createDraft')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Rendered on <body> so the modal sits above the whole app shell — inside
// <main> (its own stacking context) the sidebar covered its right edge.
export default function TripForm(props) {
  return createPortal(<TripFormInner {...props} />, document.body);
}
