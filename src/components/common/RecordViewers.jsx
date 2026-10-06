import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Eye } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db, functions } from '../../config/firebase';

const COLLECTIONS = { complaint: 'complaints', techSupport: 'techSupportTickets' };

// Records that the signed-in staff member opened this record (server side,
// see markRecordViewed — the first open notifies admins, the branch
// principal/quality officers, whoever logged it and the other assignees)
// and lists everyone who has seen it, with their first-seen time.
export default function RecordViewers({ kind, docId }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const [viewers, setViewers] = useState([]);

  useEffect(() => {
    httpsCallable(functions, 'markRecordViewed')({ kind, docId }).catch((err) => console.error('markRecordViewed failed', err));
  }, [kind, docId]);

  useEffect(() => {
    const q = query(collection(db, `${COLLECTIONS[kind]}/${docId}/views`), orderBy('firstAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => setViewers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setViewers([]));
    return () => unsubscribe();
  }, [kind, docId]);

  if (!viewers.length) return null;
  const fmt = (ts) => (ts?.toDate ? format(ts.toDate(), 'PP p', { locale: dateLocale }) : '');

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs text-slate-500">
      <span className="flex items-center gap-1 font-medium"><Eye className="w-3.5 h-3.5" />{t('recordViewers.seenBy', { count: viewers.length })}</span>
      {viewers.map((v) => (
        <span
          key={v.id}
          title={t('recordViewers.detail', { first: fmt(v.firstAt), last: fmt(v.lastAt), count: v.count || 1 })}
          className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600"
        >
          {v.name || '—'} <span className="text-slate-400" dir="ltr">{v.firstAt?.toDate ? format(v.firstAt.toDate(), 'd MMM p', { locale: dateLocale }) : ''}</span>
        </span>
      ))}
    </div>
  );
}
