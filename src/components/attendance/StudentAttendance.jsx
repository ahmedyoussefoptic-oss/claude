import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { Video, Loader2 } from 'lucide-react';
import { functions } from '../../config/firebase';
import { VC_STATUSES, VC_STATUS_STYLES, vcRate } from '../../config/attendance';

// The student's virtual classes this school year (vcStudent) in the student
// record: the rate, a count per status and the latest classes.
export default function StudentAttendance({ studentId }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? ar : enUS;
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'vcStudent')({ nationalId: studentId })
      .then((r) => { if (alive) setRows(r.data.rows); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [studentId]);

  if (rows && rows.length === 0) return null;
  const counts = Object.fromEntries(VC_STATUSES.map((s) => [s, (rows || []).filter((r) => r.status === s).length]));
  const rate = vcRate(counts);
  const shown = all ? rows : (rows || []).slice(0, 8);
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
        <Video className="w-4 h-4 text-primary" />{t('vc.studentTitle')}
        {rate != null && <span className="ms-auto text-xs font-normal text-slate-500">{t('vc.studentRate', { rate, count: rows.length })}</span>}
      </p>
      {!rows ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {VC_STATUSES.filter((s) => counts[s]).map((s) => <span key={s} className={`px-2 py-0.5 rounded-md text-xs border ${VC_STATUS_STYLES[s]}`}>{t(`vc.status.${s}`)}: <b>{counts[s]}</b></span>)}
          </div>
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => (
              <li key={r.sessionId} className="py-2 text-sm flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 tabular-nums w-28">{format(r.startAt, 'd MMM · h:mm a', { locale })}</span>
                <span className="font-medium text-slate-800">{r.subject || t('vc.class')}</span>
                <span className="text-xs text-slate-400">{r.teacherName}</span>
                <span className={`ms-auto px-2 py-0.5 rounded-md text-xs border ${VC_STATUS_STYLES[r.status]}`} title={r.note || ''}>{t(`vc.status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
          {rows.length > 8 && <button onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-primary font-medium">{all ? t('vc.showLess') : t('vc.showAll', { count: rows.length })}</button>}
        </>
      )}
    </div>
  );
}
