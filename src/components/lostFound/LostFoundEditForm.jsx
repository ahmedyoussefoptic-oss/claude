import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2, Upload } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments, useItemCategories } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { classOptionsForStage } from '../../config/techSupport';
import { uploadStaffFile } from '../../utils/uploadStaffFile';

const FIELDS = ['reportType', 'itemName', 'category', 'color', 'branch', 'location', 'description', 'reporterName', 'reporterPhone', 'studentName', 'studentId', 'department', 'stage', 'grade'];
const REPORT_TYPE_IDS = ['FOUND', 'LOST'];

const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm';
const selectCls = `${inputCls} bg-white`;

// Corrects a lost & found report's details (item, place, reporter, student,
// photo). Status, assignment and returning the item keep their own actions
// in LostFoundDetails; every change is logged with before/after values.
export default function LostFoundEditForm({ item, onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const itemCategories = useItemCategories();

  const [formData, setFormData] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, item[k] || (k === 'reportType' ? 'FOUND' : '')])));
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value, ...(name === 'stage' ? { grade: '' } : {}) }));
  };

  // Keep values the current lists no longer offer selectable.
  const withCurrent = (options, value) => (value && !options.includes(value) ? [value, ...options] : options);
  const stageOptions = withCurrent(STAGES, formData.stage);
  const gradeOptions = withCurrent(classOptionsForStage(formData.stage), formData.grade);

  const displayValue = (key, value) => {
    if (key === 'branch') return branches.find((b) => b.id === value)?.name || value;
    if (key === 'department') return departments.find((d) => d.id === value)?.name || value;
    if (key === 'category') return itemCategories.find((c) => c.id === value)?.name || value;
    if (key === 'reportType') return value ? t(`lostFoundCommon.reportTypes.${value}`) : value;
    return value;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const cleaned = Object.fromEntries(FIELDS.map((k) => [k, String(formData[k] || '').trim()]));
    const changed = FIELDS.filter((k) => cleaned[k] !== String(item[k] || (k === 'reportType' ? 'FOUND' : '')));
    if (!changed.length && !photo) {
      setError(t('lostFoundEdit.noChanges'));
      return;
    }
    setLoading(true);
    try {
      let photoUrl = null;
      if (photo) photoUrl = (await uploadStaffFile('lostFoundItems', item.itemCode, photo)).fileUrl;
      const now = serverTimestamp();
      await updateDoc(doc(db, 'lostFoundItems', item.id), {
        ...Object.fromEntries(changed.map((k) => [k, cleaned[k]])),
        ...(photoUrl ? { photoUrl } : {}),
        updatedAt: now,
      });
      await addDoc(collection(db, `lostFoundItems/${item.id}/activityLog`), {
        action: 'ITEM_EDITED',
        actorId: user.uid,
        actorName: userData?.name || t('common.user'),
        metadata: {
          changes: [
            ...changed.map((k) => ({ field: k, from: displayValue(k, item[k] || ''), to: displayValue(k, cleaned[k]) })),
            ...(photoUrl ? [{ field: 'photo', from: item.photoUrl ? '✓' : '', to: photo.name }] : []),
          ],
        },
        createdAt: now,
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || t('lostFoundEdit.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const label = (key, required) => (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {t(`lostFoundEdit.fields.${key}`)} {required && <span className="text-red-500">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('lostFoundEdit.title')}</h2>
            <p className="text-sm text-slate-500 mt-1" dir="ltr">{item.itemCode}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="lf-edit-form" onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

            <div className="grid grid-cols-2 gap-3">
              {REPORT_TYPE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, reportType: id }))}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${formData.reportType === id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {t(`lostFoundCommon.reportTypes.${id}`)}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('lostFoundEdit.itemSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>{label('itemName', true)}<input type="text" name="itemName" value={formData.itemName} onChange={handleChange} required className={inputCls} /></div>
                <div>
                  {label('category', true)}
                  <select name="category" value={formData.category} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('common.select')}</option>
                    {itemCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {formData.category && !itemCategories.some((c) => c.id === formData.category) && <option value={formData.category}>{formData.category}</option>}
                  </select>
                </div>
                <div>{label('color')}<input type="text" name="color" value={formData.color} onChange={handleChange} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  {label('branch', true)}
                  <select name="branch" value={formData.branch} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>{label('location')}<input type="text" name="location" value={formData.location} onChange={handleChange} className={inputCls} /></div>
              </div>
              <div>{label('description')}<textarea name="description" value={formData.description} onChange={handleChange} rows={3} className={`${inputCls} py-3 resize-none`} /></div>
              <div>
                {label('photo')}
                <label className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-600 cursor-pointer hover:bg-slate-50">
                  <Upload className="w-4 h-4 text-slate-400" />
                  {photo ? photo.name : item.photoUrl ? t('lostFoundEdit.replacePhoto') : t('lostFoundEdit.addPhoto')}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('lostFoundEdit.reporterSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>{label('reporterName')}<input type="text" name="reporterName" value={formData.reporterName} onChange={handleChange} className={inputCls} /></div>
                <div>{label('reporterPhone')}<input type="tel" name="reporterPhone" value={formData.reporterPhone} onChange={handleChange} dir="ltr" className={inputCls} /></div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.studentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>{label('studentName')}<input type="text" name="studentName" value={formData.studentName} onChange={handleChange} className={inputCls} /></div>
                <div>{label('studentId')}<input type="text" name="studentId" value={formData.studentId} onChange={handleChange} dir="ltr" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  {label('department')}
                  <select name="department" value={formData.department} onChange={handleChange} className={selectCls}>
                    <option value="">{t('complaintForm.selectDepartment')}</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('stage')}
                  <select name="stage" value={formData.stage} onChange={handleChange} className={selectCls}>
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {label('grade')}
                  <select name="grade" value={formData.grade} onChange={handleChange} disabled={!formData.stage} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('techSupportForm.selectClass')}</option>
                    {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="lf-edit-form" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('lostFoundEdit.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
