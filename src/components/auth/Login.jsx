import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../stores/useAuthStore';
import { Lock, Mail, Loader2, AlertCircle } from 'lucide-react';
import logo from '../../assets/logo.png';
import Watermark from '../common/Watermark';
import SystemCredit from '../common/SystemCredit';
import LanguageSwitcher from '../common/LanguageSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      // A shared complaint/ticket link (?openId=...) redirects here to sign
      // in first — ProtectedRoute stashed where the user was actually
      // headed, so send them back there instead of always /dashboard.
      const redirectTo = location.state?.from;
      const target = redirectTo ? `${redirectTo.pathname}${redirectTo.search || ''}` : '/dashboard';
      navigate(target, { replace: true });
    } catch (err) {
      // Error is handled in store
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 overflow-hidden">
      <Watermark />
      <div className="relative z-10 w-full max-w-md flex justify-end mb-2">
        <LanguageSwitcher className="bg-white border border-slate-200 shadow-sm" />
      </div>
      <div className="relative z-10 max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        <div className="p-8">
          <div className="text-center mb-8">
            <img src={logo} alt="Al Moktashef International Schools" className="mx-auto h-20 w-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('login.title')}</h1>
            <p className="text-slate-500">{t('login.subtitle')}</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 rounded-xl flex items-start gap-3 text-red-700 border border-red-100">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm">{error === 'Firebase: Error (auth/invalid-credential).' ? t('login.invalidCredentials') : error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('login.email')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pl-3 pr-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pr-10 pl-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('login.password')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pl-3 pr-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pr-10 pl-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-70 transition-all duration-200"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('login.submit')}
            </button>
          </form>
        </div>
      </div>
      <div className="relative z-10 w-full max-w-md">
        <SystemCredit />
      </div>
    </div>
  );
}
