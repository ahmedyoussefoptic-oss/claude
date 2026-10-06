import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useBranches, useDepartments, useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { classOptionsForStage } from '../../config/techSupport';
import { MAX_PUBLIC_FILES, MAX_PUBLIC_FILE_BYTES, fileToBase64 } from '../../utils/publicSubmission';
import AttachmentUploader from './AttachmentUploader';
import ExtraTypesEditor, { cleanExtraTypes } from '../complaints/ExtraTypesEditor';
import AppointmentPicker from '../appointments/AppointmentPicker';
import { isAppointmentCategory } from '../../config/appointments';

const MAX_ENTRIES = 5;

const emptyParent = { parentName: '', parentPhone: '', parentEmail: '' };

const emptyEntry = (branch) => ({
  studentName: '',
  studentId: '',
  branch,
  department: '',
  stage: '',
  grade: '',
  complaintType: '',
  subType: '',
  extraTypes: [],
  appointmentSlot: null,
  subject: '',
  details: '',
  files: [],
});

const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm';
const selectCls = `${inputCls} bg-white`;

// One parent can submit feedback for several siblings in one go: parent
// details are entered once, and each student gets their own entry that
// becomes a separate complaint (own number, assignment and tracking link).
// `visit` = the branch QR check-in page (/visit): the parent is at the
// branch waiting to meet someone, so only a short visit reason is asked for
// (details optional, no attachments) and the record is flagged as a visit.
export default function PublicComplaintFields({ initialBranch, onSuccess, visit = false, lockBranch = false }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();

  const nextKey = useRef(2);
  const [parent, setParent] = useState(emptyParent);
  const [entries, setEntries] = useState(() => [{ ...emptyEntry(initialBranch || ''), key: 1 }]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const maxMb = (MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0);

  const handleParentChange = (e) => {
    const { name, value } = e.target;
    setParent((prev) => ({ ...prev, [name]: value }));
  };

  const updateEntry = (key, patch) => {
    setEntries((list) => list.map((en) => (en.key === key ? { ...en, ...patch } : en)));
  };

  const handleEntryChange = (key) => (e) => {
    const { name, value } = e.target;
    updateEntry(key, { [name]: value, ...(name === 'complaintType' ? { subType: '' } : {}), ...(name === 'stage' ? { grade: '' } : {}), ...(['complaintType', 'subType', 'branch'].includes(name) ? { appointmentSlot: null } : {}) });
  };

  // Siblings usually attend the same branch, so it's carried over as a
  // starting point — still editable (e.g. separate boys/girls branches).
  const addEntry = () => {
    setEntries((list) => [...list, { ...emptyEntry(list[list.length - 1]?.branch || initialBranch || ''), key: nextKey.current++ }]);
  };

  const removeEntry = (key) => setEntries((list) => list.filter((en) => en.key !== key));

  const addFiles = (key, newFiles) => {
    setError(null);
    const oversized = newFiles.find((f) => f.size > MAX_PUBLIC_FILE_BYTES);
    if (oversized) {
      setError(t('publicReport.fileSizeError', { name: oversized.name, max: maxMb }));
      return;
    }
    const entry = entries.find((en) => en.key === key);
    if (entry.files.length + newFiles.length > MAX_PUBLIC_FILES) {
      setError(t('publicReport.maxFilesError', { count: MAX_PUBLIC_FILES }));
      return;
    }
    updateEntry(key, { files: [...entry.files, ...newFiles] });
  };

  const removeFile = (key, index) => {
    setEntries((list) => list.map((en) => (en.key === key ? { ...en, files: en.files.filter((_, i) => i !== index) } : en)));
  };

  const wantsAppointment = (en) => !visit && isAppointmentCategory(en.complaintType, en.subType, complaintTypes, subTypes);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (entries.some((en) => wantsAppointment(en) && !en.appointmentSlot)) {
      setError(t('appointments.pickRequired'));
      return;
    }
    setLoading(true);
    const submitPublicComplaint = httpsCallable(functions, 'submitPublicComplaint');
    const done = [...sent];
    try {
      for (const entry of entries) {
        const { files, key: _key, ...fields } = entry;
        const attachments = await Promise.all(
          files.map(async (file) => ({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64Data: await fileToBase64(file),
          }))
        );
        const { appointmentSlot, ...plain } = fields;
        const result = await submitPublicComplaint({ ...parent, ...plain, extraTypes: cleanExtraTypes(fields.extraTypes, fields.complaintType), attachments, ...(visit ? { visit: true } : {}), ...(wantsAppointment(entry) && appointmentSlot ? { appointmentSlot } : {}) });
        done.push({ id: result.data.complaintId, studentName: entry.studentName });
      }
      onSuccess(done);
    } catch (err) {
      console.error(err);
      // Entries are sent in order — drop the ones that already went through
      // so resubmitting can't create duplicates of them.
      const sentNow = done.length - sent.length;
      if (sentNow > 0) setEntries((list) => list.slice(sentNow));
      setSent(done);
      const sizeOrCountError = err.message?.includes('ميجابايت') || err.message?.includes('MB') || err.message?.includes('ملفات كحد أقصى') || err.message?.includes('files');
      if (sizeOrCountError) setError(err.message);
      else if (done.length > 0) setError(t('publicReport.partialSendError', { names: done.map((d) => d.studentName).join(t('publicReport.listSeparator')) }));
      else setError(t('publicReport.genericSendError'));
    } finally {
      setLoading(false);
    }
  };

  const multiple = entries.length > 1;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">{t('complaintForm.parentSection')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
            <input type="text" name="parentName" value={parent.parentName} onChange={handleParentChange} required className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('publicReport.parentPhoneWhatsApp')} <span className="text-red-500">*</span></label>
            <input type="tel" name="parentPhone" value={parent.parentPhone} onChange={handleParentChange} required dir="ltr" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.emailLabel')}</label>
          <input type="email" name="parentEmail" value={parent.parentEmail} onChange={handleParentChange} dir="ltr" className={inputCls} />
        </div>
      </div>

      {entries.map((entry, idx) => {
        const onChange = handleEntryChange(entry.key);
        return (
          <div key={entry.key} className={multiple ? 'space-y-6 border border-slate-200 rounded-2xl p-4' : 'space-y-6'}>
            {multiple && (
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="text-sm font-bold text-primary">{t('publicReport.entryTitle', { n: idx + 1 })}</h3>
                {idx > 0 && (
                  <button type="button" onClick={() => removeEntry(entry.key)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                    {t('publicReport.removeEntry')}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700">{t('complaintForm.studentSection')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
                  <input type="text" name="studentName" value={entry.studentName} onChange={onChange} required className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.nationalIdLabel')} <span className="text-red-500">*</span></label>
                  <input type="text" name="studentId" value={entry.studentId} onChange={onChange} required dir="ltr" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
                  <select name="branch" value={entry.branch} onChange={onChange} required disabled={lockBranch} className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-700`}>
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{t(`businessData.branches.${b.id}`, b.name)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.departmentLabel')} <span className="text-red-500">*</span></label>
                  <select name="department" value={entry.department} onChange={onChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectDepartment')}</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{t(`businessData.departments.${d.id}`, d.name)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.stageLabel')} <span className="text-red-500">*</span></label>
                  <select name="stage" value={entry.stage} onChange={onChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.gradeLabel')} <span className="text-red-500">*</span></label>
                  <select name="grade" value={entry.grade} onChange={onChange} required disabled={!entry.stage} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('techSupportForm.selectClass')}</option>
                    {classOptionsForStage(entry.stage).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700">{t('complaintForm.detailsSection')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.type')} <span className="text-red-500">*</span></label>
                  <select name="complaintType" value={entry.complaintType} onChange={onChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectType')}</option>
                    {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{t(`businessData.complaintTypes.${ct.id}`, ct.name)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subTypeLabel')} <span className="text-red-500">*</span></label>
                  <select name="subType" value={entry.subType} onChange={onChange} required disabled={!entry.complaintType} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('common.select')}</option>
                    {subTypes.filter((s) => s.parentType === entry.complaintType).map((s) => (
                      <option key={s.id} value={s.name}>{t(`businessData.subTypes.${s.parentType}.${s.name}`, s.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
              {wantsAppointment(entry) && (
                <AppointmentPicker branch={entry.branch} value={entry.appointmentSlot} onChange={(ms) => updateEntry(entry.key, { appointmentSlot: ms })} />
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('publicReport.extraTypesLabel')}</label>
                <ExtraTypesEditor
                  value={entry.extraTypes}
                  onChange={(extraTypes) => updateEntry(entry.key, { extraTypes })}
                  primaryType={entry.complaintType}
                  complaintTypes={complaintTypes}
                  subTypes={subTypes}
                  typeLabel={(ct) => t(`businessData.complaintTypes.${ct.id}`, ct.name)}
                  subTypeLabel={(s) => t(`businessData.subTypes.${s.parentType}.${s.name}`, s.name)}
                  selectCls={selectCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t(visit ? 'branchVisit.reasonLabel' : 'complaintForm.subjectLabel')} <span className="text-red-500">*</span></label>
                <input type="text" name="subject" value={entry.subject} onChange={onChange} required placeholder={t(visit ? 'branchVisit.reasonPlaceholder' : 'complaintForm.subjectPlaceholder')} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.detailsLabel')} {!visit && <span className="text-red-500">*</span>}</label>
                <textarea name="details" value={entry.details} onChange={onChange} required={!visit} rows={visit ? 3 : 4} placeholder={t(visit ? 'branchVisit.detailsPlaceholder' : 'complaintForm.detailsPlaceholder')} className={`${inputCls} py-3 resize-none`} />
              </div>

              {!visit && <AttachmentUploader files={entry.files} onAdd={(files) => addFiles(entry.key, files)} onRemove={(i) => removeFile(entry.key, i)} />}
            </div>
          </div>
        );
      })}

      {entries.length < MAX_ENTRIES && (
        <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 space-y-2">
          <p className="text-xs text-slate-600">{t('publicReport.siblingHint')}</p>
          <button type="button" onClick={addEntry} className="w-full px-4 py-2.5 border-2 border-dashed border-primary/40 text-primary rounded-xl text-sm font-medium hover:bg-primary/5 transition-colors flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" />
            {t('publicReport.addSibling')}
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? t('publicReport.sending') : visit ? t('branchVisit.submit') : multiple ? t('publicReport.submitComplaintMulti', { count: entries.length }) : t('publicReport.submitComplaint')}
      </button>
    </form>
  );
}
