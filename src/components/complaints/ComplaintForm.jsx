import { useState, useRef, useEffect } from 'react';
import { X, Upload, Save, Loader2, CheckCircle2, MessageCircle, Mic, Square } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { waLink, buildReceiptMessage } from '../../utils/whatsapp';
import { lookupStudentById, searchStudentsByName } from '../../utils/students';
import { COMPLAINT_TYPES, SUB_TYPES, STAGES } from '../../config/complaintTypes';

const PRIORITIES = [
  { id: 'NORMAL', name: 'عادية (48 ساعة)' },
  { id: 'HIGH', name: 'عالية (24 ساعة)' },
  { id: 'URGENT', name: 'عاجلة (6 ساعات)' },
];

const SOURCES = [
  { id: 'CENTER_CALL', name: 'Center Call' },
  { id: 'WHATSAPP', name: 'WhatsApp' },
  { id: 'EMAIL', name: 'Email' },
  { id: 'PARENT_PORTAL', name: 'Parent Portal' },
  { id: 'VISIT', name: 'Visit' },
  { id: 'MOBILE_APP', name: 'Mobile App' },
];

export default function ComplaintForm({ onClose }) {
  const { user } = useAuthStore();
  const fileInputRef = useRef(null);
  const branches = useBranches();
  const departments = useDepartments();
  const staff = useUsers();

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
    subject: '',
    priority: 'NORMAL',
    source: 'CENTER_CALL',
    details: '',
    assignedTo: '',
  });

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedComplaint, setSavedComplaint] = useState(null);

  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const eligibleAssignees = staff
    .filter((u) => u.role === 'SPECIALIST' && u.active !== false && (u.access === 'all' || !formData.branch || u.branch === formData.branch))
    .sort((a, b) => {
      const aMatch = a.department === formData.complaintType ? 0 : 1;
      const bMatch = b.department === formData.complaintType ? 0 : 1;
      return aMatch - bMatch;
    });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'complaintType' ? { subType: '' } : {}),
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
      grade: [student.stageName, student.gradeName, student.className].filter(Boolean).join(' - ') || prev.grade,
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
        const file = new File([blob], `تسجيل_صوتي_${Date.now()}.webm`, { type: 'audio/webm' });
        setFiles((prev) => [...prev, file]);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setRecordingError('تعذّر الوصول إلى الميكروفون — تأكد من السماح للمتصفح باستخدامه، أو أرفق ملفاً صوتياً بدلاً من ذلك.');
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
      
      // Upload files first
      const uploadedAttachments = [];
      for (const file of files) {
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
      }

      const now = serverTimestamp();
      const assignee = formData.assignedTo ? staff.find((u) => u.id === formData.assignedTo) : null;

      const newComplaint = {
        ...formData,
        complaintId,
        receiver: user.uid,
        status: 'RECEIVED',
        attachments: uploadedAttachments,
        reopened: false,
        isOverdue: false,
        assignedToName: assignee?.name || '',
        assignedAt: assignee ? now : null,
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

      if (assignee) {
        await addDoc(collection(db, `complaints/${docRef.id}/activityLog`), {
          action: 'COMPLAINT_ASSIGNED',
          actorId: user.uid,
          metadata: { toUserId: assignee.id, toUserName: assignee.name },
          createdAt: now,
        });
      }

      setSavedComplaint({
        complaintId,
        parentName: formData.parentName,
        studentName: formData.studentName,
        parentPhone: formData.parentPhone,
      });
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء حفظ الملاحظة. يرجى المحاولة مرة أخرى.');
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
          <h2 className="text-lg font-bold text-slate-900 mb-1">تم حفظ الملاحظة بنجاح</h2>
          <p className="text-sm text-slate-500 mb-6">رقم الملاحظة: <span className="font-mono font-bold text-slate-900" dir="ltr">{savedComplaint.complaintId}</span></p>

          {savedComplaint.parentPhone && (
            <a
              href={waLink(savedComplaint.parentPhone, buildReceiptMessage(savedComplaint))}
              target="_blank"
              rel="noreferrer"
              className="w-full px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2 mb-3"
            >
              <MessageCircle className="w-4 h-4" />
              إرسال رسالة الاستلام عبر واتساب
            </a>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors"
          >
            إغلاق
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
            <h2 className="text-xl font-bold text-slate-900">تسجيل ملاحظة جديدة</h2>
            <p className="text-sm text-slate-500 mt-1">يرجى تعبئة بيانات الملاحظة بدقة</p>
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
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">بيانات ولي الأمر</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم <span className="text-red-500">*</span></label>
                  <input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الجوال <span className="text-red-500">*</span></label>
                  <input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">البريد الإلكتروني</label>
                  <input type="email" name="parentEmail" value={formData.parentEmail} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>
            </div>

            {/* Section 2 */}
            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">بيانات الطالب</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم <span className="text-red-500">*</span></label>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهوية <span className="text-red-500">*</span></label>
                  <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} onBlur={handleStudentIdBlur} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع <span className="text-red-500">*</span></label>
                  <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">اختر الفرع...</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم <span className="text-red-500">*</span></label>
                  <select name="department" value={formData.department} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">اختر القسم...</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">المرحلة <span className="text-red-500">*</span></label>
                  <select name="stage" value={formData.stage} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">اختر المرحلة...</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الصف <span className="text-red-500">*</span></label>
                  <input type="text" name="grade" value={formData.grade} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>
            </div>

            {/* Section 3 */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mt-6">تفاصيل الملاحظة</h3>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف <span className="text-red-500">*</span></label>
                  <select name="complaintType" value={formData.complaintType} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    <option value="">اختر التصنيف...</option>
                    {COMPLAINT_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف الفرعي</label>
                  <select name="subType" value={formData.subType} onChange={handleChange} disabled={!formData.complaintType} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm disabled:text-slate-400">
                    <option value="">اختر...</option>
                    {(SUB_TYPES[formData.complaintType] || []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الأولوية <span className="text-red-500">*</span></label>
                  <select name="priority" value={formData.priority} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">المصدر <span className="text-red-500">*</span></label>
                  <select name="source" value={formData.source} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    {SOURCES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">عنوان مختصر للملاحظة <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  placeholder="مثال: تأخر إصدار شهادة الفصل الأول"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">نص الملاحظة <span className="text-red-500">*</span></label>
                <textarea
                  name="details"
                  value={formData.details}
                  onChange={handleChange}
                  required
                  rows={4}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm resize-none"
                  placeholder="اكتب تفاصيل المشكلة هنا..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">المسند إليه</label>
                <select name="assignedTo" value={formData.assignedTo} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                  <option value="">بدون إسناد الآن (يمكن إسنادها لاحقاً)</option>
                  {eligibleAssignees.map(u => <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ''}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">يصل إشعار فوري للمختص المختار (داخل النظام وبالبريد الإلكتروني) بمجرد حفظ الملاحظة.</p>
              </div>

              {/* Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">المرفقات</label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group">
                  <div className="space-y-2 text-center">
                    <div className="w-12 h-12 mx-auto bg-white rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-slate-400 group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-sm text-slate-600">
                      <label htmlFor="file-upload" className="relative cursor-pointer rounded-md font-medium text-primary hover:text-primary-dark">
                        <span>اضغط لرفع ملف</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" multiple onChange={handleFileChange} ref={fileInputRef} />
                      </label>
                      <p className="pl-1">أو اسحب الملفات وأفلتها هنا</p>
                    </div>
                    <p className="text-xs text-slate-500">تم اختيار {files.length} ملفات</p>
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
                    {recording ? 'إيقاف التسجيل' : 'تسجيل صوتي مباشر'}
                  </button>
                  {recording && <span className="text-xs text-red-600 animate-pulse">جارٍ التسجيل...</span>}
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
            إلغاء
          </button>
          <button 
            type="submit"
            form="complaint-form"
            disabled={loading}
            className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loading ? 'جاري الحفظ...' : 'حفظ الملاحظة'}
          </button>
        </div>

      </div>
    </div>
  );
}
