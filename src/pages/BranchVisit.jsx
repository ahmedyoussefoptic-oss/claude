import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, MapPin, Armchair, CalendarCheck, UserRound, Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import logo from '../assets/logo.png';
import Watermark from '../components/common/Watermark';
import SystemCredit from '../components/common/SystemCredit';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import PublicComplaintFields from '../components/publicReport/PublicComplaintFields';
import { useBranches } from '../hooks/useOrgData';

// Branch check-in page, opened by scanning the QR code posted at a branch
// (see BranchQrCodes.jsx — /visit?branch=<id>). The parent fills in their
// details and the reason for the visit; the record is created as a
// complaint flagged as a waiting visit, auto-assigned like the public link,
// and the assignees are notified that a parent is waiting at the branch.
export default function BranchVisit() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const branches = useBranches();
  const branchId = searchParams.get('branch') || '';
  const branch = branches.find((b) => b.id === branchId);
  const branchLabel = branch ? t(`businessData.branches.${branch.id}`, branch.name) : '';
  const [saved, setSaved] = useState(null);
  // 'appointment' = arriving for a booked visit, 'walkin' = new visit.
  const [mode, setMode] = useState(null);
  const [apptNo, setApptNo] = useState('');
  const [apptLast4, setApptLast4] = useState('');
  const [apptBusy, setApptBusy] = useState(false);
  const [apptError, setApptError] = useState(null);
  const [apptDone, setApptDone] = useState(null);

  const checkIn = async (e) => {
    e.preventDefault();
    setApptBusy(true);
    setApptError(null);
    try {
      const { data } = await httpsCallable(functions, 'checkInAppointment')({ complaintId: apptNo, phoneLast4: apptLast4, branch: branchId || undefined });
      setApptDone(data);
    } catch (err) {
      setApptError(err.message || t('branchVisit.apptError'));
    } finally {
      setApptBusy(false);
    }
  };

  useEffect(() => {
    const lang = searchParams.get('lang');
    if (lang === 'ar' || lang === 'en') i18n.changeLanguage(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <main className="relative z-10 flex-1 flex flex-col items-center p-6">
        {apptDone ? (
          <div className="w-full max-w-xl mt-10 bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 text-center">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('branchVisit.apptDoneTitle')}</h2>
            <p className="text-sm text-slate-600">{t('branchVisit.apptDoneBody', { when: apptDone.when, student: apptDone.studentName })}</p>
            <p className="text-sm text-slate-600 mt-3 flex items-center justify-center gap-1.5"><Armchair className="w-4 h-4 text-primary" />{t('branchVisit.successWait')}</p>
          </div>
        ) : saved ? (
          <div className="w-full max-w-xl mt-10 bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 text-center">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('branchVisit.successTitle')}</h2>
            <p className="text-sm text-slate-600 mb-6 flex items-center justify-center gap-1.5">
              <Armchair className="w-4 h-4 text-primary" />
              {t('branchVisit.successWait')}
            </p>
            <div className="space-y-3 mb-6">
              {saved.map((item) => (
                <div key={item.id} className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  {saved.length > 1 && item.studentName && <p className="text-sm font-bold text-slate-800 mb-1">{item.studentName}</p>}
                  <p className="text-xs text-slate-500 mb-1">{t('publicReport.kinds.COMPLAINT.idLabel')}</p>
                  <p className="text-lg font-bold text-slate-900 font-mono" dir="ltr">{item.id}</p>
                  <Link to={`/track?id=${item.id}`} className="inline-block mt-2 text-sm font-medium text-primary hover:underline">
                    {t('publicReport.kinds.COMPLAINT.trackCta')}
                  </Link>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">{t('branchVisit.keepNumber')}</p>
          </div>
        ) : (
          <>
            <div className="w-full max-w-xl mt-6 mb-4 text-center">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">{t('branchVisit.pageTitle')}</h1>
              {branchLabel && (
                <p className="inline-flex items-center gap-1.5 text-primary font-medium bg-primary/10 px-3 py-1 rounded-full text-sm mb-2">
                  <MapPin className="w-4 h-4" />
                  {branchLabel}
                </p>
              )}
              <p className="text-slate-500 text-sm">{t('branchVisit.pageSubtitle')}</p>
            </div>
            {mode === null && (
              <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setMode('appointment')} className="bg-white border-2 border-primary/30 hover:border-primary rounded-2xl p-5 text-center shadow-sm">
                  <CalendarCheck className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="font-bold text-slate-900">{t('branchVisit.haveAppointment')}</p>
                  <p className="text-xs text-slate-500 mt-1">{t('branchVisit.haveAppointmentHint')}</p>
                </button>
                <button type="button" onClick={() => setMode('walkin')} className="bg-white border-2 border-slate-200 hover:border-primary rounded-2xl p-5 text-center shadow-sm">
                  <UserRound className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="font-bold text-slate-900">{t('branchVisit.walkIn')}</p>
                  <p className="text-xs text-slate-500 mt-1">{t('branchVisit.walkInHint')}</p>
                </button>
              </div>
            )}
            {mode === 'appointment' && (
              <form onSubmit={checkIn} className="w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-4">
                <p className="font-bold text-slate-900 flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-primary" />{t('branchVisit.haveAppointment')}</p>
                {apptError && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">{apptError}</div>}
                <div>
                  <label htmlFor="appt-no" className="block text-sm font-medium text-slate-700 mb-1.5">{t('branchVisit.apptNumberLabel')} <span className="text-red-500">*</span></label>
                  <input id="appt-no" value={apptNo} onChange={(e) => setApptNo(e.target.value)} required dir="ltr" placeholder="COM-2026-1234" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                <div>
                  <label htmlFor="appt-last4" className="block text-sm font-medium text-slate-700 mb-1.5">{t('branchVisit.apptLast4Label')} <span className="text-red-500">*</span></label>
                  <input id="appt-last4" value={apptLast4} onChange={(e) => setApptLast4(e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, '').slice(0, 4))} required inputMode="numeric" dir="ltr" placeholder="1234" className="w-40 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary tracking-widest" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={apptBusy} className="flex-1 px-4 py-3 bg-primary text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-70">
                    {apptBusy && <Loader2 className="w-4 h-4 animate-spin" />}{t('branchVisit.apptSubmit')}
                  </button>
                  <button type="button" onClick={() => setMode(null)} className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm">{t('common.back')}</button>
                </div>
              </form>
            )}
            {mode === 'walkin' && (
              <PublicComplaintFields visit lockBranch={!!branch} initialBranch={branchId} onSuccess={(items) => setSaved(items)} />
            )}
          </>
        )}
      </main>

      <SystemCredit className="relative z-10" />
    </div>
  );
}
