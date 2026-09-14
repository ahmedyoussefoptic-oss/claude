import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2, CheckCircle2, ShieldCheck, MessageCircle } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useProblemTypes, usePlatforms } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { STAGES } from '../../config/complaintTypes';
import { RELATIONS, generateTicketId, classOptionsForStage } from '../../config/techSupport';
import { lookupStudentById, searchStudentsByName } from '../../utils/students';
import { waLink, buildTechSupportReceiptMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';

export default function TechSupportForm({ onClose }) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const branches = useBranches();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();
  const staff = useUsers();
  const templates = useMessageTemplates();

  const [formData, setFormData] = useState({
    studentName: '',
    nationalId: '',
    branch: '',
    stage: '',
    grade: '',
    parentName: '',
    relation: RELATIONS[0],
    parentPhone: '',
    problemType: '',
    platform: '',
    platformLink: '',
    details: '',
  });
  const [identityVerified, setIdentityVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedTicket, setSavedTicket] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'stage' ? { grade: '' } : {}),
    }));
  };

  const [studentSuggestions, setStudentSuggestions] = useState([]);
  const studentNameSearchTimer = useRef(null);

  const applyStudent = (student) => {
    setFormData((prev) => ({
      ...prev,
      studentName: student.name || prev.studentName,
      nationalId: student.nationalId || prev.nationalId,
      branch: student.branch || prev.branch,
      parentPhone: student.mobile || prev.parentPhone,
    }));
    setStudentSuggestions([]);
  };

  const handleNationalIdBlur = async () => {
    if (!formData.nationalId) return;
    const student = await lookupStudentById(formData.nationalId);
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

  const findItSpecialist = () => {
    const candidates = staff.filter(
      (u) => u.role === 'SPECIALIST' && u.department === 'IT' && u.active !== false &&
        (u.access === 'all' || u.branch === formData.branch)
    );
    // Prefer a branch-specific specialist over an all-branch one.
    candidates.sort((a, b) => (a.access === 'all' ? 1 : 0) - (b.access === 'all' ? 1 : 0));
    return candidates[0] || null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identityVerified) {
      setError(t('techSupportForm.identityRequiredAlert'));
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const ticketId = generateTicketId();
      const now = serverTimestamp();
      const assignee = findItSpecialist();

      const newTicket = {
        ...formData,
        ticketId,
        receiver: user.uid,
        identityVerified: true,
        identityVerifiedBy: user.uid,
        status: assignee ? 'ASSIGNED' : 'NEW',
        assignedTo: assignee?.id || null,
        assignedToName: assignee?.name || '',
        assignedAt: assignee ? now : null,
        isOverdue: false,
        reopenCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await addDoc(collection(db, 'techSupportTickets'), newTicket);

      await addDoc(collection(db, `techSupportTickets/${docRef.id}/activityLog`), {
        action: 'TICKET_CREATED',
        actorId: user.uid,
        createdAt: now,
      });
      await addDoc(collection(db, `techSupportTickets/${docRef.id}/activityLog`), {
        action: 'IDENTITY_VERIFIED',
        actorId: user.uid,
        metadata: { phone: formData.parentPhone },
        createdAt: now,
      });
      if (assignee) {
        await addDoc(collection(db, `techSupportTickets/${docRef.id}/activityLog`), {
          action: 'TICKET_ASSIGNED',
          actorId: user.uid,
          metadata: { toUserId: assignee.id, toUserName: assignee.name },
          createdAt: now,
        });
      }

      setSavedTicket({ id: docRef.id, ticketId, studentName: formData.studentName, parentName: formData.parentName, parentPhone: formData.parentPhone, assigneeName: assignee?.name });
    } catch (err) {
      console.error(err);
      setError(t('techSupportForm.saveError'));
    } finally {
      setLoading(false);
    }
  };

  if (savedTicket) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden p-6 text-center">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">{t('techSupportForm.successTitle')}</h2>
          <p className="text-sm text-slate-500 mb-1">{t('techSupportForm.ticketNumberLabel')} <span className="font-mono font-bold text-slate-900" dir="ltr">{savedTicket.ticketId}</span></p>
          <p className="text-sm text-slate-500 mb-6">
            {savedTicket.assigneeName ? t('techSupportForm.autoAssigned', { name: savedTicket.assigneeName }) : t('techSupportForm.noAutoAssign')}
          </p>
          {savedTicket.parentPhone && (
            <a
              href={waLink(savedTicket.parentPhone, buildTechSupportReceiptMessage(savedTicket, templates.techSupportReceipt))}
              target="_blank"
              rel="noreferrer"
              onClick={() => updateDoc(doc(db, 'techSupportTickets', savedTicket.id), { receiptMessageSentAt: serverTimestamp() })}
              className="w-full px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2 mb-3"
            >
              <MessageCircle className="w-4 h-4" />
              {t('common.sendReceiptWhatsApp')}
            </a>
          )}
          <button onClick={onClose} className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors">
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">

        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('techSupportForm.newTicketTitle')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('techSupportForm.newTicketSubtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="tech-support-form" onSubmit={handleSubmit} className="space-y-8">

            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">{error}</div>
            )}

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{t('complaintForm.studentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.studentNameFull')} <span className="text-red-500">*</span></label>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.nationalCivilIdLabel')} <span className="text-red-500">*</span></label>
                  <input type="text" name="nationalId" value={formData.nationalId} onChange={handleChange} onBlur={handleNationalIdBlur} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')} <span className="text-red-500">*</span></label>
                  <select name="branch" value={formData.branch} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.stageLabel')} <span className="text-red-500">*</span></label>
                  <select name="stage" value={formData.stage} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    <option value="">{t('complaintForm.selectStage')}</option>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.gradeLabel')} <span className="text-red-500">*</span></label>
                  <select name="grade" value={formData.grade} onChange={handleChange} required disabled={!formData.stage} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white disabled:text-slate-400 disabled:bg-slate-50">
                    <option value="">{t('techSupportForm.selectClass')}</option>
                    {classOptionsForStage(formData.stage).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{t('complaintForm.parentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.name')} <span className="text-red-500">*</span></label>
                  <input type="text" name="parentName" value={formData.parentName} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.relationLabel')}</label>
                  <select name="relation" value={formData.relation} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white">
                    {RELATIONS.map((r) => <option key={r} value={r}>{t(`techSupportForm.relations.${r}`, r)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.phoneRegisteredLabel')} <span className="text-red-500">*</span></label>
                  <input type="tel" name="parentPhone" value={formData.parentPhone} onChange={handleChange} required dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
                </div>
              </div>
              <label className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3 cursor-pointer">
                <input type="checkbox" checked={identityVerified} onChange={(e) => setIdentityVerified(e.target.checked)} className="mt-0.5" required />
                <span className="text-sm text-amber-900 flex items-start gap-1.5">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  {t('techSupportForm.identityNotice')}
                </span>
              </label>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mt-6">{t('techSupportForm.problemDetailsSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.problemTypeLabel')} <span className="text-red-500">*</span></label>
                  <select name="problemType" value={formData.problemType} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    <option value="">{t('techSupportForm.selectProblemType')}</option>
                    {problemTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.platformLabel')} <span className="text-red-500">*</span></label>
                  <select name="platform" value={formData.platform} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm">
                    <option value="">{t('techSupportForm.selectPlatform')}</option>
                    {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.platformLinkLabel')}</label>
                <input type="text" name="platformLink" value={formData.platformLink} onChange={handleChange} dir="ltr" placeholder="https://..." className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('techSupportForm.additionalNotesLabel')}</label>
                <textarea
                  name="details"
                  value={formData.details}
                  onChange={handleChange}
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm resize-none"
                  placeholder={t('techSupportForm.additionalNotesPlaceholder')}
                />
              </div>
              <p className="text-xs text-slate-500">{t('techSupportForm.sourceReceiverNote')}</p>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="tech-support-form" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loading ? t('techSupportForm.saving') : t('techSupportForm.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
