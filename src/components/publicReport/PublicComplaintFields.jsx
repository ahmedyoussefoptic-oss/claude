import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useBranches, useDepartments, useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';
import { STAGES } from '../../config/complaintTypes';
import { MAX_PUBLIC_FILES, MAX_PUBLIC_FILE_BYTES, fileToBase64 } from '../../utils/publicSubmission';
import AttachmentUploader from './AttachmentUploader';

const emptyForm = {
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
  details: '',
};

export default function PublicComplaintFields({ initialBranch, onSuccess }) {
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();

  const [formData, setFormData] = useState({ ...emptyForm, branch: initialBranch || '' });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'complaintType' ? { subType: '' } : {}),
    }));
  };

  const addFiles = (newFiles) => {
    setError(null);
    const oversized = newFiles.find((f) => f.size > MAX_PUBLIC_FILE_BYTES);
    if (oversized) {
      setError(`حجم الملف "${oversized.name}" أكبر من ${(MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0)} ميجابايت.`);
      return;
    }
    setFiles((prev) => {
      const combined = [...prev, ...newFiles];
      if (combined.length > MAX_PUBLIC_FILES) {
        setError(`يمكن إرفاق ${MAX_PUBLIC_FILES} ملفات كحد أقصى.`);
        return prev;
      }
      return combined;
    });
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: await fileToBase64(file),
        }))
      );

      const submitPublicComplaint = httpsCallable(functions, 'submitPublicComplaint');
      const result = await submitPublicComplaint({ ...formData, attachments });
      onSuccess(result.data.complaintId);
    } catch (err) {
      console.error(err);
      setError(err.message?.includes('ميجابايت') || err.message?.includes('ملفات كحد أقصى')
        ? err.message
        : 'حدث خطأ أثناء إرسال الملاحظة. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">بيانات ولي الأمر</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم <span className="text-red-500">*</span></label>
            <input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الجوال (واتساب) <span className="text-red-500">*</span></label>
            <input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">البريد الإلكتروني</label>
          <input type="email" name="parentEmail" value={formData.parentEmail} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">بيانات الطالب</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الطالب <span className="text-red-500">*</span></label>
            <input type="text" name="studentName" value={formData.studentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم هوية الطالب <span className="text-red-500">*</span></label>
            <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع <span className="text-red-500">*</span></label>
            <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر الفرع...</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم</label>
            <select name="department" value={formData.department} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر القسم...</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">المرحلة <span className="text-red-500">*</span></label>
            <select name="stage" value={formData.stage} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر المرحلة...</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الصف</label>
            <input type="text" name="grade" value={formData.grade} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">تفاصيل الملاحظة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف <span className="text-red-500">*</span></label>
            <select name="complaintType" value={formData.complaintType} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر التصنيف...</option>
              {complaintTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف الفرعي</label>
            <select name="subType" value={formData.subType} onChange={handleChange} disabled={!formData.complaintType} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white disabled:text-slate-400 disabled:bg-slate-50">
              <option value="">اختر...</option>
              {subTypes.filter((s) => s.parentType === formData.complaintType).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
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
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
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
            placeholder="اكتب تفاصيل الملاحظة هنا..."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>

        <AttachmentUploader files={files} onAdd={addFiles} onRemove={removeFile} />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'جاري الإرسال...' : 'إرسال الملاحظة'}
      </button>
    </form>
  );
}
