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
// منصة المكتشف: the owner and the users the owner shared it with.
// «نشاط المستخدمين»: the owner and the users the owner shared it with.
export const canSeeActivity = (userData) => isOwner(userData) || (userData?.activityAccess === true && userData?.active !== false);
export const canSeePlatform = (userData) => isOwner(userData) || (userData?.platformAccess === true && userData?.active !== false);
// Leave requests (الاستئذانات): the platform users hold every step; other
// staff the steps given to them on the Users page (approve / call / exit).
export const LEAVE_ROLES = ['approve', 'call', 'exit'];
export const leaveRoleOf = (userData, role) => canSeePlatform(userData) || (userData?.active !== false && userData?.leaveRoles?.[role] === true);
export const canSeeLeaves = (userData) => LEAVE_ROLES.some((r) => leaveRoleOf(userData, r));

export function adminCan(userData, caps, cap) {
  if (isOwner(userData)) return true;
  return userData?.role === 'ADMIN' && caps[cap] !== false;
}
