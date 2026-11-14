import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Plus, Loader2, CalendarDays, MessageSquareText, Link2 } from 'lucide-react';
import PageHero from '../components/common/PageHero';
import { useBranches } from '../hooks/useOrgData';
import SurveyEditor from '../components/surveys/SurveyEditor';
import SurveyResults from '../components/surveys/SurveyResults';
import SurveyShare from '../components/surveys/SurveyShare';
import { callSurvey, surveyBranchList, pick } from '../config/surveys';

// «تقييمات أولياء الأمور»: the feedback forms sent to parents as a link; one
// opens in its results.
export default function Surveys() {
  const { t, i18n } = useTranslation();
  const orgBranches = useBranches();
  const blist = useMemo(() => surveyBranchList(orgBranches), [orgBranches]);
  const branchName = (b) => pick(blist.find((x) => x.id === b), i18n.language) || b;
  const [params, setParams] = useSearchParams();
  const openId = params.get('openId');
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(null);

  const load = useCallback(async () => {
    try { setForms((await callSurvey('listSurveyForms', {})).forms || []); setError(null); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (openId) return <SurveyResults id={openId} onBack={() => { setParams({}); load(); }} />;

  const total = forms.reduce((a, f) => a + (f.responses || 0), 0);
  return (
    <div className="space-y-4">
      <PageHero
        icon={ClipboardCheck}
        title={t('surveys.title')}
        subtitle={t('surveys.subtitle')}
        facts={[
          { label: t('surveys.facts.forms'), value: forms.length },
          { label: t('surveys.facts.open'), value: forms.filter((f) => f.status === 'OPEN').length, tone: 'green' },
          { label: t('surveys.facts.responses'), value: total, tone: 'amber' },
        ]}
        actions={<button type="button" onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2"><Plus className="w-4 h-4" />{t('surveys.new')}</button>}
      />
      {loading ? <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        : error ? <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>
          : !forms.length ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
              <p className="text-slate-500">{t('surveys.empty')}</p>
              <button type="button" onClick={() => setCreating(true)} className="mt-4 px-4 py-2 bg-primary text-white rounded-xl text-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" />{t('surveys.new')}</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {forms.map((f) => (
                <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-primary/40 hover:shadow-sm transition flex flex-col">
                  <button type="button" onClick={() => setParams({ openId: f.id })} className="text-start flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-slate-900">{f.title}</p>
                      <span className={`px-2 py-0.5 rounded-md text-xs border shrink-0 ${f.status === 'OPEN' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{t(`surveys.status.${f.status}`)}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{f.branches.length ? f.branches.map(branchName).join('، ') : t('surveys.allBranches')} · {t('surveys.itemsN', { count: f.items })}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">
                      {f.date && <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-primary" /><span dir="ltr">{f.date}</span></span>}
                      <span className="flex items-center gap-1"><MessageSquareText className="w-3.5 h-3.5 text-primary" />{t('surveys.responsesN', { count: f.responses })}</span>
                    </div>
                  </button>
                  <button type="button" onClick={() => setSharing(f)} className="mt-3 self-start px-3 py-1.5 border border-primary/40 text-primary rounded-lg text-xs flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" />{t('surveys.share.button')}</button>
                </div>
              ))}
            </div>
          )}
      {creating && <SurveyEditor onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); load(); setParams({ openId: id }); }} />}
      {sharing && <SurveyShare form={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
