import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Bus, Loader2, NotebookPen, Star } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { functions } from '../../config/firebase';
import { ENROLLMENT_STATUS_STYLES, dayToDate } from '../../config/trips';

// The student's school trips (getStudentTrips) in the student record:
// status, attendance, notes recorded during the trip, survey rating.
export default function StudentTrips({ studentId }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'getStudentTrips')({ studentId })
      .then((r) => { if (alive) setTrips(r.data.trips); })
      .catch(() => { if (alive) setTrips([]); });
    return () => { alive = false; };
  }, [studentId]);

  if (trips && trips.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><Bus className="w-4 h-4 text-primary" />{t('trips.studentTripsTitle')}</p>
      {!trips ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <ul className="divide-y divide-slate-100">
          {trips.map((tr) => (
            <li key={tr.tripId} className="py-2.5 text-sm cursor-pointer hover:bg-slate-50 rounded-lg px-2" onClick={() => navigate(`/trips?openId=${tr.tripId}`)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{tr.title}</span>
                <span className="text-xs text-slate-500">{format(dayToDate(tr.date), 'd MMM yyyy', { locale: dateLocale })}</span>
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${ENROLLMENT_STATUS_STYLES[tr.status]}`}>{t(`trips.enrollment.${tr.status}`)}</span>
                {tr.boarded === true && <span className="text-xs text-emerald-700">{t('trips.attended')}</span>}
                {tr.boarded === false && <span className="text-xs text-rose-700">{t('trips.absentFromTrip')}</span>}
                {tr.declineReason && <span className="text-xs text-slate-500">{t(`trips.declineReason.${tr.declineReason}`)}</span>}
                {tr.surveyAverage != null && <span className="text-xs text-amber-600 flex items-center gap-0.5"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{tr.surveyAverage.toFixed(1)}</span>}
              </div>
              {tr.incidents.map((x, i) => (
                <p key={i} className="text-xs text-amber-800 bg-amber-50 rounded-md px-2 py-1 mt-1 flex items-start gap-1"><NotebookPen className="w-3.5 h-3.5 shrink-0 mt-0.5" />{x.note} <span className="text-amber-600">— {x.byName}</span></p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
