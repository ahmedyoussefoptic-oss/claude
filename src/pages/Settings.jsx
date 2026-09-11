import { useRef, useState } from 'react';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import { useMessageTemplates } from '../hooks/useMessageTemplates';
import { parseStudentRows, upsertStudents } from '../utils/students';
import { DEFAULT_TEMPLATES, TEMPLATE_PLACEHOLDERS } from '../utils/whatsapp';
import { Settings as SettingsIcon, Pencil, Check, X, Plus, Trash2, Building2, GraduationCap, Upload, Users as UsersIcon, Loader2, MessageCircle, RotateCcw } from 'lucide-react';

const TEMPLATE_LABELS = {
  receipt: 'رسالة استلام الملاحظة',
  resolution: 'رسالة حل الملاحظة',
  credential: 'رسالة بيانات الدخول (الدعم الفني)',
  lostFoundReceipt: 'رسالة استلام بلاغ مفقودات',
  lostFoundResolution: 'رسالة تسليم المفقودات',
  techSupportReceipt: 'رسالة استلام بلاغ تقني',
};

function MessageTemplatesEditor() {
  const liveTemplates = useMessageTemplates();
  const [drafts, setDrafts] = useState(null); // null until first touched, then { receipt, resolution, credential }
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const [error, setError] = useState(null);

  const valueFor = (key) => drafts?.[key] ?? liveTemplates[key];

  const handleChange = (key, value) => {
    setDrafts((prev) => ({ ...(prev ?? liveTemplates), [key]: value }));
    setSavedKey(null);
  };

  const handleSave = async (key) => {
    setSavingKey(key);
    setError(null);
    try {
      await setDoc(doc(db, 'settings', 'messageTemplates'), { [key]: valueFor(key) }, { merge: true });
      setSavedKey(key);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = (key) => {
    setDrafts((prev) => ({ ...(prev ?? liveTemplates), [key]: DEFAULT_TEMPLATES[key] }));
    setSavedKey(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-2">
        <MessageCircle className="w-5 h-5 text-primary" />
        قوالب رسائل الواتساب
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        عدّل نص الرسائل المرسلة تلقائياً لأولياء الأمور عبر واتساب. لا تحذف الرموز بين قوسين مزدوجين
        (مثل <code dir="ltr" className="bg-slate-100 px-1 rounded">{'{{parentName}}'}</code>) فهي تُستبدل تلقائياً بالبيانات الفعلية عند الإرسال.
      </p>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      <div className="space-y-6">
        {Object.keys(DEFAULT_TEMPLATES).map((key) => (
          <div key={key} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-slate-800">{TEMPLATE_LABELS[key]}</p>
              <button
                onClick={() => handleReset(key)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                title="استعادة النص الافتراضي"
              >
                <RotateCcw className="w-3 h-3" />
                استعادة الافتراضي
              </button>
            </div>
            <textarea
              value={valueFor(key)}
              onChange={(e) => handleChange(key, e.target.value)}
              rows={7}
              dir="rtl"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white resize-y"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-slate-400">
                المتغيرات المتاحة: {TEMPLATE_PLACEHOLDERS[key].map((p) => `{{${p}}}`).join('، ')}
              </p>
              <div className="flex items-center gap-2">
                {savedKey === key && <span className="text-xs text-emerald-600">تم الحفظ ✓</span>}
                <button
                  onClick={() => handleSave(key)}
                  disabled={savingKey === key}
                  className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-60 flex items-center gap-2"
                >
                  {savingKey === key && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  حفظ
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentImport() {
  const branches = useBranches();
  const fileInputRef = useRef(null);
  const [parsed, setParsed] = useState(null); // { records, skipped, fileName }
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null); // { count } | { error }

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setParsed(null);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const { records, skipped } = parseStudentRows(rows, branches);
      setParsed({ records, skipped, fileName: file.name });
    } catch (err) {
      setResult({ error: 'تعذّرت قراءة الملف — تأكد أنه بصيغة Excel صحيحة (.xlsx/.xls).' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImport = async () => {
    if (!parsed?.records?.length) return;
    setImporting(true);
    setResult(null);
    try {
      const count = await upsertStudents(parsed.records, (done, total) => setProgress({ done, total }));
      setResult({ count });
      setParsed(null);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <UsersIcon className="w-5 h-5 text-primary" />
          استيراد بيانات الطلاب
        </h3>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        ارفع ملف Excel يحتوي على أعمدة: id_num، name، branch_name، stage_name، grade_name، class_name، mobile.
        يتم دمج البيانات مع الموجود مسبقاً حسب رقم الهوية — لا يُحذف أي طالب غير موجود في الملف الجديد.
      </p>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" id="student-file-input" />
      <label
        htmlFor="student-file-input"
        className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-600 hover:border-primary hover:text-primary cursor-pointer transition-colors"
      >
        <Upload className="w-4 h-4" />
        اختر ملف Excel
      </label>

      {parsed && (
        <div className="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm">
          <p className="text-slate-700">
            <span className="font-medium">{parsed.fileName}</span> — تم العثور على{' '}
            <span className="font-bold text-primary">{parsed.records.length}</span> سجل طالب صالح للاستيراد.
          </p>
          {parsed.skipped.length > 0 && (
            <p className="text-amber-600 mt-1">
              تم تجاهل {parsed.skipped.length} صف بسبب نقص رقم الهوية أو الاسم (الصفوف: {parsed.skipped.slice(0, 10).join(', ')}{parsed.skipped.length > 10 ? '...' : ''}).
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleImport}
              disabled={importing || parsed.records.length === 0}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-60 flex items-center gap-2"
            >
              {importing && <Loader2 className="w-4 h-4 animate-spin" />}
              {importing ? `جاري الاستيراد... ${progress ? `(${progress.done}/${progress.total})` : ''}` : 'تأكيد الاستيراد والدمج'}
            </button>
            <button onClick={() => setParsed(null)} disabled={importing} className="px-4 py-2 text-slate-500 text-sm hover:bg-slate-100 rounded-lg disabled:opacity-60">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {result?.count != null && (
        <div className="mt-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl p-3 text-sm">
          تم استيراد/تحديث {result.count} سجل طالب بنجاح.
        </div>
      )}
      {result?.error && (
        <div className="mt-4 bg-red-50 text-red-600 border border-red-100 rounded-xl p-3 text-sm">{result.error}</div>
      )}
    </div>
  );
}

function EditableList({ title, icon: Icon, items, collectionName }) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraftName(item.name);
    setError(null);
  };

  const saveEdit = async (id) => {
    if (!draftName.trim()) return;
    try {
      await updateDoc(doc(db, collectionName, id), { name: draftName.trim() });
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdd = async () => {
    if (!newId.trim() || !newName.trim()) {
      setError('الرمز والاسم مطلوبان.');
      return;
    }
    try {
      await setDoc(doc(db, collectionName, newId.trim().toUpperCase().replace(/\s+/g, '_')), {
        name: newName.trim(),
        order: items.length + 1,
        active: true,
      });
      setAdding(false);
      setNewId('');
      setNewName('');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeactivate = async (item) => {
    if (!confirm(`إخفاء "${item.name}" من قوائم النظام؟ (لن تُحذف بياناته القديمة)`)) return;
    try {
      await updateDoc(doc(db, collectionName, item.id), { active: false });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          {title}
        </h3>
        <button onClick={() => setAdding((v) => !v)} className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1">
          <Plus className="w-4 h-4" />
          إضافة
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {adding && (
        <div className="flex flex-wrap gap-2 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="الرمز (بالإنجليزية، مثال: AL_QUDS)"
            dir="ltr"
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="الاسم المعروض"
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button onClick={handleAdd} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">حفظ</button>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="py-3 flex items-center gap-3">
            {editingId === item.id ? (
              <>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  autoFocus
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button onClick={() => saveEdit(item.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-slate-800">{item.name}</span>
                <span className="text-xs text-slate-400 font-mono" dir="ltr">{item.id}</span>
                <button onClick={() => startEdit(item)} className="p-1.5 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg" title="تعديل الاسم">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeactivate(item)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title="إخفاء">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">لا توجد عناصر</li>
        )}
      </ul>
    </div>
  );
}

export default function Settings() {
  const branches = useBranches();
  const departments = useDepartments();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          الإعدادات
        </h1>
        <p className="text-slate-500 mt-1">تعديل أسماء الفروع والأقسام المستخدمة في كل قوائم النظام</p>
      </div>

      <EditableList title="الفروع" icon={Building2} items={branches} collectionName="branches" />
      <EditableList title="الأقسام (المناهج)" icon={GraduationCap} items={departments} collectionName="departments" />
      <StudentImport />
      <MessageTemplatesEditor />
    </div>
  );
}
