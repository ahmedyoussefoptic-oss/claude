import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { callSurvey, pick, scoreTone } from '../../config/surveys';

// «تقييمات ولي الأمر» in the student record: every answer the parent sent
// for this student (by the student's ID on the form's link, or from a
// meeting), with each question's answer. Hidden when there are none (or the
// user can't see «تقييمات أولياء الأمور»).
export default function StudentSurveys({ studentId, className = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4' }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(-1);

  useEffect(() => {
    let alive = true;
    setList(null);
    callSurvey('getStudentSurveys', { studentId })
      .then((r) => { if (alive) setList(r.surveys || []); })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [studentId]);

  if (list && !list.length) return null;
  const answer = (a) => {
    if (a.value === 'NA') return a.type === 'teacher' ? t('surveys.public.didNotMeet') : t('surveys.public.na');
    if (a.type === 'choice') return pick(a.option, lang) || a.value;
    return a.value;
  };
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <div className={className}>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><ClipboardCheck className="w-4 h-4 text-primary" />{t('surveys.student.title')}{list && <span className="text-slate-400 font-normal">({list.length})</span>}</p>
      {!list ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {list.map((s, i) => (
            <div key={`${s.formId}-${s.createdAt}`}>
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)} className="w-full text-start p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:bg-slate-50">
                <ChevronDown className={`w-4 h-4 text-slate-400 transition ${open === i ? 'rotate-180' : ''}`} />
                <span className="font-medium text-slate-900">{s.title}</span>
                {s.avg != null && <span className={`text-xs tabular-nums ${scoreTone(s.avg)}`}>{t('surveys.student.avg')} <span dir="ltr">{s.avg.toFixed(1)} / 5</span></span>}
                {s.low && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t('surveys.results.lowBadge')}</span>}
                <span className="text-[11px] text-slate-400">{s.fromMeeting ? t('surveys.results.fromMeeting') : t('surveys.results.fromLink')}</span>
                <span className="text-[11px] text-slate-400 ms-auto">{day(s.createdAt)}</span>
              </button>
              {open === i && (
                <div className="px-4 pb-3 space-y-1">
                  {s.answers.map((a, j) => (
                    <p key={j} className="text-xs text-slate-600 flex gap-2">
                      <span className="text-slate-500 shrink-0 max-w-[65%]">{a.type === 'teacher' ? `${t('surveys.results.teacherOf')} ${pick(a, lang)}` : pick(a, lang)}:</span>
                      <b className={`whitespace-pre-wrap ${typeof a.value === 'number' ? scoreTone(a.value) : 'text-slate-800 font-normal'}`} dir="auto">{answer(a)}</b>
                    </p>
                  ))}
                  <button type="button" onClick={() => navigate(`/surveys?openId=${s.formId}`)} className="mt-1 text-xs text-primary hover:underline">{t('surveys.student.openForm')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
