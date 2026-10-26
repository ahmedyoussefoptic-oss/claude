import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

// «نشاط المستخدمين»: while the app is open and visible, each signed-in user
// writes presence/<uid> once a minute (and on page changes), so the owner
// sees who is online now and where. Closing the tab marks them offline.
const BEAT_MS = 60 * 1000;
const device = () => {
  const ua = navigator.userAgent || '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return `${os}${browser ? ` · ${browser}` : ''}`;
};

export function startPresence(uid, name, getPage) {
  const ref = doc(db, 'presence', uid);
  const beat = (extra = {}) => setDoc(ref, { name: name || '', lastSeenAt: serverTimestamp(), page: getPage(), device: device(), online: true, ...extra }, { merge: true }).catch(() => {});
  beat({ sessionStartAt: serverTimestamp() });
  const timer = setInterval(() => { if (document.visibilityState === 'visible') beat(); }, BEAT_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
  const onLeave = () => { setDoc(ref, { online: false, lastSeenAt: serverTimestamp() }, { merge: true }).catch(() => {}); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onLeave);
  return {
    pageChanged: () => beat(),
    stop: () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', onLeave); onLeave(); },
  };
}
