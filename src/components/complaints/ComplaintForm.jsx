import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Save, Loader2, CheckCircle2, MessageCircle, Mic, Square } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { messageSentFields } from '../../utils/messageSent';
import { useBranches, useDepartments, useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { waLink, buildReceiptMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { lookupStudentById, searchStudentsByName } from '../../utils/students';
import { STAGES } from '../../config/complaintTypes';
import { classOptionsForStage } from '../../config/techSupport';
import AssigneeMultiSelect, { eligibleAssignees } from '../common/AssigneeMultiSelect';
import ExtraTypesEditor, { cleanExtraTypes } from './ExtraTypesEditor';

const PRIORITY_IDS = ['NORMAL', 'HIGH', 'URGENT'];

const SOURCES = [
  { id: 'CENTER_CALL', name: 'Center Call' },
  { id: 'WHATSAPP', name: 'WhatsApp' },
  { id: 'EMAIL', name: 'Email' },
  { id: 'PARENT_PORTAL', name: 'Parent Portal' },
  { id: 'VISIT', name: 'Visit' },
  { id: 'MOBILE_APP', name: 'Mobile App' },
];

export default function ComplaintForm({ onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const fileInputRef = useRef(null);
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const staff = useUsers();
  const templates = useMessageTemplates();

  const [formData, setFormData] = useState({
    parentName: '',
    parentPhone: '',
    parentEmail: '',
    studentName: '',
    studentId: '',
    branch: '',
    department: '',
    stage: '',
    grade: '',
    complaintType: '',
    subType: '',
    extraTypes: [],
    subject: '',
    priority: 'NORMAL',
    source: 'CENTER_CALL',
    details: '',
    assignedTo: [],
  });

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedComplaint, setSavedComplaint] = useState(null);

  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const assigneeOptions = eligibleAssignees(staff, { branch: formData.branch, complaintType: formData.complaintType, stage: formData.stage, curriculum: formData.department });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'complaintType' ? { subType: '' } : {}),
      ...(name === 'stage' ? { grade: '' } : {}),
    }));
  };

  const [studentSuggestions, setStudentSuggestions] = useState([]);
  const studentNameSearchTimer = useRef(null);

  const applyStudent = (student) => {
    setFormData((prev) => ({
      ...prev,
      studentName: student.name || prev.studentName,
      studentId: student.nationalId || prev.studentId,
      branch: student.branch || prev.branch,
      parentPhone: student.mobile || prev.parentPhone,
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

  const handleFileChange = (e) => {
    if (e.target.files?.length) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files)]);
      e.target.value = '';
    }
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Stop the mic stream if the form is closed while a recording is still in
  // progress — otherwise the browser keeps the microphone active (and its
  // "recording" indicator lit) after the modal is gone.
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleRecording = async () => {
    setRecordingError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `${t('complaintForm.recordingFilePrefix')}${Date.now()}.webm`, { type: 'audio/webm' });
        setFiles((prev) => [...prev, file]);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setRecordingError(t('complaintForm.micError'));
    }
  };

  const generateComplaintId = async () => {
    const year = new Date().getFullYear();
    const randomId = Math.floor(1000 + Math.random() * 9000);
    return `COM-${year}-${randomId}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const complaintId = await generateComplaintId();

      // Upload files first — one failed upload (e.g. a Storage rule
      // rejecting a particular file) must not lose the whole complaint, so
      // each file is tried independently and a failure is skipped (and
      // reported afterward) rather than aborting the submission.
      const uploadedAttachments = [];
      const failedFiles = [];
      for (const file of files) {
        try {
          const fileRef = ref(storage, `complaints/${complaintId}/${file.name}`);
          await uploadBytes(fileRef, file);
          const url = await getDownloadURL(fileRef);
          uploadedAttachments.push({
            fileName: file.name,
            fileUrl: url,
            mimeType: file.type,
            size: file.size,
            uploadedBy: user.uid,
            createdAt: new Date().toISOString(),
          });
        } catch (uploadErr) {
          console.error('Attachment upload failed:', file.name, uploadErr);
          failedFiles.push({ name: file.name, message: uploadErr.message });
        }
      }

      const now = serverTimestamp();
      const assignees = formData.assignedTo.map((id) => staff.find((u) => u.id === id)).filter(Boolean);

      const newComplaint = {
        ...formData,
        extraTypes: cleanExtraTypes(formData.extraTypes, formData.complaintType),
        complaintId,
        receiver: user.uid,
        status: 'RECEIVED',
        attachments: uploadedAttachments,
        reopened: false,
        isOverdue: false,
        assignedToNames: assignees.map((a) => a.name),
        assignedAt: assignees.length ? now : null,
        createdAt: now,
        updatedAt: now,
      };

      // Add to firestore
      const docRef = await addDoc(collection(db, 'complaints'), newComplaint);

      // Create initial activity log
      await addDoc(collection(db, `complaints/${docRef.id}/activityLog`), {
        action: 'COMPLAINT_CREATED',
        actorId: user.uid,
        createdAt: now,
      });

      if (assignees.length > 0) {
        await addDoc(collection(db, `complaints/${docRef.id}/activityLog`), {
          action: 'COMPLAINT_ASSIGNED',
          actorId: user.uid,
          metadata: { toUserIds: assignees.map((a) => a.id), toUserNames: assignees.map((a) => a.name) },
          createdAt: now,
        });
      }

      setSavedComplaint({
        id: docRef.id,
        complaintId,
        parentName: formData.parentName,
        studentName: formData.studentName,
        parentPhone: formData.parentPhone,
        failedFiles,
      });
    } catch (err) {
      console.error(err);
      setError(t('complaintForm.saveError'));
    } finally {
      setLoading(false);
    }
  };

  if (savedComplaint) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden p-6 text-center">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">{t('complaintForm.successTitle')}</h2>
          <p className="text-sm text-slate-500 mb-6">{t('complaintForm.complaintNumberLabel')} <span className="font-mono font-bold text-slate-900" dir="ltr">{savedComplaint.complaintId}</span></p>

          {savedComplaint.failedFiles?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-3 mb-4 text-right">
              <p className="font-medium mb-1">{t('complaintForm.attachmentUploadFailedTitle')}</p>
              <ul className="list-disc pr-4 space-y-0.5">
                {savedComplaint.failedFiles.map((f) => (
                  <li key={f.name} dir="ltr" className="text-left">{f.name}{f.message ? ` — ${f.message}` : ''}</li>
                ))}
              </ul>
            </div>
          )}

          {savedComplaint.parentPhone && (
            <a
              href={waLink(savedComplaint.parentPhone, buildReceiptMessage(savedComplaint, templates.receipt))}
              target="_blank"
              rel="noreferrer"
              onClick={() => updateDoc(doc(db, 'complaints', savedComplaint.id), messageSentFields('receipt', user, userData))}
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
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('complaintForm.newTitle')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('complaintForm.newSubtitle')}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <form id="complaint-form" onSubmit={handleSubmit} className="space-y-8">
            
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">
                {error}
              </div>
            )}

            {/* Section 1 */}
            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{t('complaintForm.parentSection')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
                  <input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.phone')} <span className="text-red-500">*</span></label>
                  <input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.emailLabel')}</label>
                  <input type="email" name="parentEmail" value={formData.parentEmail} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>
            </div>

            {/* Section 2 */}
            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{t('complaintForm.studentSection')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
                  <input
                    type="text" name="studentName" value={formData.studentName} onChange={handleStudentNameChange}
                    onBlur={() => setTimeout(() => setStudentSuggestions([]), 150)}
                    autoComplete="off" required
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.nationalIdLabel')} <span className="text-red-500">*</span></label>
                  <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} onBlur={handleStudentIdBlur} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
                  <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.departmentLabel')} <span className="text-red-500">*</span></label>
                  <select name="department" value={formData.department} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectDepartment')}</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.stageLabel')} <span className="text-red-500">*</span></label>
                  <select name="stage" value={formData.stage} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
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

            {/* Section 3 */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mt-6">{t('complaintForm.detailsSection')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.type')} <span className="text-red-500">*</span></label>
                  <select name="complaintType" value={formData.complaintType} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    <option value="">{t('complaintForm.selectType')}</option>
                    {complaintTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subTypeLabel')} <span className="text-red-500">*</span></label>
                  <select name="subType" value={formData.subType} onChange={handleChange} required disabled={!formData.complaintType} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm disabled:text-slate-400">
                    <option value="">{t('common.select')}</option>
                    {subTypes.filter(s => s.parentType === formData.complaintType).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-4 md:order-last">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.extraTypesLabel')}</label>
                  <ExtraTypesEditor
                    value={formData.extraTypes}
                    onChange={(extraTypes) => setFormData((prev) => ({ ...prev, extraTypes }))}
                    primaryType={formData.complaintType}
                    complaintTypes={complaintTypes}
                    subTypes={subTypes}
                    selectCls="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.priorityLabel')} <span className="text-red-500">*</span></label>
                  <select name="priority" value={formData.priority} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    {PRIORITY_IDS.map(id => <option key={id} value={id}>{t(`complaintForm.priorities.${id}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.sourceLabel')} <span className="text-red-500">*</span></label>
                  <select name="source" value={formData.source} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    {SOURCES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subjectLabel')} <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  placeholder={t('complaintForm.subjectPlaceholder')}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.detailsLabel')} <span className="text-red-500">*</span></label>
                <textarea
                  name="details"
                  value={formData.details}
                  onChange={handleChange}
                  required
                  rows={4}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm resize-none"
                  placeholder={t('complaintForm.detailsPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.assignedToLabel')}</label>
                <AssigneeMultiSelect
                  options={assigneeOptions}
                  selected={formData.assignedTo}
                  onChange={(ids) => setFormData((prev) => ({ ...prev, assignedTo: ids }))}
                  placeholder={t('complaintForm.assignPlaceholder')}
                />
                <p className="text-xs text-slate-500 mt-1">{t('complaintForm.assignHint')}</p>
              </div>

              {/* Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.attachmentsLabel')}</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.length) {
                      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
                    }
                  }}
                  className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group"
                >
                  <div className="space-y-2 text-center">
                    <div className="w-12 h-12 mx-auto bg-white rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-slate-400 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-sm text-slate-600">
                      <span className="font-medium text-primary">{t('complaintForm.uploadClick')}</span>
                      <input id="file-upload" name="file-upload" type="file" className="sr-only" multiple onChange={handleFileChange} ref={fileInputRef} />
                      <p className="pl-1">{t('complaintForm.uploadDrop')}</p>
                    </div>
                    <p className="text-xs text-slate-500">{t('complaintForm.filesSelected', { count: files.length })}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors ${
                      recording ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    {recording ? t('complaintForm.stopRecording') : t('complaintForm.startRecording')}
                  </button>
                  {recording && <span className="text-xs text-red-600 animate-pulse">{t('complaintForm.recordingInProgress')}</span>}
                </div>
                {recordingError && <p className="text-xs text-red-600 mt-1">{recordingError}</p>}

                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((file, i) => (
                      <li key={i} className="text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg flex items-center justify-between">
                        <span dir="ltr">{file.name}</span>
                        <span className="flex items-center gap-2">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                          <button type="button" onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button 
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="complaint-form"
            disabled={loading}
            className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loading ? t('complaintForm.saving') : t('complaintForm.saveBtn')}
          </button>
        </div>

      </div>
    </div>
  );
}
