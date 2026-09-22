import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Clock, CheckCircle2, User, Phone, MapPin, Loader2, Trash2, UserPlus, MessageCircle, ShieldCheck, Link2, AlertTriangle, Share2 } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useUsers } from '../../hooks/useUsers';
import { useBranches, useProblemTypes, usePlatforms } from '../../hooks/useOrgData';
import { ROLES } from '../../config/roles';
import { userBranches } from '../../utils/scope';
import { TICKET_STATUS_BADGE } from '../../config/techSupport';
import { waLink, shareLink, buildCredentialMessage, buildTechSupportReceiptMessage, buildTechSupportResolutionMessage, buildTechSupportShareMessage, toWhatsAppNumber } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import AssigneeMultiSelect, { eligibleAssignees } from '../common/AssigneeMultiSelect';
import ErrorBoundary from '../common/ErrorBoundary';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

export default function TechSupportDetails({ ticket, onClose }) {
  return (
    <ErrorBoundary key={ticket.id} onClose={onClose}>
      <TechSupportDetailsInner ticket={ticket} onClose={onClose} />
    </ErrorBoundary>
  );
}

function TechSupportDetailsInner({ ticket, onClose }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const getActionName = (action) => t(`actions.techSupport.${action}`, action);
  const { user, userData } = useAuthStore();
  const users = useUsers();
  const branches = useBranches();
  const problemTypes = useProblemTypes();
  const platforms = usePlatforms();
  const templates = useMessageTemplates();
  const [logs, setLogs] = useState([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState(ticket.assignedTo || []);
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [username, setUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => {
    setSelectedAssignees(ticket.assignedTo || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  const isAdmin = userData?.role === ROLES.ADMIN;
  // Mirrors firestore.rules' canEditRecord/canDeleteRecord: a branch-scoped
  // holder of the edit/delete permission only gets it for their own branch.
  const inScope = isAdmin || userData?.access === 'all' || userBranches(userData).includes(ticket.branch);
  const canEdit = isAdmin || (inScope && userData?.perms?.edit === true);
  const canDelete = isAdmin || (inScope && userData?.perms?.delete === true);

  useEffect(() => {
    const q = query(collection(db, `techSupportTickets/${ticket.id}/activityLog`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [ticket.id]);

  const addLog = async (action, metadata = {}, updates = null) => {
    const now = serverTimestamp();
    await addDoc(collection(db, `techSupportTickets/${ticket.id}/activityLog`), {
      action,
      actorId: user.uid,
      actorName: userData?.name || t('common.user'),
      metadata,
      createdAt: now,
    });
    if (updates) {
      await updateDoc(doc(db, 'techSupportTickets', ticket.id), { ...updates, updatedAt: now });
    }
  };

  const handleAssign = async () => {
    const before = ticket.assignedTo || [];
    const addedIds = selectedAssignees.filter((id) => !before.includes(id));
    const removedIds = before.filter((id) => !selectedAssignees.includes(id));
    if (addedIds.length === 0 && removedIds.length === 0) {
      alert(t('assigneeSelect.noChangeAlert'));
      return;
    }
    const selectedUsers = selectedAssignees.map((id) => users.find((u) => u.id === id)).filter(Boolean);
    const addedNames = addedIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
    const removedNames = removedIds.map((id) => ticket.assignedToNames?.[before.indexOf(id)] || users.find((u) => u.id === id)?.name).filter(Boolean);
    setLoading(true);
    try {
      await addLog(
        before.length === 0 ? 'TICKET_ASSIGNED' : 'TICKET_TRANSFERRED',
        { toUserNames: selectedUsers.map((u) => u.name), addedNames, removedNames },
        { assignedTo: selectedAssignees, assignedToNames: selectedUsers.map((u) => u.name), assignedAt: serverTimestamp(), status: ticket.status === 'NEW' ? 'ASSIGNED' : ticket.status }
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyIdentity = async () => {
    setLoading(true);
    try {
      await addLog('IDENTITY_VERIFIED', { phone: ticket.parentPhone, verifiedManually: true }, { identityVerified: true, identityVerifiedBy: user.uid });
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      await addLog('PROCESSING_STARTED', {}, { status: 'IN_PROGRESS' });
    } finally {
      setLoading(false);
    }
  };

  // Not every ticket needs an account credential reset — IT can save just a
  // resolutionNote, just credentials, or both. Kept on the ticket (not
  // cleared after sending) since the same credentials are often needed
  // again later (parent didn't receive the message, lost it, etc.).
  const hasPartialCredentials = Boolean(username.trim()) !== Boolean(tempPassword.trim());
  const hasFullCredentials = Boolean(username.trim() && tempPassword.trim());
  const canSaveResolution = !hasPartialCredentials && (hasFullCredentials || Boolean(resolutionNote.trim()));

  const openResolutionForm = () => {
    setUsername(ticket.credentials?.username || '');
    setTempPassword(ticket.credentials?.tempPassword || '');
    setResolutionNote(ticket.resolutionNote || '');
    setShowCredsForm(true);
  };

  const handleSaveResolution = async () => {
    if (!canSaveResolution) return;
    const trimmedUsername = username.trim();
    const trimmedPassword = tempPassword.trim();
    const trimmedNote = resolutionNote.trim();
    setLoading(true);
    try {
      const updates = {
        credentials: trimmedUsername && trimmedPassword ? { username: trimmedUsername, tempPassword: trimmedPassword } : deleteField(),
        resolutionNote: trimmedNote || deleteField(),
      };
      // Writing a resolution means the ticket is solved, not still "in
      // progress" — unless it's already past that point (sent and awaiting
      // the parent's confirmation), in which case an edit shouldn't undo
      // that progress.
      if (!['WAITING_CONFIRMATION', 'CLOSED'].includes(ticket.status)) {
        updates.status = 'SOLVED';
      }
      await addLog('CREDENTIALS_PREPARED', {}, updates);
      setShowCredsForm(false);
    } finally {
      setLoading(false);
    }
  };

  // Fires on the WhatsApp link's click — not awaited, same as the
  // equivalent complaints resolution-send link, so it never blocks the
  // browser from opening wa.me. credentials/resolutionNote are deliberately
  // left in place afterward so the same message can be resent later.
  const handleResolutionSent = () => {
    const hasCredentials = ticket.credentials?.username && ticket.credentials?.tempPassword;
    if (!hasCredentials && !ticket.resolutionNote) return;
    addLog('CREDENTIALS_SENT', {
      sentToPhone: ticket.parentPhone,
      ...(hasCredentials ? { usernameSent: ticket.credentials.username } : {}),
    }, {
      status: 'WAITING_CONFIRMATION',
      resolutionMessageSentAt: serverTimestamp(),
    });
  };

  const handleConfirmClose = async () => {
    setLoading(true);
    try {
      await addLog('CONFIRMED_CLOSED', {}, { status: 'CLOSED', closedAt: serverTimestamp() });
    } finally {
      setLoading(false);
    }
  };

  const handleReopen = async () => {
    const reason = prompt(t('techSupportDetails.reopenPrompt'));
    if (!reason) return;
    setLoading(true);
    try {
      await addLog('TICKET_REOPENED', { reason }, { status: 'REOPENED', reopenCount: (ticket.reopenCount || 0) + 1 });
    } finally {
      setLoading(false);
    }
  };

  const handleEscalate = async () => {
    setLoading(true);
    try {
      // Bumping `escalation` (rather than just logging) is what triggers the
      // manager/executive notification server-side in handleItTicketAssignment.
      await addLog('TICKET_ESCALATED', { manual: true }, { escalation: (ticket.escalation || 0) + 1 });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const reason = prompt(t('techSupportDetails.deletePrompt'));
    if (!reason) return;
    setLoading(true);
    try {
      // Archived before the real delete — the ticket's own activityLog
      // subcollection would otherwise become orphaned and unreachable the
      // moment its parent doc is gone (same reasoning as complaints' delete).
      await addDoc(collection(db, 'deletedTechSupportTickets'), {
        ticket,
        activityLog: [
          ...logs,
          { action: 'TICKET_DELETED', actorId: user.uid, actorName: userData?.name || t('common.user'), metadata: { reason }, createdAt: new Date() },
        ],
        reason,
        deletedBy: user.uid,
        deletedByName: userData?.name || t('common.user'),
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'techSupportTickets', ticket.id));
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleNote = async () => {
    if (!note.trim()) return;
    setLoading(true);
    try {
      await addLog('NOTE_ADDED', { note });
      setNote('');
    } finally {
      setLoading(false);
    }
  };

  const problemTypeName = problemTypes.find((pt) => pt.id === ticket.problemType)?.name || ticket.problemType;
  const platformName = platforms.find((p) => p.id === ticket.platform)?.name || ticket.platform;
  const branchName = branches.find((b) => b.id === ticket.branch)?.name || ticket.branch;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">

        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{ticket.ticketId}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${TICKET_STATUS_BADGE[ticket.status]}`}>
                {t(`statuses.techSupport.${ticket.status}`, ticket.status)}
              </span>
              {ticket.source === 'PARENT_PORTAL' && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {t('techSupportDetails.viaPublicLink')}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {ticket.createdAt ? format(ticket.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {!canEdit && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
              {t('techSupportDetails.readOnlyNotice')}
            </div>
          )}

          {!ticket.identityVerified && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{t('techSupportDetails.identityNotVerifiedNotice')}</p>
                {canEdit && (
                  <button disabled={loading} onClick={handleVerifyIdentity} className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors">
                    {t('techSupportDetails.confirmIdentityBtn')}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              href={shareLink(buildTechSupportShareMessage(ticket, branchName, templates.techSupportShare))}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              {t('common.shareWithStaff')}
            </a>
            {!ticket.receiptMessageSentAt && ticket.parentPhone && (
              <a
                href={waLink(ticket.parentPhone, buildTechSupportReceiptMessage(ticket, templates.techSupportReceipt))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'techSupportTickets', ticket.id), { receiptMessageSentAt: serverTimestamp() })}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('techSupportDetails.sendReceiptWhatsApp')}
              </a>
            )}
            {canEdit && ticket.status === 'ASSIGNED' && (
              <button disabled={loading} onClick={handleStart} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                {t('techSupportDetails.startProcessing')}
              </button>
            )}
            {canEdit && ticket.identityVerified && ticket.status !== 'CLOSED' && (
              <button disabled={loading} onClick={openResolutionForm} className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                {(ticket.credentials || ticket.resolutionNote) ? t('techSupportDetails.editResolutionBtn') : t('techSupportDetails.prepareCredentialsBtn')}
              </button>
            )}
            {(ticket.credentials || ticket.resolutionNote) && ticket.parentPhone && ticket.status !== 'CLOSED' && (
              <a
                href={waLink(ticket.parentPhone, ticket.credentials?.username && ticket.credentials?.tempPassword
                  ? buildCredentialMessage({
                    ticketId: ticket.ticketId,
                    studentName: ticket.studentName,
                    platformName: platforms.find((p) => p.id === ticket.platform)?.name,
                    platformLink: ticket.platformLink,
                    username: ticket.credentials.username,
                    tempPassword: ticket.credentials.tempPassword,
                  }, templates.credential)
                  : buildTechSupportResolutionMessage(ticket, ticket.resolutionNote, templates.techSupportResolution)
                )}
                target="_blank"
                rel="noreferrer"
                onClick={handleResolutionSent}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('techSupportDetails.sendCredentialsWhatsApp')}
              </a>
            )}
            {canEdit && ticket.status === 'WAITING_CONFIRMATION' && (
              <button disabled={loading} onClick={handleConfirmClose} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                {t('techSupportDetails.confirmCloseBtn')}
              </button>
            )}
            {canEdit && ['CLOSED', 'WAITING_CONFIRMATION'].includes(ticket.status) && (
              <button disabled={loading} onClick={handleReopen} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors">
                {t('techSupportDetails.reopenBtn')}
              </button>
            )}
            {canEdit && !['CLOSED'].includes(ticket.status) && (
              <button disabled={loading} onClick={handleEscalate} className="px-4 py-2 bg-white border border-orange-300 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-50 transition-colors">
                {t('techSupportDetails.escalateBtn')}
              </button>
            )}
            {canDelete && (
              <button disabled={loading} onClick={handleDelete} className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2 mr-auto">
                <Trash2 className="w-4 h-4" />
                {t('techSupportDetails.deleteBtn')}
              </button>
            )}
          </div>

          {showCredsForm && (
            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                {t('techSupportDetails.credsFormTitle')}
              </h3>
              <textarea
                value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                placeholder={t('techSupportDetails.resolutionNotePlaceholder')} rows={3}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
              />
              <p className="text-xs text-slate-400">{t('techSupportDetails.credentialsOptionalHint')}</p>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder={t('techSupportDetails.usernamePlaceholder')} dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <input
                type="text" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)}
                placeholder={t('techSupportDetails.tempPasswordPlaceholder')} dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-slate-500">{t('techSupportDetails.willSendToRegistered')} <span dir="ltr" className="font-mono">{toWhatsAppNumber(ticket.parentPhone)}</span></p>
              <div className="flex gap-2">
                <button disabled={loading || !canSaveResolution} onClick={handleSaveResolution} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {t('techSupportDetails.saveCredentialsBtn')}
                </button>
                <button onClick={() => setShowCredsForm(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">{t('techSupportDetails.cancel')}</button>
              </div>
            </div>
          )}

          {canEdit && ticket.status !== 'CLOSED' && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-slate-400" />
                {(ticket.assignedTo?.length ?? 0) > 0 ? t('assigneeSelect.editAssignmentTitle') : t('assigneeSelect.newAssignmentTitle')}
              </h3>
              {ticket.assignedToNames?.length > 0 && (
                <p className="text-sm text-slate-500 mb-3">{t('assigneeSelect.currentAssigneesLabel')} <span className="font-medium text-slate-800">{ticket.assignedToNames.join(listSep)}</span></p>
              )}
              <div className="space-y-3">
                <AssigneeMultiSelect
                  options={eligibleAssignees(users, { branch: ticket.branch, complaintType: 'IT' })}
                  selected={selectedAssignees}
                  onChange={setSelectedAssignees}
                  placeholder={t('assigneeSelect.selectStaffPlaceholder')}
                />
                <button
                  disabled={loading || (selectedAssignees.length === (ticket.assignedTo || []).length && selectedAssignees.every((id) => (ticket.assignedTo || []).includes(id)))}
                  onClick={handleAssign}
                  className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
                >
                  {t('assigneeSelect.saveAssignmentBtn')}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('techSupportDetails.parentGuardian')} ({t(`techSupportForm.relations.${ticket.relation}`, ticket.relation)})</p>
                <p className="font-medium text-slate-900">{ticket.parentName}</p>
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1" dir="ltr">
                  <Phone className="w-3.5 h-3.5" /> {ticket.parentPhone}
                </p>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('techSupportDetails.student')}</p>
                <p className="font-medium text-slate-900">{ticket.studentName}</p>
                <p className="text-sm text-slate-500 mt-1">{branchName} - {ticket.stage} {ticket.grade}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="font-bold text-slate-900 text-lg">{problemTypeName}</h3>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded whitespace-nowrap">{platformName}</span>
            </div>
            {ticket.details && <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{ticket.details}</p>}
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              <p>{t('techSupportDetails.nationalIdLabel')} <span dir="ltr">{ticket.nationalId}</span> {ticket.academicId && <>· {t('techSupportDetails.academicIdLabel')} <span dir="ltr">{ticket.academicId}</span></>}</p>
              {ticket.platformLink && <p dir="ltr">{ticket.platformLink}</p>}
            </div>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-lg mb-4">{t('techSupportDetails.activityLogTitle')}</h3>
            <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
              {logs.map((log) => (
                <div key={log.id} className="relative flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-slate-50">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                    <div className="flex justify-between mb-2">
                      <p className="font-medium text-slate-900">{getActionName(log.action)}</p>
                      <p className="text-xs text-slate-400" dir="ltr">{log.createdAt ? format(log.createdAt.toDate(), 'p', { locale: dateLocale }) : ''}</p>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">{t('complaintDetails.by')} {log.actorName || t('complaintDetails.system')}</p>
                    {log.metadata?.sentToPhone && (
                      <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                        {log.metadata.usernameSent
                          ? t('techSupportDetails.credentialsSentDetail', { phone: log.metadata.sentToPhone, username: log.metadata.usernameSent })
                          : t('techSupportDetails.resolutionSentDetail', { phone: log.metadata.sentToPhone })}
                      </div>
                    )}
                    {log.metadata?.reason && (
                      <div className="mt-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100"><strong>{t('techSupportDetails.reasonLabel')}</strong> {log.metadata.reason}</div>
                    )}
                    {log.metadata?.toUserNames?.length > 0 && (
                      <div className="mt-2 p-3 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200 space-y-1">
                        <p>{t('assigneeSelect.assignedToLogLabel')} <strong>{log.metadata.toUserNames.join(listSep)}</strong></p>
                        {log.metadata.addedNames?.length > 0 && <p className="text-emerald-700">{t('assigneeSelect.addedLogLabel')} {log.metadata.addedNames.join(listSep)}</p>}
                        {log.metadata.removedNames?.length > 0 && <p className="text-red-700">{t('assigneeSelect.removedLogLabel')} {log.metadata.removedNames.join(listSep)}</p>}
                      </div>
                    )}
                    {!log.metadata?.toUserNames && log.metadata?.toUserName && (
                      <div className="mt-2 p-3 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200">{t('techSupportDetails.toLabel')} <strong>{log.metadata.toUserName}</strong></div>
                    )}
                    {log.metadata?.note && <p className="text-sm text-slate-600 mt-1">{log.metadata.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border-t border-slate-200 p-4">
          <div className="flex items-end gap-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('techSupportDetails.addNotePlaceholder')}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
              rows={1}
            />
            <button disabled={loading} onClick={handleNote} className="px-6 h-[52px] bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-medium transition-colors shadow-sm flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('techSupportDetails.addBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
