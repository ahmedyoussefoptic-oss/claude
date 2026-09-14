import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, Check, FileText, PackageSearch, Wrench } from 'lucide-react';
import { trackingLink } from '../utils/whatsapp';
import logo from '../assets/logo.png';
import Watermark from '../components/common/Watermark';
import SystemCredit from '../components/common/SystemCredit';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import PublicComplaintFields from '../components/publicReport/PublicComplaintFields';
import PublicLostFoundFields from '../components/publicReport/PublicLostFoundFields';
import PublicTechSupportFields from '../components/publicReport/PublicTechSupportFields';

const KIND_ICONS = { COMPLAINT: FileText, LOST_FOUND: PackageSearch, TECH_SUPPORT: Wrench };
const KIND_IDS = ['COMPLAINT', 'LOST_FOUND', 'TECH_SUPPORT'];

export default function PublicReportForm() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialType = KIND_IDS.includes(searchParams.get('type')) ? searchParams.get('type') : 'COMPLAINT';
  const initialBranch = searchParams.get('branch') || '';

  // A staff-generated link (see PublicLinkModal) can pin the page's language
  // via ?lang=ar|en — lets the same shareable-link feature offer a distinct
  // link per language, on top of the in-page switcher below.
  useEffect(() => {
    const lang = searchParams.get('lang');
    if (lang === 'ar' || lang === 'en') i18n.changeLanguage(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [kind, setKind] = useState(initialType);
  const [saved, setSaved] = useState(null); // { id, kind }
  const [linkCopied, setLinkCopied] = useState(false);

  const activeKind = saved?.kind || kind;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(trackingLink(saved.id));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is shown as text anyway.
    }
  };

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
          <div className="w-full max-w-xl mt-10 bg-white p-6 md:p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 text-center animate-in slide-in-from-bottom-4 duration-500">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">{t(`publicReport.kinds.${activeKind}.successTitle`)}</h2>
            <p className="text-sm text-slate-500 mb-6">{t('publicReport.reviewSoon')}</p>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-4">
              <p className="text-xs text-slate-500 mb-1">{t(`publicReport.kinds.${activeKind}.idLabel`)}</p>
              <p className="text-lg font-bold text-slate-900 font-mono" dir="ltr">{saved.id}</p>
            </div>

            <p className="text-sm text-slate-600 mb-2">{t('publicReport.keepLink')}</p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3 mb-6">
              <span className="flex-1 text-xs text-slate-600 truncate text-left" dir="ltr">{trackingLink(saved.id)}</span>
              <button onClick={copyLink} className="shrink-0 p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title={t('publicReport.copyLink')}>
                {linkCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <Link to={`/track?id=${saved.id}`} className="w-full px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors">
                {t(`publicReport.kinds.${activeKind}.trackCta`)}
              </Link>
              <button onClick={() => setSaved(null)} className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors">
                {t(`publicReport.kinds.${activeKind}.anotherCta`)}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="w-full max-w-xl mt-6 mb-4 text-center">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">{t(`publicReport.kinds.${kind}.pageTitle`)}</h1>
              <p className="text-slate-500 text-sm">{t(`publicReport.kinds.${kind}.pageSubtitle`)}</p>
            </div>

            <div className="w-full max-w-xl grid grid-cols-3 gap-2 mb-6">
              {KIND_IDS.map((id) => {
                const Icon = KIND_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      kind === id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {t(`publicReport.kinds.${id}.name`)}
                  </button>
                );
              })}
            </div>

            {kind === 'COMPLAINT' && <PublicComplaintFields initialBranch={initialBranch} onSuccess={(id) => setSaved({ id, kind: 'COMPLAINT' })} />}
            {kind === 'LOST_FOUND' && <PublicLostFoundFields initialBranch={initialBranch} onSuccess={(id) => setSaved({ id, kind: 'LOST_FOUND' })} />}
            {kind === 'TECH_SUPPORT' && <PublicTechSupportFields initialBranch={initialBranch} onSuccess={(id) => setSaved({ id, kind: 'TECH_SUPPORT' })} />}
          </>
        )}
      </main>

      <SystemCredit className="relative z-10" />
    </div>
  );
}
