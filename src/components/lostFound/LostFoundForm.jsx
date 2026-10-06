import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Save, Loader2, CheckCircle2, MessageCircle } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { messageSentFields } from '../../utils/messageSent';
import { uploadStaffFile } from '../../utils/uploadStaffFile';
import { useUsers } from '../../hooks/useUsers';
import { useBranches, useDepartments, useItemCategories } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { classOptionsForStage } from '../../config/techSupport';
import { generateItemCode } from '../../config/lostFound';
import { lookupStudentById, searchStudentsByName } from '../../utils/students';
import { waLink, buildLostFoundReceiptMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import AssigneeMultiSelect, { eligibleAssignees } from '../common/AssigneeMultiSelect';

const REPORT_TYPE_IDS = ['FOUND', 'LOST'];

export default function LostFoundForm({ onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const staff = useUsers();
  const branches = useBranches();
  const departments = useDepartments();
  const itemCategories = useItemCategories();
  const templates = useMessageTemplates();
  const fileInputRef = useRef(null);
  const [savedItem, setSavedItem] = useState(null);

  const [formData, setFormData] = useState({
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
    assignedTo: [],
  });

  const assigneeOptions = eligibleAssignees(staff, { branch: formData.branch });

  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value, ...(name === 'stage' ? { grade: '' } : {}) }));
  };

  const [studentSuggestions, setStudentSuggestions] = useState([]);
  const studentNameSearchTimer = useRef(null);

  const applyStudent = (student) => {
    setFormData((prev) => ({
      ...prev,
      studentName: student.name || prev.studentName,
      studentId: student.nationalId || prev.studentId,
      branch: student.branch || prev.branch,
    }));
    setStudentSuggestions([]);
  };

  const handleStudentIdBlur = async () => {
    if (!formData.studentId) return;
    const student = await lookupStudentById(formData.studentId);
    if (student) applyStudent(student);
  };

  const handleStudentNameChange = (e) => {
    handleChange(e);
    const term = e.target.value;
    clearTimeout(studentNameSearchTimer.current);
    studentNameSearchTimer.current = setTimeout(async () => {
      setStudentSuggestions(await searchStudentsByName(term));
    }, 300);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const itemCode = generateItemCode();

      let photoUrl = null;
      if (photo) {
        photoUrl = (await uploadStaffFile('lostFoundItems', itemCode, photo)).fileUrl;
      }

      const now = serverTimestamp();
      const assignees = formData.assignedTo.map((id) => staff.find((u) => u.id === id)).filter(Boolean);

      const newItem = {
        ...formData,
        itemCode,
        photoUrl,
        status: 'UNCLAIMED',
        receiver: user.uid,
        assignedToNames: assignees.map((a) => a.name),
        assignedAt: assignees.length ? now : null,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await addDoc(collection(db, 'lostFoundItems'), newItem);

      await addDoc(collection(db, `lostFoundItems/${docRef.id}/activityLog`), {
        action: 'ITEM_REGISTERED',
        actorId: user.uid,
        createdAt: now,
      });

      if (assignees.length > 0) {
        await addDoc(collection(db, `lostFoundItems/${docRef.id}/activityLog`), {
          action: 'ITEM_ASSIGNED',
          actorId: user.uid,
          metadata: { toUserIds: assignees.map((a) => a.id), toUserNames: assignees.map((a) => a.name) },
          createdAt: now,
        });
      }

      setSavedItem({
        id: docRef.id,
        itemCode,
        itemName: formData.itemName,
        reporterName: formData.reporterName,
        reporterPhone: formData.reporterPhone,
      });
    } catch (err) {
      console.error(err);
      setError(t('lostFoundForm.saveError'));
    } finally {
      setLoading(false);
    }
  };

  if (savedItem) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden p-6 text-center">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">{t('lostFoundForm.successTitle')}</h2>
          <p className="text-sm text-slate-500 mb-6">{t('lostFoundForm.recordNumberLabel')} <span className="font-mono font-bold text-slate-900" dir="ltr">{savedItem.itemCode}</span></p>

          {savedItem.reporterPhone && (
            <a
              href={waLink(savedItem.reporterPhone, buildLostFoundReceiptMessage(savedItem, templates.lostFoundReceipt))}
              target="_blank"
              rel="noreferrer"
              onClick={() => updateDoc(doc(db, 'lostFoundItems', savedItem.id), messageSentFields('receipt', user, userData))}
              className="w-full px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2 mb-3"
            >
              <MessageCircle className="w-4 h-4" />
              {t('common.sendReceiptWhatsApp')}
            </a>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">

        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('lostFoundForm.newTitle')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('lostFoundForm.newSubtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="lost-found-form" onSubmit={handleSubmit} className="space-y-8">

            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {REPORT_TYPE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, reportType: id }))}
                  className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                    formData.reportType === id
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t(`lostFoundCommon.reportTypes.${id}`)}
                </button>
              ))}
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{t('lostFoundForm.itemSection')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.itemNameLabel')} <span className="text-red-500">*</span></label>
                  <input type="text" name="itemName" value={formData.itemName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.type')} <span className="text-red-500">*</span></label>
                  <select name="category" value={formData.category} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('lostFoundForm.selectType')}</option>
                    {itemCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.colorLabel')}</label>
                  <input type="text" name="color" value={formData.color} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
                  <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {formData.reportType === 'FOUND' ? t('lostFoundForm.locationFound') : t('lostFoundForm.locationLost')}
                  </label>
                  <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" placeholder={t('lostFoundForm.locationPlaceholder')} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.additionalDescription')}</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm resize-none"
                  placeholder={t('lostFoundForm.descriptionPlaceholder')}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
                {formData.reportType === 'FOUND' ? t('lostFoundForm.finderSection') : t('lostFoundForm.reporterSection')}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')}</label>
                  <input type="text" name="reporterName" value={formData.reporterName} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.phone')}</label>
                  <input type="tel" name="reporterPhone" value={formData.reporterPhone} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>

              {formData.reportType === 'LOST' && (
                <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.studentNameLabel')}</label>
                    <input
                      type="text" name="studentName" value={formData.studentName} onChange={handleStudentNameChange}
                      onBlur={() => setTimeout(() => setStudentSuggestions([]), 150)}
                      autoComplete="off"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                    />
                    {studentSuggestions.length > 0 && (
                      <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {studentSuggestions.map((s) => (
                          <li
                            key={s.nationalId}
                            onMouseDown={() => applyStudent(s)}
                            className="px-4 py-2 text-sm hover:bg-slate-50 cursor-pointer flex items-center justify-between"
                          >
                            <span>{s.name}</span>
                            <span className="text-xs text-slate-400" dir="ltr">{s.nationalId}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.studentIdLabel')}</label>
                    <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} onBlur={handleStudentIdBlur} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.departmentLabel')}</label>
                    <select name="department" value={formData.department} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                      <option value="">{t('complaintForm.selectDepartment')}</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.photoLabel')}</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) setPhoto(e.dataTransfer.files[0]);
                  }}
                  className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group"
                >
                  <div className="space-y-2 text-center">
                    <div className="w-12 h-12 mx-auto bg-white rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-slate-400 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-sm text-slate-600">
                      <span className="font-medium text-primary">{t('lostFoundForm.uploadPhotoClick')}</span>
                      <input id="photo-upload" name="photo-upload" type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] || null)} ref={fileInputRef} />
                    </div>
                    {photo && <p className="text-xs text-slate-500" dir="ltr">{photo.name}</p>}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('lostFoundForm.assignSectionTitle')}</label>
                <AssigneeMultiSelect
                  options={assigneeOptions}
                  selected={formData.assignedTo}
                  onChange={(ids) => setFormData((prev) => ({ ...prev, assignedTo: ids }))}
                  placeholder={t('complaintForm.assignPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">{t('lostFoundForm.assignHint')}</p>
              </div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="lost-found-form" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loading ? t('lostFoundForm.saving') : t('lostFoundForm.saveBtn')}
          </button>
        </div>

      </div>
    </div>
  );
}
