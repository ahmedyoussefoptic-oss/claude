import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../stores/useAuthStore';
import { LogOut, LayoutDashboard, FileText, Search, User, Menu, PackageSearch, Map, Settings, Wrench, FileBarChart, Archive, GraduationCap, QrCode, Armchair, Bus, LayoutGrid, DoorOpen, UserPlus, Settings2, PhoneCall, MessageSquareText, Activity } from 'lucide-react';
import AssistantPanel from '../assistant/AssistantPanel';
import { useEffect, useState, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useAdminPermissions, adminCan, isOwner, canSeePlatform, canSeeActivity, canSeeLeaves } from '../../config/adminPermissions';
import { startPresence } from '../../utils/presence';
import NotificationBell from './NotificationBell';
import Watermark from '../common/Watermark';
import SystemCredit from '../common/SystemCredit';
import LanguageSwitcher from '../common/LanguageSwitcher';
import ThemeToggle from '../common/ThemeToggle';
import logo from '../../assets/logo.png';
import { canSeeModule, tripsAccessOf } from '../../utils/scope';

const ownerClaimTried = new Set();

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, userData, role, logout, refreshUserData } = useAuthStore();
  const caps = useAdminPermissions();

  // The system owner's account is recognised server-side by its sign-in
  // email (claimSystemOwner); anyone else gets a harmless refusal. Once per
  // page load and account.
  useEffect(() => {
    // Runs without a profile too: on a new installation the owner's profile
    // is created by claimSystemOwner on first sign-in.
    if (!user || isOwner(userData) || ownerClaimTried.has(user.uid)) return;
    ownerClaimTried.add(user.uid);
    httpsCallable(functions, 'claimSystemOwner')().then(() => refreshUserData()).catch(() => {});
  }, [user, userData, refreshUserData]);
  const navigate = useNavigate();
  const location = useLocation();
  // Heartbeat for «نشاط المستخدمين» (who is online now, and on which page).
  const presenceRef = useRef(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  useEffect(() => {
    if (!user || !userData) return undefined;
    presenceRef.current = startPresence(user.uid, userData.name, () => pathRef.current);
    return () => { presenceRef.current?.stop(); presenceRef.current = null; };
  }, [user?.uid, !!userData]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { presenceRef.current?.pageChanged(); }, [location.pathname]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Reception staff see nothing but the branch QR visits page.
  const isReceptionist = role === 'RECEPTIONIST';
  // Staff limited to the trips section see only that tab.
  const tripsOnly = !isReceptionist && tripsAccessOf(userData) === 'tripsOnly';
  // Every section is shown only if the employee may see it (Users page →
  // sections; see canSeeModule). Tech-support tickets hold national IDs and
  // account credentials, so by default only IT, Customer Service,
  // principals and quality officers get that one.
  const moduleNav = [
    ['dashboard', '/dashboard', LayoutDashboard, 'nav.dashboard'],
    ['complaints', '/complaints', FileText, 'nav.complaints'],
    ['lostFound', '/lost-found', PackageSearch, 'nav.lostFound'],
    ['techSupport', '/tech-support', Wrench, 'nav.techSupport'],
    ['flowMap', '/flow-map', Map, 'nav.flowMap'],
    ['search', '/search', Search, 'nav.advancedSearch'],
    ['students', '/students', GraduationCap, 'nav.studentRecords'],
    ['reports', '/reports', FileBarChart, 'nav.reports'],
    ['visits', '/visits', Armchair, 'nav.branchVisits'],
    ['trips', '/trips', Bus, 'nav.trips'],
    ['calls', '/calls', PhoneCall, 'nav.calls'],
    ['waReports', '/wa-reports', MessageSquareText, 'nav.waReports'],
  ];
  const navItems = moduleNav.filter(([key]) => canSeeModule(userData, key)).map(([, path, icon, label]) => ({ name: t(label), path, icon }));
  // A section the employee may not see redirects to their first allowed one.
  const blockedModule = userData && moduleNav.find(([key, path]) => (location.pathname === path || location.pathname.startsWith(`${path}/`)) && !canSeeModule(userData, key));

  if (!tripsOnly && (role === 'ADMIN' ? adminCan(userData, caps, 'users') : userData?.perms?.users)) {
    navItems.push({ name: t('nav.users'), path: '/users', icon: User });
  }
  if (!tripsOnly && (role === 'ADMIN' || userData?.isPrincipal)) {
    navItems.push({ name: t('nav.branchQr'), path: '/branch-qr', icon: QrCode });
  }
  if (adminCan(userData, caps, 'settings')) {
    navItems.push({ name: t('nav.settings'), path: '/settings', icon: Settings });
  }
  if (adminCan(userData, caps, 'archive')) {
    navItems.push({ name: t('nav.archive'), path: '/deleted-complaints', icon: Archive });
  }
  if (canSeeActivity(userData)) {
    navItems.push({ name: t('activity.title'), path: '/activity', icon: Activity });
  }
  // Staff given leave-request steps (approve / call / exit) outside the platform.
  if (!canSeePlatform(userData) && canSeeLeaves(userData)) {
    navItems.push({ name: t('platform.leaves.title'), path: '/platform/leaves', icon: DoorOpen });
  }
  // منصة المكتشف — the owner and the users the owner shared it with; its
  // settings, the owner only (also enforced in firestore.rules).
  if (canSeePlatform(userData)) {
    navItems.push(
      { divider: t('platform.navTitle'), path: '#platform' },
      { name: t('platform.home.title'), path: '/platform/home', icon: LayoutGrid },
      { name: t('platform.leaves.title'), path: '/platform/leaves', icon: DoorOpen },
      { name: t('platform.leads.title'), path: '/platform/leads', icon: UserPlus },
      { name: t('platform.students.title'), path: '/platform/students', icon: GraduationCap },
      ...(isOwner(userData) ? [{ name: t('platform.settings.title'), path: '/platform/settings', icon: Settings2 }] : []),
    );
  }

  // After every section is listed, so staff with only leave steps land there.
  const homePath = blockedModule ? (navItems[0]?.path || '/no-access') : null;

  if (!user) {
    return <Outlet />;
  }
  if (homePath && homePath !== '/no-access') {
    return <Navigate to={homePath} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Watermark — fixed behind sidebar (opaque) and content */}
      <Watermark />

      {/* Sidebar — always right-aligned regardless of language, only the
          text swaps for English; mirroring the whole shell isn't worth the
          risk of positioning bugs this combination of sticky+rtl:/ltr: caused. */}
      <aside className={`fixed md:sticky top-0 right-0 h-screen w-64 bg-white border-l border-slate-200 z-50 md:z-0 transition-transform transform ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 flex flex-col`}>
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
            <p className={`text-xs ${isOwner(userData) ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>{isOwner(userData) ? t('roles.OWNER') : t(`roles.${role}`, { defaultValue: role || '' })}</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            if (item.divider) {
              return <p key={item.path} className="pt-4 pb-1 px-3 text-[11px] font-bold text-amber-600 tracking-wide">{item.divider}</p>;
            }
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
            <ThemeToggle />
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
          <ThemeToggle />
            <LanguageSwitcher />
          <NotificationBell />
        </div>
        <div className="p-4 md:p-8 flex-1 overflow-x-hidden">
          {homePath === '/no-access' ? (
            <div className="max-w-lg mx-auto mt-16 bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-600">{t('nav.noAccess')}</div>
          ) : <Outlet />}
          <AssistantPanel />
        </div>
        <SystemCredit />
      </main>
    </div>
  );
}
