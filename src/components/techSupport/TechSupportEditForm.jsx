import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2 } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments, useProblemTypes, usePlatforms } from '../../hooks/useOrgData';
import { isParentRelated } from '../../config/techSupport';
import ParentNationalIdField from './ParentNationalIdField';
import { STAGES } from '../../config/complaintTypes';
import { RELATIONS, classOptionsForStage } from '../../config/techSupport';

const FIELDS = ['studentName', 'nationalId', 'branch', 'department', 'stage', 'grade', 'parentName', 'relation', 'parentPhone', 'problemType', 'platform', 'parentNationalId', 'platformLink', 'details'];

const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm';
const selectCls = `${inputCls} bg-white`;

// Corrects a ticket's own details after it was logged (wrong phone number,
// wrong branch/problem type, typos). Status, assignment and the resolution
// message keep their own dedicated actions in TechSupportDetails.
export default function TechSupportEditForm({ ticket, onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();

  const [formData, setFormData] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, ticket[k] || ''])));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value, ...(name === 'stage' ? { grade: '' } : {}) }));
  };

  // Older records can hold a value the current lists no longer offer —
  // keep it selectable so opening the form doesn't silently blank it.
  const withCurrent = (options, value) => (value && !options.includes(value) ? [value, ...options] : options);
  const stageOptions = withCurrent(STAGES, formData.stage);
  const gradeOptions = withCurrent(classOptionsForStage(formData.stage), formData.grade);
  const relationOptions = withCurrent(RELATIONS, formData.relation);

  // Activity-log entries store readable names, not ids.
  const displayValue = (key, value) => {
    if (key === 'branch') return branches.find((b) => b.id === value)?.name || value;
    if (key === 'department') return departments.find((d) => d.id === value)?.name || value;
    if (key === 'problemType') return problemTypes.find((p) => p.id === value)?.name || value;
    if (key === 'platform') return platforms.find((p) => p.id === value)?.name || value;
    return value;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const cleaned = Object.fromEntries(FIELDS.map((k) => [k, (formData[k] || '').trim()]));
    const changed = FIELDS.filter((k) => cleaned[k] !== (ticket[k] || ''));
    if (changed.length === 0) {
      setError(t('techSupportEdit.noChanges'));
      return;
    }
    setLoading(true);
    try {
      const now = serverTimestamp();
      await updateDoc(doc(db, 'techSupportTickets', ticket.id), {
        ...Object.fromEntries(changed.map((k) => [k, cleaned[k]])),
        updatedAt: now,
      });
      await addDoc(collection(db, `techSupportTickets/${ticket.id}/activityLog`), {
        action: 'TICKET_EDITED',
        actorId: user.uid,
        actorName: userData?.name || t('common.user'),
        metadata: { changes: changed.map((k) => ({ field: k, from: displayValue(k, ticket[k] || ''), to: displayValue(k, cleaned[k]) })) },
        createdAt: now,
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError(t('techSupportEdit.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const label = (key, required) => (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {t(`techSupportEdit.fields.${key}`)} {required && <span className="text-red-500">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('techSupportEdit.title')}</h2>
            <p className="text-sm text-slate-500 mt-1" dir="ltr">{ticket.ticketId}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="tech-edit-form" onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>}

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.studentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>{label('studentName', true)}<input type="text" name="studentName" value={formData.studentName} onChange={handleChange} required className={inputCls} /></div>
                <div>{label('nationalId', true)}<input type="text" name="nationalId" value={formData.nationalId} onChange={handleChange} required dir="ltr" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  {label('branch', true)}
                  <select name="branch" value={formData.branch} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('department')}
                  <select name="department" value={formData.department} onChange={handleChange} className={selectCls}>
                    <option value="">{t('complaintForm.selectDepartment')}</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('stage', true)}
                  <select name="stage" value={formData.stage} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {label('grade', true)}
                  <select name="grade" value={formData.grade} onChange={handleChange} required disabled={!formData.stage} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                    <option value="">{t('techSupportForm.selectClass')}</option>
                    {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('complaintForm.parentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>{label('parentName', true)}<input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className={inputCls} /></div>
                <div>
                  {label('relation')}
                  <select name="relation" value={formData.relation} onChange={handleChange} className={selectCls}>
                    {relationOptions.map((r) => <option key={r} value={r}>{t(`techSupportForm.relations.${r}`, r)}</option>)}
                  </select>
                </div>
                <div>{label('parentPhone', true)}<input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className={inputCls} /></div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">{t('techSupportForm.problemDetailsSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  {label('problemType', true)}
                  <select name="problemType" value={formData.problemType} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('techSupportForm.selectProblemType')}</option>
                    {problemTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                  </select>
                </div>
                <div>
                  {label('platform', true)}
                  <select name="platform" value={formData.platform} onChange={handleChange} required className={selectCls}>
                    <option value="">{t('techSupportForm.selectPlatform')}</option>
                    {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              {(isParentRelated(formData.problemType, formData.platform, problemTypes, platforms) || formData.parentNationalId) && (
                <ParentNationalIdField value={formData.parentNationalId} onChange={handleChange} inputCls={inputCls} />
              )}
              <div>{label('platformLink')}<input type="text" name="platformLink" value={formData.platformLink} onChange={handleChange} dir="ltr" placeholder="https://..." className={inputCls} /></div>
              <div>{label('details')}<textarea name="details" value={formData.details} onChange={handleChange} rows={3} className={`${inputCls} py-3 resize-none`} /></div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="tech-edit-form" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('techSupportEdit.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
