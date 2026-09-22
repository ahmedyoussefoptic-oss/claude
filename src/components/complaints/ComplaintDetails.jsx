import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Send, Paperclip, Clock, CheckCircle2, Circle, User, Phone, MapPin, Loader2, AlertCircle, Printer, UserPlus, MessageCircle, Trash2, Star, Link2, Mic, Square, Share2 } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useUsers } from '../../hooks/useUsers';
import { useBranches } from '../../hooks/useOrgData';
import { waLink, shareLink, buildReceiptMessage, buildResolutionMessage, buildComplaintShareMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { ROLES } from '../../config/roles';
import { userBranches } from '../../utils/scope';
import AssigneeMultiSelect, { eligibleAssignees } from '../common/AssigneeMultiSelect';
import ErrorBoundary from '../common/ErrorBoundary';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const FLOW_STEP_KEYS = [
  { key: 'RECEIVED', match: () => true },
  { key: 'ASSIGNED', match: (l) => ['COMPLAINT_ASSIGNED', 'COMPLAINT_TRANSFERRED'].includes(l.action) },
  { key: 'IN_PROGRESS', match: (l) => l.action === 'COMPLAINT_ACKNOWLEDGED' },
  { key: 'SOLVED', match: (l) => l.action === 'SOLUTION_ADDED' },
  { key: 'CLOSED', match: (l) => l.action === 'SURVEY_SUBMITTED' || l.action === 'COMPLAINT_CLOSED' },
];

const getStatusBadge = (status) => {
  switch (status) {
    case 'RECEIVED': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'IN_PROGRESS': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'WAITING_PARENT_RESPONSE': return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'SOLVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'CLOSED': return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
    case 'ESCALATED': return 'bg-orange-100 text-orange-800 border-orange-200';
    default: return 'bg-slate-100 text-slate-800 border-slate-200';
  }
};

export default function ComplaintDetails({ complaint, onClose }) {
  return (
    <ErrorBoundary key={complaint.id} onClose={onClose}>
      <ComplaintDetailsInner complaint={complaint} onClose={onClose} />
    </ErrorBoundary>
  );
}

function ComplaintDetailsInner({ complaint, onClose }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const getStatusName = (status) => t(`statuses.complaint.${status}`, status);
  const getActionName = (action) => t(`actions.complaint.${action}`, action);
  const RATING_LABELS = { resolutionSpeed: t('ratings.resolutionSpeed'), solutionQuality: t('ratings.solutionQuality'), staffProfessionalism: t('ratings.staffProfessionalism') };
  const FLOW_STEPS = FLOW_STEP_KEYS.map((s) => ({ ...s, label: t(`complaintDetails.flowSteps.${s.key}`) }));
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const { user, userData } = useAuthStore();
  const users = useUsers();
  const branches = useBranches();
  const branchName = branches.find((b) => b.id === complaint.branch)?.name || complaint.branch;
  const templates = useMessageTemplates();
  const [logs, setLogs] = useState([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'internal'
  // Defensive: a handful of very old complaints still hold assignedTo as a
  // pre-migration scalar uid instead of an array — callers (ComplaintsList,
  // Reports, Search) normalize this on fetch, but re-normalize here too so
  // this component can never crash on `.every`/`.includes` even if some
  // future caller forgets to.
  const normalizedAssignedTo = Array.isArray(complaint.assignedTo) ? complaint.assignedTo : (complaint.assignedTo ? [complaint.assignedTo] : []);
  const normalizedAssignedToNames = Array.isArray(complaint.assignedToNames) ? complaint.assignedToNames : (complaint.assignedToNames ? [complaint.assignedToNames] : []);
  const [selectedAssignees, setSelectedAssignees] = useState(normalizedAssignedTo);

  // Voice solving: a short voice note can be attached to the solution (same
  // record-then-upload pattern as ComplaintForm.jsx's attachment recorder),
  // and/or the solution text itself can be dictated via the Web Speech API
  // instead of typed.
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const [pendingRecording, setPendingRecording] = useState(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const [dictating, setDictating] = useState(false);
  const [dictationError, setDictationError] = useState(null);
  const recognitionRef = useRef(null);
  const dictationBaseRef = useRef('');
  const dictationFinalRef = useRef('');
  const dictationSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Stop any in-progress mic stream / speech recognition if the modal is
  // closed mid-recording, so the browser's mic indicator doesn't stay lit.
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleRecording = async () => {
    setRecordingError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `${t('complaintDetails.solutionRecordingPrefix')}${Date.now()}.webm`, { type: 'audio/webm' });
        setPendingRecording(file);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setRecordingError(t('complaintDetails.micError'));
    }
  };

  const toggleDictation = () => {
    setDictationError(null);
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setDictationError(t('complaintDetails.dictationUnsupported'));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = i18n.language === 'ar' ? 'ar-SA' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    dictationBaseRef.current = reply ? `${reply} ` : '';
    dictationFinalRef.current = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          dictationFinalRef.current += `${transcript} `;
        } else {
          interim += transcript;
        }
      }
      setReply(dictationBaseRef.current + dictationFinalRef.current + interim);
    };
    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setDictationError(t('complaintDetails.dictationError'));
      }
    };
    recognition.onend = () => setDictating(false);
    recognitionRef.current = recognition;
    recognition.start();
    setDictating(true);
  };

  // Resync when the user switches to a different complaint (not on every
  // realtime update of the same one, so an in-progress edit isn't stomped).
  useEffect(() => {
    setSelectedAssignees(normalizedAssignedTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaint.id]);

  const isAdmin = userData?.role === ROLES.ADMIN;
  // Mirrors firestore.rules' canEditRecord/canDeleteRecord: a branch-scoped
  // holder of the edit/delete permission only gets it for their own branch
  // — otherwise the buttons render but every write is rejected server-side.
  const inScope = isAdmin || userData?.access === 'all' || userBranches(userData).includes(complaint.branch);
  const canEdit = isAdmin || (inScope && userData?.perms?.edit === true);
  const canDelete = isAdmin || (inScope && userData?.perms?.delete === true);

  useEffect(() => {
    const q = query(
      collection(db, `complaints/${complaint.id}/activityLog`),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [complaint.id]);

  const addLog = async (action, metadata = {}, updates = null) => {
    const now = serverTimestamp();
    await addDoc(collection(db, `complaints/${complaint.id}/activityLog`), {
      action,
      actorId: user.uid,
      actorName: userData?.name || t('common.user'),
      metadata,
      createdAt: now
    });

    if (updates) {
      const changes = typeof updates === 'string' ? { status: updates } : updates;
      await updateDoc(doc(db, 'complaints', complaint.id), {
        ...changes,
        updatedAt: now
      });
    }
  };

  const handleAction = async (actionType) => {
    setLoading(true);
    try {
      if (actionType === 'ACKNOWLEDGE') {
        await addLog('COMPLAINT_ACKNOWLEDGED', {}, 'IN_PROGRESS');
      } else if (actionType === 'ESCALATE') {
        await addLog('COMPLAINT_ESCALATED', {}, 'ESCALATED');
      } else if (actionType === 'SOLVE') {
        if (!reply.trim()) {
          alert(t('complaintDetails.solutionRequiredAlert'));
          return;
        }
        const updates = { status: 'SOLVED', solutionDetails: reply, solvedAt: serverTimestamp() };
        // A failed recording upload (e.g. a Storage rule rejecting the
        // file) must not block marking the complaint solved — the solution
        // text is what matters most; the recording is best-effort.
        if (pendingRecording) {
          try {
            const fileRef = ref(storage, `complaints/${complaint.complaintId}/${pendingRecording.name}`);
            await uploadBytes(fileRef, pendingRecording);
            const url = await getDownloadURL(fileRef);
            updates.attachments = [
              ...(complaint.attachments || []),
              {
                fileName: pendingRecording.name,
                fileUrl: url,
                mimeType: pendingRecording.type,
                size: pendingRecording.size,
                uploadedBy: user.uid,
                createdAt: new Date().toISOString(),
              },
            ];
          } catch (uploadErr) {
            console.error('Solution recording upload failed:', uploadErr);
            alert(t('complaintDetails.recordingUploadFailedAlert', { message: uploadErr.message }));
          }
        }
        await addLog('SOLUTION_ADDED', { solutionDetails: reply }, updates);
        setReply('');
        setPendingRecording(null);
      } else if (actionType === 'COMMENT') {
        if (!reply.trim()) return;
        await addLog('INTERNAL_COMMENT_ADDED', { comment: reply });
        setReply('');
      } else if (actionType === 'WAIT_PARENT') {
        await addLog('COMPLAINT_STATUS_CHANGED', { to: 'WAITING_PARENT_RESPONSE' }, 'WAITING_PARENT_RESPONSE');
      } else if (actionType === 'ASSIGN') {
        const before = normalizedAssignedTo;
        const addedIds = selectedAssignees.filter((id) => !before.includes(id));
        const removedIds = before.filter((id) => !selectedAssignees.includes(id));
        if (addedIds.length === 0 && removedIds.length === 0) {
          alert(t('complaintDetails.noAssignmentChangeAlert'));
          return;
        }
        const selectedUsers = selectedAssignees.map((id) => users.find((u) => u.id === id)).filter(Boolean);
        const addedNames = addedIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
        const removedNames = removedIds.map((id) => normalizedAssignedToNames[before.indexOf(id)] || users.find((u) => u.id === id)?.name).filter(Boolean);
        await addLog(
          before.length === 0 ? 'COMPLAINT_ASSIGNED' : 'COMPLAINT_TRANSFERRED',
          { toUserNames: selectedUsers.map((u) => u.name), addedNames, removedNames },
          { assignedTo: selectedAssignees, assignedToNames: selectedUsers.map((u) => u.name), assignedAt: serverTimestamp() }
        );
      } else if (actionType === 'REJECT') {
        if (!reply.trim()) {
          alert(t('complaintDetails.rejectReasonRequiredAlert'));
          return;
        }
        await addLog('COMPLAINT_REJECTED', { reason: reply }, 'REJECTED');
        setReply('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const reason = prompt(t('complaintDetails.deleteReasonPrompt'));
    if (!reason) return;
    setLoading(true);
    try {
      // A full snapshot (complaint fields + its activity log, including this
      // deletion itself) is archived before the real delete — the complaint's
      // own activityLog subcollection would otherwise become orphaned and
      // unreachable the moment its parent doc is gone. Kept out of
      // firestore.rules' admin-only-read boundary until archived; see
      // deletedComplaints there for who may read/write it.
      await addDoc(collection(db, 'deletedComplaints'), {
        complaint,
        activityLog: [
          ...logs,
          { action: 'COMPLAINT_DELETED', actorId: user.uid, actorName: userData?.name || t('common.user'), metadata: { reason }, createdAt: new Date() },
        ],
        reason,
        deletedBy: user.uid,
        deletedByName: userData?.name || t('common.user'),
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'complaints', complaint.id));
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Filter logs for general timeline vs internal
  const timelineLogs = logs.filter(l => l.action !== 'INTERNAL_COMMENT_ADDED');
  const internalLogs = logs.filter(l => l.action === 'INTERNAL_COMMENT_ADDED');

  // Derive the complaint's flow-map progress from its activity log, most
  // recent first, so we can render a done/current stepper.
  const stepStates = FLOW_STEPS.map((step) => {
    const match = [...logs].reverse().find((l) => step.match(l));
    return { ...step, done: !!match, at: match?.createdAt };
  });
  const firstPendingIndex = stepStates.findIndex((s) => !s.done);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{t('complaintDetails.titlePrefix')} #{complaint.complaintId}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadge(complaint.status)}`}>
                {getStatusName(complaint.status)}
              </span>
              {complaint.source === 'PARENT_PORTAL' && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {t('complaintDetails.viaPublicLink')}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {complaint.createdAt ? format(complaint.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => window.print()}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              title={t('common.print')}
            >
              <Printer className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Action Buttons for Staff */}
          {!canEdit && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 print:hidden">
              {t('complaintDetails.readOnlyNotice')}
            </div>
          )}
          <div className="flex flex-wrap gap-2 print:hidden">
            <a
              href={shareLink(buildComplaintShareMessage(complaint, branchName, templates.complaintShare))}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              {t('common.shareWithStaff')}
            </a>
            {canEdit && complaint.status === 'RECEIVED' && (
              <button disabled={loading} onClick={() => handleAction('ACKNOWLEDGE')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                {t('complaintDetails.acknowledge')}
              </button>
            )}
            {canEdit && (complaint.status === 'IN_PROGRESS' || complaint.status === 'RECEIVED') && (
              <>
                <button disabled={loading} onClick={() => handleAction('WAIT_PARENT')} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
                  {t('complaintDetails.waitParent')}
                </button>
                <button disabled={loading} onClick={() => handleAction('SOLVE')} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                  {t('complaintDetails.solve')}
                </button>
              </>
            )}
            {canEdit && complaint.status !== 'SOLVED' && complaint.status !== 'CLOSED' && (
              <button disabled={loading} onClick={() => handleAction('ESCALATE')} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors">
                {t('complaintDetails.escalate')}
              </button>
            )}
            {canEdit && complaint.status === 'RECEIVED' && (
              <button disabled={loading} onClick={() => handleAction('REJECT')} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                {t('complaintDetails.reject')}
              </button>
            )}
            {!complaint.receiptMessageSentAt && complaint.parentPhone && (
              <a
                href={waLink(complaint.parentPhone, buildReceiptMessage(complaint, templates.receipt))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'complaints', complaint.id), { receiptMessageSentAt: serverTimestamp() })}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('common.sendReceiptWhatsApp')}
              </a>
            )}
            {['SOLVED', 'CLOSED'].includes(complaint.status) && complaint.solutionDetails && complaint.parentPhone && (
              <a
                href={waLink(complaint.parentPhone, buildResolutionMessage(complaint, complaint.solutionDetails, templates.resolution))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'complaints', complaint.id), { resolutionMessageSentAt: serverTimestamp() })}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('common.sendResolutionWhatsApp')}
              </a>
            )}
            {canDelete && (
              <button disabled={loading} onClick={handleDelete} className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2 mr-auto">
                <Trash2 className="w-4 h-4" />
                {t('complaintDetails.deleteFinal')}
              </button>
            )}
          </div>

          {/* Flow map — where this complaint currently stands */}
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm print:hidden">
            <h3 className="font-bold text-slate-900 text-sm mb-4">{t('complaintDetails.flowMapTitle')}</h3>
            <div className="flex items-start">
              {stepStates.map((s, i) => {
                const isCurrent = !s.done && i === firstPendingIndex;
                return (
                  <div key={s.key} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center text-center gap-1 min-w-[84px]">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        s.done ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {s.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      </div>
                      <p className={`text-[11px] leading-tight ${s.done || isCurrent ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{s.label}</p>
                      {s.at && <p className="text-[10px] text-slate-400" dir="ltr">{format(s.at.toDate(), 'P', { locale: dateLocale })}</p>}
                    </div>
                    {i < stepStates.length - 1 && (
                      <div className={`h-0.5 flex-1 mx-1 ${stepStates[i + 1].done || s.done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Parent satisfaction survey — shows what the parent reported for
              THIS student/complaint; visible as soon as satisfactionRate or
              a reopen reason has been recorded via the public tracking portal. */}
          {(typeof complaint.satisfactionRate === 'number' || complaint.parentFeedback) && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm print:hidden">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                {t('complaintDetails.surveyTitle')}
              </h3>
              {typeof complaint.satisfactionRate === 'number' ? (
                <>
                  <div className="flex items-center gap-1.5 mb-4">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={`w-5 h-5 ${n <= Math.round(complaint.satisfactionRate) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
                    ))}
                    <span className="text-sm font-bold text-slate-700 mr-1">{complaint.satisfactionRate.toFixed(1)} / 5</span>
                  </div>
                  {complaint.satisfactionDetails && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                      {Object.entries(RATING_LABELS).map(([key, label]) => (
                        <div key={key} className="bg-slate-50 rounded-lg p-2.5 text-center">
                          <p className="text-xs text-slate-500 mb-1">{label}</p>
                          <p className="text-sm font-bold text-slate-800">{complaint.satisfactionDetails[key] ?? '—'} / 5</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                  {t('complaintDetails.reopenedNoRating')}
                </p>
              )}
              {complaint.parentFeedback && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100">"{complaint.parentFeedback}"</p>
              )}
            </div>
          )}

          {/* Assignment / Transfer */}
          {canEdit && complaint.status !== 'CLOSED' && complaint.status !== 'REJECTED' && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm print:hidden">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-slate-400" />
                {normalizedAssignedTo.length > 0 ? t('complaintDetails.editAssignment') : t('complaintDetails.newAssignment')}
              </h3>
              {normalizedAssignedToNames.length > 0 && (
                <p className="text-sm text-slate-500 mb-3">{t('complaintDetails.currentAssignees')} <span className="font-medium text-slate-800">{normalizedAssignedToNames.join(listSep)}</span></p>
              )}
              <div className="space-y-3">
                <AssigneeMultiSelect
                  options={eligibleAssignees(users, { branch: complaint.branch, complaintType: complaint.complaintType })}
                  selected={selectedAssignees}
                  onChange={setSelectedAssignees}
                  placeholder={t('complaintDetails.selectStaffPlaceholder')}
                />
                <button
                  disabled={loading || (selectedAssignees.length === normalizedAssignedTo.length && selectedAssignees.every((id) => normalizedAssignedTo.includes(id)))}
                  onClick={() => handleAction('ASSIGN')}
                  className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
                >
                  {t('complaintDetails.saveAssignment')}
                </button>
              </div>
            </div>
          )}

          {/* Info Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('common.parent')}</p>
                <p className="font-medium text-slate-900">{complaint.parentName}</p>
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1" dir="ltr">
                  <Phone className="w-3.5 h-3.5" /> {complaint.parentPhone}
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('complaintDetails.branchAndStudent')}</p>
                <p className="font-medium text-slate-900">{complaint.studentName}</p>
                <p className="text-sm text-slate-500 mt-1">{branchName} - {complaint.grade}</p>
              </div>
            </div>
          </div>

          {/* Complaint Text */}
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="font-bold text-slate-900 text-lg">{complaint.subject || t('complaintDetails.basicDetails')}</h3>
              <div className="flex gap-1.5 shrink-0">
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded whitespace-nowrap">{complaint.complaintType}</span>
                {complaint.subType && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded whitespace-nowrap">{complaint.subType}</span>}
              </div>
            </div>
            <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">
              {complaint.details}
            </p>
            
            {/* Attachments */}
            {complaint.attachments && complaint.attachments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h4 className="text-sm font-medium text-slate-700 mb-2">{t('complaintDetails.attachmentsLabel')}</h4>
                <div className="flex flex-wrap gap-2">
                  {complaint.attachments.map((file, i) => (
                    file.mimeType?.startsWith('audio/') ? (
                      <div key={i} className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">
                        <p className="text-xs text-slate-500 mb-1" dir="ltr">{file.fileName}</p>
                        <audio controls src={file.fileUrl} className="w-full h-9" />
                      </div>
                    ) : (
                      <a key={i} href={file.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-slate-100 transition-colors">
                        <Paperclip className="w-4 h-4" />
                        <span dir="ltr">{file.fileName}</span>
                      </a>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div>
            <div className="flex gap-4 border-b border-slate-200 mb-4 px-1">
              <button onClick={() => setActiveTab('history')} className={`pb-2 font-medium text-sm transition-colors ${activeTab === 'history' ? 'border-b-2 border-primary text-primary' : 'text-slate-500 hover:text-slate-700'}`}>
                {t('complaintDetails.historyTab')}
              </button>
              <button onClick={() => setActiveTab('internal')} className={`pb-2 font-medium text-sm transition-colors ${activeTab === 'internal' ? 'border-b-2 border-primary text-primary' : 'text-slate-500 hover:text-slate-700'}`}>
                {t('complaintDetails.internalTab')}
              </button>
            </div>

            {activeTab === 'history' ? (
              <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
                {timelineLogs.map((log) => (
                  <div key={log.id} className="relative flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-slate-50">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                      <div className="flex justify-between mb-2">
                        <p className="font-medium text-slate-900">{getActionName(log.action)}</p>
                        <p className="text-xs text-slate-400" dir="ltr">
                          {log.createdAt ? format(log.createdAt.toDate(), 'p', { locale: dateLocale }) : ''}
                        </p>
                      </div>
                      <p className="text-sm text-slate-600 mb-1">{t('complaintDetails.by')} {log.actorName || t('complaintDetails.system')}</p>
                      {log.metadata?.solutionDetails && (
                        <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                          <strong>{t('complaintDetails.solutionLabel')}</strong> {log.metadata.solutionDetails}
                        </div>
                      )}
                      {log.metadata?.reason && (
                        <div className="mt-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100">
                          <strong>{t('complaintDetails.reasonLabel')}</strong> {log.metadata.reason}
                        </div>
                      )}
                      {log.metadata?.toUserNames?.length > 0 && (
                        <div className="mt-2 p-3 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200 space-y-1">
                          <p>{t('complaintDetails.assignedToLabel')} <strong>{log.metadata.toUserNames.join(listSep)}</strong></p>
                          {log.metadata.addedNames?.length > 0 && <p className="text-emerald-700">{t('complaintDetails.addedLabel')} {log.metadata.addedNames.join(listSep)}</p>}
                          {log.metadata.removedNames?.length > 0 && <p className="text-red-700">{t('complaintDetails.removedLabel')} {log.metadata.removedNames.join(listSep)}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4 print:hidden">
                {internalLogs.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">{t('complaintDetails.noInternalComments')}</p>
                ) : (
                  internalLogs.map((log) => (
                    <div key={log.id} className="bg-amber-50 p-4 rounded-xl border border-amber-100">
                      <div className="flex justify-between mb-1">
                        <p className="font-medium text-amber-900 text-sm">{log.actorName}</p>
                        <p className="text-xs text-amber-600/70" dir="ltr">
                          {log.createdAt ? format(log.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
                        </p>
                      </div>
                      <p className="text-sm text-amber-800 whitespace-pre-wrap">{log.metadata?.comment}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white border-t border-slate-200 p-4 print:hidden">
          {activeTab === 'history' && canEdit && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                type="button"
                onClick={toggleRecording}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  recording ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {recording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {recording ? t('complaintDetails.stopRecording') : t('complaintDetails.recordSolutionNote')}
              </button>
              {dictationSupported && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    dictating ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {dictating ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {dictating ? t('complaintDetails.stopDictation') : t('complaintDetails.startDictation')}
                </button>
              )}
              {pendingRecording && (
                <span className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                  <Mic className="w-3 h-3" />
                  {pendingRecording.name}
                  <button type="button" onClick={() => setPendingRecording(null)} className="hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {recording && <span className="text-xs text-red-600 animate-pulse">{t('complaintDetails.recordingInProgress')}</span>}
              {dictating && <span className="text-xs text-primary animate-pulse">{t('complaintDetails.dictationInProgress')}</span>}
              {(recordingError || dictationError) && <span className="text-xs text-red-600">{recordingError || dictationError}</span>}
            </div>
          )}
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={activeTab === 'internal' ? t('complaintDetails.internalCommentPlaceholder') : t('complaintDetails.solutionPlaceholder')}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
                rows={1}
              />
            </div>
            {activeTab === 'internal' ? (
              <button disabled={loading} onClick={() => handleAction('COMMENT')} className="px-6 h-[52px] bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-medium transition-colors shadow-sm flex items-center gap-2">
                {t('complaintDetails.commentBtn')}
                <Send className="w-4 h-4 -scale-x-100" />
              </button>
            ) : (
              <button disabled={loading || !canEdit} onClick={() => handleAction('SOLVE')} className="px-6 h-[52px] bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50">
                {t('complaintDetails.solveBtn')}
                <CheckCircle2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
