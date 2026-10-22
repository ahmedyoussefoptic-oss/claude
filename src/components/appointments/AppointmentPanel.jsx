import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { CalendarCheck, CalendarClock, CalendarPlus, Loader2, MessageCircle } from 'lucide-react';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';
import { userBranches } from '../../utils/scope';
import { waLink, trackingLink } from '../../utils/whatsapp';
import { isAppointmentCategory, APPOINTMENT_STATUS } from '../../config/appointments';
import AppointmentPicker, { formatAppointment } from './AppointmentPicker';

// School-visit appointment of a complaint: the requested slot and its
// status; the branch principal (or staff with edit permission / assignees)
// confirms it or moves it to another free slot (decideAppointment), which
// messages the parent automatically when the WhatsApp API is on — with a
// manual WhatsApp button as a fallback. On any record they handle, they can
// also invite the parent to a visit themselves (inviteParentVisit): a free
// slot or any other time, with a note for the parent.
export default function AppointmentPanel({ complaint, branchName }) {
  const { t, i18n } = useTranslation();
  const { user, userData } = useAuthStore();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const [changing, setChanging] = useState(false);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [mode, setMode] = useState('slot'); // 'slot' | 'custom'
  const [customDay, setCustomDay] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);

  const appt = complaint.appointment;
  const isRequestType = isAppointmentCategory(complaint.complaintType, complaint.subType, complaintTypes, subTypes);
  const inScope = userData?.role === 'ADMIN' || userData?.access === 'all' || userBranches(userData).includes(complaint.branch);
  const canManage = userData?.role === 'ADMIN' || (inScope && (userData?.isPrincipal === true || userData?.perms?.edit === true || (complaint.assignedTo || []).includes(user?.uid)));
  const canInvite = (canManage || (inScope && userData?.isQuality === true)) && !['CLOSED', 'REJECTED'].includes(complaint.status);
  if (!appt && !isRequestType && !canInvite) return null;

  const invite = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const customAt = mode === 'custom' && customDay && customTime ? new Date(`${customDay}T${customTime}:00+03:00`).getTime() : null;
      const { data } = await httpsCallable(functions, 'inviteParentVisit')({ complaintDocId: complaint.id, ...(customAt ? { customAt } : { slot }), note });
      setResult(data);
      setInviting(false);
      setSlot(null);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const inviteReady = mode === 'custom' ? Boolean(customDay && customTime) : Boolean(slot);
  const status = appt?.status;
  const when = appt?.start ? formatAppointment(appt.start.toMillis(), i18n.language) : null;

  const decide = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'decideAppointment')({ complaintDocId: complaint.id, action, ...(action === 'reschedule' ? { slot } : {}) });
      setChanging(false);
      setSlot(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const parentMessage = when && `${t('appointments.parentMessage', {
    parent: complaint.parentName, branch: branchName, when, id: complaint.complaintId, link: trackingLink(complaint.complaintId),
  })}${appt?.note ? `\n${t('appointments.noteForParent')}: ${appt.note}` : ''}`;

  return (
    <div className="bg-white p-5 rounded-xl border border-sky-200 shadow-sm space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" />{t('appointments.panelTitle')}</h3>
        {status && <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${APPOINTMENT_STATUS[status]?.[1] || ''}`}>{t(`appointments.status.${status}`)}</span>}
      </div>

      {when ? (
        <div>
          <p className="text-lg font-bold text-slate-900">{when}</p>
          {appt.rescheduled && appt.requestedStart && (
            <p className="text-xs text-slate-500 mt-0.5">{t('appointments.originallyRequested', { when: formatAppointment(appt.requestedStart.toMillis(), i18n.language) })}</p>
          )}
          {appt.decidedByName && <p className="text-xs text-slate-500 mt-0.5">{t('appointments.decidedBy', { name: appt.decidedByName })}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-500">{isRequestType ? t('appointments.noSlotYet') : t('appointments.inviteHint')}</p>
      )}
      {appt?.note && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2 py-1">{t('appointments.noteForParent')}: {appt.note}</p>}
      {result && <p className="text-sm text-emerald-700">{result.sent ? t('appointments.inviteSentAuto', { when: result.when }) : t('appointments.inviteSaved', { when: result.when })}</p>}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</p>}

      {canInvite && status !== 'CHECKED_IN' && status !== 'REQUESTED' && (
        <button disabled={busy} onClick={() => { setInviting((v) => !v); setChanging(false); }} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2">
          <CalendarPlus className="w-4 h-4" />{status ? t('appointments.changeInvite') : t('appointments.inviteBtn')}
        </button>
      )}

      {inviting && (
        <div className="space-y-3 border border-sky-100 rounded-xl p-3">
          <div className="flex gap-2 text-sm">
            {['slot', 'custom'].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg border ${mode === m ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`appointments.mode.${m}`)}</button>
            ))}
          </div>
          {mode === 'slot' ? (
            <AppointmentPicker branch={complaint.branch} value={slot} onChange={setSlot} required={false} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <input type="date" value={customDay} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCustomDay(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('appointments.noteLabel')}</label>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t('appointments.notePlaceholder')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
          <button disabled={busy || !inviteReady} onClick={invite} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}{t('appointments.inviteSend')}
          </button>
        </div>
      )}

      {canManage && status === 'REQUESTED' && (
        <div className="flex flex-wrap gap-2">
          {status === 'REQUESTED' && (
            <button disabled={busy} onClick={() => decide('confirm')} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60">
              {busy && !changing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              {t('appointments.confirmBtn')}
            </button>
          )}
          <button disabled={busy} onClick={() => setChanging((v) => !v)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium">
            {status ? t('appointments.otherSlotBtn') : t('appointments.setSlotBtn')}
          </button>
        </div>
      )}

      {changing && (
        <div className="space-y-2">
          <AppointmentPicker branch={complaint.branch} value={slot} onChange={setSlot} required={false} />
          <button disabled={busy || !slot} onClick={() => decide('reschedule')} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('appointments.saveOtherSlot')}
          </button>
        </div>
      )}

      {status === 'CONFIRMED' && complaint.parentPhone && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <a href={waLink(complaint.parentPhone, parentMessage)} target="_blank" rel="noreferrer" className="px-3.5 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />{t('appointments.sendToParent')}
          </a>
          {complaint.appointmentMessageSentAt && <span className="text-xs text-emerald-700">{t('appointments.sentAuto')}</span>}
        </div>
      )}
      {status === 'CONFIRMED' && <p className="text-xs text-slate-500">{t('appointments.checkInHint')}</p>}
      {status === 'CONFIRMED' && <p className="text-xs text-sky-700">{appt.reminderSentFor ? t('appointments.reminderSent', { day: appt.reminderSentFor }) : t('appointments.reminderAuto')}</p>}
    </div>
  );
}
