import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Bus, MapPin, Clock, CalendarDays, Wallet, Loader2, CheckCircle2, ShieldCheck, Paperclip, AlertTriangle, Info } from 'lucide-react';
import { functions } from '../config/firebase';
import Watermark from '../components/common/Watermark';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import logo from '../assets/logo.png';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from '../utils/publicSubmission';
import { ENROLLMENT_STATUS_STYLES } from '../config/trips';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

// Public trip page (/trip/<tripCode>) — from the WhatsApp announcement, the
// QR poster or a shared link. The parent identifies the student (national
// ID + last 4 digits of the registered mobile), then approves or declines
// and, for a paid trip, attaches the transfer receipt or picks paying at
// the branch. All checks happen in the Cloud Functions.
export default function TripConsent() {
  const { t } = useTranslation();
  const { code } = useParams();
  const [trip, setTrip] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [studentId, setStudentId] = useState('');
  const [last4, setLast4] = useState('');
  const [student, setStudent] = useState(null);
  const [decision, setDecision] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [healthNotes, setHealthNotes] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    call('getPublicTrip', { tripCode: code })
      .then((data) => { setLoadError(null); setTrip(data); })
      .catch((err) => { setTrip(null); setLoadError(err.message); });
  }, [code]);

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await call('verifyTripStudent', { tripCode: code, studentId, last4 });
      setStudent(data);
      const en = data.enrollment;
      if (en) {
        setDecision(en.decision || '');
        setPayMethod(en.payMethod || '');
        setHealthNotes(en.healthNotes || '');
        setEmergencyPhone(en.emergencyPhone || '');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickReceipt = (file) => {
    setError(null);
    if (file && file.size > MAX_PUBLIC_FILE_BYTES) {
      setError(t('tripConsent.fileTooBig'));
      return;
    }
    setReceipt(file || null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!decision) { setError(t('tripConsent.pickDecision')); return; }
    const paid = decision === 'APPROVED' && trip.fee > 0;
    if (paid && !payMethod) { setError(t('tripConsent.pickPayMethod')); return; }
    if (decision === 'APPROVED' && !agree) { setError(t('tripConsent.mustAgree')); return; }
    setBusy(true);
    try {
      const file = paid && payMethod === 'BANK' && receipt
        ? { fileName: receipt.name, mimeType: receipt.type || 'application/octet-stream', base64Data: await fileToBase64(receipt) }
        : null;
      const data = await call('submitTripConsent', { tripCode: code, studentId, last4, decision, payMethod, healthNotes, emergencyPhone, agree, receipt: file });
      setDone(data.enrollment);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enrollment = student?.enrollment;
  const locked = enrollment?.payStatus === 'PAID';
  const card = 'w-full max-w-2xl bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100';

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <img src={logo} alt={t('app.brand')} className="h-8 w-auto" />
            <span className="font-bold text-lg">{t('app.brand')}</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-5">
        {loadError ? (
          <div className={`${card} mt-10 text-center text-slate-600`}>{loadError}</div>
        ) : !trip ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mt-20" />
        ) : (
          <>
            <div className={card}>
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Bus className="w-6 h-6" /></div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">{trip.title}</h1>
                  <p className="text-sm text-slate-500 mt-0.5">{trip.branchNames.join('، ')}{trip.stages.length > 0 && <> · <span dir="ltr">{trip.stages.join(', ')}</span></>}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 text-sm">
                <p className="flex items-center gap-2 text-slate-700"><MapPin className="w-4 h-4 text-primary shrink-0" />{trip.destination}</p>
                <p className="flex items-center gap-2 text-slate-700"><CalendarDays className="w-4 h-4 text-primary shrink-0" />{trip.dateLabel}</p>
                {trip.departTime && <p className="flex items-center gap-2 text-slate-700"><Clock className="w-4 h-4 text-primary shrink-0" />{t('tripConsent.times', { from: trip.departTime, to: trip.returnTime || '—' })}</p>}
                <p className="flex items-center gap-2 text-slate-700"><Wallet className="w-4 h-4 text-primary shrink-0" />{trip.fee > 0 ? t('trips.feeValue', { fee: trip.fee }) : t('trips.free')}</p>
              </div>
              {trip.objective && <p className="text-sm text-slate-600 mt-4">{trip.objective}</p>}
              {trip.meetingPoint && <p className="text-sm text-slate-600 mt-2"><b>{t('trips.form.meetingPoint')}:</b> {trip.meetingPoint}</p>}
              {trip.requirements && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap"><b>{t('trips.form.requirements')}:</b> {trip.requirements}</p>}
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 mt-4 flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{t('tripConsent.deadline', { date: trip.payDeadlineLabel })}</p>
            </div>

            {done ? (
              <div className={`${card} text-center`}>
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">{t('tripConsent.doneTitle')}</h2>
                <span className={`inline-block px-3 py-1 rounded-lg text-sm font-medium border ${ENROLLMENT_STATUS_STYLES[done.status]}`}>{t(`trips.enrollment.${done.status}`)}</span>
                <p className="text-sm text-slate-600 mt-3">{t(`tripConsent.doneBody.${done.status}`)}</p>
              </div>
            ) : !trip.registrationOpen && !student ? (
              <div className={`${card} text-center text-slate-600`}>{t('tripConsent.closed')}</div>
            ) : !student ? (
              <form onSubmit={verify} className={`${card} space-y-4`}>
                <h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />{t('tripConsent.verifyTitle')}</h2>
                <p className="text-sm text-slate-500">{t('tripConsent.verifyHint')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.studentId')}</label>
                    <input required inputMode="numeric" dir="ltr" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t('tripConsent.last4')}</label>
                    <input required inputMode="numeric" maxLength={4} dir="ltr" value={last4} onChange={(e) => setLast4(e.target.value)} className={inputCls} />
                  </div>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.continue')}
                </button>
              </form>
            ) : (
              <form onSubmit={submit} className={`${card} space-y-4`}>
                <div>
                  <p className="text-xs text-slate-500">{t('tripConsent.student')}</p>
                  <p className="font-bold text-slate-900">{student.studentName} <span className="text-sm font-normal text-slate-500" dir="ltr">{student.grade} {student.className}</span></p>
                </div>
                {enrollment && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm">
                    {t('tripConsent.currentStatus')}: <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${ENROLLMENT_STATUS_STYLES[enrollment.status]}`}>{t(`trips.enrollment.${enrollment.status}`)}</span>
                    {enrollment.status === 'RECEIPT_REJECTED' && enrollment.payRejectReason && <p className="text-orange-700 mt-1">{t('tripConsent.rejectedReason', { reason: enrollment.payRejectReason })}</p>}
                    {enrollment.receiptName && <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{enrollment.receiptName}</p>}
                  </div>
                )}
                {locked ? (
                  <p className="text-sm text-emerald-700">{t('tripConsent.locked')}</p>
                ) : !trip.registrationOpen ? (
                  <p className="text-sm text-slate-600">{t('tripConsent.closed')}</p>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-medium text-slate-700 mb-2">{t('tripConsent.decisionLabel')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {['APPROVED', 'DECLINED'].map((d) => (
                          <button type="button" key={d} onClick={() => setDecision(d)} className={`py-3 rounded-xl text-sm font-medium border ${decision === d ? (d === 'APPROVED' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-700 border-slate-200'}`}>
                            {t(`tripConsent.decision.${d}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {decision === 'APPROVED' && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">{t('trips.healthNotes')}</label>
                            <input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} placeholder={t('tripConsent.healthPlaceholder')} className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">{t('trips.emergencyPhone')}</label>
                            <input inputMode="tel" dir="ltr" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} />
                          </div>
                        </div>

                        {trip.fee > 0 && (
                          <div className="space-y-3">
                            <p className="text-sm font-medium text-slate-700">{t('tripConsent.payLabel', { fee: trip.fee })}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {trip.payMethods.map((m) => (
                                <button type="button" key={m} onClick={() => setPayMethod(m)} className={`py-2.5 rounded-xl text-sm border ${payMethod === m ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`trips.payMethod.${m}`)}</button>
                              ))}
                            </div>
                            {payMethod === 'BANK' && (
                              <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 space-y-2">
                                {trip.bankDetails && <p className="text-sm text-slate-700 whitespace-pre-wrap">{trip.bankDetails}</p>}
                                <label className="flex items-center gap-2 text-sm text-primary cursor-pointer">
                                  <Paperclip className="w-4 h-4" />
                                  {receipt ? receipt.name : t('tripConsent.attachReceipt')}
                                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pickReceipt(e.target.files?.[0])} />
                                </label>
                                <p className="text-xs text-slate-500">{t('tripConsent.receiptHint')}</p>
                              </div>
                            )}
                            {payMethod === 'RECEPTION' && <p className="text-xs text-slate-500">{t('tripConsent.receptionHint')}</p>}
                          </div>
                        )}

                        {trip.refundPolicy && <p className="text-xs text-slate-500 whitespace-pre-wrap"><b>{t('trips.form.refundPolicy')}:</b> {trip.refundPolicy}</p>}
                        <label className="flex items-start gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
                          {t('tripConsent.agree')}
                        </label>
                      </>
                    )}

                    {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
                    <button disabled={busy} className="w-full py-3 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('tripConsent.submit')}
                    </button>
                  </>
                )}
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
