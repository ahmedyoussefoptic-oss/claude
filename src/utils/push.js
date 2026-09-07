import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, app } from '../config/firebase';

// Firebase Web Push requires a VAPID key pair tied to this specific Firebase
// project — issued from Firebase Console → Project settings → Cloud
// Messaging tab → "Web Push certificates". It is a public key (safe to embed
// client-side), but it can only be generated from that console screen, so it
// is filled in once and kept here rather than passed in from an env var.
const VAPID_KEY = 'BFYyKTYCHtA5wj1V9Ff1gXHRsQGDfZl6O6txJ0wDR8IWNjOBW4U1rCbMC2GCHDBpBxhwsg2Cek27ZAyiGNJ4Ejc';

export function pushSupported() {
  return !!VAPID_KEY && typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

// Requests browser permission (if not already decided) and, once granted,
// registers the service worker and stores the resulting device token on the
// user's Firestore doc so Cloud Functions can push to it (see
// functions/index.js's pushOnNotification).
export async function enablePushNotifications(uid) {
  if (!VAPID_KEY) return { ok: false, reason: 'not-configured' };
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const { getMessaging, getToken } = await import('firebase/messaging');
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: 'no-token' };

    await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });
    return { ok: true };
  } catch (err) {
    console.error('Failed to enable push notifications', err);
    return { ok: false, reason: 'error' };
  }
}
