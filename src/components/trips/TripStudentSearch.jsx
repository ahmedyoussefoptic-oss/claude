import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Search, Loader2, X, ExternalLink, FileText, Paperclip, HeartPulse, Phone, Bus } from 'lucide-react';
import { functions } from '../../config/firebase';
import { searchStudents, studentDisplayName } from '../../utils/students';
import { ENROLLMENT_STATUS_STYLES, tripTime } from '../../config/trips';
import { printTripInvoice } from '../../utils/tripInvoice';
import { useWhatsAppApi } from '../../hooks/useWhatsAppApi';
import SendTripLink from './SendTripLink';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

// Trips page › find a student by national ID or any part of the name: their
// details, every trip they replied to (and coming trips they haven't), the
// payment status with who collected / confirmed it, and the invoice.
export default function TripStudentSearch({ branchName, onOpenTrip }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState(null);
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const timer = useRef(null);
  const waApi = useWhatsAppApi();

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2 || student) { setHits([]); return undefined; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try { setHits(await searchStudents(term, 8)); } catch { setHits([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q, student]);

  const open = async (s) => {
    setStudent(s);
    setHits([]);
    setTrips(null);
    setError(null);
    try {
      const { trips: list } = await call('getStudentTrips', { studentId: s.nationalId, full: true });
      setTrips(list);
    } catch (err) {
      setError(err.message);
    }
  };
  // Trips-only staff can't browse the roster: a full ID still works.
  const submit = (e) => {
    e.preventDefault();
    const id = q.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/\D/g, '');
    if (hits[0]) open(hits[0]);
    else if (id.length >= 9) open({ nationalId: id, name: '' });
  };
  const clear = () => { setStudent(null); setTrips(null); setQ(''); setError(null); };
  const invoice = async (tr) => {
    setBusy(tr.tripId);
    try { printTripInvoice(await call('issueTripInvoice', { tripId: tr.tripId, studentId: student.nationalId }), t); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };
  const when = (ms) => (ms ? new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) : '');
  const kv = (label, value) => (value ? <p className="text-xs"><span className="text-slate-500">{label}: </span><span className="text-slate-800">{value}</span></p> : null);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
      <form onSubmit={submit} className="relative">
        <Search className="w-5 h-5 absolute top-3 right-3 text-slate-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); if (student) { setStudent(null); setTrips(null); } }} placeholder={t('trips.search.placeholder')}
          className="w-full pr-11 pl-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
        {(q || student) && <button type="button" onClick={clear} className="absolute top-2.5 left-2 p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>}
        {searching && <Loader2 className="w-4 h-4 animate-spin absolute top-3.5 left-10 text-slate-400" />}
        {hits.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
            {hits.map((s) => (
              <li key={s.nationalId}>
                <button type="button" onClick={() => open(s)} className="w-full text-start px-4 py-2 hover:bg-slate-50">
                  <span className="font-medium text-slate-900">{studentDisplayName(s)}</span>
                  <span className="block text-xs text-slate-500"><span dir="ltr">{s.nationalId}</span> · {branchName(s.branch) || s.branchName} · <span dir="ltr">{s.gradeName} {s.className}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {student && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 bg-slate-50 rounded-xl px-4 py-3">
            <p className="font-bold text-slate-900">{studentDisplayName(student) || student.nationalId}</p>
            <p className="text-sm text-slate-600" dir="ltr">{student.nationalId}</p>
            {student.branch && <p className="text-sm text-slate-600">{branchName(student.branch)}</p>}
            {student.gradeName && <p className="text-sm text-slate-600" dir="ltr">{student.gradeName} {student.className}</p>}
            {student.mobile && <p className="text-sm text-slate-600 flex items-center gap-1"><Phone className="w-3.5 h-3.5" /><span dir="ltr">{student.mobile}</span></p>}
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!trips && !error && <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
          {trips && trips.length === 0 && <p className="text-sm text-slate-500 text-center py-4">{t('trips.search.noTrips')}</p>}
          {trips && trips.map((tr) => (
            <div key={tr.tripId} className="border border-slate-100 rounded-xl p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <p className="font-bold text-slate-900 flex items-center gap-1.5"><Bus className="w-4 h-4 text-primary" />{tr.title}</p>
                <p className="text-xs text-slate-500" dir="ltr">{tr.tripCode} · {tr.date}{tr.departTime ? ` · ${tripTime(tr.departTime, i18n.language)} – ${tripTime(tr.returnTime, i18n.language)}` : ''}</p>
                {kv(t('trips.form.destination'), tr.destination)}
                {kv(t('trips.form.meetingPoint'), tr.meetingPoint)}
                {kv(t('trips.search.fee'), tr.fee > 0 ? t('trips.feeValue', { fee: tr.fee }) : t('trips.free'))}
                {tr.status === 'NO_RESPONSE' && tr.payDeadline && kv(t('trips.form.payDeadline'), tr.payDeadline)}
              </div>
              <div className="space-y-1">
                <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${ENROLLMENT_STATUS_STYLES[tr.status] || ''}`}>{t(`trips.enrollment.${tr.status}`)}</span>
                {tr.declineReason && kv(t('tripConsent.declineReason'), t(`trips.declineReason.${tr.declineReason}`))}
                {tr.submittedAt && kv(t('trips.search.repliedAt'), `${when(tr.submittedAt)}${tr.source === 'staff' ? ` (${t('trips.byStaff', { name: tr.recordedByName || '' })})` : ''}`)}
                {tr.payMethod && kv(t('trips.col.payMethod'), t(`trips.payMethod.${tr.payMethod}`))}
                {tr.payStatus === 'PAID' && (
                  <div className="text-xs bg-emerald-50 text-emerald-800 rounded-md px-2 py-1 space-y-0.5">
                    <p className="font-medium">{t('trips.paidVia', { method: t(`trips.collectMethod.${tr.collectMethod || (tr.payMethod === 'BANK' ? 'TRANSFER' : 'CASH')}`) })} — {t('trips.feeValue', { fee: tr.paidAmount ?? tr.fee })}</p>
                    {tr.collectorName && <p>{t('trips.collectorLabel')}: {tr.collectorName}</p>}
                    <p>{t('trips.confirmerLabel')}: {tr.confirmedBy || '—'}{tr.confirmedAt ? ` · ${when(tr.confirmedAt)}` : ''}</p>
                    {tr.ref && <p>{t('trips.collect.ref')}: {tr.ref}</p>}
                    {tr.invoiceNo && <p>{t('trips.invoice.number')}: <span dir="ltr">{tr.invoiceNo}</span></p>}
                  </div>
                )}
                {tr.payRejectReason && tr.status === 'RECEIPT_REJECTED' && <p className="text-xs text-orange-700">{tr.payRejectReason}</p>}
                {tr.receiptUrl && <a href={tr.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{t('trips.viewReceipt')}</a>}
                {tr.pledgeUrl && <a href={tr.pledgeUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 hover:underline flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{t('trips.viewPledge')}</a>}
              </div>
              <div className="space-y-1">
                {tr.healthNotes && <p className="text-xs text-rose-600 flex items-center gap-1"><HeartPulse className="w-3.5 h-3.5" />{tr.healthNotes}</p>}
                {kv(t('trips.sheet.parentPhone'), tr.parentPhone)}
                {kv(t('trips.emergencyPhone'), tr.emergencyPhone)}
                {tr.boarded != null && kv(t('trips.col.boarded'), tr.boarded ? t('trips.present') : t('trips.absent'))}
                {tr.returned != null && kv(t('trips.col.returned'), tr.returned ? t('trips.present') : t('trips.absent'))}
                {(tr.incidents || []).map((x, i) => <p key={i} className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-0.5">{x.note} — {x.byName}</p>)}
                {tr.surveyAverage != null && kv(t('trips.overallRating'), tr.surveyAverage.toFixed(1))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => onOpenTrip(tr.tripId)} className="px-2.5 py-1 rounded-lg text-xs border border-slate-300 bg-white text-slate-700 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" />{t('trips.search.openTrip')}</button>
                  <SendTripLink tripId={tr.tripId} studentId={student.nationalId} waApi={waApi} />
                  {tr.payStatus === 'PAID' && (
                    <button type="button" disabled={busy === tr.tripId} onClick={() => invoice(tr)} className="px-2.5 py-1 rounded-lg text-xs border border-sky-300 bg-white text-sky-700 flex items-center gap-1 disabled:opacity-50">
                      {busy === tr.tripId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}{tr.invoiceNo ? t('trips.invoice.reprint') : t('trips.invoice.issue')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
