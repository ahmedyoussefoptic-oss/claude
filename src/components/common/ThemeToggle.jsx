import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';

const KEY = 'mis-theme';
export function readTheme() {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}
export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Optional dark mode, remembered per browser (see the html.dark block in index.css).
export default function ThemeToggle({ className = '' }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(readTheme);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  };
  return (
    <button onClick={toggle} title={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')} aria-label={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
      className={`p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors ${className}`}>
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
