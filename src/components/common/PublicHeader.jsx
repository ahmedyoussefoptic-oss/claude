import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import Watermark from './Watermark';
import LanguageSwitcher from './LanguageSwitcher';
import logo from '../../assets/logo.png';

// The design of the public links (parents, visitors), chosen once for all
// of them in «الإعدادات» (settings/publicDesign, readable by anyone). Kept in
// the browser so a returning visitor sees it at once.
const KEY = 'mis-public-design';
const clean = (d) => (d === 'navy' ? 'navy' : 'classic');
let fetched = null; // one read per page load
export function usePublicDesign() {
  const [design, setDesign] = useState(() => { try { return clean(localStorage.getItem(KEY)); } catch { return 'classic'; } });
  useEffect(() => {
    let live = true;
    fetched = fetched || getDoc(doc(db, 'settings', 'publicDesign')).then((s) => clean(s.data()?.design)).catch(() => null);
    fetched.then((d) => {
      if (!d || !live) return;
      try { localStorage.setItem(KEY, d); } catch { /* storage unavailable */ }
      setDesign(d);
    });
    return () => { live = false; };
  }, []);
  // The page's colours follow it while it is open (set before the first
  // paint, so a staff member's own design never flashes on a public page).
  useLayoutEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.design;
    root.dataset.design = design;
    return () => { root.dataset.design = prev || 'classic'; };
  }, [design]);
  return design;
}

// The top of a public page: classic → the white bar with the logo; navy →
// soft colour washes, the navy bar and a navy title card (logo, date, title).
// Pages mark their own title «public-title» (hidden when the card shows it).
export default function PublicHeader({ width = 'max-w-2xl', title, subtitle, icon: Icon }) {
  const { t, i18n } = useTranslation();
  const design = usePublicDesign();
  if (design !== 'navy') {
    return (
      <>
        <Watermark />
        <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
          <div className={`${width} mx-auto flex items-center justify-between`}>
            <div className="flex items-center gap-2 text-primary">
              <img src={logo} alt={t('app.brand')} className="h-8 w-auto" />
              <span className="font-bold text-lg">{t('app.brand')}</span>
            </div>
            <LanguageSwitcher />
          </div>
        </header>
      </>
    );
  }
  const date = new Date().toLocaleDateString(i18n.language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
        <div className="absolute -top-32 -start-24 w-96 h-96 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute -top-16 -end-24 w-80 h-80 rounded-full bg-violet-200/40 blur-3xl" />
        <div className="absolute top-60 start-1/3 w-72 h-72 rounded-full bg-amber-100/60 blur-3xl" />
      </div>
      <header className="relative z-10 sticky top-0 bg-white/85 backdrop-blur-md border-b border-slate-100">
        <div className="h-1 bg-gradient-to-l from-[#1f3c64] via-violet-500 to-amber-400" />
        <div className={`${width} mx-auto flex items-center justify-between py-3 px-4`}>
          <div className="flex items-center gap-2.5">
            <img src={logo} alt={t('app.brand')} className="h-10 w-auto" />
            <span className="font-extrabold text-lg text-[#1b345a]">{t('tripConsent.schoolName')}</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      {title && (
        <div className="relative z-10 px-4 pt-5">
          <div className={`${width} mx-auto rounded-[28px] bg-[#1b345a] text-white shadow-xl shadow-slate-300/40 overflow-hidden relative`}>
            <svg aria-hidden className="absolute -top-24 -start-24 w-[400px] h-[400px] text-white/10 pointer-events-none" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth=".4" /></svg>
            <div className="relative px-5 sm:px-7 py-5 sm:py-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="bg-[#ffffff] rounded-xl p-1.5 shrink-0"><img src={logo} alt="" className="h-8 w-auto" /></span>
                  <span className="font-bold text-sm sm:text-base leading-tight">{t('tripConsent.schoolName')}</span>
                </div>
                <span className="text-xs sm:text-sm text-white/85 text-end leading-tight max-w-[45%]">{date}</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold mt-4 leading-tight flex items-center gap-3">{Icon && <Icon className="w-8 h-8 text-amber-300 shrink-0" />}{title}</h1>
              {subtitle && <p className="text-white/75 text-[15px] mt-1">{subtitle}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
