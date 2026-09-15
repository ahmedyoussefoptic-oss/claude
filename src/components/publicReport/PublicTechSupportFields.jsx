import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useBranches, useProblemTypes, usePlatforms } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { RELATIONS, classOptionsForStage } from '../../config/techSupport';

const emptyForm = {
  studentName: '',
  nationalId: '',
  branch: '',
  stage: '',
  grade: '',
  parentName: '',
  relation: RELATIONS[0],
  parentPhone: '',
  problemType: '',
  platform: '',
  platformLink: '',
  details: '',
};

export default function PublicTechSupportFields({ initialBranch, onSuccess }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();

  const [formData, setFormData] = useState({ ...emptyForm, branch: initialBranch || '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'stage' ? { grade: '' } : {}),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const submitPublicTechSupportTicket = httpsCallable(functions, 'submitPublicTechSupportTicket');
      const result = await submitPublicTechSupportTicket(formData);
      onSuccess(result.data.ticketId);
    } catch (err) {
      console.error(err);
      setError(t('publicReport.genericSendError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
        {t('publicReport.identityNotice')}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">{t('techSupportForm.studentSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.studentNameFull')} <span className="text-red-500">*</span></label>
            <input type="text" name="studentName" value={formData.studentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.nationalCivilIdLabel')} <span className="text-red-500">*</span></label>
            <input type="text" name="nationalId" value={formData.nationalId} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
          <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
            <option value="">{t('complaintForm.selectBranch')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{t(`businessData.branches.${b.id}`, b.name)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.stageLabel')} <span className="text-red-500">*</span></label>
            <select name="stage" value={formData.stage} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">{t('complaintForm.selectStage')}</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.gradeLabel')} <span className="text-red-500">*</span></label>
            <select name="grade" value={formData.grade} onChange={handleChange} required disabled={!formData.stage} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white disabled:text-slate-400 disabled:bg-slate-50">
              <option value="">{t('techSupportForm.selectClass')}</option>
              {classOptionsForStage(formData.stage).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">{t('complaintForm.parentSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
            <input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.relationLabel')}</label>
            <select name="relation" value={formData.relation} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              {RELATIONS.map((r) => <option key={r} value={r}>{t(`techSupportForm.relations.${r}`, r)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.phoneRegisteredLabel')} <span className="text-red-500">*</span></label>
          <input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">{t('techSupportForm.problemDetailsSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.problemTypeLabel')} <span className="text-red-500">*</span></label>
            <select name="problemType" value={formData.problemType} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">{t('techSupportForm.selectProblemType')}</option>
              {problemTypes.map((pt) => <option key={pt.id} value={pt.id}>{t(`businessData.problemTypes.${pt.id}`, pt.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.platformLabel')} <span className="text-red-500">*</span></label>
            <select name="platform" value={formData.platform} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">{t('techSupportForm.selectPlatform')}</option>
              {platforms.map((p) => <option key={p.id} value={p.id}>{t(`businessData.platforms.${p.id}`, p.name)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.platformLinkLabel')}</label>
          <input type="text" name="platformLink" value={formData.platformLink} onChange={handleChange} dir="ltr" placeholder="https://..." className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.additionalNotesLabel')}</label>
          <textarea
            name="details"
            value={formData.details}
            onChange={handleChange}
            rows={3}
            placeholder={t('techSupportForm.additionalNotesPlaceholder')}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? t('publicReport.sending') : t('publicReport.submitReport')}
      </button>
    </form>
  );
}
