import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, Check, ExternalLink, MessageCircle, FileText, PackageSearch, Wrench, Link2, Languages } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';

const TYPE_IDS = ['COMPLAINT', 'LOST_FOUND', 'TECH_SUPPORT'];
const TYPE_ICONS = { COMPLAINT: FileText, LOST_FOUND: PackageSearch, TECH_SUPPORT: Wrench };
const LANGUAGES = [
  { id: 'ar', name: 'العربية' },
  { id: 'en', name: 'English' },
];

export default function PublicLinkModal({ onClose }) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const [type, setType] = useState('COMPLAINT');
  const [branch, setBranch] = useState('');
  const [lang, setLang] = useState(i18n.language === 'en' ? 'en' : 'ar');
  const [copied, setCopied] = useState(false);

  const params = new URLSearchParams();
  if (type !== 'COMPLAINT') params.set('type', type);
  if (branch) params.set('branch', branch);
  params.set('lang', lang);
  const link = `${window.location.origin}/report?${params.toString()}`;

  const typeName = t(`publicReport.kinds.${type}.name`);
  const shareMessage = [
    t('app.brand'),
    t('publicLinkModal.shareMessageLead', { item: type === 'COMPLAINT' ? t('publicLinkModal.yourComplaint') : t('publicLinkModal.yourReport') }),
    link,
  ].join('\n');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is still shown as selectable text.
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            {t('publicLinkModal.title')}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-500">
            {t('publicLinkModal.description')}
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('publicLinkModal.reportTypeLabel')}</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_IDS.map((id) => {
                const Icon = TYPE_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setType(id)}
                    className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      type === id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {t(`publicReport.kinds.${id}.name`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5" />
              {t('publicLinkModal.linkLanguageLabel')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    lang === l.id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('publicLinkModal.branchOptional')}</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('publicLinkModal.allBranchesNote')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('publicLinkModal.readyLink', { type: typeName })}</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
              <span className="flex-1 text-xs text-slate-600 truncate text-left" dir="ltr">{link}</span>
              <button onClick={copyLink} className="shrink-0 p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title={t('publicReport.copyLink')}>
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              {t('publicLinkModal.shareWhatsApp')}
            </a>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              title={t('publicLinkModal.openLink')}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
