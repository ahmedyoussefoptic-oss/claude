import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../stores/useAuthStore';
import { ChevronDown, Inbox, BarChart3, ShieldCheck, Presentation, ClipboardCheck, LogOut, LayoutDashboard, FileText, Search, User, Menu, PackageSearch, Map, Settings, Wrench, FileBarChart, Archive, GraduationCap, QrCode, Armchair, Bus, LayoutGrid, DoorOpen, UserPlus, Settings2, PhoneCall, MessageSquareText, Activity, PhoneOutgoing, HeartHandshake, Video, Wallet } from 'lucide-react';
import AssistantPanel from '../assistant/AssistantPanel';
import { useEffect, useState, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useAdminPermissions, adminCan, isOwner, canSeePlatform, canSeeActivity, canSeeLeaves, canSeeCallTasks, canSeeAttendance } from '../../config/adminPermissions';
import { startPresence } from '../../utils/presence';
import NotificationBell from './NotificationBell';
import Watermark from '../common/Watermark';
import SystemCredit from '../common/SystemCredit';
import LanguageSwitcher from '../common/LanguageSwitcher';
import ThemeToggle from '../common/ThemeToggle';
import DesignToggle from '../common/DesignToggle';
import useDesignStore from '../../stores/useDesignStore';
import logo from '../../assets/logo.png';
import { canSeeModule, tripsAccessOf } from '../../utils/scope';

const ownerClaimTried = new Set();

// The side menu in groups (each a drop-down), in this order; a page not
// listed here falls in the last group. A group with one page shows the page
// alone.
const NAV_GROUPS = [
  { id: 'home', paths: ['/dashboard'] },
  { id: 'records', icon: Inbox, paths: ['/complaints', '/finance', '/tech-support', '/lost-found', '/visits'] },
  { id: 'students', icon: GraduationCap, paths: ['/students', '/support-programs', '/meetings', '/surveys', '/trips', '/attendance'] },
  { id: 'calls', icon: PhoneOutgoing, paths: ['/call-tasks', '/calls', '/wa-reports'] },
  { id: 'reports', icon: BarChart3, paths: ['/reports', '/search', '/flow-map', '/activity'] },
  { id: 'admin', icon: ShieldCheck, paths: ['/users', '/branch-qr', '/settings', '/deleted-complaints'] },
  { id: 'platform', icon: LayoutGrid, paths: ['/platform'] },
];
const NAV_OPEN_KEY = 'mis-nav-open';
const groupOf = (path) => (NAV_GROUPS.find((g) => g.paths.some((p) => path === p || path.startsWith(`${p}/`))) || NAV_GROUPS[NAV_GROUPS.length - 1]).id;

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
  // Which menu groups are open (remembered on this device); the group of
  // the page being shown always opens.
  const [openGroups, setOpenGroups] = useState(() => { try { return JSON.parse(localStorage.getItem(NAV_OPEN_KEY) || '[]'); } catch { return []; } });
  const toggleGroup = (id) => setOpenGroups((list) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  useEffect(() => {
    const g = groupOf(location.pathname);
    setOpenGroups((list) => (list.includes(g) ? list : [...list, g]));
  }, [location.pathname]);
  const { design, setDesign } = useDesignStore();
  const navy = design === 'navy';
  // The design saved on the account (chosen on another device) wins.
  useEffect(() => {
    if (userData?.uiDesign && userData.uiDesign !== useDesignStore.getState().design) setDesign(userData.uiDesign);
  }, [userData?.uiDesign, setDesign]);

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
    ['finance', '/finance', Wallet, 'nav.finance'],
    ['lostFound', '/lost-found', PackageSearch, 'nav.lostFound'],
    ['techSupport', '/tech-support', Wrench, 'nav.techSupport'],
    ['flowMap', '/flow-map', Map, 'nav.flowMap'],
    ['search', '/search', Search, 'nav.advancedSearch'],
    ['students', '/students', GraduationCap, 'nav.studentRecords'],
    ['reports', '/reports', FileBarChart, 'nav.reports'],
    ['visits', '/visits', Armchair, 'nav.branchVisits'],
    ['trips', '/trips', Bus, 'nav.trips'],
    ['meetings', '/meetings', Presentation, 'nav.meetings'],
    ['meetings', '/surveys', ClipboardCheck, 'nav.surveys'],
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
  if (!tripsOnly && canSeeCallTasks(userData)) {
    navItems.push({ name: t('callTasks.title'), path: '/call-tasks', icon: PhoneOutgoing });
  }
  if (!tripsOnly && canSeeAttendance(userData)) {
    navItems.push({ name: t('vc.title'), path: '/attendance', icon: Video });
  }
  // Staff given leave-request steps (approve / call / exit) outside the platform.
  if (!canSeePlatform(userData) && canSeeLeaves(userData)) {
    navItems.push({ name: t('platform.leaves.title'), path: '/platform/leaves', icon: DoorOpen });
  }
  // منصة المكتشف — the owner and the users the owner shared it with; its
  // settings, the owner only (also enforced in firestore.rules).
  if (canSeePlatform(userData)) {
    navItems.push(
      { name: t('platform.home.title'), path: '/platform/home', icon: LayoutGrid },
      { name: t('platform.leaves.title'), path: '/platform/leaves', icon: DoorOpen },
      { name: t('platform.leads.title'), path: '/platform/leads', icon: UserPlus },
      { name: t('platform.students.title'), path: '/platform/students', icon: GraduationCap },
      { name: t('platform.sped.title'), path: '/platform/sped', icon: HeartHandshake },
      ...(isOwner(userData) ? [{ name: t('platform.settings.title'), path: '/platform/settings', icon: Settings2 }] : []),
    );
  }

  // After every section is listed, so staff with only leave steps land there.
  const homePath = blockedModule ? (navItems[0]?.path || '/no-access') : null;

  // The menu in its groups (order of NAV_GROUPS, then of each group's pages).
  const rank = (path) => { const g = NAV_GROUPS.find((x) => x.id === groupOf(path)); const i = g.paths.findIndex((p) => path === p || path.startsWith(`${p}/`)); return i < 0 ? 99 : i; };
  const navGroups = NAV_GROUPS.map((g) => ({ ...g, items: navItems.filter((it) => groupOf(it.path) === g.id).sort((a, b) => rank(a.path) - rank(b.path)) })).filter((g) => g.items.length);
  const activeGroup = groupOf(location.pathname);

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
      <aside className={`fixed md:sticky top-0 right-0 h-screen w-64 ${navy ? 'bg-[#1b345a] text-white' : 'bg-white border-l border-slate-200'} z-50 md:z-0 transition-transform transform ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 flex flex-col`}>
        <div className={`p-6 border-b flex items-center gap-3 ${navy ? 'border-white/10' : 'border-slate-100'}`}>
          {navy
            ? <span className="bg-[#ffffff] rounded-xl p-1.5 shrink-0"><img src={logo} alt="Al Moktashef International Schools" className="h-9 w-auto" /></span>
            : <img src={logo} alt="Al Moktashef International Schools" className="h-10 w-auto shrink-0" />}
          <div>
            <h2 className={`text-base font-bold leading-tight ${navy ? 'text-white' : 'text-primary'}`}>{t('app.brand')}</h2>
            <p className={`text-xs mt-0.5 ${navy ? 'text-white/60' : 'text-slate-500'}`}>{t('app.tagline')}</p>
          </div>
        </div>

        <div className={`p-4 flex items-center gap-3 border-b ${navy ? 'border-white/10' : 'border-slate-100'}`}>
          {navy
            ? <div className="w-10 h-10 bg-violet-500 rounded-full flex items-center justify-center text-white font-extrabold shrink-0">{String(userData?.name || user.email || '?').trim().charAt(0)}</div>
            : <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600"><User className="w-5 h-5" /></div>}
          <div>
            <p className={`text-sm font-medium ${navy ? 'text-white' : 'text-slate-900'}`}>{userData?.name || user.email}</p>
            <p className={`text-xs ${isOwner(userData) ? (navy ? 'text-amber-300 font-bold' : 'text-amber-600 font-bold') : (navy ? 'text-white/60' : 'text-slate-500')}`}>{isOwner(userData) ? t('roles.OWNER') : t(`roles.${role}`, { defaultValue: role || '' })}</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navGroups.map((g) => {
            const item = (it, nested) => {
              const Icon = it.icon;
              const isActive = location.pathname.startsWith(it.path);
              return (
                <button
                  key={it.path}
                  onClick={() => {
                    navigate(it.path);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 ${nested ? 'ps-4 pe-3 py-2' : 'px-3 py-2.5'} rounded-xl text-sm font-medium transition-colors ${
                    navy
                      ? (isActive ? 'bg-[#ffffff] text-[#1b345a] font-bold shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white')
                      : (isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                  }`}
                >
                  <Icon className={`${nested ? 'w-4 h-4' : 'w-5 h-5'} ${navy ? (isActive ? 'text-[#1b345a]' : 'text-white/50') : (isActive ? 'text-primary' : 'text-slate-400')}`} />
                  <span className="text-start">{it.name}</span>
                </button>
              );
            };
            if (g.items.length === 1) return item(g.items[0], false);
            const open = openGroups.includes(g.id);
            const GIcon = g.icon || LayoutGrid;
            const hasActive = g.id === activeGroup;
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={open}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                    navy ? (hasActive ? 'text-white' : 'text-white/80 hover:bg-white/10') : (hasActive ? 'text-slate-900' : 'text-slate-700 hover:bg-slate-50')
                  }`}
                >
                  <GIcon className={`w-5 h-5 ${navy ? (g.id === 'platform' ? 'text-amber-300' : 'text-white/60') : (g.id === 'platform' ? 'text-amber-600' : 'text-slate-500')}`} />
                  <span className="flex-1 text-start">{t(`nav.groups.${g.id}`)}</span>
                  {!open && hasActive && <span className={`w-1.5 h-1.5 rounded-full ${navy ? 'bg-amber-300' : 'bg-primary'}`} />}
                  <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''} ${navy ? 'text-white/50' : 'text-slate-400'}`} />
                </button>
                {open && <div className={`mt-0.5 mb-1 ms-3 ps-2 space-y-0.5 border-s ${navy ? 'border-white/15' : 'border-slate-200'}`}>{g.items.map((it) => item(it, true))}</div>}
              </div>
            );
          })}
        </nav>

        <div className={`p-4 border-t ${navy ? 'border-white/10' : 'border-slate-100'}`}>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${navy ? 'text-rose-300 hover:bg-white/10' : 'text-red-600 hover:bg-red-50'}`}
          >
            <LogOut className={`w-5 h-5 ${navy ? 'text-rose-300' : 'text-red-500'}`} />
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
            <DesignToggle />
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
          <div className="flex items-center gap-1">
            <DesignToggle withLabel />
            <ThemeToggle />
          </div>
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
