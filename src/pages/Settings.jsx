import { useState } from 'react';
import { collection, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import { Settings as SettingsIcon, Pencil, Check, X, Plus, Trash2, Building2, GraduationCap } from 'lucide-react';

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
    </div>
  );
}
