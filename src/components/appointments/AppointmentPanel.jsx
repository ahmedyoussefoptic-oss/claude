import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { CalendarCheck, CalendarClock, Loader2, MessageCircle } from 'lucide-react';
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
// manual WhatsApp button as a fallback.
export default function AppointmentPanel({ complaint, branchName }) {
  const { t, i18n } = useTranslation();
  const { user, userData } = useAuthStore();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const [changing, setChanging] = useState(false);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const appt = complaint.appointment;
  const isRequestType = isAppointmentCategory(complaint.complaintType, complaint.subType, complaintTypes, subTypes);
  if (!appt && !isRequestType) return null;

  const inScope = userData?.role === 'ADMIN' || userData?.access === 'all' || userBranches(userData).includes(complaint.branch);
  const canManage = userData?.role === 'ADMIN' || (inScope && (userData?.isPrincipal === true || userData?.perms?.edit === true || (complaint.assignedTo || []).includes(user?.uid)));
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

  const parentMessage = when && t('appointments.parentMessage', {
    parent: complaint.parentName, branch: branchName, when, id: complaint.complaintId, link: trackingLink(complaint.complaintId),
  });

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
        <p className="text-sm text-slate-500">{t('appointments.noSlotYet')}</p>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</p>}

      {canManage && status !== 'CHECKED_IN' && (
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
    </div>
  );
}
