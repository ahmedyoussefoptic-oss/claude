import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Armchair, Handshake, Clock, CalendarDays, CalendarPlus, Phone, Loader2, CheckCircle2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db, functions } from '../config/firebase';
import { useUsers } from '../hooks/useUsers';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { scopeConstraints, userBranches } from '../utils/scope';
import StatCard from '../components/dashboard/StatCard';
import { formatMinutes } from '../utils/duration';
import { normalizeAssignees } from '../utils/assignees';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import AppointmentPicker from '../components/appointments/AppointmentPicker';

const isToday = (ts) => {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000));

// The parent couldn't be met during a walk-in visit: book a confirmed
// meeting slot on the same record (bookMeetingFromVisit). The parent gets
// the WhatsApp confirmation and checks in with "I have an appointment".
function BookMeetingDialog({ visit, onClose }) {
  const { t } = useTranslation();
  const [slot, setSlot] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'bookMeetingFromVisit')({ complaintDocId: visit.id, slot, note });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><CalendarPlus className="w-5 h-5 text-indigo-600" />{t('branchVisits.bookTitle')}</h3>
        <p className="text-sm text-slate-600">{t('branchVisits.confirmFor', { parent: visit.parentName, student: visit.studentName })}</p>
        <AppointmentPicker branch={visit.branch} value={slot} onChange={setSlot} />
        <div>
          <label className="block text-xs text-slate-600 mb-1">{t('branchVisits.bookNote')}</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" />
        </div>
        <p className="text-xs text-slate-500">{t('branchVisits.bookHint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
          <button disabled={busy || !slot} onClick={book} className="px-5 py-2 text-sm rounded-xl bg-indigo-600 text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}{t('branchVisits.bookButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reception confirms that the parent was met and by whom (confirmBranchVisit);
// that staff member then writes the meeting summary and solution.
function ConfirmMeetingDialog({ visit, onClose }) {
  const { t } = useTranslation();
  const users = useUsers();
  const assigned = (visit.assignedTo || []).map((id, i) => ({ id, name: users.find((u) => u.id === id)?.name || visit.assignedToNames?.[i] || id }));
  const others = users
    .filter((u) => u.active !== false && u.role !== 'RECEPTIONIST' && u.tripsAccess !== 'tripsOnly' && !(visit.assignedTo || []).includes(u.id)
      && (u.access === 'all' || userBranches(u).includes(visit.branch)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  const [metByIds, setMetByIds] = useState(assigned.length === 1 ? [assigned[0].id] : []);
  const toggle = (id) => setMetByIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'confirmBranchVisit')({ complaintDocId: visit.id, metByIds, notes });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900">{t('branchVisits.confirmTitle')}</h3>
        <p className="text-sm text-slate-600">{t('branchVisits.confirmFor', { parent: visit.parentName, student: visit.studentName })}</p>
        <div>
          <label className="block text-xs text-slate-600 mb-1">{t('branchVisits.metWith')}</label>
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-2">
            {[[t('branchVisits.assignedGroup'), assigned], [t('branchVisits.otherStaff'), others.map((u) => ({ id: u.id, name: u.name || u.email }))]].map(([label, list]) => list.length > 0 && (
              <div key={label}>
                <p className="text-[11px] font-bold text-slate-400 mb-1">{label}</p>
                {list.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-slate-700 py-0.5 cursor-pointer">
                    <input type="checkbox" checked={metByIds.includes(u.id)} onChange={() => toggle(u.id)} />
                    {u.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
          {metByIds.length > 1 && <p className="text-xs text-teal-700 mt-1">{t('branchVisits.selectedCount', { n: metByIds.length })}</p>}
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">{t('branchVisits.receptionNote')}</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" />
        </div>
        <p className="text-xs text-slate-500">{t('branchVisits.confirmHint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
          <button disabled={busy || !metByIds.length} onClick={confirm} className="px-5 py-2 text-sm rounded-xl bg-teal-600 text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('branchVisits.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Branch QR check-ins (see BranchVisit.jsx / confirmBranchVisit) — the only
// page a reception employee (role RECEPTIONIST) can open, and firestore.rules
// only lets them list complaints flagged viaVisitQr. Shows who is waiting,
// for how long, and who met them — never the complaint details, internal
// comments or solution.
export default function BranchVisits() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('TODAY');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(null);
  const [booking, setBooking] = useState(null);
  // Staff open the visit's full record; reception only sees this list.
  const [openId, setOpenId] = useState(null);
  const isReceptionist = userData?.role === 'RECEPTIONIST';

  // Keeps the "waiting for X minutes" figures moving.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!userData) return;
    const constraints = [where('viaVisitQr', '==', true)];
    constraints.push(...scopeConstraints(userData, { adminAll: true }));
    const unsubscribe = onSnapshot(query(collection(db, 'complaints'), ...constraints), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data(), ...normalizeAssignees(d.data()) }));
      list.sort((a, b) => (b.visitArrivedAt?.toMillis?.() || 0) - (a.visitArrivedAt?.toMillis?.() || 0));
      setVisits(list);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.role, userData?.access, userData?.branches?.join(','), userData?.recordScope]);

  const stats = useMemo(() => {
    const today = visits.filter((v) => isToday(v.visitArrivedAt));
    const metToday = today.filter((v) => v.visitStatus === 'MET' && v.visitMetAt);
    // Today's visits: arrival → meeting, or → now for those still waiting.
    const waits = today.map((v) => minutesBetween(v.visitArrivedAt.toMillis(), v.visitStatus === 'MET' && v.visitMetAt ? v.visitMetAt.toMillis() : now));
    return {
      waiting: visits.filter((v) => v.visitStatus === 'WAITING').length,
      today: today.length,
      metToday: metToday.length,
      avgWait: waits.length ? Math.round(waits.reduce((s, m) => s + m, 0) / waits.length) : null,
    };
  }, [visits, now]);

  const shown = visits.filter((v) => (range === 'ALL' || isToday(v.visitArrivedAt) || v.visitStatus === 'WAITING')
    && (statusFilter === 'ALL' || v.visitStatus === statusFilter));

  const chip = (active, onClick, label) => (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${active ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Armchair className="w-6 h-6 text-primary" />
          {t('branchVisits.title')}
        </h1>
        <p className="text-slate-500 mt-1">{t('branchVisits.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t('branchVisits.waitingNow')} value={String(stats.waiting)} icon={Armchair} gradient="from-rose-500 to-red-600" />
        <StatCard title={t('branchVisits.today')} value={String(stats.today)} icon={CalendarDays} gradient="from-sky-500 to-blue-600" />
        <StatCard title={t('branchVisits.metToday')} value={String(stats.metToday)} icon={Handshake} gradient="from-emerald-500 to-teal-600" />
        <StatCard title={t('branchVisits.avgWait')} value={stats.avgWait == null ? formatMinutes(0, t) : formatMinutes(stats.avgWait, t)} sub={stats.avgWait == null ? t('branchVisits.noVisitsToday') : undefined} icon={Clock} gradient="from-amber-400 to-orange-500" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {chip(range === 'TODAY', () => setRange('TODAY'), t('branchVisits.rangeToday'))}
          {chip(range === 'ALL', () => setRange('ALL'), t('branchVisits.rangeAll'))}
          <span className="w-px h-6 bg-slate-200 mx-1" />
          {chip(statusFilter === 'ALL', () => setStatusFilter('ALL'), t('branchVisits.statusAll'))}
          {chip(statusFilter === 'WAITING', () => setStatusFilter('WAITING'), t('branchVisits.statusWaiting'))}
          {chip(statusFilter === 'MET', () => setStatusFilter('MET'), t('branchVisits.statusMet'))}
          {chip(statusFilter === 'NOT_MET', () => setStatusFilter('NOT_MET'), t('branchVisits.statusNotMet'))}
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-slate-400 text-sm">{t('branchVisits.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((v) => {
              const waiting = v.visitStatus === 'WAITING';
              const notMet = v.visitStatus === 'NOT_MET';
              const arrived = v.visitArrivedAt?.toMillis?.();
              return (
                <li
                  key={v.id}
                  onClick={isReceptionist ? undefined : () => setOpenId(v.id)}
                  className={`p-4 flex flex-col md:flex-row md:items-center gap-3 ${waiting ? 'bg-rose-50/40' : ''} ${isReceptionist ? '' : 'cursor-pointer hover:bg-slate-50 transition-colors'}`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${waiting ? 'bg-rose-100 text-rose-600' : notMet ? 'bg-indigo-100 text-indigo-600' : 'bg-teal-100 text-teal-600'}`}>
                    {waiting ? <Armchair className="w-5 h-5" /> : notMet ? <CalendarPlus className="w-5 h-5" /> : <Handshake className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900">
                      {v.parentName}
                      {v.parentPhone && <a href={`tel:${v.parentPhone}`} onClick={(e) => e.stopPropagation()} className="text-sm font-normal text-slate-500 mr-2 inline-flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" />{v.parentPhone}</a>}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {t('branchVisits.studentLine', { student: v.studentName, grade: [v.stage, v.grade].filter(Boolean).join(' — '), branch: branchName(v.branch) })}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">{t('branchVisits.reason')}: {v.subject}</p>
                    {!waiting && v.visitMetByName ? (
                      <p className="text-sm font-medium text-teal-700 mt-1">{t('branchVisits.interviewer')}: {v.visitMetByName}</p>
                    ) : v.assignedToNames?.length > 0 && (
                      <p className="text-sm text-slate-600 mt-1">{t('branchVisits.expectedInterviewer')}: {v.assignedToNames.join(i18n.language === 'ar' ? '، ' : ', ')}</p>
                    )}
                  </div>
                  <div className="md:text-left shrink-0 space-y-1">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${waiting ? 'bg-rose-100 text-rose-700 border-rose-200' : notMet ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-teal-100 text-teal-700 border-teal-200'}`}>
                      {waiting ? t('branchVisits.statusWaiting') : notMet ? t('branchVisits.statusNotMet') : t('branchVisits.statusMet')}
                    </span>
                    {notMet && v.appointment?.start && (
                      <p className="text-xs font-medium text-indigo-700">
                        {t('branchVisits.meetingBooked', { when: format(v.appointment.start.toDate(), 'EEEE d MMMM · p', { locale: dateLocale }) })}
                        {v.visitNotMetByName && <span className="block text-[11px] text-slate-400 font-normal">{t('branchVisits.bookedBy', { name: v.visitNotMetByName })}</span>}
                      </p>
                    )}
                    {arrived && (
                      <p className="text-xs text-slate-500">
                        {t('branchVisits.arrived', { time: format(v.visitArrivedAt.toDate(), 'p', { locale: dateLocale }) })}
                        {!isToday(v.visitArrivedAt) && ` · ${format(v.visitArrivedAt.toDate(), 'PP', { locale: dateLocale })}`}
                      </p>
                    )}
                    {waiting && arrived && (
                      <p className="text-xs font-bold text-rose-600">{t('branchVisits.waitingForText', { time: formatMinutes(minutesBetween(arrived, now), t) })}</p>
                    )}
                    {waiting && (
                      <div className="flex flex-wrap gap-1.5 md:justify-end">
                        {isReceptionist && (
                          <button onClick={(e) => { e.stopPropagation(); setConfirming(v); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 text-white flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />{t('branchVisits.confirmButton')}
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setBooking(v); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 flex items-center gap-1">
                          <CalendarPlus className="w-3.5 h-3.5" />{t('branchVisits.bookButton')}
                        </button>
                      </div>
                    )}
                    {!waiting && v.visitMetAt && (
                      <p className="text-xs text-teal-700">
                        {t('branchVisits.metBy', { name: v.visitMetByName || '—', time: format(v.visitMetAt.toDate(), 'p', { locale: dateLocale }) })}
                        {arrived && ` · ${t('branchVisits.waitedText', { time: formatMinutes(minutesBetween(arrived, v.visitMetAt.toMillis()), t) })}`}
                      </p>
                    )}
                    {!waiting && v.visitConfirmedByName && (
                      <p className="text-[11px] text-slate-400">{t('branchVisits.confirmedByReception', { name: v.visitConfirmedByName })}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirming && <ConfirmMeetingDialog visit={confirming} onClose={() => setConfirming(null)} />}
      {booking && <BookMeetingDialog visit={booking} onClose={() => setBooking(null)} />}
      {openId && visits.find((v) => v.id === openId) && (
        <ComplaintDetails complaint={visits.find((v) => v.id === openId)} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
