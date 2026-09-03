import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDkUAbMWSuQcHRz0-cwQjRvE3kXuJqBoX8",
  authDomain: "mis-complaints.firebaseapp.com",
  projectId: "mis-complaints",
  storageBucket: "mis-complaints.firebasestorage.app",
  messagingSenderId: "276652032120",
  appId: "1:276652032120:web:d981177284c52e64b6ad8d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
