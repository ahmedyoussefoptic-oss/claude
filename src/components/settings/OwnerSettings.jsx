import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Crown, ShieldCheck, KeyRound, Loader2, Check } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import { ADMIN_CAPS, useAdminPermissions } from '../../config/adminPermissions';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

// Shown to the system owner only: what other system admins may do, and the
// Settings password.
export default function OwnerSettings() {
  const { t } = useTranslation();
  const caps = useAdminPermissions();
  const [savingCap, setSavingCap] = useState(null);
  const [capError, setCapError] = useState(null);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwDone, setPwDone] = useState(null);

  useEffect(() => onSnapshot(doc(db, 'settings', 'security'), (snap) => setLockEnabled(snap.exists() && snap.data().lockEnabled === true), () => {}), []);

  const toggleCap = async (cap) => {
    setSavingCap(cap);
    setCapError(null);
    try {
      await setDoc(doc(db, 'settings', 'adminPermissions'), { ...caps, [cap]: !caps[cap] }, { merge: true });
    } catch (err) {
      setCapError(err.message);
    } finally {
      setSavingCap(null);
    }
  };

  const savePassword = async (remove) => {
    setPwError(null);
    setPwDone(null);
    if (!remove && (next.length < 6 || next !== confirm)) {
      setPwError(next.length < 6 ? t('ownerSettings.pwTooShort') : t('ownerSettings.pwMismatch'));
      return;
    }
    setPwBusy(true);
    try {
      const { data } = await httpsCallable(functions, 'setSettingsPassword')({ current, next: remove ? '' : next });
      setPwDone(data.lockEnabled ? t('ownerSettings.pwSaved') : t('ownerSettings.pwRemoved'));
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-amber-50 to-white rounded-2xl border border-amber-200 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><Crown className="w-5 h-5 text-amber-500" />{t('ownerSettings.title')}</h3>
        <p className="text-sm text-slate-500 mt-1">{t('ownerSettings.subtitle')}</p>
      </div>

      <section>
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-primary" />{t('ownerSettings.adminCapsTitle')}</p>
        <p className="text-xs text-slate-500 mb-3">{t('ownerSettings.adminCapsHint')}</p>
        <div className="space-y-2">
          {ADMIN_CAPS.map((cap) => (
            <label key={cap} className="flex items-start gap-3 bg-white border border-slate-100 rounded-xl p-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={caps[cap]} disabled={savingCap === cap} onChange={() => toggleCap(cap)} />
              <span>
                <span className="text-sm font-medium text-slate-800 flex items-center gap-2">{t(`ownerSettings.caps.${cap}`)}{savingCap === cap && <Loader2 className="w-3.5 h-3.5 animate-spin" />}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{t(`ownerSettings.capsHint.${cap}`)}</span>
              </span>
            </label>
          ))}
        </div>
        {capError && <p className="text-sm text-red-600 mt-2">{capError}</p>}
      </section>

      <section>
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2"><KeyRound className="w-4 h-4 text-primary" />{t('ownerSettings.pwTitle')}</p>
        <p className="text-xs text-slate-500 mb-3">{lockEnabled ? t('ownerSettings.pwOnHint') : t('ownerSettings.pwOffHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {lockEnabled && (
            <div><label className="block text-xs text-slate-600 mb-1">{t('ownerSettings.pwCurrent')}</label><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} /></div>
          )}
          <div><label className="block text-xs text-slate-600 mb-1">{t('ownerSettings.pwNew')}</label><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} /></div>
          <div><label className="block text-xs text-slate-600 mb-1">{t('ownerSettings.pwConfirm')}</label><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></div>
        </div>
        {pwError && <p className="text-sm text-red-600 mt-2">{pwError}</p>}
        {pwDone && <p className="text-sm text-emerald-700 mt-2 flex items-center gap-1"><Check className="w-4 h-4" />{pwDone}</p>}
        <div className="flex flex-wrap gap-2 mt-3">
          <button disabled={pwBusy || !next} onClick={() => savePassword(false)} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {pwBusy && <Loader2 className="w-4 h-4 animate-spin" />}{lockEnabled ? t('ownerSettings.pwChange') : t('ownerSettings.pwSet')}
          </button>
          {lockEnabled && (
            <button disabled={pwBusy || !current} onClick={() => savePassword(true)} className="px-4 py-2 rounded-xl text-sm text-rose-600 border border-rose-200 bg-white disabled:opacity-50">{t('ownerSettings.pwRemove')}</button>
          )}
        </div>
      </section>
    </div>
  );
}
