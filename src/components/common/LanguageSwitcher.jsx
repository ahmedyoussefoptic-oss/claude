import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

export default function LanguageSwitcher({ className = '' }) {
  const { i18n, t } = useTranslation();

  const toggle = () => {
    i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar');
  };

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors ${className}`}
      title="Switch language / تبديل اللغة"
    >
      <Languages className="w-4 h-4" />
      {t('common.language')}
    </button>
  );
}
