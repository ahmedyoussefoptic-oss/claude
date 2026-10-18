// Handles push notifications while the app tab is not focused or is closed
// entirely. The config values below are the same public web-app config
// already embedded in the client bundle (see src/config/firebase.js) — none
// of this is secret, it just identifies which Firebase project to talk to.
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

// Another school's copy registers this script with its config in the URL
// (see MESSAGING_SW_URL in src/config/firebase.js).
const swParams = new URLSearchParams(self.location.search);
firebase.initializeApp({
  apiKey: swParams.get('apiKey') || "AIzaSyDkUAbMWSuQcHRz0-cwQjRvE3kXuJqBoX8",
  authDomain: swParams.get('authDomain') || "mis-complaints.firebaseapp.com",
  projectId: swParams.get('projectId') || "mis-complaints",
  storageBucket: swParams.get('storageBucket') || "mis-complaints.firebasestorage.app",
  messagingSenderId: swParams.get('messagingSenderId') || "276652032120",
  appId: swParams.get('appId') || "1:276652032120:web:d981177284c52e64b6ad8d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;
  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    data: payload.data || {},
  }).then(() => {
    // Mirrors the count of still-pending OS notifications from this app
    // onto the installed PWA's home-screen icon badge — an approximation
    // (it can't see the app's actual unread count while it's closed), but
    // NotificationBell.jsx corrects it to the real count as soon as the app
    // is next opened. Unsupported on iOS Safari.
    if ('setAppBadge' in self.navigator) {
      self.registration.getNotifications().then((notifs) => {
        self.navigator.setAppBadge(notifs.length).catch(() => {});
      });
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.complaintId ? '/complaints' : '/dashboard';
  event.waitUntil(clients.openWindow(url));
});
