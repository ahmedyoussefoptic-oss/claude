import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Lock, Loader2, KeyRound } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useAdminPermissions, adminCan } from '../../config/adminPermissions';

// Guards the Settings page: the admin capability "settings" (set by the
// system owner) and, when the owner has set one, the Settings password.
// firestore.rules enforce both on every write (adminPerm / settingsUnlocked);
// this only decides what to show.
export default function SettingsGate({ children }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const caps = useAdminPermissions();
  const [lockEnabled, setLockEnabled] = useState(null);
  const [unlockedUntil, setUnlockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => onSnapshot(doc(db, 'settings', 'security'), (snap) => setLockEnabled(snap.exists() && snap.data().lockEnabled === true), () => setLockEnabled(false)), []);
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'settingsUnlocks', user.uid), (snap) => setUnlockedUntil(snap.exists() ? snap.data().expiresAt?.toMillis?.() || 0 : 0), () => setUnlockedUntil(0));
  }, [user]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!adminCan(userData, caps, 'settings')) {
    return <p className="max-w-xl mx-auto mt-20 text-center text-slate-500">{t('ownerSettings.noSettingsAccess')}</p>;
  }
  if (lockEnabled === null) return <div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;

  const unlocked = !lockEnabled || unlockedUntil > now;
  if (unlocked) {
    return (
      <>
        {lockEnabled && (
          <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm rounded-xl px-4 py-2">
            <span className="flex items-center gap-2"><KeyRound className="w-4 h-4" />{t('ownerSettings.unlockedUntil', { minutes: Math.max(1, Math.round((unlockedUntil - now) / 60000)) })}</span>
            <button onClick={() => httpsCallable(functions, 'lockSettings')().catch(() => {})} className="px-3 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-700 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />{t('ownerSettings.lockNow')}</button>
          </div>
        )}
        {children}
      </>
    );
  }

  const unlock = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, 'unlockSettings')({ password });
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={unlock} className="max-w-sm mx-auto mt-16 bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4 text-center">
      <div className="w-14 h-14 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto"><Lock className="w-7 h-7" /></div>
      <h2 className="text-lg font-bold text-slate-900">{t('ownerSettings.lockedTitle')}</h2>
      <p className="text-sm text-slate-500">{t('ownerSettings.lockedHint')}</p>
      <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy || !password} className="w-full py-2.5 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-60">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('ownerSettings.unlock')}
      </button>
    </form>
  );
}
