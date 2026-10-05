import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, setDoc } from 'firebase/firestore';
import { Timer, Save, Check, Loader2 } from 'lucide-react';
import { db } from '../../config/firebase';
import { useSlaSettings, DEFAULT_SLA, businessMs } from '../../utils/businessTime';

const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

// Resolution-time (SLA) targets and the working-time rules used to count
// them — read by the Cloud Functions that set due dates (settings/sla) and
// by every "resolution time" shown in the app.
export default function SlaSettings() {
  const { t } = useTranslation();
  const cfg = useSlaSettings();
  const [draft, setDraft] = useState(DEFAULT_SLA);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setDraft(cfg); }, [cfg]);

  const setHours = (p, v) => setDraft((d) => ({ ...d, complaintHours: { ...d.complaintHours, [p]: v } }));
  const toggleDay = (day) => setDraft((d) => ({ ...d, workDays: d.workDays.includes(day) ? d.workDays.filter((x) => x !== day) : [...d.workDays, day].sort() }));

  // Working hours per day, to show what an SLA in hours means in days.
  const dayHours = businessMs(Date.UTC(2026, 9, 4, -3), Date.UTC(2026, 9, 5, -3), { ...draft, workDays: [0, 1, 2, 3, 4, 5, 6] }) / 3600000;

  const save = async () => {
    setError(null);
    const num = (v, f) => (Number(v) > 0 ? Number(v) : f);
    if (!draft.workDays.length) { setError(t('slaSettings.noDaysError')); return; }
    if (draft.businessHoursOnly && !(draft.workEnd > draft.workStart)) { setError(t('slaSettings.hoursError')); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'sla'), {
        complaintHours: Object.fromEntries(PRIORITIES.map((p) => [p, num(draft.complaintHours[p], DEFAULT_SLA.complaintHours[p])])),
        techHours: num(draft.techHours, DEFAULT_SLA.techHours),
        businessHoursOnly: !!draft.businessHoursOnly,
        workDays: draft.workDays,
        workStart: draft.workStart,
        workEnd: draft.workEnd,
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

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <div>
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><Timer className="w-5 h-5 text-primary" />{t('slaSettings.title')}</h3>
        <p className="text-sm text-slate-500 mt-1">{t('slaSettings.subtitle')}</p>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{error}</div>}

      <div>
        <p className="text-sm font-bold text-slate-700 mb-2">{t('slaSettings.targetsTitle')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PRIORITIES.map((p) => (
            <div key={p}>
              <label htmlFor={`sla-${p}`} className="block text-xs text-slate-600 mb-1">{t('slaSettings.complaintPriority', { priority: t(`complaintForm.priorities.${p}`) })}</label>
              <input id={`sla-${p}`} type="number" min="1" value={draft.complaintHours[p]} onChange={(e) => setHours(p, e.target.value)} className={inputCls} />
            </div>
          ))}
          <div>
            <label htmlFor="sla-tech" className="block text-xs text-slate-600 mb-1">{t('slaSettings.techTickets')}</label>
            <input id="sla-tech" type="number" min="1" value={draft.techHours} onChange={(e) => setDraft((d) => ({ ...d, techHours: e.target.value }))} className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1.5">{t('slaSettings.hoursUnit')}</p>
      </div>

      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
        <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" className="mt-1" checked={!!draft.businessHoursOnly} onChange={(e) => setDraft((d) => ({ ...d, businessHoursOnly: e.target.checked }))} />
          <span>
            {t('slaSettings.businessOnly')}
            <span className="block text-xs text-slate-500 font-normal mt-0.5">{t('slaSettings.businessOnlyHint')}</span>
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div>
            <label htmlFor="sla-start" className="block text-xs text-slate-600 mb-1">{t('slaSettings.workStart')}</label>
            <input id="sla-start" type="time" dir="ltr" value={draft.workStart} disabled={!draft.businessHoursOnly} onChange={(e) => setDraft((d) => ({ ...d, workStart: e.target.value }))} className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`} />
          </div>
          <div>
            <label htmlFor="sla-end" className="block text-xs text-slate-600 mb-1">{t('slaSettings.workEnd')}</label>
            <input id="sla-end" type="time" dir="ltr" value={draft.workEnd} disabled={!draft.businessHoursOnly} onChange={(e) => setDraft((d) => ({ ...d, workEnd: e.target.value }))} className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`} />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-600 mb-1.5">{t('slaSettings.workDays')}</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button key={d} type="button" onClick={() => toggleDay(d)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${draft.workDays.includes(d) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
                {t(`slaSettings.days.${d}`)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-600">
          {draft.businessHoursOnly
            ? t('slaSettings.exampleBusiness', { perDay: dayHours, hours: draft.complaintHours.NORMAL, days: dayHours ? Math.round((Number(draft.complaintHours.NORMAL) / dayHours) * 10) / 10 : '—' })
            : t('slaSettings.exampleAllDay')}
        </p>
      </div>

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">{t('slaSettings.appliesNote')}</p>

      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark flex items-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saved ? t('waApi.saved') : t('common.save')}
      </button>
    </div>
  );
}
