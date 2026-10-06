import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { ROLES, ROLE_LABELS } from '../config/roles';
import { useBranches, useDepartments } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import { userBranches } from '../utils/scope';
import { STAGES } from '../config/complaintTypes';
import NotificationPrefsEditor from '../components/common/NotificationPrefsEditor';
import { Users as UsersIcon, Plus, Loader2, Mail, Lock, Phone, Briefcase, User as UserIcon, Pencil, Trash2, KeyRound, X, SlidersHorizontal, RotateCcw } from 'lucide-react';

const DEPARTMENT_IDS = ['ADMINISTRATIVE', 'ACADEMIC', 'BEHAVIORAL', 'IT'];

// Collapses a user's grade list into ranges in STAGES order for display,
// e.g. [G1, G2, G3, G4, G5, G9] -> "G1–G5، G9".
function formatStages(stages, sep) {
  const idx = [...new Set(stages)].map((st) => STAGES.indexOf(st)).filter((i) => i >= 0).sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < idx.length; i++) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    parts.push(j > i ? `${STAGES[idx[i]]}–${STAGES[idx[j]]}` : STAGES[idx[i]]);
    i = j;
  }
  return parts.join(sep);
}

const emptyForm = {
  name: '',
  email: '',
  password: '',
  phone: '',
  jobTitle: '',
  department: '',
  active: true,
  role: ROLES.CUSTOMER_SERVICE,
  branches: [],
  access: 'branch',
  perms: { edit: false, delete: false, users: false },
  isPrincipal: false,
  isQuality: false,
  notificationPrefs: {},
  notificationChannels: {},
  stages: [],
  curricula: [],
};

export default function Users() {
  const { t, i18n } = useTranslation();
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const roleName = (r) => t(`roles.${r}`, ROLE_LABELS[r] || r);
  const departmentName = (id) => t(`users.departments.${id}`, id);
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const branches = useBranches();
  const curriculumOptions = useDepartments();
  const curriculumName = (id) => curriculumOptions.find((d) => d.id === id)?.name || id;

  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState(null);

  const [branchFilter, setBranchFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

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
      branches: userBranches(u),
      access: u.access === 'all' ? 'all' : 'branch',
      perms: { edit: !!u.perms?.edit, delete: !!u.perms?.delete, users: !!u.perms?.users },
      isPrincipal: u.isPrincipal === true,
      isQuality: u.isQuality === true,
      notificationPrefs: u.notificationPrefs || {},
      notificationChannels: u.notificationChannels || {},
      stages: Array.isArray(u.stages) ? u.stages : [],
      curricula: Array.isArray(u.curricula) ? u.curricula : [],
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
      const branches = form.access === 'all' ? [] : form.branches;
      if (editingId) {
        await updateDoc(doc(db, 'users', editingId), {
          name: form.name,
          phone: form.phone || null,
          jobTitle: form.jobTitle || null,
          department,
          active: form.active,
          role: form.role,
          branches,
          access: form.access,
          perms: form.perms,
          isPrincipal: form.isPrincipal,
          isQuality: form.isQuality,
          notificationPrefs: form.notificationPrefs,
          notificationChannels: form.notificationChannels,
          stages: form.stages,
          curricula: form.curricula,
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
          branches,
          access: form.access,
          perms: form.perms,
          isPrincipal: form.isPrincipal,
          isQuality: form.isQuality,
          notificationPrefs: form.notificationPrefs,
          notificationChannels: form.notificationChannels,
          stages: form.stages,
          curricula: form.curricula,
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
      alert(t('users.cannotDeleteSelf'));
      return;
    }
    if (!confirm(t('users.deleteConfirm', { name: u.name }))) return;
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
      setResetError(t('users.passwordTooShort'));
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

  const filteredUsers = users.filter((u) => {
    if (branchFilter && u.access !== 'all' && !userBranches(u).includes(branchFilter)) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    return true;
  });
  const filtersActive = branchFilter || roleFilter;
  const resetFilters = () => { setBranchFilter(''); setRoleFilter(''); };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-primary" />
            {t('users.pageTitle')}
          </h1>
          <p className="text-slate-500 mt-1">{t('users.pageSubtitle')}</p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl hover:bg-primary-dark transition-colors"
        >
          <Plus className="w-5 h-5" />
          {t('users.addUser')}
        </button>
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
          <h2 className="text-lg font-bold mb-4">{editingId ? t('users.editUserTitle') : t('users.addNewUserTitle')}</h2>
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')}</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.emailLabel')}</label>
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
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.passwordLabel')}</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.staffPhoneLabel')}</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.jobTitleLabel')}</label>
              <div className="relative">
                <Briefcase className="absolute right-3 top-2.5 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={form.jobTitle}
                  onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))}
                  placeholder={t('users.jobTitlePlaceholder')}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.roleLabel')}</label>
              <select
                value={form.role}
                onChange={(e) => handleRoleChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
              >
                {Object.values(ROLES).map((r) => (
                  <option key={r} value={r}>{roleName(r)}</option>
                ))}
              </select>
              {form.role === ROLES.RECEPTIONIST && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-1.5">{t('users.receptionistHint')}</p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')}</label>
              <div className={`flex flex-wrap gap-x-5 gap-y-2 border border-slate-200 rounded-xl p-3 ${form.access === 'all' ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.branches.includes(b.id)}
                      disabled={form.access === 'all'}
                      onChange={(e) => setForm((p) => ({
                        ...p,
                        branches: e.target.checked ? [...p.branches, b.id] : p.branches.filter((id) => id !== b.id),
                      }))}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">{t('users.multiBranchHint')}</p>
            </div>
            {form.role === ROLES.SPECIALIST && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.departmentSpecialtyLabel')}</label>
                <select
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
                >
                  <option value="">{t('users.selectDepartment')}</option>
                  {DEPARTMENT_IDS.map((id) => <option key={id} value={id}>{departmentName(id)}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {t('users.departmentHint')}
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.status')}</label>
              <select
                value={form.active ? '1' : '0'}
                onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === '1' }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-primary bg-white"
              >
                <option value="1">{t('users.activeStatus')}</option>
                <option value="0">{t('users.suspendedStatus')}</option>
              </select>
            </div>

            <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-4">
              <p className="text-sm font-bold text-slate-800 mb-3">{t('users.accessPermsTitle')}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.access === 'all'}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, access: e.target.checked ? 'all' : 'branch' }))}
                  />
                  🌐 {t('users.accessAllBranches')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.edit}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, edit: e.target.checked } }))}
                  />
                  ✏️ {t('users.permEditComplaints')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.delete}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, delete: e.target.checked } }))}
                  />
                  🗑️ {t('users.permDeleteComplaints')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.perms.users}
                    disabled={isAdminRole}
                    onChange={(e) => setForm((p) => ({ ...p, perms: { ...p.perms, users: e.target.checked } }))}
                  />
                  👥 {t('users.permManageUsers')}
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {t('users.accessPermsHint')}
              </p>
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">{t('users.stagesLabel')}</label>
                {form.stages.length > 0 && (
                  <button type="button" onClick={() => setForm((p) => ({ ...p, stages: [] }))} className="text-xs text-primary hover:underline">
                    {t('users.stagesClear')}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 border border-slate-200 rounded-xl p-3 bg-white">
                {STAGES.map((st) => {
                  const on = form.stages.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setForm((p) => ({
                        ...p,
                        stages: on ? p.stages.filter((x) => x !== st) : STAGES.filter((x) => x === st || p.stages.includes(x)),
                      }))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary'}`}
                      dir="ltr"
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {form.stages.length ? t('users.stagesSelected', { list: formatStages(form.stages, listSep) }) : t('users.stagesAll')}
                {' '}{t('users.stagesHint')}
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.curriculaLabel')}</label>
              <div className="flex flex-wrap gap-x-5 gap-y-2 border border-slate-200 rounded-xl p-3 bg-white">
                {curriculumOptions.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.curricula.includes(d.id)}
                      onChange={(e) => setForm((p) => ({
                        ...p,
                        curricula: e.target.checked ? [...p.curricula, d.id] : p.curricula.filter((id) => id !== d.id),
                      }))}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {form.curricula.length ? t('users.curriculaSelected', { list: form.curricula.map(curriculumName).join(listSep) }) : t('users.curriculaAll')}
              </p>
            </div>

            <div className="md:col-span-2 bg-amber-50 border border-amber-100 rounded-xl p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={form.isPrincipal}
                  onChange={(e) => setForm((p) => ({ ...p, isPrincipal: e.target.checked }))}
                />
                🏫 {t('users.isPrincipalLabel')}
              </label>
              <p className="text-xs text-slate-600 mt-2">{t('users.isPrincipalHint')}</p>
            </div>

            <div className="md:col-span-2 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={form.isQuality}
                  onChange={(e) => setForm((p) => ({ ...p, isQuality: e.target.checked }))}
                />
                ✅ {t('users.isQualityLabel')}
              </label>
              <p className="text-xs text-slate-600 mt-2">{t('users.isQualityHint')}</p>
            </div>

            <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-4">
              <NotificationPrefsEditor
                prefs={form.notificationPrefs}
                channels={form.notificationChannels}
                onChange={({ prefs, channels }) => setForm((p) => ({ ...p, notificationPrefs: prefs, notificationChannels: channels }))}
              />
            </div>

            <div className="md:col-span-2 mt-2 flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 flex items-center justify-center py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-70"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (editingId ? t('users.saveChanges') : t('common.save'))}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors"
              >
                {t('common.cancel')}
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
          <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-end bg-slate-50/50">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 pb-2.5">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t('users.filtersLabel')}
            </div>
            <div className="w-44">
              <label className="block text-xs text-slate-500 mb-1">{t('common.branch')}</label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
              >
                <option value="">{t('common.allBranches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="w-52">
              <label className="block text-xs text-slate-500 mb-1">{t('users.rolesFilterLabel')}</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
              >
                <option value="">{t('users.allRoles')}</option>
                {Object.values(ROLES).map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
              </select>
            </div>
            {filtersActive && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('common.reset')}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.nameJobTitleHeader')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.contactHeader')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.roleLabel')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.departmentHeader')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.accessScopeHeader')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('common.edit')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('users.deleteComplaintsHeader')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('common.status')}</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-600">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">
                      {u.name}{u.id === currentUser?.uid && <span className="mr-2 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{t('users.youBadge')}</span>}
                      {u.jobTitle && <div className="text-xs text-slate-500 font-normal mt-0.5">{u.jobTitle}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500" dir="ltr">
                      {u.email}
                      {u.phone && <div>{u.phone}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {roleName(u.role)}
                      </span>
                      {u.isPrincipal && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 mr-1 mt-1">
                          🏫 {t('users.principalTag')}
                        </span>
                      )}
                      {u.isQuality && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 mr-1 mt-1">
                          ✅ {t('users.qualityTag')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {u.department ? departmentName(u.department) : '—'}
                      {Array.isArray(u.stages) && u.stages.length > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {t('users.stagesShort')}: <span dir="ltr">{formatStages(u.stages, ', ')}</span>
                        </div>
                      )}
                      {Array.isArray(u.curricula) && u.curricula.length > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {t('users.curriculaShort')}: {u.curricula.map(curriculumName).join(listSep)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {u.access === 'all'
                        ? `🌐 ${t('common.allBranches')}`
                        : (userBranches(u).map((id) => branches.find((b) => b.id === id)?.name || id).join(listSep) || '—')}
                    </td>
                    <td className="px-6 py-4 text-sm">{u.perms?.edit ? '✔' : '—'}</td>
                    <td className="px-6 py-4 text-sm">{u.perms?.delete ? '✔' : '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${u.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                        {u.active === false ? t('users.suspendedStatus') : t('users.activeStatus')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <button onClick={() => openEditForm(u)} className="p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title={t('common.edit')}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => openResetPassword(u)} className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title={t('users.resetPasswordTitle')}>
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(u)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title={t('common.delete')}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan="9" className="px-6 py-8 text-center text-slate-500">
                      {users.length === 0 ? t('users.noUsersRegistered') : t('users.noUsersMatchFilters')}
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
              <h2 className="text-lg font-bold text-slate-900">{t('users.resetPasswordTitle')}</h2>
              <button onClick={() => setResetTarget(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {t('users.forStaff')} <span className="font-medium text-slate-800">{resetTarget.name}</span>
            </p>
            {resetError && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{resetError}</div>}
            <form onSubmit={handleResetPassword}>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('users.newPasswordLabel')}</label>
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
                  {resetSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : t('users.savePasswordBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
