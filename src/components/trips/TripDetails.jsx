import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import QRCode from 'qrcode';
import {
  X, Loader2, Pencil, Send, CheckCircle2, XCircle, Lock, Unlock, Flag, Ban, Link2, Copy, Check, QrCode, MessageCircle,
  AlertTriangle, MapPin, Clock, Users as UsersIcon, Wallet, Bus, FileDown, Printer, Paperclip, Search, UserPlus, Trash2, HeartPulse,
  Home, NotebookPen, Star, ThumbsUp, ClipboardList,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { useWhatsAppApi } from '../../hooks/useWhatsAppApi';
import logo from '../../assets/logo.png';
import {
  TRIP_STATUS_STYLES, ENROLLMENT_STATUSES, ENROLLMENT_STATUS_STYLES, TRIP_PAY_METHODS, TRIP_DECLINE_REASONS, TRIP_RATINGS,
  enrollmentStatus, tripPermissions, tripConflicts, tripLink, dayToDate,
} from '../../config/trips';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

function printHtml(title, body, extraCss = '') {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box } body { margin: 0; font-family: Tahoma, Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  ${extraCss}
</style></head><body>${body}<script>window.onload = () => { window.print(); }</script></body></html>`);
  win.document.close();
}

// Small dialog for a reason / note before a server action.
function NoteDialog({ title, label, required, onCancel, onConfirm, busy }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900">{title}</h3>
        <label className="block text-xs text-slate-600">{label}</label>
        <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
          <button disabled={busy || (required && !note.trim())} onClick={() => onConfirm(note.trim())} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Consent taken by phone / on paper (staffSetTripEnrollment).
function ManualConsentDialog({ trip, student, current, onCancel, onSaved }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState(current?.decision || 'APPROVED');
  const [declineReason, setDeclineReason] = useState(current?.declineReason || '');
  const [payMethod, setPayMethod] = useState(current?.payMethod || (trip.payMethods || [])[0] || 'RECEPTION');
  const [healthNotes, setHealthNotes] = useState(current?.healthNotes || '');
  const [emergencyPhone, setEmergencyPhone] = useState(current?.emergencyPhone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
    try {
      await call('staffSetTripEnrollment', { id: trip.id, studentId: student.id, decision, declineReason, payMethod, healthNotes, emergencyPhone, remove });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900">{t('trips.manual.title')}</h3>
        <p className="text-sm text-slate-600">{student.name} — <span dir="ltr">{student.grade} {student.className}</span></p>
        <div className="flex gap-2">
          {['APPROVED', 'DECLINED'].map((d) => (
            <button key={d} onClick={() => setDecision(d)} className={`flex-1 py-2 rounded-xl text-sm border ${decision === d ? (d === 'APPROVED' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-600 border-slate-200'}`}>
              {t(`trips.decision.${d}`)}
            </button>
          ))}
        </div>
        {decision === 'DECLINED' && (
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('tripConsent.declineReason')}</label>
            <select value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} className={inputCls}>
              <option value="">{t('common.optional')}</option>
              {TRIP_DECLINE_REASONS.map((r) => <option key={r} value={r}>{t(`trips.declineReason.${r}`)}</option>)}
            </select>
          </div>
        )}
        {decision === 'APPROVED' && trip.fee > 0 && (
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('trips.form.payMethods')}</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
              {TRIP_PAY_METHODS.map((m) => <option key={m} value={m}>{t(`trips.payMethod.${m}`)}</option>)}
            </select>
          </div>
        )}
        {decision === 'APPROVED' && (
          <>
            <div><label className="block text-xs text-slate-600 mb-1">{t('trips.healthNotes')}</label><input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-xs text-slate-600 mb-1">{t('trips.emergencyPhone')}</label><input dir="ltr" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} /></div>
          </>
        )}
        <p className="text-xs text-slate-400">{t('trips.manual.hint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-between gap-2">
          {current ? <button disabled={busy} onClick={() => save(true)} className="px-3 py-2 text-sm rounded-xl text-rose-600 hover:bg-rose-50 flex items-center gap-1"><Trash2 className="w-4 h-4" />{t('trips.manual.remove')}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
            <button disabled={busy} onClick={() => save(false)} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TripDetails({ tripId, listed, allTrips, onClose, onEdit, onChanged }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const users = useUsers();
  const waApi = useWhatsAppApi();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const sep = i18n.language === 'ar' ? '، ' : ', ';

  const [trip, setTrip] = useState(listed ? { ...listed, id: tripId } : null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [enrollments, setEnrollments] = useState({});
  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState(null);
  const [log, setLog] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [arrivalResult, setArrivalResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [copied, setCopied] = useState(false);
  const [announceResult, setAnnounceResult] = useState(null);
  const [studentFilter, setStudentFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const perms = tripPermissions(userData, trip, user?.uid);

  useEffect(() => onSnapshot(doc(db, 'trips', tripId), (snap) => {
    if (snap.exists()) setTrip({ id: snap.id, ...snap.data() });
    else setLoadError(t('trips.notFound'));
  }, (err) => setLoadError(err.message)), [tripId, t]);

  useEffect(() => {
    if (!perms.seeStudents) return undefined;
    return onSnapshot(collection(db, 'trips', tripId, 'enrollments'), (snap) => {
      setEnrollments(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])));
    }, (err) => console.error(err));
  }, [tripId, perms.seeStudents]);

  const surveyVisible = perms.seeStudents && trip?.status === 'COMPLETED';
  useEffect(() => {
    if (!surveyVisible) return undefined;
    return onSnapshot(collection(db, 'trips', tripId, 'surveys'), (snap) => {
      setSurveys(snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, (err) => console.error(err));
  }, [tripId, surveyVisible]);

  useEffect(() => onSnapshot(query(collection(db, 'trips', tripId, 'activityLog'), orderBy('createdAt', 'desc'), limit(40)), (snap) => {
    setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error(err)), [tripId]);

  const needRoster = perms.seeStudents && ['students', 'boarding'].includes(tab) && !roster;
  useEffect(() => {
    if (!needRoster) return;
    call('getTripRoster', { id: tripId }).then((d) => setRoster(d.students)).catch((err) => setRosterError(err.message));
  }, [needRoster, tripId]);

  const rows = useMemo(() => {
    if (!trip) return [];
    const list = (roster || []).map((s) => ({ ...s, e: enrollments[s.id] || null }));
    // Enrollments of students no longer on the roster (moved grade/branch).
    Object.entries(enrollments).forEach(([id, e]) => {
      if (!list.some((r) => r.id === id)) list.push({ id, name: e.studentName, grade: e.grade, className: e.className, branch: e.branch, e, offRoster: true });
    });
    return list.map((r) => ({ ...r, status: enrollmentStatus(r.e, trip.fee) }))
      .sort((a, b) => (a.grade || '').localeCompare(b.grade || '', 'en', { numeric: true }) || (a.className || '').localeCompare(b.className || '') || (a.name || '').localeCompare(b.name || '', 'ar'));
  }, [roster, enrollments, trip]);

  const counts = useMemo(() => Object.fromEntries(ENROLLMENT_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])), [rows]);

  if (!trip) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 z-[100] flex items-center justify-center">
        {loadError ? <div className="bg-white rounded-2xl p-6 text-sm text-red-600">{loadError} <button onClick={onClose} className="mr-3 underline">{t('common.close')}</button></div> : <Loader2 className="w-8 h-8 animate-spin text-white" />}
      </div>
    );
  }

  const run = async (key, fn) => {
    setBusy(key);
    setActionError(null);
    try {
      const result = await fn();
      await onChanged?.();
      return result;
    } catch (err) {
      setActionError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const action = (name, reason) => run(name, () => call('tripAction', { id: trip.id, action: name, reason }));
  const withReason = (name, title) => setDialog({ title, label: t('trips.reasonLabel'), required: true, onConfirm: async (reason) => { await action(name, reason); setDialog(null); } });
  const announce = (audience) => run(`announce-${audience}`, async () => {
    const result = await call('sendTripAnnouncement', { id: trip.id, audience });
    setAnnounceResult(result);
    return result;
  });
  const review = (studentId, act, note) => run(`pay-${studentId}`, () => call('reviewTripPayment', { id: trip.id, studentId, action: act, note }));
  const announceArrival = () => run('arrival', async () => {
    const result = await call('announceTripArrival', { id: trip.id });
    setArrivalResult(result);
    return result;
  });
  const sendSurvey = () => run('survey', async () => {
    const result = await call('sendTripSurvey', { id: trip.id });
    setAnnounceResult(result);
    return result;
  });
  const addIncident = (r) => setDialog({ title: t('trips.incidentTitle', { name: r.name }), label: t('trips.incidentLabel'), required: true, onConfirm: async (note) => { await run(`inc-${r.id}`, () => call('addTripIncident', { id: trip.id, studentId: r.id, note })); setDialog(null); } });
  const boarding = (studentId, field, value) => run(`board-${studentId}-${field}`, () => call('setTripBoarding', { id: trip.id, studentId, field, value }));

  const link = tripLink(trip.tripCode);
  const isPublic = ['OPEN', 'CLOSED', 'COMPLETED'].includes(trip.status);
  const conflicts = trip.status !== 'CANCELLED' ? tripConflicts(trip, allTrips) : [];
  const supervisorNames = (trip.supervisors || []).map((id) => users.find((u) => u.id === id)?.name).filter(Boolean);
  const stageText = (trip.stages || []).length ? trip.stages.join(', ') : t('trips.allGrades');
  const sectionText = (trip.departments || []).length ? trip.departments.map((d) => departments.find((x) => x.id === d)?.name || d).join(sep) : t('trips.allSections');
  const stats = trip.stats || {};
  const expected = (stats.approved || 0) * (trip.fee || 0);
  const shareMessage = t('trips.shareMessage', { title: trip.title, date: format(dayToDate(trip.date), 'EEEE d MMMM yyyy', { locale: dateLocale }), link });

  const copyLink = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  const printPoster = async () => {
    const qr = await QRCode.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: 'M' });
    const logoUrl = new URL(logo, window.location.origin).href;
    printHtml(trip.title, `<div class="page">
  <img class="logo" src="${logoUrl}" alt="">
  <h1>${escapeHtml(trip.title)}</h1>
  <div class="sub">${escapeHtml(trip.destination)} — ${escapeHtml(format(dayToDate(trip.date), 'EEEE d MMMM yyyy', { locale: dateLocale }))}</div>
  <img class="qr" src="${qr}" alt="">
  <p class="hint">${escapeHtml(t('trips.posterHint'))}</p>
</div>`, `@page { size: A4; margin: 0 } .page { width: 210mm; height: 297mm; padding: 22mm 18mm; display: flex; flex-direction: column; align-items: center; text-align: center; border: 10mm solid #0369a1 }
  img.logo { height: 26mm } h1 { font-size: 28pt; margin: 10mm 0 3mm } .sub { font-size: 16pt; color: #0369a1; font-weight: bold; margin-bottom: 8mm }
  img.qr { width: 120mm; height: 120mm; border: 2mm solid #e2e8f0; border-radius: 6mm; padding: 4mm } .hint { font-size: 15pt; margin-top: 9mm; line-height: 1.8 }`);
  };

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const data = rows.map((r) => ({
      [t('trips.col.student')]: r.name,
      [t('trips.col.nationalId')]: r.id,
      [t('trips.col.branch')]: branchName(r.branch),
      [t('trips.col.grade')]: r.grade,
      [t('trips.col.class')]: r.className,
      [t('trips.col.status')]: t(`trips.enrollment.${r.status}`),
      [t('trips.col.payMethod')]: r.e?.payMethod ? t(`trips.payMethod.${r.e.payMethod}`) : '',
      [t('trips.col.paid')]: r.e?.payStatus === 'PAID' ? (r.e.paidAmount ?? trip.fee) : '',
      [t('trips.healthNotes')]: r.e?.healthNotes || '',
      [t('trips.emergencyPhone')]: r.e?.emergencyPhone || '',
      [t('trips.col.boarded')]: r.e?.boarded === true ? '✓' : r.e?.boarded === false ? '✗' : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, `${trip.tripCode}.xlsx`);
  };

  const confirmedRows = rows.filter((r) => r.status === 'CONFIRMED');
  const printBoarding = () => {
    const body = `<div style="padding:12mm">
  <h2 style="margin:0 0 2mm">${escapeHtml(trip.title)} — ${escapeHtml(t('trips.boardingList'))}</h2>
  <p style="margin:0 0 6mm;color:#475569">${escapeHtml(format(dayToDate(trip.date), 'EEEE d MMMM yyyy', { locale: dateLocale }))} · ${escapeHtml(trip.departTime || '')} · ${confirmedRows.length} ${escapeHtml(t('trips.students'))}</p>
  <table><thead><tr><th>#</th><th>${escapeHtml(t('trips.col.student'))}</th><th>${escapeHtml(t('trips.col.grade'))}</th><th>${escapeHtml(t('trips.healthNotes'))}</th><th>${escapeHtml(t('trips.emergencyPhone'))}</th><th>${escapeHtml(t('trips.col.boarded'))}</th><th>${escapeHtml(t('trips.col.returned'))}</th></tr></thead>
  <tbody>${confirmedRows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td dir="ltr">${escapeHtml(`${r.grade || ''} ${r.className || ''}`)}</td><td>${escapeHtml(r.e?.healthNotes || '')}</td><td dir="ltr">${escapeHtml(r.e?.emergencyPhone || '')}</td><td></td><td></td></tr>`).join('')}</tbody></table></div>`;
    printHtml(trip.title, body, `@page { size: A4; margin: 10mm } table { width: 100%; border-collapse: collapse; font-size: 10pt } th, td { border: 1px solid #cbd5e1; padding: 2mm; text-align: right } th { background: #f1f5f9 } td:nth-child(6), td:nth-child(7) { width: 16mm }`);
  };

  const tabs = [
    ['overview', t('trips.tabOverview')],
    ...(perms.seeStudents ? [['students', t('trips.tabStudents')]] : []),
    ...(perms.supervise && isPublic ? [['boarding', t('trips.tabBoarding')]] : []),
    ...(surveyVisible ? [['survey', t('trips.tabSurvey')]] : []),
  ];
  const btn = 'px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 disabled:opacity-50';
  const spin = (key, Icon) => (busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />);
  const filtered = rows.filter((r) => (studentFilter === 'ALL' || r.status === studentFilter)
    && (!search.trim() || (r.name || '').includes(search.trim()) || r.id.includes(search.trim()) || (r.className || '').toLowerCase().includes(search.trim().toLowerCase())));

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-0 md:p-6">
      <div className="w-full max-w-6xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full md:h-auto md:max-h-full">
        <div className="px-5 md:px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{trip.title}</h2>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${TRIP_STATUS_STYLES[trip.status]}`}>{t(`trips.status.${trip.status}`)}</span>
              <span className="text-xs font-mono text-slate-400" dir="ltr">{trip.tripCode}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{trip.destination}</span>
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{format(dayToDate(trip.date), 'EEEE d MMMM yyyy', { locale: dateLocale })}{trip.departTime && ` · ${trip.departTime}–${trip.returnTime || ''}`}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl shrink-0"><X className="w-6 h-6" /></button>
        </div>

        <div className="px-5 md:px-6 border-b border-slate-200 flex gap-1 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-5">
          {actionError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{actionError}</div>}

          {tab === 'overview' && (
            <>
              {trip.status === 'DRAFT' && trip.rejectionReason && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{t('trips.rejectedNote', { name: trip.rejectedByName || '', reason: trip.rejectionReason })}</div>
              )}
              {trip.status === 'CANCELLED' && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{t('trips.cancelledNote', { name: trip.cancelledByName || '', reason: trip.cancelReason || '' })}</div>
              )}
              {conflicts.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{t('trips.conflictWarning', { list: conflicts.map((c) => `${c.title} (${(c.stages || []).join(', ') || t('trips.allGrades')})`).join(sep) })}</div>
              )}

              <div className="flex flex-wrap gap-2">
                {perms.manage && ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED'].includes(trip.status) && (
                  <button onClick={() => onEdit(trip)} className={`${btn} border border-slate-300 bg-white text-slate-700`}><Pencil className="w-4 h-4" />{t('common.edit')}</button>
                )}
                {perms.manage && trip.status === 'DRAFT' && (
                  <button disabled={!!busy} onClick={() => action('submit')} className={`${btn} bg-amber-500 text-white`}>{spin('submit', Send)}{t('trips.actions.submit')}</button>
                )}
                {perms.approve && trip.status === 'PENDING_APPROVAL' && (
                  <>
                    <button disabled={!!busy} onClick={() => action('approve')} className={`${btn} bg-emerald-600 text-white`}>{spin('approve', CheckCircle2)}{t('trips.actions.approve')}</button>
                    <button disabled={!!busy} onClick={() => withReason('reject', t('trips.actions.reject'))} className={`${btn} bg-rose-50 text-rose-700 border border-rose-200`}><XCircle className="w-4 h-4" />{t('trips.actions.reject')}</button>
                  </>
                )}
                {perms.manage && trip.status === 'OPEN' && (
                  <button disabled={!!busy} onClick={() => action('close')} className={`${btn} bg-sky-600 text-white`}>{spin('close', Lock)}{t('trips.actions.close')}</button>
                )}
                {perms.manage && trip.status === 'CLOSED' && (
                  <button disabled={!!busy} onClick={() => action('reopen')} className={`${btn} border border-slate-300 bg-white text-slate-700`}>{spin('reopen', Unlock)}{t('trips.actions.reopen')}</button>
                )}
                {perms.manage && ['OPEN', 'CLOSED'].includes(trip.status) && trip.date <= format(new Date(), 'yyyy-MM-dd') && (
                  <button disabled={!!busy} onClick={() => action('complete')} className={`${btn} bg-indigo-600 text-white`}>{spin('complete', Flag)}{t('trips.actions.complete')}</button>
                )}
                {perms.manage && ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED'].includes(trip.status) && (
                  <button disabled={!!busy} onClick={() => withReason('cancel', t('trips.actions.cancel'))} className={`${btn} text-rose-600 hover:bg-rose-50`}><Ban className="w-4 h-4" />{t('trips.actions.cancel')}</button>
                )}
              </div>
              {trip.status === 'PENDING_APPROVAL' && !perms.approve && <p className="text-sm text-amber-700">{t('trips.awaitingApproval')}</p>}

              {isPublic && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    [t('trips.statResponses'), `${stats.responses || 0}`, UsersIcon, 'text-slate-700'],
                    [t('trips.statApproved'), `${stats.approved || 0}${trip.capacity > 0 ? ` / ${trip.capacity}` : ''}`, CheckCircle2, 'text-emerald-700'],
                    [t('trips.statConfirmedShort'), `${stats.confirmed || 0}`, Bus, 'text-sky-700'],
                    [t('trips.statCollected'), trip.fee > 0 ? t('trips.collectedOf', { collected: stats.collected || 0, expected }) : t('trips.free'), Wallet, 'text-violet-700'],
                  ].map(([label, value, Icon, color]) => (
                    <div key={label} className="border border-slate-100 rounded-2xl p-4">
                      <p className="text-xs text-slate-500 flex items-center gap-1"><Icon className="w-4 h-4" />{label}</p>
                      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {isPublic && perms.manage && (
                <div className="border border-sky-100 bg-sky-50/50 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-bold text-slate-800">{t('trips.shareTitle')}</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={link} dir="ltr" className={`${inputCls} font-mono text-xs`} />
                    <button onClick={() => copyLink(link)} className={`${btn} border border-slate-300 bg-white text-slate-700 shrink-0`}>{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}{t('trips.copyLink')}</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={printPoster} className={`${btn} border border-slate-300 bg-white text-slate-700`}><QrCode className="w-4 h-4" />{t('trips.printPoster')}</button>
                    <button onClick={() => copyLink(shareMessage)} className={`${btn} border border-slate-300 bg-white text-slate-700`}><Link2 className="w-4 h-4" />{t('trips.copyMessage')}</button>
                    {trip.status === 'OPEN' && (
                      <>
                        <button disabled={!!busy || !waApi.enabled} onClick={() => announce('all')} className={`${btn} bg-[#25D366] text-white`} title={!waApi.enabled ? t('trips.waDisabled') : ''}>{spin('announce-all', MessageCircle)}{t('trips.announceAll')}</button>
                        <button disabled={!!busy || !waApi.enabled} onClick={() => announce('pending')} className={`${btn} border border-[#25D366] text-[#128C7E] bg-white`}>{spin('announce-pending', MessageCircle)}{t('trips.remindPending')}</button>
                      </>
                    )}
                  </div>
                  {!waApi.enabled && <p className="text-xs text-slate-500">{t('trips.waDisabled')}</p>}
                  {announceResult && <p className="text-sm text-emerald-700">{t('trips.announceResult', announceResult)}</p>}
                  {trip.announcedAt && <p className="text-xs text-slate-500">{t('trips.announcedAt', { date: format(trip.announcedAt.toDate ? trip.announcedAt.toDate() : new Date(trip.announcedAt), 'PPp', { locale: dateLocale }), count: trip.announcedCount || 0 })}</p>}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-100 rounded-2xl p-4 space-y-2 text-sm">
                  <p className="font-bold text-slate-800">{t('trips.form.targeting')}</p>
                  <p><span className="text-slate-500">{t('trips.form.branches')}: </span>{(trip.branches || []).map(branchName).join(sep)}</p>
                  <p><span className="text-slate-500">{t('trips.form.sections')}: </span>{sectionText}</p>
                  <p><span className="text-slate-500">{t('trips.form.grades')}: </span><span dir="ltr">{stageText}</span></p>
                  <p><span className="text-slate-500">{t('trips.form.capacity')}: </span>{trip.capacity > 0 ? trip.capacity : t('trips.unlimited')}</p>
                  {trip.objective && <p><span className="text-slate-500">{t('trips.form.objective')}: </span>{trip.objective}</p>}
                </div>
                <div className="border border-slate-100 rounded-2xl p-4 space-y-2 text-sm">
                  <p className="font-bold text-slate-800">{t('trips.form.cost')}</p>
                  <p><span className="text-slate-500">{t('trips.form.fee')}: </span>{trip.fee > 0 ? t('trips.feeValue', { fee: trip.fee }) : t('trips.free')}</p>
                  <p><span className="text-slate-500">{t('trips.form.payDeadline')}: </span>{trip.payDeadline && format(dayToDate(trip.payDeadline), 'EEEE d MMMM', { locale: dateLocale })}</p>
                  {trip.fee > 0 && <p><span className="text-slate-500">{t('trips.form.payMethods')}: </span>{(trip.payMethods || []).map((m) => t(`trips.payMethod.${m}`)).join(sep)}</p>}
                  {trip.bankDetails && <p className="whitespace-pre-wrap"><span className="text-slate-500">{t('trips.form.bankDetails')}: </span>{trip.bankDetails}</p>}
                </div>
                <div className="border border-slate-100 rounded-2xl p-4 space-y-2 text-sm md:col-span-2">
                  <p className="font-bold text-slate-800">{t('trips.form.operations')}</p>
                  {trip.meetingPoint && <p><span className="text-slate-500">{t('trips.form.meetingPoint')}: </span>{trip.meetingPoint}</p>}
                  <p><span className="text-slate-500">{t('trips.form.buses')}: </span>{trip.buses || '—'}</p>
                  <p><span className="text-slate-500">{t('trips.form.supervisors')}: </span>{supervisorNames.join(sep) || '—'}</p>
                  {trip.requirements && <p className="whitespace-pre-wrap"><span className="text-slate-500">{t('trips.form.requirements')}: </span>{trip.requirements}</p>}
                  {trip.notes && <p className="whitespace-pre-wrap"><span className="text-slate-500">{t('trips.form.notes')}: </span>{trip.notes}</p>}
                  <p className="text-xs text-slate-400">{t('trips.createdBy', { name: trip.createdByName || '' })}{trip.approvedByName && ` · ${t('trips.approvedBy', { name: trip.approvedByName })}`}</p>
                </div>
              </div>

              {log.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-slate-800 mb-2">{t('trips.activity')}</p>
                  <ul className="text-xs text-slate-600 space-y-1.5">
                    {log.map((l) => (
                      <li key={l.id} className="flex gap-2">
                        <span className="text-slate-400 shrink-0" dir="ltr">{l.createdAt?.toDate ? format(l.createdAt.toDate(), 'dd/MM HH:mm') : ''}</span>
                        <span>
                          <b>{l.actorName}</b> — {t(`trips.log.${l.action}`, { defaultValue: l.action })}
                          {l.metadata?.studentName && ` · ${l.metadata.studentName}`}
                          {l.metadata?.decision && ` (${t(`trips.decision.${l.metadata.decision}`)})`}
                          {l.metadata?.reason && ` · ${l.metadata.reason}`}
                          {l.metadata?.note && ` · ${l.metadata.note}`}
                          {l.metadata?.sent != null && ` · ${t('trips.announceResult', l.metadata)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {['students', 'boarding'].includes(tab) && !roster && !rosterError && <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}
          {['students', 'boarding'].includes(tab) && rosterError && <p className="text-sm text-red-600">{rosterError}</p>}

          {tab === 'students' && roster && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setStudentFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-sm ${studentFilter === 'ALL' ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{t('trips.allStudents')} ({rows.length})</button>
                {ENROLLMENT_STATUSES.map((s) => (counts[s] > 0 || s === 'NO_RESPONSE') && (
                  <button key={s} onClick={() => setStudentFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm ${studentFilter === s ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`trips.enrollment.${s}`)} ({counts[s]})</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('trips.searchStudents')} className={`${inputCls} pr-9`} />
                </div>
                <button onClick={exportExcel} className={`${btn} border border-slate-300 bg-white text-slate-700`}><FileDown className="w-4 h-4" />{t('trips.exportExcel')}</button>
              </div>
              {rows.length === 0 && <p className="text-sm text-slate-500 bg-amber-50 border border-amber-100 rounded-xl p-3">{t('trips.noRoster')}</p>}
              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('trips.col.student')}</th>
                      <th className="px-3 py-2 text-start">{t('trips.col.grade')}</th>
                      <th className="px-3 py-2 text-start">{t('trips.col.status')}</th>
                      <th className="px-3 py-2 text-start">{t('trips.col.payment')}</th>
                      <th className="px-3 py-2 text-start">{t('trips.col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-900">{r.name}</p>
                          <p className="text-xs text-slate-400" dir="ltr">{r.id}{(trip.branches || []).length > 1 && ` · ${branchName(r.branch)}`}</p>
                          {r.e?.healthNotes && <p className="text-xs text-rose-600 flex items-center gap-1 mt-0.5"><HeartPulse className="w-3.5 h-3.5" />{r.e.healthNotes}</p>}
                          {r.offRoster && <p className="text-xs text-amber-600">{t('trips.offRoster')}</p>}
                          {r.hasMobile === false && <p className="text-xs text-amber-600">{t('trips.noMobile')}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap" dir="ltr">{r.grade} {r.className}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${ENROLLMENT_STATUS_STYLES[r.status]}`}>{t(`trips.enrollment.${r.status}`)}</span>
                          {r.e?.source === 'staff' && <p className="text-[11px] text-slate-400 mt-0.5">{t('trips.byStaff', { name: r.e.recordedByName || '' })}</p>}
                          {r.e?.payRejectReason && r.status === 'RECEIPT_REJECTED' && <p className="text-[11px] text-orange-700 mt-0.5">{r.e.payRejectReason}</p>}
                          {r.status === 'DECLINED' && r.e?.declineReason && <p className="text-[11px] text-rose-700 mt-0.5">{t(`trips.declineReason.${r.e.declineReason}`)}</p>}
                          {r.e?.incidents?.length > 0 && <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1"><NotebookPen className="w-3 h-3" />{t('trips.incidentsCount', { count: r.e.incidents.length })}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {r.e?.payMethod && <p>{t(`trips.payMethod.${r.e.payMethod}`)}</p>}
                          {r.e?.receipt?.fileUrl && <a href={r.e.receipt.fileUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{t('trips.viewReceipt')}</a>}
                          {r.e?.payStatus === 'PAID' && <p className="text-emerald-700">{t('trips.paidBy', { name: r.e.reviewedByName || '' })}{r.e.cashReceiptNo && ` · ${r.e.cashReceiptNo}`}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {perms.finance && r.e?.decision === 'APPROVED' && trip.fee > 0 && r.e.payStatus !== 'PAID' && (
                              <>
                                {r.e.receipt && ['REVIEW', 'REJECTED', 'AWAITING'].includes(r.e.payStatus) && (
                                  <button disabled={!!busy} onClick={() => review(r.id, 'accept')} className="px-2 py-1 rounded-lg text-xs bg-emerald-600 text-white disabled:opacity-50">{busy === `pay-${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('trips.acceptReceipt')}</button>
                                )}
                                {r.e.receipt && r.e.payStatus === 'REVIEW' && (
                                  <button disabled={!!busy} onClick={() => setDialog({ title: t('trips.rejectReceipt'), label: t('trips.rejectReasonLabel'), required: true, onConfirm: async (note) => { await review(r.id, 'reject', note); setDialog(null); } })} className="px-2 py-1 rounded-lg text-xs bg-rose-50 text-rose-700 border border-rose-200">{t('trips.rejectReceipt')}</button>
                                )}
                                <button disabled={!!busy} onClick={() => setDialog({ title: t('trips.cashPaid'), label: t('trips.cashReceiptLabel'), required: false, onConfirm: async (note) => { await review(r.id, 'cash', note); setDialog(null); } })} className="px-2 py-1 rounded-lg text-xs border border-slate-300 bg-white text-slate-700">{t('trips.cashPaid')}</button>
                              </>
                            )}
                            {(perms.manage || perms.finance) && ['OPEN', 'CLOSED'].includes(trip.status) && !r.offRoster && (
                              <button onClick={() => setDialog({ manual: r })} className="px-2 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 flex items-center gap-1" title={t('trips.manual.title')}><UserPlus className="w-3.5 h-3.5" />{r.e ? t('trips.manual.edit') : t('trips.manual.add')}</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'survey' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">{t('trips.surveyCount', { count: surveys.length, total: stats.confirmed || 0 })}</p>
                {perms.manage && (
                  <button disabled={!!busy || !waApi.enabled} onClick={sendSurvey} className={`${btn} bg-[#25D366] text-white`}>{spin('survey', MessageCircle)}{t('trips.sendSurvey')}</button>
                )}
              </div>
              {announceResult && <p className="text-sm text-emerald-700">{t('trips.announceResult', announceResult)}</p>}
              {trip.surveySentAt && <p className="text-xs text-slate-500">{t('trips.surveySentAt', { date: format(trip.surveySentAt.toDate(), 'PPp', { locale: dateLocale }) })}</p>}
              {surveys.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="border border-amber-100 bg-amber-50/50 rounded-2xl p-4 col-span-2 md:col-span-1">
                    <p className="text-xs text-slate-500 flex items-center gap-1"><Star className="w-4 h-4" />{t('trips.overallRating')}</p>
                    <p className="text-2xl font-bold text-amber-600 mt-1">{(surveys.reduce((a, x) => a + x.average, 0) / surveys.length).toFixed(1)}<span className="text-sm text-slate-400"> / 5</span></p>
                  </div>
                  {TRIP_RATINGS.map((k) => (
                    <div key={k} className="border border-slate-100 rounded-2xl p-4">
                      <p className="text-xs text-slate-500">{t(`trips.rating.${k}`)}</p>
                      <p className="text-xl font-bold text-slate-800 mt-1">{(surveys.reduce((a, x) => a + x.ratings[k], 0) / surveys.length).toFixed(1)}</p>
                    </div>
                  ))}
                  <div className="border border-emerald-100 rounded-2xl p-4">
                    <p className="text-xs text-slate-500 flex items-center gap-1"><ThumbsUp className="w-4 h-4" />{t('trips.recommendRate')}</p>
                    <p className="text-xl font-bold text-emerald-700 mt-1">{Math.round((100 * surveys.filter((x) => x.recommend).length) / surveys.length)}%</p>
                  </div>
                </div>
              )}
              {surveys.length === 0 ? <p className="py-10 text-center text-slate-400 text-sm">{t('trips.noSurveys')}</p> : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
                  {surveys.map((x) => (
                    <li key={x.studentId} className="p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{x.studentName}</span>
                        <span className="text-xs text-slate-400" dir="ltr">{x.grade}</span>
                        <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${x.average <= 2.5 ? 'bg-rose-100 text-rose-700' : x.average < 4 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{x.average.toFixed(1)} / 5</span>
                        <span className="text-xs text-slate-500">{x.recommend ? t('trips.recommends') : t('trips.notRecommends')}</span>
                        {x.complaintId && <span className="text-xs text-rose-600 flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{t('trips.complaintOpened')} <span dir="ltr" className="font-mono">{x.complaintId}</span></span>}
                      </div>
                      {x.comment && <p className="text-slate-600 mt-1">{x.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'boarding' && roster && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">{t('trips.boardingCounts', { boarded: confirmedRows.filter((r) => r.e?.boarded === true).length, returned: confirmedRows.filter((r) => r.e?.returned === true).length, total: confirmedRows.length })}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={printBoarding} className={`${btn} border border-slate-300 bg-white text-slate-700`}><Printer className="w-4 h-4" />{t('trips.printBoarding')}</button>
                  {trip.date === format(new Date(), 'yyyy-MM-dd') && (
                    <button disabled={!!busy} onClick={announceArrival} className={`${btn} bg-emerald-600 text-white`}>{spin('arrival', Home)}{t('trips.arrived')}</button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">{t('trips.arrivedHint')}</p>
              {arrivalResult && <p className="text-sm text-emerald-700">{arrivalResult.whatsapp ? t('trips.arrivalSent', arrivalResult) : t('trips.arrivalNoWa')}</p>}
              {trip.arrivedAt && <p className="text-xs text-slate-500">{t('trips.arrivedAt', { time: format(trip.arrivedAt.toDate(), 'p', { locale: dateLocale }), name: trip.arrivedByName || '' })}</p>}
              {confirmedRows.length === 0 ? <p className="py-10 text-center text-slate-400 text-sm">{t('trips.noConfirmed')}</p> : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
                  {confirmedRows.map((r) => (
                    <li key={r.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{r.name} <span className="text-xs text-slate-400" dir="ltr">{r.grade} {r.className}</span></p>
                        {r.e?.healthNotes && <p className="text-xs text-rose-600 flex items-center gap-1"><HeartPulse className="w-3.5 h-3.5" />{r.e.healthNotes}</p>}
                        {r.e?.emergencyPhone && <a href={`tel:${r.e.emergencyPhone}`} className="text-xs text-slate-500" dir="ltr">{r.e.emergencyPhone}</a>}
                        {(r.e?.incidents || []).map((x, i) => (
                          <p key={i} className="text-xs text-amber-800 bg-amber-50 rounded-md px-2 py-1 mt-1">{x.note} <span className="text-amber-600">— {x.byName}{x.at?.toDate ? ` · ${format(x.at.toDate(), 'p', { locale: dateLocale })}` : ''}</span></p>
                        ))}
                      </div>
                      <button disabled={!!busy} onClick={() => addIncident(r)} className="px-2 py-1 rounded-lg text-xs text-amber-700 hover:bg-amber-50 flex items-center gap-1 self-start sm:self-center"><NotebookPen className="w-3.5 h-3.5" />{t('trips.addIncident')}</button>
                      {['boarded', 'returned'].map((field) => (
                        <div key={field} className="flex items-center gap-1">
                          <span className="text-xs text-slate-500 w-14">{t(`trips.col.${field}`)}</span>
                          {[true, false].map((v) => (
                            <button
                              key={String(v)}
                              disabled={!!busy}
                              onClick={() => boarding(r.id, field, r.e?.[field] === v ? null : v)}
                              className={`px-2.5 py-1 rounded-lg text-xs border ${r.e?.[field] === v ? (v ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-600 border-slate-200'}`}
                            >
                              {busy === `board-${r.id}-${field}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : v ? t('trips.present') : t('trips.absent')}
                            </button>
                          ))}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {dialog && !dialog.manual && <NoteDialog {...dialog} busy={!!busy} onCancel={() => setDialog(null)} />}
      {dialog?.manual && (
        <ManualConsentDialog trip={trip} student={dialog.manual} current={dialog.manual.e} onCancel={() => setDialog(null)} onSaved={() => setDialog(null)} />
      )}
    </div>
  );
}
