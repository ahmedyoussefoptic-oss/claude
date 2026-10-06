import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

// What system-admin (ADMIN) accounts may do, set by the system owner
// ("منشئ النظام") in settings/adminPermissions — a missing key means
// allowed. The owner always has everything. Mirrored in firestore.rules
// (adminPerm) and functions/index.js (ADMIN_CAPS).
export const ADMIN_CAPS = ['settings', 'users', 'manageAdmins', 'archive', 'delete'];
export const DEFAULT_ADMIN_CAPS = Object.fromEntries(ADMIN_CAPS.map((c) => [c, true]));

export function useAdminPermissions() {
  const [caps, setCaps] = useState(DEFAULT_ADMIN_CAPS);
  useEffect(() => onSnapshot(doc(db, 'settings', 'adminPermissions'), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    setCaps(Object.fromEntries(ADMIN_CAPS.map((c) => [c, data[c] !== false])));
  }, () => setCaps(DEFAULT_ADMIN_CAPS)), []);
  return caps;
}

export const isOwner = (userData) => userData?.isOwner === true;

export function adminCan(userData, caps, cap) {
  if (isOwner(userData)) return true;
  return userData?.role === 'ADMIN' && caps[cap] !== false;
}
