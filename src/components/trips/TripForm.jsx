import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { X, Save, Loader2, AlertTriangle } from 'lucide-react';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { userBranches } from '../../utils/scope';
import { TRIP_STAGES, TRIP_PAY_METHODS, tripConflicts } from '../../config/trips';

const EMPTY = {
  title: '', destination: '', objective: '', date: '', departTime: '07:30', returnTime: '13:00', meetingPoint: '',
  branches: [], departments: [], stages: [], capacity: '', fee: '', payDeadline: '', payMethods: ['BANK'],
  bankDetails: '', refundPolicy: '', requirements: '', supervisors: [], buses: '', notes: '',
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
export default function TripForm({ trip, allTrips, onClose, onSaved }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const departments = useDepartments();
  const users = useUsers();
  const scoped = userData?.role === 'ADMIN' || userData?.access === 'all';
  const branches = scoped ? allBranches : allBranches.filter((b) => userBranches(userData).includes(b.id));
  const [form, setForm] = useState(() => (trip
    ? { ...EMPTY, ...trip, capacity: trip.capacity || '', fee: trip.fee || '', buses: trip.buses || '' }
    : { ...EMPTY, branches: branches.length === 1 ? [branches[0].id] : [] }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v?.target ? v.target.value : v }));

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
      const { data } = await httpsCallable(functions, 'saveTrip')({ id: trip?.id || null, trip: form });
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

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Section title={t('trips.form.basics')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t('trips.form.titleLabel')}><input value={form.title} onChange={set('title')} className={inputCls} placeholder={t('trips.form.titlePlaceholder')} /></Field>
              <Field label={t('trips.form.destination')}><input value={form.destination} onChange={set('destination')} className={inputCls} /></Field>
              <Field label={t('trips.form.objective')} className="md:col-span-2"><textarea rows={2} value={form.objective} onChange={set('objective')} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.date')}><input type="date" value={form.date} onChange={set('date')} className={inputCls} /></Field>
              <Field label={t('trips.form.departTime')}><input type="time" value={form.departTime} onChange={set('departTime')} className={inputCls} /></Field>
              <Field label={t('trips.form.returnTime')}><input type="time" value={form.returnTime} onChange={set('returnTime')} className={inputCls} /></Field>
              <Field label={t('trips.form.meetingPoint')}><input value={form.meetingPoint} onChange={set('meetingPoint')} className={inputCls} /></Field>
            </div>
          </Section>

          <Section title={t('trips.form.targeting')}>
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
                  <Field label={t('trips.form.bankDetails')} hint={t('trips.form.bankDetailsHint')}><textarea rows={2} value={form.bankDetails} onChange={set('bankDetails')} className={inputCls} /></Field>
                )}
                <Field label={t('trips.form.refundPolicy')}><textarea rows={2} value={form.refundPolicy} onChange={set('refundPolicy')} className={inputCls} /></Field>
              </>
            )}
          </Section>

          <Section title={t('trips.form.operations')}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={t('trips.form.buses')}><input type="number" min="0" value={form.buses} onChange={set('buses')} className={inputCls} /></Field>
            </div>
            <Field label={t('trips.form.requirements')} hint={t('trips.form.requirementsHint')}><textarea rows={2} value={form.requirements} onChange={set('requirements')} className={inputCls} /></Field>
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
