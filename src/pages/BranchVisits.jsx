import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Armchair, Handshake, Clock, CalendarDays, CalendarPlus, Phone, Loader2, CheckCircle2, HeartHandshake, Building2, UserCog, Pencil, UserPlus } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db, functions } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { scopeConstraints, userBranches } from '../utils/scope';
import StaffPicker from '../components/visits/StaffPicker';
import StatCard from '../components/dashboard/StatCard';
import { formatMinutes } from '../utils/duration';
import { normalizeAssignees } from '../utils/assignees';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import AppointmentPicker from '../components/appointments/AppointmentPicker';
import VisitDeclineDialog from '../components/visits/VisitDeclineDialog';
import VisitRequestsPanel from '../components/visits/VisitRequestsPanel';
import PageHero from '../components/common/PageHero';
import LeadVisitRow, { LEAD_OPEN } from '../components/visits/LeadVisitRow';

const isToday = (ts) => {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const minutesBetween = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const isTodayMs = (ms) => !!ms && new Date(ms).toDateString() === new Date().toDateString();
// Order of the merged list: waiting now, then the coming appointments
// (earliest first), then the finished visits (latest first).
const rankOf = (item) => (item.kind === 'lead'
  ? (item.v.status === 'ARRIVED' ? 0 : LEAD_OPEN.includes(item.v.status) ? 1 : 2)
  : (item.v.visitStatus === 'WAITING' ? 0 : 2));

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
  const [metByIds, setMetByIds] = useState(() => (visit.visitInterviewerIds?.length ? visit.visitInterviewerIds
    : (visit.assignedTo || []).length === 1 ? [visit.assignedTo[0]] : []));
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
        <StaffPicker visit={visit} value={metByIds} onChange={setMetByIds} />
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

// Picks who will meet a waiting parent, or corrects who met them after the
// visit was confirmed (setVisitInterviewer).
function InterviewerDialog({ visit, onClose }) {
  const { t } = useTranslation();
  const met = visit.visitStatus === 'MET';
  const [ids, setIds] = useState(() => (met ? (visit.visitMetByIds?.length ? visit.visitMetByIds : [visit.visitMetBy].filter(Boolean)) : visit.visitInterviewerIds || []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'setVisitInterviewer')({ complaintDocId: visit.id, ids });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><UserCog className="w-5 h-5 text-primary" />{t(met ? 'branchVisits.editInterviewerTitle' : 'branchVisits.pickInterviewerTitle')}</h3>
        <p className="text-sm text-slate-600">{t('branchVisits.confirmFor', { parent: visit.parentName, student: visit.studentName })}</p>
        <StaffPicker visit={visit} value={ids} onChange={setIds} />
        <p className="text-xs text-slate-500">{t(met ? 'branchVisits.editInterviewerHint' : 'branchVisits.pickInterviewerHint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
          <button disabled={busy || !ids.length} onClick={save} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{t('common.save')}
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
  const [declining, setDeclining] = useState(null);
  const [picking, setPicking] = useState(null);
  const [branchFilter, setBranchFilter] = useState('');
  // Staff open the visit's full record; reception only sees this list.
  const [openId, setOpenId] = useState(null);
  const isReceptionist = userData?.role === 'RECEPTIONIST';
  // New-registration visits (leadVisits, through listBranchLeadVisits):
  // «زيارة عميل تسجيل جديد» rows in the same list.
  const [leadVisits, setLeadVisits] = useState([]);
  const [platformUser, setPlatformUser] = useState(false);
  const [kindFilter, setKindFilter] = useState('ALL');
  const loadLeadVisits = useCallback(() => {
    httpsCallable(functions, 'listBranchLeadVisits')({}).then(({ data }) => {
      setLeadVisits(data.visits || []);
      setPlatformUser(data.platform === true);
    }).catch((err) => console.error(err));
  }, []);
  useEffect(() => {
    if (!userData) return undefined;
    loadLeadVisits();
    const id = setInterval(loadLeadVisits, 60000);
    return () => clearInterval(id);
  }, [userData, loadLeadVisits]);
  const todayKey = format(new Date(now), 'yyyy-MM-dd');

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

  // Branches this user can pick from (all for admins / all-branch access).
  const branchOptions = (userData?.role === 'ADMIN' || userData?.access === 'all') ? branches : branches.filter((b) => userBranches(userData).includes(b.id));
  const scoped = useMemo(() => (branchFilter ? visits.filter((v) => v.branch === branchFilter) : visits), [visits, branchFilter]);
  const scopedLeads = useMemo(() => (branchFilter ? leadVisits.filter((v) => v.branch === branchFilter) : leadVisits), [leadVisits, branchFilter]);

  const stats = useMemo(() => {
    const visits = scoped;
    const today = visits.filter((v) => isToday(v.visitArrivedAt));
    const metToday = today.filter((v) => v.visitStatus === 'MET' && v.visitMetAt);
    // Today's visits: arrival → meeting, or → now for those still waiting.
    const waits = today.map((v) => minutesBetween(v.visitArrivedAt.toMillis(), v.visitStatus === 'MET' && v.visitMetAt ? v.visitMetAt.toMillis() : now));
    // New-registration families who checked in today count like the others.
    const leadsIn = scopedLeads.filter((v) => isTodayMs(v.arrivedAt) || (v.status === 'ATTENDED' && isTodayMs(v.metAt)));
    leadsIn.filter((v) => v.arrivedAt).forEach((v) => waits.push(minutesBetween(v.arrivedAt, v.status === 'ATTENDED' && v.metAt ? v.metAt : now)));
    return {
      waiting: visits.filter((v) => v.visitStatus === 'WAITING').length + scopedLeads.filter((v) => v.status === 'ARRIVED').length,
      today: today.length + leadsIn.length,
      metToday: metToday.length + leadsIn.filter((v) => v.status === 'ATTENDED').length,
      avgWait: waits.length ? Math.round(waits.reduce((s, m) => s + m, 0) / waits.length) : null,
      newRegToday: scopedLeads.filter((v) => v.dayKey === todayKey).length,
    };
  }, [scoped, scopedLeads, now, todayKey]);

  const leadStatusOf = { WAITING: ['ARRIVED'], MET: ['ATTENDED'], NOT_MET: ['NO_SHOW'], SCHEDULED: LEAD_OPEN };
  const shown = [
    ...(kindFilter === 'NEW_REG' ? [] : scoped.filter((v) => (range === 'ALL' || isToday(v.visitArrivedAt) || v.visitStatus === 'WAITING')
      && (statusFilter === 'ALL' || v.visitStatus === statusFilter)).map((v) => ({ kind: 'walkin', v, at: v.visitArrivedAt?.toMillis?.() || 0 }))),
    ...(kindFilter === 'PARENTS' ? [] : scopedLeads.filter((v) => (range === 'ALL' || v.dayKey === todayKey || v.status === 'ARRIVED')
      && (statusFilter === 'ALL' || leadStatusOf[statusFilter]?.includes(v.status))).map((v) => ({ kind: 'lead', v, at: v.arrivedAt || v.at || 0 }))),
  ].sort((a, b) => rankOf(a) - rankOf(b) || (rankOf(a) === 1 ? a.at - b.at : b.at - a.at));

  const chip = (active, onClick, label) => (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${active ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHero
        icon={Armchair}
        title={t('branchVisits.title')}
        subtitle={t('branchVisits.subtitle')}
        facts={[{ label: t('branchVisits.waitingNow'), value: stats.waiting, tone: 'red' }, { label: t('branchVisits.today'), value: stats.today }, { label: t('branchVisits.metToday'), value: stats.metToday, tone: 'green' }, { label: t('branchVisits.newRegToday'), value: stats.newRegToday }]}
      />

      <VisitRequestsPanel />

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
          {chip(statusFilter === 'SCHEDULED', () => setStatusFilter('SCHEDULED'), t('branchVisits.statusScheduled'))}
          <span className="w-px h-6 bg-slate-200 mx-1" />
          {chip(kindFilter === 'ALL', () => setKindFilter('ALL'), t('branchVisits.kindAll'))}
          {chip(kindFilter === 'PARENTS', () => setKindFilter('PARENTS'), t('branchVisits.kindParents'))}
          {chip(kindFilter === 'NEW_REG', () => setKindFilter('NEW_REG'), <span className="inline-flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" />{t('branchVisits.kindNewReg')}</span>)}
          {branchOptions.length > 1 && (
            <>
              <span className="w-px h-6 bg-slate-200 mx-1" />
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <Building2 className="w-4 h-4" />
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="">{t('common.allBranches')}</option>
                  {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </>
          )}
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-slate-400 text-sm">{t('branchVisits.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((item) => {
              if (item.kind === 'lead') {
                return <LeadVisitRow key={`lead-${item.v.id}`} v={item.v} branchName={branchName} now={now} todayKey={todayKey} platform={platformUser} onChanged={loadLeadVisits} />;
              }
              const v = item.v;
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
                      <p className="text-sm font-medium text-teal-700 mt-1 flex flex-wrap items-center gap-1.5">
                        {t('branchVisits.interviewer')}: {v.visitMetByName}
                        {v.visitStatus === 'MET' && (
                          <button onClick={(e) => { e.stopPropagation(); setPicking(v); }} title={t('branchVisits.editInterviewer')} className="px-2 py-0.5 rounded-md border border-teal-200 text-xs font-normal text-teal-700 hover:bg-teal-50 inline-flex items-center gap-1">
                            <Pencil className="w-3 h-3" />{t('branchVisits.editInterviewer')}
                          </button>
                        )}
                      </p>
                    ) : waiting && v.visitInterviewerName ? (
                      <p className="text-sm font-medium text-primary mt-1">{t('branchVisits.interviewer')}: {v.visitInterviewerName}</p>
                    ) : v.assignedToNames?.length > 0 && (
                      <p className="text-sm text-slate-600 mt-1">{t('branchVisits.expectedInterviewer')}: {v.assignedToNames.join(i18n.language === 'ar' ? '، ' : ', ')}</p>
                    )}
                  </div>
                  <div className="md:text-left shrink-0 space-y-1">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${waiting ? 'bg-rose-100 text-rose-700 border-rose-200' : notMet ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-teal-100 text-teal-700 border-teal-200'}`}>
                      {waiting ? t('branchVisits.statusWaiting') : notMet ? t('branchVisits.statusNotMet') : t('branchVisits.statusMet')}
                    </span>
                    {notMet && v.visitDeclineReason && (
                      <p className="text-xs text-rose-700 max-w-xs">{t('visitDecline.rowReason', { reason: v.visitDeclineReason })}</p>
                    )}
                    {notMet && !v.appointment?.start && v.visitNotMetMode === 'PARENT_BOOKS' && (
                      <p className="text-xs font-medium text-indigo-700">{t('visitDecline.rowParentBooks')}{v.visitNotMetByName && <span className="block text-[11px] text-slate-400 font-normal">{t('branchVisits.bookedBy', { name: v.visitNotMetByName })}</span>}</p>
                    )}
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
                        <button onClick={(e) => { e.stopPropagation(); setPicking(v); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-teal-300 text-teal-700 hover:bg-teal-50 flex items-center gap-1">
                          <UserCog className="w-3.5 h-3.5" />{t(v.visitInterviewerName ? 'branchVisits.changeInterviewer' : 'branchVisits.pickInterviewer')}
                        </button>
                        {!isReceptionist && (
                          <button onClick={(e) => { e.stopPropagation(); setDeclining(v); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 flex items-center gap-1">
                            <HeartHandshake className="w-3.5 h-3.5" />{t('visitDecline.button')}
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
                    {!waiting && v.visitMetEditedByName && (
                      <p className="text-[11px] text-slate-400">{t('branchVisits.interviewerEditedBy', { name: v.visitMetEditedByName })}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirming && <ConfirmMeetingDialog visit={confirming} onClose={() => setConfirming(null)} />}
      {picking && <InterviewerDialog visit={picking} onClose={() => setPicking(null)} />}
      {booking && <BookMeetingDialog visit={booking} onClose={() => setBooking(null)} />}
      {declining && <VisitDeclineDialog visit={declining} branchName={branchName(declining.branch)} onClose={() => setDeclining(null)} />}
      {openId && visits.find((v) => v.id === openId) && (
        <ComplaintDetails complaint={visits.find((v) => v.id === openId)} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
