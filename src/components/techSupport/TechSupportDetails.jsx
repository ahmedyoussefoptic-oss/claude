import { useState, useEffect } from 'react';
import { X, Clock, CheckCircle2, User, Phone, MapPin, Loader2, Trash2, UserPlus, MessageCircle, ShieldCheck } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useUsers } from '../../hooks/useUsers';
import { useBranches } from '../../hooks/useOrgData';
import { ROLES } from '../../config/roles';
import { PROBLEM_TYPES, PLATFORMS, TICKET_STATUS_LABELS, TICKET_STATUS_BADGE } from '../../config/techSupport';
import { waLink, buildCredentialMessage, toWhatsAppNumber } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const getActionName = (action) => {
  switch (action) {
    case 'TICKET_CREATED': return 'تم تسجيل البلاغ';
    case 'IDENTITY_VERIFIED': return 'تم التحقق من هوية مقدّم البلاغ';
    case 'TICKET_ASSIGNED': return 'تم إسناد البلاغ';
    case 'TICKET_TRANSFERRED': return 'تم تحويل البلاغ لمختص آخر';
    case 'PROCESSING_STARTED': return 'بدأ المختص المعالجة';
    case 'CREDENTIALS_SENT': return 'تم إرسال بيانات الدخول';
    case 'CONFIRMED_CLOSED': return 'تأكيد نجاح الدخول وإغلاق البلاغ';
    case 'TICKET_REOPENED': return 'تم إعادة فتح البلاغ';
    case 'TICKET_ESCALATED': return 'تم تصعيد البلاغ';
    case 'NOTE_ADDED': return 'ملاحظة';
    default: return action;
  }
};

export default function TechSupportDetails({ ticket, onClose }) {
  const { user, userData } = useAuthStore();
  const users = useUsers();
  const branches = useBranches();
  const templates = useMessageTemplates();
  const [logs, setLogs] = useState([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [username, setUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  const isAdmin = userData?.role === ROLES.ADMIN;
  // Mirrors firestore.rules' canEditRecord/canDeleteRecord: a branch-scoped
  // holder of the edit/delete permission only gets it for their own branch.
  const inScope = isAdmin || userData?.access === 'all' || userData?.branch === ticket.branch;
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
      actorName: userData?.name || 'مستخدم',
      metadata,
      createdAt: now,
    });
    if (updates) {
      await updateDoc(doc(db, 'techSupportTickets', ticket.id), { ...updates, updatedAt: now });
    }
  };

  const handleAssign = async () => {
    if (!assigneeId) return;
    const assignee = users.find((u) => u.id === assigneeId);
    const isReassign = !!ticket.assignedTo;
    setLoading(true);
    try {
      await addLog(
        isReassign ? 'TICKET_TRANSFERRED' : 'TICKET_ASSIGNED',
        { toUserId: assigneeId, toUserName: assignee?.name },
        { assignedTo: assigneeId, assignedToName: assignee?.name || '', assignedAt: serverTimestamp(), status: ticket.status === 'NEW' ? 'ASSIGNED' : ticket.status }
      );
      setAssigneeId('');
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

  const handleSendCredentials = async () => {
    if (!username.trim() || !tempPassword.trim()) return;
    const message = buildCredentialMessage({
      ticketId: ticket.ticketId,
      studentName: ticket.studentName,
      platformName: PLATFORMS.find((p) => p.id === ticket.platform)?.name,
      platformLink: ticket.platformLink,
      username,
      tempPassword,
    }, templates.credential);
    window.open(waLink(ticket.parentPhone, message), '_blank');
    setLoading(true);
    try {
      // NOTE: the temp password is deliberately never written to Firestore —
      // only the fact that credentials were sent, when, by whom, and to which
      // registered number is kept, per the module's audit requirements.
      await addLog('CREDENTIALS_SENT', { sentToPhone: ticket.parentPhone, usernameSent: username }, { status: 'WAITING_CONFIRMATION', resolutionMessageSentAt: serverTimestamp() });
      setShowCredsForm(false);
      setUsername('');
      setTempPassword('');
    } finally {
      setLoading(false);
    }
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
    const reason = prompt('سبب إعادة فتح البلاغ (مثال: لم ينجح تسجيل الدخول):');
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
    const reason = prompt('اكتب سبب حذف البلاغ نهائياً (إلزامي):');
    if (!reason) return;
    setLoading(true);
    try {
      await addLog('TICKET_DELETED', { reason });
      await deleteDoc(doc(db, 'techSupportTickets', ticket.id));
      onClose();
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

  const problemTypeName = PROBLEM_TYPES.find((t) => t.id === ticket.problemType)?.name || ticket.problemType;
  const platformName = PLATFORMS.find((p) => p.id === ticket.platform)?.name || ticket.platform;
  const branchName = branches.find((b) => b.id === ticket.branch)?.name || ticket.branch;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">

        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{ticket.ticketId}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${TICKET_STATUS_BADGE[ticket.status]}`}>
                {TICKET_STATUS_LABELS[ticket.status]}
              </span>
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {ticket.createdAt ? format(ticket.createdAt.toDate(), 'PP p', { locale: ar }) : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {!canEdit && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
              صلاحيتك اطلاع فقط على هذا البلاغ — لا تملك صلاحية التعديل.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canEdit && ticket.status === 'ASSIGNED' && (
              <button disabled={loading} onClick={handleStart} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                بدء المعالجة
              </button>
            )}
            {canEdit && ticket.status === 'IN_PROGRESS' && (
              <button disabled={loading} onClick={() => setShowCredsForm(true)} className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                إرسال بيانات الدخول عبر واتساب
              </button>
            )}
            {canEdit && ticket.status === 'WAITING_CONFIRMATION' && (
              <button disabled={loading} onClick={handleConfirmClose} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                تأكيد نجاح الدخول وإغلاق البلاغ
              </button>
            )}
            {canEdit && ['CLOSED', 'WAITING_CONFIRMATION'].includes(ticket.status) && (
              <button disabled={loading} onClick={handleReopen} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors">
                إعادة فتح البلاغ
              </button>
            )}
            {canEdit && !['CLOSED'].includes(ticket.status) && (
              <button disabled={loading} onClick={handleEscalate} className="px-4 py-2 bg-white border border-orange-300 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-50 transition-colors">
                تصعيد
              </button>
            )}
            {canDelete && (
              <button disabled={loading} onClick={handleDelete} className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2 mr-auto">
                <Trash2 className="w-4 h-4" />
                حذف البلاغ نهائياً
              </button>
            )}
          </div>

          {showCredsForm && (
            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                بيانات الدخول المؤقتة — لن تُحفظ هذه القيم في النظام
              </h3>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="اسم المستخدم" dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <input
                type="text" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)}
                placeholder="الرمز السري المؤقت" dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-slate-500">سيُرسل الرمز حصراً إلى الرقم المسجّل: <span dir="ltr" className="font-mono">{toWhatsAppNumber(ticket.parentPhone)}</span></p>
              <div className="flex gap-2">
                <button disabled={loading || !username.trim() || !tempPassword.trim()} onClick={handleSendCredentials} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  فتح واتساب والإرسال
                </button>
                <button onClick={() => setShowCredsForm(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">إلغاء</button>
              </div>
            </div>
          )}

          {canEdit && ticket.status !== 'CLOSED' && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-slate-400" />
                {ticket.assignedTo ? 'تحويل البلاغ لمختص آخر' : 'إسناد البلاغ لمختص تقنية معلومات'}
              </h3>
              {ticket.assignedToName && (
                <p className="text-sm text-slate-500 mb-3">المختص الحالي: <span className="font-medium text-slate-800">{ticket.assignedToName}</span></p>
              )}
              <div className="flex gap-3">
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
                  <option value="">اختر المختص...</option>
                  {users.filter((u) => u.id !== ticket.assignedTo && u.active !== false).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role}{u.department === 'IT' ? ' - IT' : ''})</option>
                  ))}
                </select>
                <button disabled={loading || !assigneeId} onClick={handleAssign} className="px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 disabled:opacity-50">
                  {ticket.assignedTo ? 'تحويل' : 'إسناد'}
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
                <p className="text-xs text-slate-500 mb-0.5">ولي الأمر ({ticket.relation})</p>
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
                <p className="text-xs text-slate-500 mb-0.5">الطالب</p>
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
              <p>رقم الهوية: <span dir="ltr">{ticket.nationalId}</span> {ticket.academicId && <>· الرقم الأكاديمي: <span dir="ltr">{ticket.academicId}</span></>}</p>
              {ticket.platformLink && <p dir="ltr">{ticket.platformLink}</p>}
            </div>
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-lg mb-4">سجل المتابعة (سجل التدقيق)</h3>
            <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
              {logs.map((log) => (
                <div key={log.id} className="relative flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-slate-50">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                    <div className="flex justify-between mb-2">
                      <p className="font-medium text-slate-900">{getActionName(log.action)}</p>
                      <p className="text-xs text-slate-400" dir="ltr">{log.createdAt ? format(log.createdAt.toDate(), 'p', { locale: ar }) : ''}</p>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">بواسطة: {log.actorName || 'النظام'}</p>
                    {log.metadata?.sentToPhone && (
                      <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                        أُرسلت بيانات الدخول إلى الرقم المسجّل <span dir="ltr">{log.metadata.sentToPhone}</span> — اسم المستخدم: <span dir="ltr">{log.metadata.usernameSent}</span> (الرمز السري غير مخزَّن).
                      </div>
                    )}
                    {log.metadata?.reason && (
                      <div className="mt-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100"><strong>السبب:</strong> {log.metadata.reason}</div>
                    )}
                    {log.metadata?.toUserName && (
                      <div className="mt-2 p-3 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200">إلى: <strong>{log.metadata.toUserName}</strong></div>
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
              placeholder="أضف ملاحظة متابعة..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
              rows={1}
            />
            <button disabled={loading} onClick={handleNote} className="px-6 h-[52px] bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-medium transition-colors shadow-sm flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'إضافة'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
