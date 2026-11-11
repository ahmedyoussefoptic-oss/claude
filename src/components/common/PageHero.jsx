import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavy } from '../../stores/useDesignStore';
import logo from '../../assets/logo.png';

// A page's title. Classic design: the usual heading + actions row. Navy
// design: the navy card (logo, date, big title, a row of facts, a tear line
// with a status pill and the page's actions).
//   facts: [{ label, value, tone?: 'amber'|'green'|'red'|'violet', to? }]
//   toolbar: filters / tabs — beside the actions (classic) or under the card (navy).
const TONE = { amber: 'text-amber-300', green: 'text-emerald-300', red: 'text-rose-300', violet: 'text-violet-300' };

export default function PageHero({ title, subtitle, icon: Icon, actions, toolbar, facts = [], pill }) {
  const navy = useNavy();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  if (!navy) {
    return (
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">{Icon && <Icon className="w-6 h-6 text-primary" />}{title}</h1>
          {subtitle && <p className="text-slate-500 mt-1 text-sm md:text-base">{subtitle}</p>}
        </div>
        {(actions || toolbar) && <div className="flex flex-wrap items-center gap-2 md:gap-3">{toolbar}{actions}</div>}
      </div>
    );
  }
  const date = new Date().toLocaleDateString(i18n.language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const card = (
    <div className="navy-hero relative rounded-[28px] bg-[#1b345a] text-white shadow-xl shadow-slate-300/40 overflow-hidden">
      <svg aria-hidden className="absolute -top-28 -start-28 w-[440px] h-[440px] text-white/10 pointer-events-none" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth=".4" /></svg>
      <div className="relative px-5 md:px-7 pt-5 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="bg-[#ffffff] rounded-xl p-1.5 shrink-0"><img src={logo} alt="" className="h-8 w-auto" /></span>
            <span className="font-bold text-sm md:text-base leading-tight">{t('tripConsent.schoolName')}</span>
          </div>
          <span className="text-xs md:text-sm text-white/85 text-end leading-tight">{date}</span>
        </div>
        <h1 className="text-2xl md:text-4xl font-extrabold mt-4 leading-tight flex items-center gap-3">{Icon && <Icon className="w-7 h-7 md:w-9 md:h-9 text-amber-300 shrink-0" />}{title}</h1>
        {subtitle && <p className="text-white/70 text-sm md:text-base mt-1">{subtitle}</p>}
        {facts.length > 0 && (
          <div className={`grid ${facts.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} ${facts.length >= 4 ? 'md:grid-cols-4' : ''} ${facts.length >= 5 ? 'lg:grid-cols-5' : ''} gap-x-4 gap-y-3 mt-5`}>
            {facts.map((f) => {
              const body = (<><p className="text-xs md:text-sm text-white/65 truncate">{f.label}</p><p className={`text-2xl md:text-3xl font-extrabold truncate ${TONE[f.tone] || ''}`}>{f.value}</p></>);
              return f.to
                ? <button key={f.label} type="button" onClick={() => navigate(f.to)} className="text-start min-w-0 rounded-xl -m-1.5 p-1.5 hover:bg-white/10 transition">{body}</button>
                : <div key={f.label} className="min-w-0">{body}</div>;
            })}
          </div>
        )}
      </div>
      {(pill || actions) ? (
      <>
      <div className="relative h-10 mt-3">
        <span className="absolute -start-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-50" />
        <span className="absolute -end-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-50" />
        <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-white/30" />
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-5 md:px-7 pb-5">
        {pill ? <span className="bg-white/15 rounded-full px-4 py-1.5 text-sm font-bold">{pill}</span> : <span />}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      </>
      ) : <div className="h-6" />}
    </div>
  );
  if (!toolbar) return card;
  return (
    <div className="space-y-3">
      {card}
      <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
    </div>
  );
}
