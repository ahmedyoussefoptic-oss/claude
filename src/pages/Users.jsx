import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { ROLES, ROLE_LABELS } from '../config/roles';
import { useBranches } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import { Users as UsersIcon, Plus, Loader2, Mail, Lock, Phone, Briefcase, User as UserIcon, Pencil, Trash2, KeyRound, X } from 'lucide-react';

const DEPARTMENTS = [
  { id: 'ADMINISTRATIVE', name: 'الشؤون الإدارية' },
  { id: 'ACADEMIC', name: 'الشؤون الأكاديمية' },
  { id: 'BEHAVIORAL', name: 'التوجيه والإرشاد الطلابي' },
  { id: 'IT', name: 'تقنية المعلومات' },
];

const emptyForm = {
  name: '',
  email: '',
  password: '',
  phone: '',
  jobTitle: '',
  department: '',
  active: true,
  role: ROLES.CUSTOMER_SERVICE,
  branch: '',
  access: 'branch',
  perms: { edit: false, delete: false, users: false },
};

export default function Users() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const branches = useBranches();

  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(true);
  };

  const openEditForm = (u) => {
    setEditingId(u.id);
    setForm({
      name: u.name || '',
      email: u.email || '',
      password: '',
      phone: u.phone || '',
      jobTitle: u.jobTitle || '',
      department: u.department || '',
      active: u.active !== false,
      role: u.role || ROLES.CUSTOMER_SERVICE,
      branch: u.branch || '',
      access: u.access === 'all' ? 'all' : 'branch',
      perms: { edit: !!u.perms?.edit, delete: !!u.perms?.delete, users: !!u.perms?.users },
    });
    setError(null);
    setShowForm(true);
  };

  const handleRoleChange = (role) => {
    setForm((prev) => ({
      ...prev,
      role,
      ...(role === ROLES.ADMIN
        ? { access: 'all', perms: { edit: true, delete: true, users: true } }
        : {}),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const department = form.role === ROLES.SPECIALIST ? (form.department || null) : null;
      if (editingId) {
        await updateDoc(doc(db, 'users', editingId), {
          name: form.name,
          phone: form.phone || null,
          jobTitle: form.jobTitle || null,
          department,
          active: form.active,
          role: form.role,
          branch: form.access === 'all' ? null : (form.branch || null),
          access: form.access,
          perms: form.perms,
        });
      } else {
        // Delegates to a Cloud Function (Admin SDK) so creating a new staff
        // account no longer signs the current admin out of their own session.
        const createStaffUser = httpsCallable(functions, 'createStaffUser');
        await createStaffUser({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone || null,
          jobTitle: form.jobTitle || null,
          department,
          active: form.active,
          role: form.role,
          branch: form.access === 'all' ? null : (form.branch || null),
          access: form.access,
          perms: form.perms,
        });
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u) => {
    if (u.id === currentUser?.uid) {
      alert('لا يمكن حذف المستخدم الذي تعمل باسمه حالياً.');
      return;
    }
    if (!confirm(`تأكيد حذف الموظف "${u.name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      const deleteStaffUser = httpsCallable(functions, 'deleteStaffUser');
      await deleteStaffUser({ uid: u.id });
    } catch (err) {
      alert(err.message);
    }
  };

  const openResetPassword = (u) => {
    setResetTarget(u);
    setNewPassword('');
    setResetError(null);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setResetError('يجب ألا تقل كلمة المرور عن 6 أحرف.');
      return;
    }
    setResetSubmitting(true);
    setResetError(null);
    try {
      const resetStaffPassword = httpsCallable(functions, 'resetStaffPassword');
      await resetStaffPassword({ uid: resetTarget.id, newPassword });
      setResetTarget(null);
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetSubmitting(false);
    }
  };

  const isAdminRole = form.role === ROLES.ADMIN;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-primary" />
            إدارة المستخدمين
          </h1>
          <p className="text-slate-500 mt-1">إضافة وتعديل وحذف الموظفين وصلاحياتهم</p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl hover:bg-primary-dark transition-colors"
        >
          <Plus className="w-5 h-5" />
          إضافة مستخدم
        </button>
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
          <h2 className="text-lg font-bold mb-4">{editingId ? 'تعديل بيانات الموظف' : 'إضافة مستخدم جديد'}</h2>
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم</label>
              <div className="relative">
                <UserIcon className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">البريد الإلكتروني</label>
              <div className="relative">
                <Mail className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  disabled={!!editingId}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary disabled:bg-slate-50 disabled:text-slate-400"
                  required
                />
              </div>
            </div>
            {!editingId && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <Lock className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    dir="ltr"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم جوال الموظف</label>
              <div className="relative">
                <Phone className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="05xxxxxxxx"
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">المسمى الوظيفي</label>
              <div className="relative">
                <Briefcase className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.jobTitle}
                  onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))}
                  placeholder="مثال: وكيل الشؤون التعليمية"
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الصلاحية (الدور)</label>
              <select
                value={form.role}
                onChange={(e) => handleRoleChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
              >
                {Object.values(ROLES).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع</label>
              <select
                value={form.branch}
                onChange={(e) => setForm((p) => ({ ...p, branch: e.target.value }))}
                disabled={form.access === 'all'}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">اختر الفرع...</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {form.role === ROLES.SPECIALIST && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">القسم / التخصص</label>
                <select
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
                >
                  <option value="">اختر القسم...</option>
                  {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  للملاحظات الإدارية/الأكاديمية/السلوكية يحدد نوع الملاحظات التي يختص بمعالجتها. اختر "تقنية المعلومات" لموظفي فريق الدعم الفني — بدون موظف بهذا القسم لن تُسند بلاغات الدعم الفني لأحد تلقائياً.
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الحالة</label>
              <select
                value={form.active ? '1' : '0'}
                onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === '1' }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
              >
                <option value="1">نشط</option>
                <option value="0">موقوف</option>
              </select>
            </div>

            <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-4">
              <p className="text-sm font-bold text-slate-800 mb-3">نطاق الاطلاع والصلاحيات</p>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.access === 'all'}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, access: e.target.checked ? 'all' : 'branch' }))}
                  />
                  🌐 اطلاع على جميع الفروع
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.edit}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, edit: e.target.checked } }))}
                  />
                  ✏️ تعديل الملاحظات
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.delete}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, delete: e.target.checked } }))}
                  />
                  🗑️ حذف الملاحظات
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.users}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, users: e.target.checked } }))}
                  />
                  👥 إدارة الموظفين
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                بدون تفعيل "الاطلاع على جميع الفروع" لن يرى الموظف إلا ملاحظات فرعه فقط. "تعديل الملاحظات" يشمل الإسناد والحل والتصعيد؛ بدونه يكون الاطلاع للقراءة فقط.
              </p>
            </div>

            <div className="md:col-span-2 mt-2 flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 flex items-center justify-center py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-70"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (editingId ? 'حفظ التعديلات' : 'حفظ')}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">الاسم / المسمى الوظيفي</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">التواصل</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">الصلاحية</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">القسم</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">نطاق الاطلاع</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">تعديل</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">حذف الملاحظات</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">الحالة</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {u.name}{u.id === currentUser?.uid && <span className="mr-2 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">أنت</span>}
                      {u.jobTitle && <div className="text-xs text-slate-500 font-normal mt-0.5">{u.jobTitle}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500" dir="ltr">
                      {u.email}
                      {u.phone && <div>{u.phone}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {DEPARTMENTS.find(d => d.id === u.department)?.name || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {u.access === 'all' ? '🌐 كل الفروع' : (branches.find(b => b.id === u.branch)?.name || '—')}
                    </td>
                    <td className="px-6 py-4 text-sm">{u.perms?.edit ? '✔' : '—'}</td>
                    <td className="px-6 py-4 text-sm">{u.perms?.delete ? '✔' : '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${u.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                        {u.active === false ? 'موقوف' : 'نشط'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <button onClick={() => openEditForm(u)} className="p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="تعديل">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => openResetPassword(u)} className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="إعادة تعيين كلمة المرور">
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(u)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="9" className="px-6 py-8 text-center text-slate-500">
                      لا يوجد مستخدمين مسجلين
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">إعادة تعيين كلمة المرور</h2>
              <button onClick={() => setResetTarget(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              للموظف: <span className="font-medium text-slate-800">{resetTarget.name}</span>
            </p>
            {resetError && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{resetError}</div>}
            <form onSubmit={handleResetPassword}>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الجديدة</label>
              <div className="relative mb-4">
                <Lock className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  dir="ltr"
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={resetSubmitting}
                  className="flex-1 flex items-center justify-center py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-70"
                >
                  {resetSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'حفظ كلمة المرور'}
                </button>
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
