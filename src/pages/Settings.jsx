import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  useBranches,
  useDepartments,
  useComplaintTypes,
  useSubTypes,
  useProblemTypes,
  usePlatforms,
  useItemCategories,
  ensureSeeded,
} from '../hooks/useOrgData';
import { useMessageTemplates } from '../hooks/useMessageTemplates';
import WhatsAppApiSettings from '../components/settings/WhatsAppApiSettings';
import SlaSettings from '../components/settings/SlaSettings';
import AppointmentSettings from '../components/settings/AppointmentSettings';
import { parseStudentRows, upsertStudents } from '../utils/students';
import { DEFAULT_TEMPLATES, TEMPLATE_PLACEHOLDERS } from '../utils/whatsapp';
import {
  Settings as SettingsIcon,
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  Building2,
  GraduationCap,
  Upload,
  Users as UsersIcon,
  Loader2,
  MessageCircle,
  RotateCcw,
  Tag,
  Tags,
  Wrench,
  Monitor,
  Package,
} from 'lucide-react';

function MessageTemplatesEditor() {
  const { t, i18n } = useTranslation();
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
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
        {t('settings.templatesTitle')}
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        {t('settings.templatesDescriptionPre')}
        (<code dir="ltr" className="bg-slate-100 px-1 rounded">{'{{parentName}}'}</code>) {t('settings.templatesDescriptionPost')}
      </p>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      <div className="space-y-6">
        {Object.keys(DEFAULT_TEMPLATES).map((key) => (
          <div key={key} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-slate-800">{t(`settings.templateLabels.${key}`)}</p>
              <button
                onClick={() => handleReset(key)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                title={t('settings.restoreDefault')}
              >
                <RotateCcw className="w-3 h-3" />
                {t('settings.restoreDefault')}
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
                {t('settings.availableVariables')} {TEMPLATE_PLACEHOLDERS[key].map((p) => `{{${p}}}`).join(listSep)}
              </p>
              <div className="flex items-center gap-2">
                {savedKey === key && <span className="text-xs text-emerald-600">{t('settings.savedCheck')}</span>}
                <button
                  onClick={() => handleSave(key)}
                  disabled={savingKey === key}
                  className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-60 flex items-center gap-2"
                >
                  {savingKey === key && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t('common.save')}
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
  const { t } = useTranslation();
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
    } catch {
      setResult({ error: t('settings.fileReadError') });
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
          {t('settings.studentImportTitle')}
        </h3>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        {t('settings.studentImportDescription')}
      </p>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" id="student-file-input" />
      <label
        htmlFor="student-file-input"
        className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-600 hover:border-primary hover:text-primary cursor-pointer transition-colors"
      >
        <Upload className="w-4 h-4" />
        {t('settings.chooseExcelFile')}
      </label>

      {parsed && (
        <div className="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm">
          <p className="text-slate-700">
            <span className="font-medium">{parsed.fileName}</span> — {t('settings.foundRecords', { count: parsed.records.length })}
          </p>
          {parsed.skipped.length > 0 && (
            <p className="text-amber-600 mt-1">
              {t('settings.skippedRows', { count: parsed.skipped.length, rows: parsed.skipped.slice(0, 10).join(', ') + (parsed.skipped.length > 10 ? '...' : '') })}
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleImport}
              disabled={importing || parsed.records.length === 0}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-60 flex items-center gap-2"
            >
              {importing && <Loader2 className="w-4 h-4 animate-spin" />}
              {importing ? t('settings.importingProgress', { progress: progress ? `(${progress.done}/${progress.total})` : '' }) : t('settings.confirmImportMerge')}
            </button>
            <button onClick={() => setParsed(null)} disabled={importing} className="px-4 py-2 text-slate-500 text-sm hover:bg-slate-100 rounded-lg disabled:opacity-60">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {result?.count != null && (
        <div className="mt-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl p-3 text-sm">
          {t('settings.importSuccess', { count: result.count })}
        </div>
      )}
      {result?.error && (
        <div className="mt-4 bg-red-50 text-red-600 border border-red-100 rounded-xl p-3 text-sm">{result.error}</div>
      )}
    </div>
  );
}

function EditableList({ title, icon: Icon, items, collectionName, flag }) {
  const { t } = useTranslation();
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
      setError(t('settings.codeAndNameRequired'));
      return;
    }
    try {
      // Must run before the write below — see ensureSeeded()'s comment in
      // useOrgData.js: adding the first-ever real document to a collection
      // that's still showing the hardcoded fallback instantly hides every
      // other fallback-only entry, since nothing backs them in Firestore.
      await ensureSeeded(collectionName);
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

  // Optional per-item boolean (e.g. problem types / platforms "يخص ولي
  // الأمر"). Seeds the collection first in case it's still the fallback.
  const toggleFlag = async (item) => {
    try {
      await ensureSeeded(collectionName);
      await setDoc(doc(db, collectionName, item.id), { [flag.key]: !item[flag.key] }, { merge: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeactivate = async (item) => {
    if (!confirm(t('settings.hideConfirm', { name: item.name }))) return;
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
          {t('common.add')}
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {adding && (
        <div className="flex flex-wrap gap-2 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder={t('settings.codePlaceholder')}
            dir="ltr"
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.displayNamePlaceholder')}
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button onClick={handleAdd} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">{t('common.save')}</button>
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
                {flag && (
                  <button
                    type="button"
                    onClick={() => toggleFlag(item)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${item[flag.key] ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'}`}
                  >
                    {item[flag.key] ? '✓ ' : ''}{flag.label}
                  </button>
                )}
                <span className="text-xs text-slate-400 font-mono" dir="ltr">{item.id}</span>
                <button onClick={() => startEdit(item)} className="p-1.5 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg" title={t('settings.editNameTitle')}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeactivate(item)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title={t('settings.hideTitle')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">{t('settings.noItems')}</li>
        )}
      </ul>
    </div>
  );
}

function SubTypesEditor({ complaintTypes, subTypes }) {
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState(complaintTypes[0]?.id || '');
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);

  const filtered = subTypes.filter((s) => s.parentType === activeType);

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraftName(item.name);
    setError(null);
  };

  const saveEdit = async (id) => {
    if (!draftName.trim()) return;
    try {
      await updateDoc(doc(db, 'complaintSubTypes', id), { name: draftName.trim() });
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) {
      setError(t('settings.subTypeNameRequired'));
      return;
    }
    try {
      // See ensureSeeded()'s comment in useOrgData.js — must run before the
      // write below, or the first real sub-type ever added hides every
      // other fallback-only sub-type across all three parent types at once.
      await ensureSeeded('complaintSubTypes');
      const id = `${activeType}_${Date.now()}`;
      await setDoc(doc(db, 'complaintSubTypes', id), {
        name: newName.trim(),
        parentType: activeType,
        order: filtered.length + 1,
        active: true,
      });
      setAdding(false);
      setNewName('');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  // "Visit appointment" sub-types show the slot picker on the forms.
  const toggleAppointment = async (item) => {
    try {
      await ensureSeeded('complaintSubTypes');
      await setDoc(doc(db, 'complaintSubTypes', item.id), { appointment: !item.appointment }, { merge: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeactivate = async (item) => {
    if (!confirm(t('settings.hideConfirm', { name: item.name }))) return;
    try {
      await updateDoc(doc(db, 'complaintSubTypes', item.id), { active: false });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Tags className="w-5 h-5 text-primary" />
          {t('settings.subTypesTitle')}
        </h3>
        <button onClick={() => setAdding((v) => !v)} className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1">
          <Plus className="w-4 h-4" />
          {t('common.add')}
        </button>
      </div>

      <p className="text-sm text-slate-500 mb-4">{t('settings.subTypesHint')}</p>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {complaintTypes.map((ct) => (
          <button
            key={ct.id}
            onClick={() => { setActiveType(ct.id); setAdding(false); setEditingId(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${activeType === ct.id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {ct.name}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {adding && (
        <div className="flex flex-wrap gap-2 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.subTypeNamePlaceholder')}
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button onClick={handleAdd} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">{t('common.save')}</button>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {filtered.map((item) => (
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
                <button
                  type="button"
                  onClick={() => toggleAppointment(item)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${item.appointment ? 'bg-sky-100 text-sky-800 border-sky-200' : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'}`}
                >
                  {item.appointment ? '✓ ' : ''}{t('settings.appointmentFlag')}
                </button>
                <button onClick={() => startEdit(item)} className="p-1.5 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg" title={t('settings.editNameTitle')}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeactivate(item)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg" title={t('settings.hideTitle')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">{t('settings.noSubTypesYet')}</li>
        )}
      </ul>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const branches = useBranches();
  const departments = useDepartments();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();
  const itemCategories = useItemCategories();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          {t('nav.settings')}
        </h1>
        <p className="text-slate-500 mt-1">{t('settings.pageSubtitle')}</p>
      </div>

      <EditableList title={t('settings.branchesTitle')} icon={Building2} items={branches} collectionName="branches" />
      <EditableList title={t('settings.departmentsTitle')} icon={GraduationCap} items={departments} collectionName="departments" />
      <EditableList title={t('settings.complaintTypesTitle')} icon={Tag} items={complaintTypes} collectionName="complaintTypes" flag={{ key: 'appointment', label: t('settings.appointmentFlag') }} />
      <SubTypesEditor complaintTypes={complaintTypes} subTypes={subTypes} />
      <EditableList title={t('settings.problemTypesTitle')} icon={Wrench} items={problemTypes} collectionName="problemTypes" flag={{ key: 'parentRelated', label: t('settings.parentRelatedFlag') }} />
      <EditableList title={t('settings.platformsTitle')} icon={Monitor} items={platforms} collectionName="platforms" flag={{ key: 'parentRelated', label: t('settings.parentRelatedFlag') }} />
      <EditableList title={t('settings.itemCategoriesTitle')} icon={Package} items={itemCategories} collectionName="itemCategories" />
      <StudentImport />
      <SlaSettings />
      <AppointmentSettings />
      <MessageTemplatesEditor />
      <WhatsAppApiSettings />
    </div>
  );
}
