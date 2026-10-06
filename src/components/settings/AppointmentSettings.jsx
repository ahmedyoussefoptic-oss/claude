import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { CalendarClock, Save, Check, Loader2 } from 'lucide-react';
import { db } from '../../config/firebase';

const DEFAULTS = { days: [0, 1, 2, 3, 4], start: '08:00', end: '13:00', slotMinutes: 30, capacity: 1, daysAhead: 14, minNoticeHours: 12 };
const DAYS = [0, 1, 2, 3, 4, 5, 6];

// When parents may book a school visit (settings/appointments) — read by
// getAvailableSlots / reserveAppointment in functions/index.js.
export default function AppointmentSettings() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'appointments'), (snap) => setDraft({ ...DEFAULTS, ...(snap.exists() ? snap.data() : {}) }), () => {});
    return () => unsubscribe();
  }, []);

  const save = async () => {
    setError(null);
    if (!draft.days.length) { setError(t('slaSettings.noDaysError')); return; }
    if (!(draft.end > draft.start)) { setError(t('slaSettings.hoursError')); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'appointments'), {
        days: draft.days,
        start: draft.start,
        end: draft.end,
        slotMinutes: Math.max(5, Number(draft.slotMinutes) || 30),
        capacity: Math.max(1, Number(draft.capacity) || 1),
        daysAhead: Math.max(1, Number(draft.daysAhead) || 14),
        minNoticeHours: Math.max(0, Number(draft.minNoticeHours) || 0),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary bg-white';
  const num = (id, key) => (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-600 mb-1">{t(`appointmentSettings.${key}`)}</label>
      <input id={id} type="number" min="0" value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} className={inputCls} />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <div>
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" />{t('appointmentSettings.title')}</h3>
        <p className="text-sm text-slate-500 mt-1">{t('appointmentSettings.subtitle')}</p>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{error}</div>}
      <div>
        <p className="text-xs text-slate-600 mb-1.5">{t('appointmentSettings.days')}</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button key={d} type="button" onClick={() => setDraft((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d].sort() }))} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${draft.days.includes(d) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
              {t(`slaSettings.days.${d}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="appt-start" className="block text-xs text-slate-600 mb-1">{t('appointmentSettings.start')}</label>
          <input id="appt-start" type="time" dir="ltr" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label htmlFor="appt-end" className="block text-xs text-slate-600 mb-1">{t('appointmentSettings.end')}</label>
          <input id="appt-end" type="time" dir="ltr" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} className={inputCls} />
        </div>
        {num('appt-slot', 'slotMinutes')}
        {num('appt-cap', 'capacity')}
        {num('appt-ahead', 'daysAhead')}
        {num('appt-notice', 'minNoticeHours')}
      </div>
      <p className="text-xs text-slate-500">{t('appointmentSettings.categoryHint')}</p>
      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark flex items-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saved ? t('waApi.saved') : t('common.save')}
      </button>
    </div>
  );
}
