import { create } from 'zustand';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// The system's look: «الكلاسيكي» (classic, the original) or «الكحلي» (navy,
// the parents' links look). Applied as html[data-design]; remembered in the
// browser for an instant start and on the user's account so it follows them
// to their other devices.
const KEY = 'mis-design';
export const DESIGNS = ['classic', 'navy'];
const clean = (d) => (d === 'navy' ? 'navy' : 'classic');

export function readDesign() {
  try { return clean(localStorage.getItem(KEY)); } catch { return 'classic'; }
}
export function applyDesign(d) {
  document.documentElement.dataset.design = clean(d);
}

const useDesignStore = create((set, get) => ({
  design: readDesign(),
  // save: the signed-in user's id, to keep the choice on their account.
  setDesign: (d, uid = null) => {
    const design = clean(d);
    applyDesign(design);
    try { localStorage.setItem(KEY, design); } catch { /* storage unavailable */ }
    if (get().design !== design) set({ design });
    if (uid) updateDoc(doc(db, 'users', uid), { uiDesign: design }).catch(() => { /* kept on this device */ });
  },
}));

export default useDesignStore;
