import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, BellRing, BellOff, Settings2, X, Loader2 } from 'lucide-react';
import NotificationPrefsEditor from '../common/NotificationPrefsEditor';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useNotifications } from '../../hooks/useNotifications';
import useAuthStore from '../../stores/useAuthStore';
import { enablePushNotifications, pushSupported } from '../../utils/push';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

// Maps each notification `type` (set server-side in functions/index.js'
// notifyUsers() calls) to the page that can open the record it points to
// via ?openId=<doc id> — complaints, tech-support tickets, and lost & found
// items each live on their own list page. Falls back to complaints, the
// most common case, for any type not listed here.
const NOTIFICATION_TARGET_PATH = {
  IT_ASSIGNED: '/tech-support',
  IT_ESCALATED: '/tech-support',
  IT_INTERNAL_COMMENT_ADDED: '/tech-support',
  LF_ASSIGNED: '/lost-found',
  ASSIGNED: '/complaints',
  URGENT_CREATED: '/complaints',
  ESCALATED: '/complaints',
  SOLVED_NOTIFY_RECEIVER: '/complaints',
  SLA_WARNING: '/complaints',
  INTERNAL_COMMENT_ADDED: '/complaints',
  VISIT_ARRIVED: '/complaints',
  APPOINTMENT_REQUESTED: '/complaints',
  VIEWED: '/complaints',
  IT_VIEWED: '/tech-support',
  PARTIAL_SOLUTION_ADDED: '/complaints',
  REOPENED: '/complaints',
  IT_REOPENED: '/tech-support',
  TRIP_APPROVAL_REQUESTED: '/trips',
  TRIP_DECIDED: '/trips',
  TRIP_RECEIPT: '/trips',
};

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const fire = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => ctx.close();
    };
    // A freshly-created AudioContext can start "suspended" under the
    // browser's autoplay policy when it isn't created in direct response to
    // a user gesture (exactly the case here — a Firestore realtime update
    // triggers this, not a click) — no error is thrown, it just silently
    // produces no sound unless explicitly resumed first.
    if (ctx.state === 'suspended') {
      ctx.resume().then(fire).catch(() => {});
    } else {
      fire();
    }
  } catch {
    // Web Audio unavailable — silently skip.
  }
}

// Mirrors the unread count onto the installed PWA's home-screen icon badge
// (Android/desktop Chrome & Edge; iOS Safari doesn't support this API yet
// for home-screen web apps, so this is a no-op there).
function setAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  try {
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  } catch {
    // Badging API unavailable in this context — silently skip.
  }
}

export default function NotificationBell() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const navigate = useNavigate();
  const { user, userData } = useAuthStore();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState({ prefs: {}, channels: {} });
  const [prefsSaving, setPrefsSaving] = useState(false);
  const openPrefs = () => {
    setPrefsDraft({ prefs: userData?.notificationPrefs || {}, channels: userData?.notificationChannels || {} });
    setOpen(false);
    setPrefsOpen(true);
  };
  const savePrefs = async () => {
    if (!user) return;
    setPrefsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { notificationPrefs: prefsDraft.prefs, notificationChannels: prefsDraft.channels });
      // userData is loaded once at sign-in — keep it in step with what was saved.
      useAuthStore.setState((st) => ({ userData: { ...st.userData, notificationPrefs: prefsDraft.prefs, notificationChannels: prefsDraft.channels } }));
      setPrefsOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setPrefsSaving(false);
    }
  };
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const [pushPermission, setPushPermission] = useState(() => (pushSupported() ? Notification.permission : 'unsupported'));
  const [enablingPush, setEnablingPush] = useState(false);
  const ref = useRef(null);
  const knownIds = useRef(new Set());
  const isFirstLoad = useRef(true);
  const unreadCountRef = useRef(0);

  const unreadCount = notifications.filter((n) => !n.read).length;
  unreadCountRef.current = unreadCount;

  useEffect(() => {
    setAppBadge(unreadCount);
  }, [unreadCount]);

  // Repeats the chime every 5 minutes for as long as anything is still
  // unread, so a notification left unopened doesn't just chime once and go
  // silent — a single continuous timer (not reset on every notification
  // change) reads the current count through a ref each time it fires, so
  // new notifications arriving mid-cycle don't restart the 5-minute clock.
  useEffect(() => {
    const interval = setInterval(() => {
      if (unreadCountRef.current > 0) playChime();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If the browser already granted permission in a past session, silently
  // (re-)register the device token — tokens can rotate, and arrayUnion on
  // the write side means re-registering the same token is a no-op.
  useEffect(() => {
    if (!user || pushPermission !== 'granted') return;
    enablePushNotifications(user.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, pushPermission]);

  const handleEnablePush = async () => {
    if (!user || enablingPush) return;
    setEnablingPush(true);
    const result = await enablePushNotifications(user.uid);
    setEnablingPush(false);
    setPushPermission(pushSupported() ? Notification.permission : 'unsupported');
    if (!result.ok) {
      console.warn('Push notifications not enabled:', result.reason);
    }
  };

  // Play a short chime for notifications that arrive after the initial load,
  // so staff notice new assignments/reminders/escalations without watching
  // the screen — the visual badge above covers the "مرئي" half.
  useEffect(() => {
    if (isFirstLoad.current) {
      notifications.forEach((n) => knownIds.current.add(n.id));
      isFirstLoad.current = false;
      return;
    }
    const hasNew = notifications.some((n) => !n.read && !knownIds.current.has(n.id));
    notifications.forEach((n) => knownIds.current.add(n.id));
    if (hasNew) playChime();
  }, [notifications]);

  const markRead = async (n) => {
    if (n.read) return;
    try {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    } catch (err) {
      console.error(err);
    }
  };

  // Closes the dropdown and jumps straight to the record the notification
  // is about — previously this only marked it read, leaving staff to close
  // the dropdown and find the record themselves in the list.
  const handleNotificationClick = (n) => {
    markRead(n);
    setOpen(false);
    if (n.complaintId) {
      const path = NOTIFICATION_TARGET_PATH[n.type] || '/complaints';
      navigate(`${path}?openId=${encodeURIComponent(n.complaintId)}`);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <p className="font-bold text-sm text-slate-900">{t('notifications.title')}</p>
              <button onClick={openPrefs} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary" title={t('notificationPrefs.title')}>
                <Settings2 className="w-3.5 h-3.5" />
                {t('notificationPrefs.myPrefs')}
              </button>
            </div>
            {pushPermission === 'default' && (
              <button
                onClick={handleEnablePush}
                disabled={enablingPush}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-60"
              >
                <BellRing className="w-3.5 h-3.5" />
                {enablingPush ? '...' : t('notifications.enablePush')}
              </button>
            )}
            {pushPermission === 'denied' && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <BellOff className="w-3.5 h-3.5 shrink-0" />
                {t('notifications.pushBlocked')}
              </p>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">{t('notifications.empty')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`px-4 py-3 text-sm cursor-pointer hover:bg-slate-50 transition-colors ${!n.read ? 'bg-primary/5' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />}
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{n.title}</p>
                      <p className="text-slate-500 mt-0.5">{n.body}</p>
                      <p className="text-xs text-slate-400 mt-1" dir="ltr">
                        {n.createdAt ? formatDistanceToNow(n.createdAt.toDate(), { addSuffix: true, locale: dateLocale }) : ''}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {prefsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-[120] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setPrefsOpen(false); }}>
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <p className="font-bold text-slate-900">{t('notificationPrefs.myPrefsTitle')}</p>
              <button onClick={() => setPrefsOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 max-h-[70vh] overflow-y-auto">
              <NotificationPrefsEditor prefs={prefsDraft.prefs} channels={prefsDraft.channels} onChange={setPrefsDraft} />
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setPrefsOpen(false)} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
              <button onClick={savePrefs} disabled={prefsSaving} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-60">
                {prefsSaving && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
