import { useTranslation } from 'react-i18next';
import { Bell, Smartphone, Mail } from 'lucide-react';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '../../config/notificationCategories';

const CHANNEL_ICONS = { push: Smartphone, email: Mail };

// Toggles for which notifications a user receives, and through which
// channels besides the in-app bell. `prefs` / `channels` are the user-doc
// maps where a missing key means "on".
export default function NotificationPrefsEditor({ prefs = {}, channels = {}, onChange }) {
  const { t } = useTranslation();
  const isOn = (map, key) => map[key] !== false;
  const setAll = (on) => onChange({
    prefs: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, on])),
    channels: Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, on])),
  });
  const toggle = (kind, key) => {
    const map = kind === 'prefs' ? prefs : channels;
    onChange({ prefs, channels, [kind]: { ...map, [key]: !isOn(map, key) } });
  };
  const box = (on) => `w-9 h-5 rounded-full relative transition-colors shrink-0 ${on ? 'bg-primary' : 'bg-slate-300'}`;
  const knob = (on) => `absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'right-[18px]'}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />{t('notificationPrefs.title')}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAll(true)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">{t('notificationPrefs.enableAll')}</button>
          <button type="button" onClick={() => setAll(false)} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">{t('notificationPrefs.disableAll')}</button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {NOTIFICATION_CATEGORIES.map((c) => {
          const on = isOn(prefs, c.id);
          return (
            <button key={c.id} type="button" role="switch" aria-checked={on} onClick={() => toggle('prefs', c.id)} className="flex items-center gap-3 text-right p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50">
              <span className={box(on)}><span className={knob(on)} /></span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${on ? 'text-slate-800' : 'text-slate-400'}`}>{t(`notificationPrefs.categories.${c.id}`)}</span>
                <span className="block text-[11px] text-slate-500">{t(`notificationPrefs.hints.${c.id}`)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="pt-2 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-600 mb-2">{t('notificationPrefs.channelsTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {NOTIFICATION_CHANNELS.map((ch) => {
            const on = isOn(channels, ch);
            const Icon = CHANNEL_ICONS[ch];
            return (
              <button key={ch} type="button" role="switch" aria-checked={on} onClick={() => toggle('channels', ch)} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 hover:bg-slate-50">
                <span className={box(on)}><span className={knob(on)} /></span>
                <Icon className={`w-4 h-4 ${on ? 'text-slate-700' : 'text-slate-300'}`} />
                <span className={`text-sm ${on ? 'text-slate-800' : 'text-slate-400'}`}>{t(`notificationPrefs.channels.${ch}`)}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">{t('notificationPrefs.channelsHint')}</p>
      </div>
    </div>
  );
}
