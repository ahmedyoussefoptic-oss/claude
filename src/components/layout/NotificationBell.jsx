import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useNotifications } from '../../hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
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
  } catch {
    // Web Audio unavailable or blocked by the browser's autoplay policy — silently skip.
  }
}

export default function NotificationBell() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const knownIds = useRef(new Set());
  const isFirstLoad = useRef(true);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-900">
            {t('notifications.title')}
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">{t('notifications.empty')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  onClick={() => markRead(n)}
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
    </div>
  );
}
