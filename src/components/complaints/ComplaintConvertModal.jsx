import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Wrench, Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useProblemTypes, usePlatforms } from '../../hooks/useOrgData';
import { RELATIONS, classOptionsForStage } from '../../config/techSupport';
import { isParentRelated } from '../../config/techSupport';
import ParentNationalIdField from '../techSupport/ParentNationalIdField';

const selectCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white';

// Asks only for what a tech-support ticket needs beyond the complaint's own
// data; the move itself (create ticket, archive + remove the complaint) runs
// server-side in convertComplaintToTechTicket.
export default function ComplaintConvertModal({ complaint, onClose, onConverted }) {
  const { t } = useTranslation();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();
  const classOptions = classOptionsForStage(complaint.stage);

  const [form, setForm] = useState({
    problemType: '',
    platform: '',
    grade: classOptions.includes(complaint.grade) ? complaint.grade : '',
    relation: RELATIONS[0],
    parentNationalId: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const convert = httpsCallable(functions, 'convertComplaintToTechTicket');
      const { data } = await convert({ complaintDocId: complaint.id, ...form });
      onConverted(data);
    } catch (err) {
      console.error(err);
      setError(err.code === 'functions/permission-denied' || err.code === 'functions/failed-precondition' ? err.message : t('complaintConvert.error'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" />
            {t('complaintConvert.title')}
          </h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl p-3">{t('complaintConvert.description')}</p>
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">{error}</div>}

          <div className="text-sm bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1">
            <p><span className="text-slate-500">{t('common.student')}:</span> <span className="font-medium text-slate-900">{complaint.studentName}</span></p>
            <p><span className="text-slate-500">{t('common.parent')}:</span> <span className="font-medium text-slate-900">{complaint.parentName}</span> <span dir="ltr" className="text-slate-500">{complaint.parentPhone}</span></p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.problemTypeLabel')} <span className="text-red-500">*</span></label>
              <select name="problemType" value={form.problemType} onChange={handleChange} required className={selectCls}>
                <option value="">{t('techSupportForm.selectProblemType')}</option>
                {problemTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.platformLabel')} <span className="text-red-500">*</span></label>
              <select name="platform" value={form.platform} onChange={handleChange} required className={selectCls}>
                <option value="">{t('techSupportForm.selectPlatform')}</option>
                {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {isParentRelated(form.problemType, form.platform, problemTypes, platforms) && (
              <div className="sm:col-span-2">
                <ParentNationalIdField value={form.parentNationalId} onChange={handleChange} inputCls={selectCls} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.gradeLabel')} <span className="text-red-500">*</span></label>
              {classOptions.length > 0 ? (
                <select name="grade" value={form.grade} onChange={handleChange} required className={selectCls}>
                  <option value="">{t('techSupportForm.selectClass')}</option>
                  {classOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              ) : (
                <input type="text" name="grade" value={form.grade} onChange={handleChange} required className={selectCls} />
              )}
              {complaint.grade && !classOptions.includes(complaint.grade) && (
                <p className="text-xs text-slate-400 mt-1">{t('complaintConvert.originalGrade', { grade: complaint.grade })}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.relationLabel')}</label>
              <select name="relation" value={form.relation} onChange={handleChange} className={selectCls}>
                {RELATIONS.map((r) => <option key={r} value={r}>{t(`techSupportForm.relations.${r}`, r)}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            {loading ? t('complaintConvert.converting') : t('complaintConvert.confirmBtn')}
          </button>
        </div>
      </form>
    </div>
  );
}
