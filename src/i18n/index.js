import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

const STORAGE_KEY = 'mis-language';

function applyDocumentDirection(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

const savedLang = (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'ar';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'ar',
    interpolation: { escapeValue: false },
  });

applyDocumentDirection(savedLang);

i18n.on('languageChanged', (lang) => {
  localStorage.setItem(STORAGE_KEY, lang);
  applyDocumentDirection(lang);
});

export default i18n;
