import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Your web app's Firebase configuration
// Another school's copy sets these in a .env file (VITE_FIREBASE_*, see
// setup/README); without one the original project is used.
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDkUAbMWSuQcHRz0-cwQjRvE3kXuJqBoX8",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "mis-complaints.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "mis-complaints",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "mis-complaints.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "276652032120",
  appId: env.VITE_FIREBASE_APP_ID || "1:276652032120:web:d981177284c52e64b6ad8d"
};
// Cloud Functions region (callable URLs, the WhatsApp delivery-report URL).
export const FUNCTIONS_REGION = env.VITE_FUNCTIONS_REGION || "us-central1";
// The push service worker can't read the build env, so another school's
// copy passes its config in the script URL (the original keeps the plain
// URL, so existing devices keep their push registration).
export const MESSAGING_SW_URL = env.VITE_FIREBASE_PROJECT_ID
  ? `/firebase-messaging-sw.js?${new URLSearchParams(firebaseConfig).toString()}`
  : "/firebase-messaging-sw.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);
