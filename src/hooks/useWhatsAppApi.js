import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

export const DEFAULT_WA_API = {
  enabled: false,
  autoSend: true,
  language: 'ar',
  templates: {
    complaintReceipt: 'complaint_receipt',
    complaintResolution: 'complaint_resolution',
    techReceipt: 'tech_receipt',
    techResolution: 'tech_resolution',
    visitMet: 'visit_thanks',
    lostFoundReceipt: 'lostfound_receipt',
    lostFoundReturned: 'lostfound_returned',
  },
};

// Live-syncs settings/whatsappApi (Taqnyat WhatsApp Business API template
// names + on/off switch). Sending itself happens server-side in the
// sendWhatsAppApiMessage Cloud Function, which holds the API token.
export function useWhatsAppApi() {
  const [config, setConfig] = useState(DEFAULT_WA_API);
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'whatsappApi'),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setConfig({ ...DEFAULT_WA_API, ...data, templates: { ...DEFAULT_WA_API.templates, ...(data.templates || {}) } });
      },
      () => setConfig(DEFAULT_WA_API)
    );
    return () => unsubscribe();
  }, []);
  return config;
}
