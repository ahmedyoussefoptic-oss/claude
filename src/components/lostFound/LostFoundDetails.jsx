import { useState, useEffect } from 'react';
import { X, Clock, CheckCircle2, Phone, MapPin, Package, Loader2, MessageCircle, Link2 } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useItemCategories } from '../../hooks/useOrgData';
import { ITEM_STATUS_LABELS, ITEM_STATUS_BADGE, REPORT_TYPES } from '../../config/lostFound';
import { ROLES } from '../../config/roles';
import { waLink, buildLostFoundReceiptMessage, buildLostFoundResolutionMessage } from '../../utils/whatsapp';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const getActionName = (action) => {
  switch (action) {
    case 'ITEM_REGISTERED': return 'تم تسجيل الغرض';
    case 'ITEM_MATCHED': return 'تمت مطابقة الغرض بصاحبه';
    case 'ITEM_RETURNED': return 'تم تسليم الغرض';
    case 'ITEM_CLOSED': return 'تم إغلاق السجل';
    case 'NOTE_ADDED': return 'ملاحظة';
    default: return action;
  }
};

export default function LostFoundDetails({ item, onClose }) {
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const itemCategories = useItemCategories();
  const templates = useMessageTemplates();
  const [logs, setLogs] = useState([]);
  const [note, setNote] = useState('');
  const [returnedTo, setReturnedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const isAdmin = userData?.role === ROLES.ADMIN;
  // Mirrors firestore.rules' canEditRecord: a branch-scoped edit permission
  // only applies within that user's own branch.
  const inScope = isAdmin || userData?.access === 'all' || userData?.branch === item.branch;
  const canEdit = isAdmin || (inScope && userData?.perms?.edit === true);

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
      actorName: userData?.name || 'مستخدم',
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
          alert('يرجى كتابة اسم من تم تسليمه الغرض.');
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
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const reportTypeName = REPORT_TYPES.find((t) => t.id === item.reportType)?.name || item.reportType;
  const categoryName = itemCategories.find((c) => c.id === item.category)?.name || item.category;
  const branchName = branches.find((b) => b.id === item.branch)?.name || item.branch;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">

        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">{item.itemCode}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${ITEM_STATUS_BADGE[item.status]}`}>
                {ITEM_STATUS_LABELS[item.status]}
              </span>
              {item.source === 'PARENT_PORTAL' && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  عبر الرابط العام
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {item.createdAt ? format(item.createdAt.toDate(), 'PP p', { locale: ar }) : ''}
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
                onClick={() => updateDoc(doc(db, 'lostFoundItems', item.id), { receiptMessageSentAt: serverTimestamp() })}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                إرسال رسالة الاستلام عبر واتساب
              </a>
            )}
            {canEdit && item.status === 'UNCLAIMED' && (
              <button disabled={loading} onClick={() => handleAction('MATCH')} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors">
                تمت مطابقة الغرض بصاحبه
              </button>
            )}
            {canEdit && (item.status === 'UNCLAIMED' || item.status === 'MATCHED') && (
              <button disabled={loading} onClick={() => handleAction('CLOSE')} className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors">
                إغلاق بدون تسليم
              </button>
            )}
            {item.status === 'RETURNED' && item.reporterPhone && (
              <a
                href={waLink(item.reporterPhone, buildLostFoundResolutionMessage(item, templates.lostFoundResolution))}
                target="_blank"
                rel="noreferrer"
                onClick={() => updateDoc(doc(db, 'lostFoundItems', item.id), { resolutionMessageSentAt: serverTimestamp() })}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95 transition-all flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                إرسال رسالة التسليم عبر واتساب
              </a>
            )}
          </div>

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
                <p className="text-xs text-slate-500 mb-0.5">الفرع / المكان</p>
                <p className="font-medium text-slate-900">{branchName}</p>
                <p className="text-sm text-slate-500 mt-1">{item.location}</p>
              </div>
            </div>
          </div>

          {item.reporterName && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">جهة الاتصال</p>
                <p className="font-medium text-slate-900">{item.reporterName}</p>
                <p className="text-sm text-slate-500 mt-1" dir="ltr">{item.reporterPhone}</p>
              </div>
            </div>
          )}

          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <h3 className="font-bold text-slate-900 text-lg mb-3">الوصف</h3>
            <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">
              {item.description || 'لا يوجد وصف إضافي'}
            </p>
            {item.photoUrl && (
              <a href={item.photoUrl} target="_blank" rel="noreferrer" className="block mt-4">
                <img src={item.photoUrl} alt={item.itemName} className="max-h-64 rounded-lg border border-slate-100" />
              </a>
            )}
          </div>

          {item.status === 'MATCHED' && (
            <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">تسليم الغرض</h3>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={returnedTo}
                  onChange={(e) => setReturnedTo(e.target.value)}
                  placeholder="اسم من تم تسليمه الغرض"
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <button disabled={loading} onClick={() => handleAction('RETURN')} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors">
                  تأكيد التسليم
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-bold text-slate-900 text-lg mb-4">سجل المتابعة</h3>
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
                        {log.createdAt ? format(log.createdAt.toDate(), 'p', { locale: ar }) : ''}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">بواسطة: {log.actorName || 'النظام'}</p>
                    {log.metadata?.returnedTo && (
                      <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                        <strong>تم التسليم إلى:</strong> {log.metadata.returnedTo}
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
                placeholder="أضف ملاحظة متابعة..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
                rows={1}
              />
            </div>
            <button disabled={loading} onClick={() => handleAction('NOTE')} className="px-6 h-[52px] bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-medium transition-colors shadow-sm flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'إضافة'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
