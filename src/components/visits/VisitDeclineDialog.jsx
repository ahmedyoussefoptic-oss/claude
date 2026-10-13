import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { HeartHandshake, Link2, CalendarPlus, Loader2, MessageCircle, Copy, Check, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { functions } from '../../config/firebase';
import { waLink } from '../../utils/whatsapp';
import AppointmentPicker from '../appointments/AppointmentPicker';

// The assignee can't meet a parent who came without an appointment: they
// apologise (reason required) and either send the parent a link to pick a
// new meeting time (declineVisitMeeting), or pick the time themselves
// (bookMeetingFromVisit). Either way the parent gets a WhatsApp message
// with the apology and the link / the time.
export default function VisitDeclineDialog({ visit, branchName, onClose }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('parent'); // 'parent' | 'staff'
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { message }
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { setError(t('visitDecline.reasonRequired')); return; }
    setBusy(true);
    setError(null);
    try {
      const greeting = t('visitDecline.msgGreeting', { parent: visit.parentName || '', student: visit.studentName || '', branch: branchName || '' });
      if (mode === 'parent') {
        const { data } = await httpsCallable(functions, 'declineVisitMeeting')({ complaintDocId: visit.id, reason });
        setDone({ link: data.bookLink, message: `${greeting}\n${t('visitDecline.msgParentBooks', { reason: reason.trim(), link: data.bookLink })}` });
      } else {
        const { data } = await httpsCallable(functions, 'bookMeetingFromVisit')({ complaintDocId: visit.id, slot, reason });
        const when = data.when || (slot ? format(new Date(slot), 'EEEE d MMMM · p', { locale: dateLocale }) : '');
        setDone({ message: `${greeting}\n${t('visitDecline.msgStaffBooked', { reason: reason.trim(), when, number: visit.complaintId })}` });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const option = (key, Icon, title, hint) => (
    <button type="button" onClick={() => setMode(key)} className={`text-start rounded-xl border-2 p-3 flex gap-3 ${mode === key ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}>
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${mode === key ? 'text-primary' : 'text-slate-400'}`} />
      <span><span className="block text-sm font-bold text-slate-900">{title}</span><span className="block text-xs text-slate-500 mt-0.5">{hint}</span></span>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[120] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><HeartHandshake className="w-5 h-5 text-rose-600" />{t('visitDecline.title')}</h3>
        <p className="text-sm text-slate-600">{t('branchVisits.confirmFor', { parent: visit.parentName, student: visit.studentName })}</p>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{t(mode === 'parent' ? 'visitDecline.doneParent' : 'visitDecline.doneStaff')}</p>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 font-sans">{done.message}</pre>
            <div className="flex flex-wrap gap-2">
              {visit.parentPhone && (
                <a href={waLink(visit.parentPhone, done.message)} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white flex items-center gap-1.5">
                  <MessageCircle className="w-4 h-4" />{t('visitDecline.sendWa')}
                </a>
              )}
              {done.link && (
                <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(done.link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }} className="px-4 py-2 rounded-xl text-sm border border-slate-300 flex items-center gap-1.5">
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}{t('visitDecline.copyLink')}
                </button>
              )}
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-slate-300 bg-white mr-auto">{t('common.close')}</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-slate-600 mb-1">{t('visitDecline.reason')} <span className="text-red-500">*</span></label>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('visitDecline.reasonPlaceholder')} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" />
            </div>
            <div className="grid grid-cols-1 gap-2">
              {option('parent', Link2, t('visitDecline.optParent'), t('visitDecline.optParentHint'))}
              {option('staff', CalendarPlus, t('visitDecline.optStaff'), t('visitDecline.optStaffHint'))}
            </div>
            {mode === 'staff' && <AppointmentPicker branch={visit.branch} value={slot} onChange={setSlot} />}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
              <button type="button" disabled={busy || !reason.trim() || (mode === 'staff' && !slot)} onClick={submit} className="px-5 py-2 text-sm rounded-xl bg-rose-600 text-white font-medium flex items-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartHandshake className="w-4 h-4" />}{t('visitDecline.confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
