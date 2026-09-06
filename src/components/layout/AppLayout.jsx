import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../stores/useAuthStore';
import { LogOut, LayoutDashboard, FileText, Search, User, Menu, PackageSearch, Map, Settings, Wrench, FileBarChart } from 'lucide-react';
import { useState } from 'react';
import NotificationBell from './NotificationBell';
import Watermark from '../common/Watermark';
import SystemCredit from '../common/SystemCredit';
import LanguageSwitcher from '../common/LanguageSwitcher';
import logo from '../../assets/logo.png';

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, userData, role, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { name: t('nav.dashboard'), path: '/dashboard', icon: LayoutDashboard },
    { name: t('nav.complaints'), path: '/complaints', icon: FileText },
    { name: t('nav.lostFound'), path: '/lost-found', icon: PackageSearch },
    { name: t('nav.techSupport'), path: '/tech-support', icon: Wrench },
    { name: t('nav.flowMap'), path: '/flow-map', icon: Map },
    { name: t('nav.advancedSearch'), path: '/search', icon: Search },
    { name: t('nav.reports'), path: '/reports', icon: FileBarChart },
  ];

  if (role === 'ADMIN' || userData?.perms?.users) {
    navItems.push({ name: t('nav.users'), path: '/users', icon: User });
  }
  if (role === 'ADMIN') {
    navItems.push({ name: t('nav.settings'), path: '/settings', icon: Settings });
  }

  if (!user) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Watermark — fixed behind sidebar (opaque) and content */}
      <Watermark />

      {/* Sidebar — always right-aligned regardless of language, only the
          text swaps for English; mirroring the whole shell isn't worth the
          risk of positioning bugs this combination of sticky+rtl:/ltr: caused. */}
      <aside className={`fixed md:sticky top-0 right-0 h-screen w-64 bg-white border-l border-slate-200 z-50 transition-transform transform ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 flex flex-col`}>
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <img src={logo} alt="Al Moktashef International Schools" className="h-10 w-auto shrink-0" />
          <div>
            <h2 className="text-base font-bold text-primary leading-tight">{t('app.brand')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('app.tagline')}</p>
          </div>
        </div>

        <div className="p-4 flex items-center gap-3 border-b border-slate-100">
          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600">
            <User className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{userData?.name || user.email}</p>
            <p className="text-xs text-slate-500 capitalize">{role}</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
                {item.name}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-5 h-5 text-red-500" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-3 md:hidden flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Al Moktashef International Schools" className="h-7 w-auto" />
            <h2 className="text-lg font-bold text-slate-900">{t('app.brandShort')}</h2>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <NotificationBell />
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -mr-2 text-slate-600 hover:bg-slate-50 rounded-lg"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </header>
        <div className="hidden md:flex items-center justify-between px-8 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
          <LanguageSwitcher />
          <NotificationBell />
        </div>
        <div className="p-4 md:p-8 flex-1 overflow-x-hidden">
          <Outlet />
        </div>
        <SystemCredit />
      </main>
    </div>
  );
}
