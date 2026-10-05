import { serverTimestamp } from 'firebase/firestore';

// Fields written when a WhatsApp message to the parent is sent — `kind` is
// 'receipt' or 'resolution'. The sender is stored on the record itself (not
// just in the activity log) so list pages can show who sent it without
// reading every record's log.
export function messageSentFields(kind, user, userData) {
  return {
    [`${kind}MessageSentAt`]: serverTimestamp(),
    [`${kind}MessageSentBy`]: user?.uid || null,
    [`${kind}MessageSentByName`]: userData?.name || user?.email || null,
  };
}
