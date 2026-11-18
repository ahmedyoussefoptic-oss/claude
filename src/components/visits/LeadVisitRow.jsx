import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { UserPlus, Armchair, Handshake, UserX, CheckCircle2, DoorOpen, Loader2, Phone, FolderOpen, MapPin, User, CalendarClock } from 'lucide-react';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { formatMinutes } from '../../utils/duration';
import { INTEREST_LEVELS } from '../../config/platform';
import StaffPicker from './StaffPicker';

// A new-registration visit (leadVisits) on «زيارات الفروع», as returned by
// listBranchLeadVisits: the family's appointment, arrival, who received
// them, or that they did not come (leadVisitAction).
export const LEAD_OPEN = ['REQUESTED', 'SCHEDULED', 'CONFIRMED'];
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const localPhone = (p) => (String(p || '').startsWith('966') ? `0${String(p).slice(3)}` : String(p || ''));
const call = (data) => httpsCallable(functions, 'leadVisitAction')(data);

function ReceiveDialog({ v, platform, onClose, onDone }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const [ids, setIds] = useState(() => (userData?.role === 'RECEPTIONIST' || !user?.uid ? [] : [user.uid]));
  const [note, setNote] = useState('');
  const [interest, setInterest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call({ visitId: v.id, action: 'attended', metByIds: ids, note, interest });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-md max-h-full overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><Handshake className="w-5 h-5 text-teal-600" />{t('branchVisits.lead.receiveTitle')}</h3>
        <p className="text-sm text-slate-600">{v.parentName} — {v.students}</p>
        <StaffPicker visit={{ branch: v.branch, assignedTo: [] }} value={ids} onChange={setIds} label={t('branchVisits.lead.receivedBy')} />
        {platform && (
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('branchVisits.lead.interest')}</label>
            <select value={interest} onChange={(e) => setInterest(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm">
              <option value="">—</option>
              {INTEREST_LEVELS.map((x) => <option key={x} value={x}>{t(`platform.leads.interest.${x}`)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-slate-600 mb-1">{t('branchVisits.receptionNote')}</label>
          <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" />
        </div>
        <p className="text-xs text-slate-500">{t('branchVisits.lead.receiveHint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
          <button disabled={busy || !ids.length} onClick={save} className="px-5 py-2 text-sm rounded-xl bg-teal-600 text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('branchVisits.lead.receive')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeadVisitRow({ v, branchName, now, todayKey, platform, onChanged }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [receiving, setReceiving] = useState(false);
  const waiting = v.status === 'ARRIVED';
  const open = LEAD_OPEN.includes(v.status);
  const due = v.dayKey <= todayKey; // today's (or a past day's) appointment
  const time = (ms) => format(new Date(ms), 'h:mm a', { locale: dateLocale });

  const run = (action, confirmText) => async (e) => {
    e.stopPropagation();
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setError(null);
    try {
      await call({ visitId: v.id, action });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const tone = waiting ? 'rose' : v.status === 'ATTENDED' ? 'teal' : v.status === 'NO_SHOW' ? 'slate' : v.status === 'REQUESTED' ? 'amber' : 'emerald';
  const pill = {
    rose: 'bg-rose-100 text-rose-700 border-rose-200', teal: 'bg-teal-100 text-teal-700 border-teal-200', slate: 'bg-slate-100 text-slate-600 border-slate-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[tone];
  const Icon = waiting ? Armchair : v.status === 'ATTENDED' ? Handshake : v.status === 'NO_SHOW' ? UserX : UserPlus;
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50';

  return (
    <li className={`p-4 flex flex-col md:flex-row md:items-center gap-3 ${waiting ? 'bg-rose-50/40' : 'bg-emerald-50/20'}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${waiting ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
          {v.parentName}
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-600 text-white">{t('branchVisits.lead.badge')}</span>
          {v.phone && <a href={`tel:${localPhone(v.phone)}`} className="text-sm font-normal text-slate-500 inline-flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" />{localPhone(v.phone)}</a>}
        </p>
        <p className="text-sm text-slate-600">{t('branchVisits.lead.studentsLine', { students: v.students || '—', branch: branchName(v.branch) })}</p>
        <p className="text-sm text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t(`platform.visits.types.${v.type}`, v.type)} — {v.at ? <>{format(new Date(v.at), 'EEEE d MMMM', { locale: dateLocale })} <span dir="ltr">{time(v.at)}</span></> : '—'}</span>
          {v.host && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{t('branchVisits.lead.host')}: {v.host}</span>}
          {v.assignedToName && <span>{t('branchVisits.lead.officer')}: {v.assignedToName}</span>}
          {v.leadCode && <span dir="ltr" className="font-mono text-xs">{v.leadCode}</span>}
        </p>
        {v.notes && <p className="text-xs text-slate-500">{v.notes}</p>}
        {v.status === 'ATTENDED' && v.metByName && <p className="text-sm font-medium text-teal-700 mt-1">{t('branchVisits.lead.receivedBy')}: {v.metByName}</p>}
      </div>
      <div className="md:text-left shrink-0 space-y-1">
        <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${pill}`}>{t(`branchVisits.lead.status.${v.status}`, v.status)}</span>
        {v.status === 'REQUESTED' && <p className="text-[11px] text-amber-700 max-w-xs">{t('branchVisits.lead.requestedHint')}</p>}
        {v.arrivedAt && (
          <p className="text-xs text-slate-500">{t('branchVisits.lead.arrivedAt')} <span dir="ltr">{time(v.arrivedAt)}</span>{v.arrivedByName && ` · ${v.arrivedByName}`}</p>
        )}
        {waiting && v.arrivedAt && <p className="text-xs font-bold text-rose-600">{t('branchVisits.waitingForText', { time: formatMinutes(minutesBetween(v.arrivedAt, now), t) })}</p>}
        {v.status === 'ATTENDED' && v.metAt && (
          <p className="text-xs text-teal-700">
            {t('branchVisits.lead.receivedAt')} <span dir="ltr">{time(v.metAt)}</span>
            {v.arrivedAt && ` · ${t('branchVisits.waitedText', { time: formatMinutes(minutesBetween(v.arrivedAt, v.metAt), t) })}`}
          </p>
        )}
        {['ATTENDED', 'NO_SHOW'].includes(v.status) && v.statusByName && <p className="text-[11px] text-slate-400">{t('branchVisits.lead.recordedBy', { name: v.statusByName })}</p>}
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          {open && due && (
            <button disabled={!!busy} onClick={run('arrived')} className={`${btn} bg-rose-600 text-white`}>
              {busy === 'arrived' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DoorOpen className="w-3.5 h-3.5" />}{t('branchVisits.lead.arrived')}
            </button>
          )}
          {(waiting || (open && due) || v.status === 'NO_SHOW') && (
            <button disabled={!!busy} onClick={(e) => { e.stopPropagation(); setReceiving(true); }} className={`${btn} ${waiting ? 'bg-teal-600 text-white' : 'bg-white border border-teal-300 text-teal-700 hover:bg-teal-50'}`}>
              <Handshake className="w-3.5 h-3.5" />{t('branchVisits.lead.receive')}
            </button>
          )}
          {open && v.at && v.at < now && (
            <button disabled={!!busy} onClick={run('noShow', t('branchVisits.lead.noShowConfirm'))} className={`${btn} bg-white border border-slate-300 text-slate-600 hover:bg-slate-50`}>
              {busy === 'noShow' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}{t('branchVisits.lead.noShow')}
            </button>
          )}
          {platform && v.leadId && (
            <Link to={`/platform/leads?openId=${v.leadId}`} onClick={(e) => e.stopPropagation()} className={`${btn} bg-white border border-primary/30 text-primary`}>
              <FolderOpen className="w-3.5 h-3.5" />{t('branchVisits.lead.openFile')}
            </Link>
          )}
        </div>
        {open && !due && (
          <p className="text-[11px] text-slate-400 flex items-center gap-1 md:justify-end"><MapPin className="w-3 h-3" />{t('branchVisits.lead.upcoming')}</p>
        )}
        {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
      </div>
      {receiving && <ReceiveDialog v={v} platform={platform} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); onChanged(); }} />}
    </li>
  );
}
