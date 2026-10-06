import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { CalendarDays, Loader2 } from 'lucide-react';
import { functions } from '../../config/firebase';

const TZ = 'Asia/Riyadh';
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// Shows only the free visit slots of a branch (getAvailableSlots, computed
// from Settings › مواعيد الزيارات minus existing bookings): a row of days,
// then that day's times. `value` / `onChange` carry the chosen slot (ms).
export default function AppointmentPicker({ branch, value, onChange, required = true }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState(null);
  const [day, setDay] = useState(null);

  useEffect(() => {
    if (!branch) { setSlots(null); return; }
    let cancelled = false;
    setSlots(null);
    setError(null);
    httpsCallable(functions, 'getAvailableSlots')({ branch })
      .then(({ data }) => { if (!cancelled) setSlots(data.slots || []); })
      .catch(() => { if (!cancelled) { setSlots([]); setError(t('appointments.loadError')); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const days = useMemo(() => {
    const map = new Map();
    (slots || []).forEach((ms) => {
      const k = dayKey(ms);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ms);
    });
    return [...map.entries()];
  }, [slots]);

  const activeDay = day || (value ? dayKey(value) : days[0]?.[0]);
  const times = days.find(([k]) => k === activeDay)?.[1] || [];
  const fmtDay = (ms) => new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
  const fmtTime = (ms) => new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

  return (
    <div className="space-y-2.5 bg-sky-50/60 border border-sky-100 rounded-xl p-3">
      <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
        <CalendarDays className="w-4 h-4 text-primary" />
        {t('appointments.pickLabel')} {required && <span className="text-red-500">*</span>}
      </p>
      {!branch ? (
        <p className="text-xs text-slate-500">{t('appointments.pickBranchFirst')}</p>
      ) : slots === null ? (
        <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('appointments.loading')}</p>
      ) : days.length === 0 ? (
        <p className="text-xs text-red-600">{error || t('appointments.noSlots')}</p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map(([k, list]) => (
              <button
                key={k}
                type="button"
                onClick={() => setDay(k)}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium border text-center leading-tight ${activeDay === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}
              >
                {fmtDay(list[0])}
                <span className={`block text-[10px] font-normal ${activeDay === k ? 'text-white/80' : 'text-slate-400'}`}>{t('appointments.freeCount', { count: list.length })}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {times.map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => onChange(ms)}
                className={`px-3 py-1.5 rounded-lg text-sm border tabular-nums ${value === ms ? 'bg-emerald-600 text-white border-emerald-600 font-medium' : 'bg-white text-slate-700 border-slate-200 hover:border-primary'}`}
              >
                {fmtTime(ms)}
              </button>
            ))}
          </div>
          {value && <p className="text-xs text-emerald-700">{t('appointments.chosen', { when: `${fmtDay(value)} — ${fmtTime(value)}` })}</p>}
        </>
      )}
    </div>
  );
}

export function formatAppointment(ms, lang) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
}
