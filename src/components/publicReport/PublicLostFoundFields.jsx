import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useBranches, useDepartments, useItemCategories } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { classOptionsForStage } from '../../config/techSupport';
import { MAX_PUBLIC_FILE_BYTES, fileToBase64 } from '../../utils/publicSubmission';
import AttachmentUploader from './AttachmentUploader';

const REPORT_TYPE_IDS = ['FOUND', 'LOST'];

const emptyForm = {
  reportType: 'FOUND',
  category: '',
  itemName: '',
  description: '',
  color: '',
  branch: '',
  location: '',
  reporterName: '',
  reporterPhone: '',
  studentName: '',
  studentId: '',
  department: '',
  stage: '',
  grade: '',
};

export default function PublicLostFoundFields({ initialBranch, onSuccess }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const departments = useDepartments();
  const itemCategories = useItemCategories();

  const [formData, setFormData] = useState({ ...emptyForm, branch: initialBranch || '' });
  const [photoFiles, setPhotoFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const maxMb = (MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value, ...(name === 'stage' ? { grade: '' } : {}) }));
  };

  const addPhoto = (newFiles) => {
    setError(null);
    const file = newFiles[0];
    if (!file) return;
    if (file.size > MAX_PUBLIC_FILE_BYTES) {
      setError(t('publicReport.fileSizeError', { name: file.name, max: maxMb }));
      return;
    }
    setPhotoFiles([file]);
  };

  const removePhoto = () => setPhotoFiles([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.reportType === 'LOST' && (!formData.reporterName.trim() || !formData.reporterPhone.trim())) {
      setError(t('publicReport.reporterNameRequiredAlert'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let photo = null;
      if (photoFiles[0]) {
        photo = {
          fileName: photoFiles[0].name,
          mimeType: photoFiles[0].type || 'application/octet-stream',
          base64Data: await fileToBase64(photoFiles[0]),
        };
      }

      const submitPublicLostFoundItem = httpsCallable(functions, 'submitPublicLostFoundItem');
      const result = await submitPublicLostFoundItem({ ...formData, photo });
      onSuccess(result.data.itemCode);
    } catch (err) {
      console.error(err);
      setError(err.message?.includes('ميجابايت') || err.message?.includes('MB') || err.message === t('publicReport.reporterNameRequiredAlert')
        ? err.message
        : t('publicReport.genericSendError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        {REPORT_TYPE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFormData((prev) => ({ ...prev, reportType: id }))}
            className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
              formData.reportType === id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t(`lostFoundCommon.reportTypes.${id}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">{t('lostFoundForm.itemSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.itemNameLabel')} <span className="text-red-500">*</span></label>
            <input type="text" name="itemName" value={formData.itemName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.type')} <span className="text-red-500">*</span></label>
            <select name="category" value={formData.category} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">{t('lostFoundForm.selectType')}</option>
              {itemCategories.map((c) => <option key={c.id} value={c.id}>{t(`businessData.itemCategories.${c.id}`, c.name)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.colorLabel')}</label>
            <input type="text" name="color" value={formData.color} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
            <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">{t('complaintForm.selectBranch')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{t(`businessData.branches.${b.id}`, b.name)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {formData.reportType === 'FOUND' ? t('lostFoundForm.locationFound') : t('lostFoundForm.locationLost')}
          </label>
          <input type="text" name="location" value={formData.location} onChange={handleChange} placeholder={t('lostFoundForm.locationPlaceholder')} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.additionalDescription')}</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            placeholder={t('lostFoundForm.descriptionPlaceholder')}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">
          {formData.reportType === 'FOUND' ? t('lostFoundForm.finderSection') : t('lostFoundForm.reporterSection')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('common.name')} {formData.reportType === 'LOST' && <span className="text-red-500">*</span>}
            </label>
            <input type="text" name="reporterName" value={formData.reporterName} onChange={handleChange} required={formData.reportType === 'LOST'} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('common.phone')} {formData.reportType === 'LOST' && <span className="text-red-500">*</span>}
            </label>
            <input type="tel" name="reporterPhone" value={formData.reporterPhone} onChange={handleChange} required={formData.reportType === 'LOST'} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>

        {formData.reportType === 'LOST' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.studentNameLabel')}</label>
              <input type="text" name="studentName" value={formData.studentName} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.studentIdLabel')}</label>
              <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
            </div>
          </div>
        )}
        {formData.reportType === 'LOST' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.departmentLabel')}</label>
                    <select name="department" value={formData.department} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                      <option value="">{t('complaintForm.selectDepartment')}</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{t(`businessData.departments.${d.id}`, d.name)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.stageLabel')}</label>
                    <select name="stage" value={formData.stage} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                      <option value="">{t('complaintForm.selectStage')}</option>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.gradeLabel')}</label>
                    <select name="grade" value={formData.grade} onChange={handleChange} disabled={!formData.stage} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white disabled:text-slate-400 disabled:bg-slate-50">
                      <option value="">{t('techSupportForm.selectClass')}</option>
                      {classOptionsForStage(formData.stage).map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
        )}

        <AttachmentUploader files={photoFiles} onAdd={addPhoto} onRemove={removePhoto} max={1} label={t('publicReport.itemPhotoOptional')} accept="image/*" />
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
