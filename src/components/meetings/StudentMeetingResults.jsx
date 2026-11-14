import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Presentation, Loader2 } from 'lucide-react';
import { functions } from '../../config/firebase';

// The student's parent meetings in the student record: who came, and each
// result a teacher or manager wrote (with recommendations and follow-ups).
export default function StudentMeetingResults({ studentId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState(null);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'getStudentMeetings')({ studentId })
      .then((r) => { if (alive) setMeetings(r.data.meetings || []); })
      .catch(() => { if (alive) setMeetings([]); });
    return () => { alive = false; };
  }, [studentId]);

  if (meetings && meetings.length === 0) return null;
  const results = (mt) => [
    ...mt.minutes.map((mn) => ({ who: mn.teacherName, sub: mn.subject, purpose: '', result: mn.points, recommendations: mn.recommendations, agreements: mn.agreements, followUp: mn.followUp })),
    ...(mt.requests || []).map((rq) => ({ who: rq.staffName, sub: t(`meetings.roles.${rq.staffRole}`), purpose: rq.purpose, result: rq.result, recommendations: rq.recommendations, followUp: rq.followUp, status: rq.status, rejectReason: rq.rejectReason })),
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><Presentation className="w-4 h-4 text-primary" />{t('meetings.results.studentTitle')}</p>
      {!meetings ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <div className="space-y-4">
          {meetings.map((mt) => (
            <div key={mt.id}>
              <button type="button" onClick={() => navigate(`/meetings?openId=${mt.id}`)} className="flex flex-wrap items-center gap-2 text-sm hover:text-primary">
                <span className="font-medium text-slate-900">{mt.title}</span>
                <span className="text-xs text-slate-500" dir="ltr">{mt.date}</span>
                <span className={`px-2 py-0.5 rounded-md text-xs border ${mt.attended ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{mt.attended ? t('meetings.invites.came') : t(`meetings.response.${mt.response || 'NONE'}`)}</span>
                {mt.attendee && <span className="text-xs text-slate-500">{t('meetings.family.attendee', { name: mt.attendee.name, relation: t(`meetings.family.relations.${mt.attendee.relation}`) })}</span>}
              </button>
              <div className="mt-2 space-y-2">
                {results(mt).map((r, i) => (
                  <div key={i} className="border border-slate-100 rounded-lg p-2.5 text-sm">
                    <p className="text-xs text-slate-500"><b className="text-slate-800">{r.who}</b>{r.sub ? ` · ${r.sub}` : ''}{r.status && r.status !== 'DONE' ? ` · ${t(`meetings.request.${r.status}`)}` : ''}</p>
                    {r.purpose && <p className="text-xs text-slate-600 mt-1">{t('meetings.staffReq.purpose')}: {r.purpose}</p>}
                    {r.rejectReason && <p className="text-xs text-rose-700 mt-1">{t('meetings.staffReq.rejectReason')}: {r.rejectReason}</p>}
                    {r.result && <p className="text-slate-900 mt-1 whitespace-pre-wrap"><span className="text-xs font-bold text-emerald-700">{t('meetings.results.col.result')}: </span>{r.result}</p>}
                    {r.recommendations && <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{t('meetings.teacher.recommendations')}: {r.recommendations}</p>}
                    {r.agreements && <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{t('meetings.teacher.agreements')}: {r.agreements}</p>}
                    {r.followUp?.complaintNo && <button type="button" onClick={() => navigate(`/complaints?openId=${r.followUp.complaintId}`)} className="text-xs text-amber-700 hover:underline mt-1">{t('meetings.teacher.followUpCreated', { number: r.followUp.complaintNo })}</button>}
                  </div>
                ))}
                {!results(mt).length && <p className="text-xs text-slate-400">{t('meetings.results.noneForStudent')}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
