import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEFAULT_TEMPLATES } from '../utils/whatsapp';

// Live-syncs settings/messageTemplates, falling back to the built-in
// defaults until an admin edits them in Settings (or if the doc is missing).
export function useMessageTemplates() {
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'messageTemplates'),
      (snap) => {
        setTemplates(snap.exists() ? { ...DEFAULT_TEMPLATES, ...snap.data() } : DEFAULT_TEMPLATES);
      },
      () => setTemplates(DEFAULT_TEMPLATES)
    );
    return () => unsubscribe();
  }, []);

  return templates;
}
