import { create } from 'zustand';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import i18n from '../i18n';

const useAuthStore = create((set) => ({
  user: null,
  role: null,
  userData: null,
  loading: true,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  logout: async () => {
    set({ loading: true });
    await signOut(auth);
    set({ user: null, role: null, userData: null, loading: false });
  },

  initialize: () => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // get custom claims if needed, or get user doc from firestore
          const idTokenResult = await user.getIdTokenResult();
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data();

            if (data.active === false) {
              await signOut(auth);
              set({ user: null, role: null, userData: null, loading: false, error: i18n.t('login.accountSuspended') });
              return;
            }

            set({
              user,
              role: data.role || idTokenResult.claims.role || 'spec',
              userData: data,
              loading: false,
              error: null
            });
          } else {
            // User authenticated but no profile in firestore yet
            set({
              user,
              role: idTokenResult.claims.role || 'spec',
              userData: null,
              loading: false,
              error: null
            });
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          set({ user, role: null, userData: null, loading: false, error: error.message });
        }
      } else {
        set({ user: null, role: null, userData: null, loading: false });
      }
    });
  }
}));

export default useAuthStore;
