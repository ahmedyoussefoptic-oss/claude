import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2 } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments, useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import ExtraTypesEditor, { cleanExtraTypes } from './ExtraTypesEditor';
import { classOptionsForStage } from '../../config/techSupport';

const FIELDS = ['parentName', 'parentPhone', 'parentEmail', 'studentName', 'studentId', 'branch', 'department', 'stage', 'grade', 'complaintType', 'subType', 'subject', 'details'];

const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm';
const selectCls = `${inputCls} bg-white`;

// Corrects a complaint's own details after it was submitted (wrong phone
// number, wrong branch/classification, typos). Status, assignment and the
// solution keep their own dedicated actions in ComplaintDetails.
export default function ComplaintEditForm({ complaint, onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();

  const [formData, setFormData] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, complaint[k] || ''])));
  const [extraTypes, setExtraTypes] = useState(() => (Array.isArray(complaint.extraTypes) ? complaint.extraTypes : []));
  const extraLabel = (rows) => rows.map((r) => [complaintTypes.find((ct) => ct.id === r.type)?.name || r.type, r.subType].filter(Boolean).join(' — ')).join('، ');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value, ...(name === 'complaintType' ? { subType: '' } : {}), ...(name === 'stage' ? { grade: '' } : {}) }));
  };

  const subTypeOptions = subTypes.filter((s) => s.parentType === formData.complaintType);
  // Older records can hold a value the current lists no longer offer —
  // keep it selectable so opening the form doesn't silently blank it.
  const stageOptions = STAGES.includes(formData.stage) || !formData.stage ? STAGES : [formData.stage, ...STAGES];
  const hasLegacySubType = formData.subType && !subTypeOptions.some((s) => s.name === formData.subType);
  const classOptions = classOptionsForStage(formData.stage);
  const gradeOptions = formData.grade && !classOptions.includes(formData.grade) ? [formData.grade, ...classOptions] : classOptions;

  // Activity-log entries store readable names, not ids.
  const displayValue = (key, value) => {
    if (key === 'branch') return branches.find((b) => b.id === value)?.name || value;
    if (key === 'department') return departments.find((d) => d.id === value)?.name || value;
    if (key === 'complaintType') return complaintTypes.find((ct) => ct.id === value)?.name || value;
    return value;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const cleaned = Object.fromEntries(FIELDS.map((k) => [k, (formData[k] || '').trim()]));
    const changed = FIELDS.filter((k) => cleaned[k] !== (complaint[k] || ''));
    const cleanedExtra = cleanExtraTypes(extraTypes, cleaned.complaintType);
    const extraChanged = JSON.stringify(cleanedExtra) !== JSON.stringify(complaint.extraTypes || []);
    if (changed.length === 0 && !extraChanged) {
      setError(t('complaintEdit.noChanges'));
      return;
    }
    setLoading(true);
    try {
      const now = serverTimestamp();
      await updateDoc(doc(db, 'complaints', complaint.id), {
        ...Object.fromEntries(changed.map((k) => [k, cleaned[k]])),
        ...(extraChanged ? { extraTypes: cleanedExtra } : {}),
        updatedAt: now,
      });
      await addDoc(collection(db, `complaints/${complaint.id}/activityLog`), {
        action: 'COMPLAINT_EDITED',
        actorId: user.uid,
        actorName: userData?.name || t('common.user'),
        metadata: {
          changes: [
            ...changed.map((k) => ({ field: k, from: displayValue(k, complaint[k] || ''), to: displayValue(k, cleaned[k]) })),
            ...(extraChanged ? [{ field: 'extraTypes', from: extraLabel(complaint.extraTypes || []), to: extraLabel(cleanedExtra) }] : []),
          ],
        },
        createdAt: now,
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError(t('complaintEdit.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const label = (key, required) => (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {t(`complaintEdit.fields.${key}`)} {required && <span className="text-red-500">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('complaintEdit.title')}</h2>
            <p className="text-sm text-slate-500 mt-1" dir="ltr">{complaint.complaintId}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="complaint-edit-form" onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.parentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>{label('parentName', true)}<input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className={inputCls} /></div>
                <div>{label('parentPhone', true)}<input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className={inputCls} /></div>
                <div>{label('parentEmail')}<input type="email" name="parentEmail" value={formData.parentEmail} onChange={handleChange} dir="ltr" className={inputCls} /></div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.studentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>{label('studentName', true)}<input type="text" name="studentName" value={formData.studentName} onChange={handleChange} required className={inputCls} /></div>
                <div>{label('studentId', true)}<input type="text" name="studentId" value={formData.studentId} onChange={handleChange} required dir="ltr" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  {label('branch', true)}
                  <select name="branch" value={formData.branch} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('department')}
                  <select name="department" value={formData.department} onChange={handleChange} className={selectCls}>
                    <option value="">{t('complaintForm.selectDepartment')}</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('stage', true)}
                  <select name="stage" value={formData.stage} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {label('grade', true)}
                  <select name="grade" value={formData.grade} onChange={handleChange} required disabled={!formData.stage} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('techSupportForm.selectClass')}</option>
                    {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.detailsSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  {label('complaintType', true)}
                  <select name="complaintType" value={formData.complaintType} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectType')}</option>
                    {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('subType', subTypeOptions.length > 0)}
                  <select name="subType" value={formData.subType} onChange={handleChange} required={subTypeOptions.length > 0} disabled={!formData.complaintType} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('common.select')}</option>
                    {hasLegacySubType && <option value={formData.subType}>{formData.subType}</option>}
                    {subTypeOptions.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                {label('extraTypes')}
                <ExtraTypesEditor value={extraTypes} onChange={setExtraTypes} primaryType={formData.complaintType} complaintTypes={complaintTypes} subTypes={subTypes} selectCls={selectCls} />
              </div>
              <div>{label('subject', true)}<input type="text" name="subject" value={formData.subject} onChange={handleChange} required className={inputCls} /></div>
              <div>{label('details', true)}<textarea name="details" value={formData.details} onChange={handleChange} required rows={4} className={`${inputCls} py-3 resize-none`} /></div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="complaint-edit-form" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('complaintEdit.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
