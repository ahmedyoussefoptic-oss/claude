import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { BellRing, Loader2, Check, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';

// Unresolved statuses per record kind — mirrors REMINDER_KINDS in
// functions/index.js (sendRecordReminder).
const OPEN = {
  complaint: ['RECEIVED', 'IN_PROGRESS', 'WAITING_PARENT_RESPONSE', 'ESCALATED'],
  techSupport: ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'SOLVED', 'REOPENED'],
  lostFound: ['UNCLAIMED', 'MATCHED'],
};

// "Remind" button beside an unresolved record: notifies its assignees,
// naming the sender, with an optional short note.
export default function ReminderButton({ kind, record }) {
  const { t, i18n } = useTranslation();
  const { user, userData } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const recipients = (record.assignedTo || []).filter((id) => id !== user?.uid);
  if (userData?.role === 'RECEPTIONIST' || !OPEN[kind]?.includes(record.status) || !recipients.length) return null;

  const last = record.lastReminderAt?.toDate?.();
  const lastText = last ? t('reminder.last', { name: record.lastReminderByName || '', ago: formatDistanceToNow(last, { addSuffix: true, locale: i18n.language === 'ar' ? ar : enUS }) }) : '';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'sendRecordReminder')({ kind, docId: record.id, note });
      setDone(true);
      setNote('');
      setTimeout(() => { setOpen(false); setDone(false); }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block" ref={boxRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={[t('reminder.button'), lastText].filter(Boolean).join(' — ')}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${last ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`}
      >
        <BellRing className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute z-40 top-9 left-0 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-3 text-right space-y-2 cursor-default">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">{t('reminder.title')}</p>
            <button type="button" onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-slate-500">{t('reminder.to', { names: (record.assignedToNames || []).filter((_, i) => (record.assignedTo || [])[i] !== user?.uid).join('، ') })}</p>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('reminder.notePlaceholder')} className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          {lastText && <p className="text-[11px] text-amber-700">{lastText}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="button" disabled={busy || done} onClick={send} className="w-full py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 flex items-center justify-center gap-1.5 disabled:opacity-70">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" /> : <BellRing className="w-4 h-4" />}
            {done ? t('reminder.sent') : t('reminder.send')}
          </button>
        </div>
      )}
    </div>
  );
}
