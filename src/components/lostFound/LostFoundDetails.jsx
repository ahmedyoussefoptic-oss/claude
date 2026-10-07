import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminPermissions, adminCan } from '../../config/adminPermissions';
import { X, Clock, CheckCircle2, Phone, MapPin, Package, Loader2, MessageCircle, Link2, UserPlus, Trash2, GraduationCap } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from '../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import useAuthStore from '../../stores/useAuthStore';
import { messageSentFields } from '../../utils/messageSent';
import { useUsers } from '../../hooks/useUsers';
import { useBranches, useDepartments, useItemCategories } from '../../hooks/useOrgData';
import { ITEM_STATUS_BADGE } from '../../config/lostFound';
import { ROLES } from '../../config/roles';
import { userBranches } from '../../utils/scope';
import { waLink, buildLostFoundReceiptMessage, buildLostFoundResolutionMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { useWhatsAppApi } from '../../hooks/useWhatsAppApi';
import AssigneeMultiSelect, { eligibleAssignees } from '../common/AssigneeMultiSelect';
import ErrorBoundary from '../common/ErrorBoundary';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

export default function LostFoundDetails({ item, onClose }) {
  return (
    <ErrorBoundary key={item.id} onClose={onClose}>
      <LostFoundDetailsInner item={item} onClose={onClose} />
    </ErrorBoundary>
  );
}

function LostFoundDetailsInner({ item, onClose }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const getActionName = (action) => t(`actions.lostFound.${action}`, action);
  const { user, userData } = useAuthStore();
  const users = useUsers();
  const branches = useBranches();
  const itemCategories = useItemCategories();
  const templates = useMessageTemplates();
  const waApi = useWhatsAppApi();
  const [waSending, setWaSending] = useState(null);
  const sendViaApi = async (event) => {
    if (!confirm(t('waApi.confirmSend', { phone: item.reporterPhone }))) return;
    setWaSending(event);
    try {
      // The function also records the receipt/resolution "sent by" fields.
      await httpsCallable(functions, 'sendWhatsAppApiMessage')({ kind: 'lostFound', docId: item.id, event });
      alert(t('waApi.sentOk'));
    } catch (err) {
      console.error(err);
      alert(err.message || t('waApi.sendFailed'));
    } finally {
      setWaSending(null);
    }
  };
  const [logs, setLogs] = useState([]);
  const [note, setNote] = useState('');
  const [returnedTo, setReturnedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState(item.assignedTo || []);

  useEffect(() => {
    setSelectedAssignees(item.assignedTo || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const isAdmin = userData?.role === ROLES.ADMIN;

  const adminCaps = useAdminPermissions();
  // Mirrors firestore.rules' canEditRecord/canDeleteRecord: a branch-scoped
  // holder of the edit/delete permission only gets it for their own branch.
  const inScope = isAdmin || userData?.access === 'all' || userBranches(userData).includes(item.branch);
  const canEdit = isAdmin || (inScope && userData?.perms?.edit === true);
  const canDelete = isAdmin ? adminCan(userData, adminCaps, 'delete') : (inScope && userData?.perms?.delete === true);

  useEffect(() => {
    const q = query(
      collection(db, `lostFoundItems/${item.id}/activityLog`),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [item.id]);

  const addLog = async (action, metadata = {}, updates = {}) => {
    const now = serverTimestamp();
    await addDoc(collection(db, `lostFoundItems/${item.id}/activityLog`), {
      action,
      actorId: user.uid,
      actorName: userData?.name || t('common.user'),
      metadata,
      createdAt: now,
    });

    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, 'lostFoundItems', item.id), {
        ...updates,
        updatedAt: now,
      });
    }
  };

  const handleAction = async (actionType) => {
    setLoading(true);
    try {
      if (actionType === 'MATCH') {
        await addLog('ITEM_MATCHED', {}, { status: 'MATCHED' });
      } else if (actionType === 'RETURN') {
        if (!returnedTo.trim()) {
          alert(t('lostFoundDetails.returnedToNameRequiredAlert'));
          return;
        }
        await addLog('ITEM_RETURNED', { returnedTo }, { status: 'RETURNED', returnedTo });
        setReturnedTo('');
      } else if (actionType === 'CLOSE') {
        await addLog('ITEM_CLOSED', {}, { status: 'CLOSED' });
      } else if (actionType === 'NOTE') {
        if (!note.trim()) return;
        await addLog('NOTE_ADDED', { note });
        setNote('');
      } else if (actionType === 'ASSIGN') {
        const before = item.assignedTo || [];
        const addedIds = selectedAssignees.filter((id) => !before.includes(id));
        const removedIds = before.filter((id) => !selectedAssignees.includes(id));
        if (addedIds.length === 0 && removedIds.length === 0) {
          alert(t('assigneeSelect.noChangeAlert'));
          return;
        }
        const selectedUsers = selectedAssignees.map((id) => users.find((u) => u.id === id)).filter(Boolean);
        const addedNames = addedIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
        const removedNames = removedIds.map((id) => item.assignedToNames?.[before.indexOf(id)] || users.find((u) => u.id === id)?.name).filter(Boolean);
        await addLog(
          before.length === 0 ? 'ITEM_ASSIGNED' : 'ITEM_TRANSFERRED',
          { toUserNames: selectedUsers.map((u) => u.name), addedNames, removedNames },
          { assignedTo: selectedAssignees, assignedToNames: selectedUsers.map((u) => u.name), assignedAt: serverTimestamp() }
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const reason = prompt(t('lostFoundDetails.deleteReasonPrompt'));
    if (!reason) return;
    setLoading(true);
    try {
      // Archived before the real delete — the item's own activityLog
      // subcollection would otherwise become orphaned and unreachable the
      // moment its parent doc is gone (same reasoning as complaints' delete).
      await addDoc(collection(db, 'deletedLostFoundItems'), {
        item,
        activityLog: [
          ...logs,
          { action: 'ITEM_DELETED', actorId: user.uid, actorName: userData?.name || t('common.user'), metadata: { reason }, createdAt: new Date() },
        ],
        reason,
        deletedBy: user.uid,
        deletedByName: userData?.name || t('common.user'),
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'lostFoundItems', item.id));
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const reportTypeName = t(`lostFoundCommon.reportTypes.${item.reportType}`, item.reportType);
  const categoryName = itemCategories.find((c) => c.id === item.category)?.name || item.category;
  const branchName = branches.find((b) => b.id === item.branch)?.name || item.branch;
  const departments = useDepartments();
  const departmentName = item.department ? (departments.find((d) => d.id === item.department)?.name || item.department) : '';
  const hasStudent = item.studentName || item.studentId || item.stage || item.grade || item.department;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">

        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{item.itemCode}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${ITEM_STATUS_BADGE[item.status]}`}>
                {t(`statuses.lostFound.${item.status}`, item.status)}
              </span>
              {item.source === 'PARENT_PORTAL' && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {t('lostFoundDetails.viaPublicLink')}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {item.createdAt ? format(item.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          <div className="flex flex-wrap gap-2">
            {!item.receiptMessageSentAt && item.reporterPhone && (
              <a
                href={waLink(item.reporterPhone, buildLostFoundReceiptMessage(item, templates.lostFoundReceipt))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'lostFoundItems', item.id), messageSentFields('receipt', user, userData))}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('common.sendReceiptWhatsApp')}
              </a>
            )}
            {waApi.enabled && !item.receiptMessageSentAt && item.reporterPhone && (
              <button disabled={!!waSending} onClick={() => sendViaApi('receipt')} className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium hover:bg-emerald-800 transition-all flex items-center gap-2 disabled:opacity-60">
                {waSending === 'receipt' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                {t('waApi.sendReceiptApi')}
              </button>
            )}
            {canEdit && item.status === 'UNCLAIMED' && (
              <button disabled={loading} onClick={() => handleAction('MATCH')} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors">
                {t('lostFoundDetails.confirmMatched')}
              </button>
            )}
            {canEdit && (item.status === 'UNCLAIMED' || item.status === 'MATCHED') && (
              <button disabled={loading} onClick={() => handleAction('CLOSE')} className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors">
                {t('lostFoundDetails.closeWithoutReturn')}
              </button>
            )}
            {item.status === 'RETURNED' && item.reporterPhone && (
              <a
                href={waLink(item.reporterPhone, buildLostFoundResolutionMessage(item, templates.lostFoundResolution))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'lostFoundItems', item.id), messageSentFields('resolution', user, userData))}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {t('common.sendResolutionWhatsApp')}
              </a>
            )}
            {waApi.enabled && item.status === 'RETURNED' && item.reporterPhone && (
              <button disabled={!!waSending} onClick={() => sendViaApi('returned')} className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium hover:bg-emerald-800 transition-all flex items-center gap-2 disabled:opacity-60">
                {waSending === 'returned' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                {t('waApi.sendReturnedApi')}
              </button>
            )}
            {canDelete && (
              <button disabled={loading} onClick={handleDelete} className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2 mr-auto">
                <Trash2 className="w-4 h-4" />
                {t('lostFoundDetails.deleteFinal')}
              </button>
            )}
          </div>

          {canEdit && item.status !== 'RETURNED' && item.status !== 'CLOSED' && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-slate-400" />
                {(item.assignedTo?.length ?? 0) > 0 ? t('assigneeSelect.editAssignmentTitle') : t('assigneeSelect.newAssignmentTitle')}
              </h3>
              {item.assignedToNames?.length > 0 && (
                <p className="text-sm text-slate-500 mb-3">{t('assigneeSelect.currentAssigneesLabel')} <span className="font-medium text-slate-800">{item.assignedToNames.join(listSep)}</span></p>
              )}
              <div className="space-y-3">
                <AssigneeMultiSelect
                  options={eligibleAssignees(users, { branch: item.branch })}
                  selected={selectedAssignees}
                  onChange={setSelectedAssignees}
                  placeholder={t('assigneeSelect.selectStaffPlaceholder')}
                />
                <button
                  disabled={loading || (selectedAssignees.length === (item.assignedTo || []).length && selectedAssignees.every((id) => (item.assignedTo || []).includes(id)))}
                  onClick={() => handleAction('ASSIGN')}
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
                <Package className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{reportTypeName}</p>
                <p className="font-medium text-slate-900">{item.itemName}</p>
                <p className="text-sm text-slate-500 mt-1">{categoryName}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('lostFoundDetails.branchLocation')}</p>
                <p className="font-medium text-slate-900">{branchName}</p>
                <p className="text-sm text-slate-500 mt-1">{item.location}</p>
              </div>
            </div>
          </div>

          {hasStudent && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('lostFoundDetails.studentLabel')}</p>
                <p className="font-medium text-slate-900">{item.studentName || '—'}{item.studentId && <span className="text-sm text-slate-500 font-normal mr-2" dir="ltr">{item.studentId}</span>}</p>
                <p className="text-sm text-slate-500 mt-1">{[departmentName, item.stage, item.grade].filter(Boolean).join(' — ') || '—'}</p>
              </div>
            </div>
          )}

          {item.reporterName && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{t('lostFoundDetails.contact')}</p>
                <p className="font-medium text-slate-900">{item.reporterName}</p>
                <p className="text-sm text-slate-500 mt-1" dir="ltr">{item.reporterPhone}</p>
              </div>
            </div>
          )}

          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <h3 className="font-bold text-slate-900 text-lg mb-3">{t('lostFoundDetails.description')}</h3>
            <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">
              {item.description || t('lostFoundDetails.noDescription')}
            </p>
            {item.photoUrl && (
              <a href={item.photoUrl} target="_blank" rel="noreferrer" className="block mt-4">
                <img src={item.photoUrl} alt={item.itemName} className="max-h-64 rounded-lg border border-slate-100" />
              </a>
            )}
          </div>

          {item.status === 'MATCHED' && (
            <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">{t('lostFoundDetails.returnItem')}</h3>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={returnedTo}
                  onChange={(e) => setReturnedTo(e.target.value)}
                  placeholder={t('lostFoundDetails.returnedToPlaceholder')}
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <button disabled={loading} onClick={() => handleAction('RETURN')} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors">
                  {t('lostFoundDetails.confirmReturn')}
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-bold text-slate-900 text-lg mb-4">{t('lostFoundDetails.followUpLog')}</h3>
            <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
              {logs.map((log) => (
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
                    {log.metadata?.returnedTo && (
                      <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                        <strong>{t('lostFoundDetails.returnedToLabel')}</strong> {log.metadata.returnedTo}
                      </div>
                    )}
                    {log.action === 'REMINDER_SENT' && (
                      <p className="text-sm text-amber-700 mt-1">{t('reminder.logTo', { names: (log.metadata?.toUserNames || []).join(listSep) || '—' })}</p>
                    )}
                    {log.action !== 'REMINDER_SENT' && log.metadata?.toUserNames?.length > 0 && (
                      <div className="mt-2 p-3 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200 space-y-1">
                        <p>{t('assigneeSelect.assignedToLogLabel')} <strong>{log.metadata.toUserNames.join(listSep)}</strong></p>
                        {log.metadata.addedNames?.length > 0 && <p className="text-emerald-700">{t('assigneeSelect.addedLogLabel')} {log.metadata.addedNames.join(listSep)}</p>}
                        {log.metadata.removedNames?.length > 0 && <p className="text-red-700">{t('assigneeSelect.removedLogLabel')} {log.metadata.removedNames.join(listSep)}</p>}
                      </div>
                    )}
                    {log.metadata?.note && (
                      <p className="text-sm text-slate-600 mt-1">{log.metadata.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border-t border-slate-200 p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('lostFoundDetails.followUpPlaceholder')}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
                rows={1}
              />
            </div>
            <button disabled={loading} onClick={() => handleAction('NOTE')} className="px-6 h-[52px] bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-medium transition-colors shadow-sm flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.add')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
