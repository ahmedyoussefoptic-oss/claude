import { useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Copy, Check, Upload, X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { useBranches, useDepartments, useComplaintTypes, useSubTypes } from '../hooks/useOrgData';
import { STAGES } from '../config/complaintTypes';
import { trackingLink } from '../utils/whatsapp';
import logo from '../assets/logo.png';
import Watermark from '../components/common/Watermark';
import SystemCredit from '../components/common/SystemCredit';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

export default function PublicComplaintForm() {
  const [searchParams] = useSearchParams();
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();

  const [formData, setFormData] = useState({ ...emptyForm, branch: searchParams.get('branch') || '' });
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // { complaintId }
  const [linkCopied, setLinkCopied] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'complaintType' ? { subType: '' } : {}),
    }));
  };

  const handleFileChange = (e) => {
    if (!e.target.files?.length) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const addFiles = (newFiles) => {
    setError(null);
    const oversized = newFiles.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`حجم الملف "${oversized.name}" أكبر من 4 ميجابايت.`);
      return;
    }
    setFiles((prev) => {
      const combined = [...prev, ...newFiles];
      if (combined.length > MAX_FILES) {
        setError(`يمكن إرفاق ${MAX_FILES} ملفات كحد أقصى.`);
        return prev;
      }
      return combined;
    });
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

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

      setSaved({ complaintId: result.data.complaintId });
      setFiles([]);
    } catch (err) {
      console.error(err);
      setError(err.message?.includes('4 ميجابايت') || err.message?.includes('ملفات كحد أقصى')
        ? err.message
        : 'حدث خطأ أثناء إرسال الملاحظة. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(trackingLink(saved.complaintId));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is shown as text anyway.
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <img src={logo} alt="مدارس مكتشف العالمية" className="h-8 w-auto" />
            <span className="font-bold text-lg">مدارس المكتشف العالمية</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center p-6">
        {saved ? (
          <div className="w-full max-w-xl mt-10 bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 text-center animate-in slide-in-from-bottom-4 duration-500">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">تم إرسال ملاحظتكم بنجاح</h2>
            <p className="text-sm text-slate-500 mb-6">سيتم مراجعتها والتواصل معكم في أقرب وقت.</p>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-4">
              <p className="text-xs text-slate-500 mb-1">رقم الملاحظة</p>
              <p className="text-lg font-bold text-slate-900 font-mono" dir="ltr">{saved.complaintId}</p>
            </div>

            <p className="text-sm text-slate-600 mb-2">احتفظوا برابط المتابعة التالي لمعرفة حالة الملاحظة لاحقاً:</p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3 mb-6">
              <span className="flex-1 text-xs text-slate-600 truncate text-left" dir="ltr">{trackingLink(saved.complaintId)}</span>
              <button
                onClick={copyLink}
                className="shrink-0 p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                title="نسخ الرابط"
              >
                {linkCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <Link
                to={`/track?id=${saved.complaintId}`}
                className="w-full px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors"
              >
                متابعة حالة الملاحظة الآن
              </Link>
              <button
                onClick={() => setSaved(null)}
                className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors"
              >
                تقديم ملاحظة أخرى
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="w-full max-w-xl mt-6 mb-6 text-center">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">تقديم ملاحظة</h1>
              <p className="text-slate-500 text-sm">يرجى تعبئة البيانات التالية بدقة، وسيتم التواصل معكم في أقرب وقت.</p>
            </div>

            <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>
              )}

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

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">مرفقات (اختياري)</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
                    }}
                    className="flex justify-center px-6 py-5 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <div className="space-y-1.5 text-center">
                      <Upload className="w-6 h-6 mx-auto text-slate-400" />
                      <p className="text-sm text-slate-600">
                        <span className="font-medium text-primary">اضغط لرفع صورة أو ملف</span>
                        <input ref={fileInputRef} type="file" className="sr-only" multiple onChange={handleFileChange} accept="image/*,.pdf,.doc,.docx" />
                        {' '}أو اسحبه وأفلته هنا
                      </p>
                      <p className="text-xs text-slate-400">حتى {MAX_FILES} ملفات، بحد أقصى 4 ميجابايت لكل ملف</p>
                    </div>
                  </div>
                  {files.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {files.map((file, i) => (
                        <li key={i} className="text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg flex items-center justify-between">
                          <span dir="ltr" className="truncate">{file.name}</span>
                          <span className="flex items-center gap-2 shrink-0">
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

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'جاري الإرسال...' : 'إرسال الملاحظة'}
              </button>
            </form>
          </>
        )}
      </main>

      <SystemCredit className="relative z-10" />
    </div>
  );
}
