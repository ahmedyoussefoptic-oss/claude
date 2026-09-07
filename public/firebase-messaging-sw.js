// Handles push notifications while the app tab is not focused or is closed
// entirely. The config values below are the same public web-app config
// already embedded in the client bundle (see src/config/firebase.js) — none
// of this is secret, it just identifies which Firebase project to talk to.
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDkUAbMWSuQcHRz0-cwQjRvE3kXuJqBoX8",
  authDomain: "mis-complaints.firebaseapp.com",
  projectId: "mis-complaints",
  storageBucket: "mis-complaints.firebasestorage.app",
  messagingSenderId: "276652032120",
  appId: "1:276652032120:web:d981177284c52e64b6ad8d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;
  self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.complaintId ? '/complaints' : '/dashboard';
  event.waitUntil(clients.openWindow(url));
});
