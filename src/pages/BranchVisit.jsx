import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, MapPin, Armchair } from 'lucide-react';
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
        {saved ? (
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
            <PublicComplaintFields visit lockBranch={!!branch} initialBranch={branchId} onSuccess={(items) => setSaved(items)} />
          </>
        )}
      </main>

      <SystemCredit className="relative z-10" />
    </div>
  );
}
