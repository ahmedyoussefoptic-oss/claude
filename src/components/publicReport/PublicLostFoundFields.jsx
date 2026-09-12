import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useBranches, useItemCategories } from '../../hooks/useOrgData';
import { REPORT_TYPES } from '../../config/lostFound';
import { MAX_PUBLIC_FILE_BYTES, fileToBase64 } from '../../utils/publicSubmission';
import AttachmentUploader from './AttachmentUploader';

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
};

export default function PublicLostFoundFields({ initialBranch, onSuccess }) {
  const branches = useBranches();
  const itemCategories = useItemCategories();

  const [formData, setFormData] = useState({ ...emptyForm, branch: initialBranch || '' });
  const [photoFiles, setPhotoFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const addPhoto = (newFiles) => {
    setError(null);
    const file = newFiles[0];
    if (!file) return;
    if (file.size > MAX_PUBLIC_FILE_BYTES) {
      setError(`حجم الصورة أكبر من ${(MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0)} ميجابايت.`);
      return;
    }
    setPhotoFiles([file]);
  };

  const removePhoto = () => setPhotoFiles([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.reportType === 'LOST' && (!formData.reporterName.trim() || !formData.reporterPhone.trim())) {
      setError('يرجى إدخال اسم ورقم جوال المُبلّغ عن الفقدان.');
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
      setError(err.message?.includes('ميجابايت') || err.message?.includes('المُبلّغ')
        ? err.message
        : 'حدث خطأ أثناء إرسال البلاغ. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        {REPORT_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFormData((prev) => ({ ...prev, reportType: t.id }))}
            className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
              formData.reportType === t.id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">بيانات الغرض</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الغرض <span className="text-red-500">*</span></label>
            <input type="text" name="itemName" value={formData.itemName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف <span className="text-red-500">*</span></label>
            <select name="category" value={formData.category} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر التصنيف...</option>
              {itemCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">اللون</label>
            <input type="text" name="color" value={formData.color} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع <span className="text-red-500">*</span></label>
            <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
              <option value="">اختر الفرع...</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {formData.reportType === 'FOUND' ? 'مكان العثور عليه' : 'مكان/زمان الفقدان'}
          </label>
          <input type="text" name="location" value={formData.location} onChange={handleChange} placeholder="مثال: الفناء، الفصل 4-ب..." className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">وصف إضافي</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            placeholder="أي تفاصيل تساعد على التعرف على الغرض..."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700">
          {formData.reportType === 'FOUND' ? 'بيانات من عثر على الغرض (اختياري)' : 'بيانات ولي الأمر / الطالب المُبلِّغ'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              الاسم {formData.reportType === 'LOST' && <span className="text-red-500">*</span>}
            </label>
            <input type="text" name="reporterName" value={formData.reporterName} onChange={handleChange} required={formData.reportType === 'LOST'} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              رقم الجوال {formData.reportType === 'LOST' && <span className="text-red-500">*</span>}
            </label>
            <input type="tel" name="reporterPhone" value={formData.reporterPhone} onChange={handleChange} required={formData.reportType === 'LOST'} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
        </div>

        {formData.reportType === 'LOST' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الطالب</label>
              <input type="text" name="studentName" value={formData.studentName} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم هوية الطالب</label>
              <input type="text" name="studentId" value={formData.studentId} onChange={handleChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
            </div>
          </div>
        )}

        <AttachmentUploader files={photoFiles} onAdd={addPhoto} onRemove={removePhoto} max={1} label="صورة الغرض (اختياري)" accept="image/*" />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'جاري الإرسال...' : 'إرسال البلاغ'}
      </button>
    </form>
  );
}
