import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Loader2, ExternalLink } from 'lucide-react';
import { callSurvey } from '../../config/surveys';

// On a meeting's page: which feedback form the families who came answer
// after it (from «تقييمات أولياء الأمور»), or the short built-in survey.
export default function MeetingSurveyPicker({ meeting, run, busy }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [forms, setForms] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    callSurvey('listSurveyForms', {}).then((r) => setForms(r.forms || [])).catch((err) => { setForms([]); setError(err.message); });
  }, []);
  const current = forms?.find((f) => f.id === meeting.surveyFormId);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-primary" />{t('surveys.meeting.pickerTitle')}</p>
      <p className="text-xs text-slate-500">{t('surveys.meeting.pickerHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {!forms ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : (
          <select value={meeting.surveyFormId || ''} disabled={!!busy || meeting.status === 'CANCELLED'} onChange={(e) => run('setSurveyForm', { formId: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white min-w-[240px] max-w-full">
            <option value="">{t('surveys.meeting.builtIn')}</option>
            {meeting.surveyFormId && !current && <option value={meeting.surveyFormId}>{meeting.surveyFormTitle || meeting.surveyFormId}</option>}
            {forms.map((f) => <option key={f.id} value={f.id}>{f.title}{f.status !== 'OPEN' ? ` (${t('surveys.status.CLOSED')})` : ''}</option>)}
          </select>
        )}
        {busy === 'setSurveyForm' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
        {meeting.surveyFormId && <button type="button" onClick={() => navigate(`/surveys?openId=${meeting.surveyFormId}`)} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700"><ExternalLink className="w-4 h-4" />{t('surveys.meeting.results', { count: meeting.stats?.feedback || 0 })}</button>}
      </div>
      {current && current.status !== 'OPEN' && <p className="text-xs text-amber-700">{t('surveys.meeting.closedNote')}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
