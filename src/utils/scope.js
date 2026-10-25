import { where } from 'firebase/firestore';
import { auth } from '../config/firebase';

// Normalizes a staff user's branch scope into an array. Users used to hold
// a single scalar `branch` field; they can now be scoped to several
// branches at once via `branches` (array). Falls back to the legacy single
// `branch` field for accounts created before this existed, so nothing
// needs a data migration. `access === 'all'` users have no meaningful
// branch list — callers should check `access` separately before relying
// on this.
export function userBranches(userData) {
  if (Array.isArray(userData?.branches) && userData.branches.length) return userData.branches;
  if (userData?.branch) return [userData.branch];
  return [];
}

// Firestore's `in` operator requires a non-empty array (max 30 entries).
// A user scoped to zero branches should see nothing, matching the existing
// '__NONE__' sentinel used with `where('branch', '==', ...)`.
export function branchScopeConstraintValues(userData) {
  const list = userBranches(userData);
  return list.length ? list.slice(0, 30) : ['__NONE__'];
}

// Mirrors firestore.rules' canAccessTechSupport(): tech-support tickets hold
// national IDs and account credentials, so only admins, Customer Service,
// the IT department, and school principals (who are auto-assigned every
// public-link submission in their branch) may open that module.
export function canAccessTechSupport(userData) {
  return canSeeModule(userData, 'techSupport');
}
function techSupportByRole(userData) {
  return userData?.role === 'ADMIN' || userData?.role === 'CUSTOMER_SERVICE' || userData?.department === 'IT' || userData?.isPrincipal === true || userData?.isQuality === true;
}

// Per-employee sections (Users page → «الأقسام التي يطّلع عليها»), stored as
// `modules: { key: true|false }`. A missing key keeps the role's default,
// so accounts created before this existed see exactly what they saw.
// Admins see everything, reception only the branch visits, and
// tripsAccess 'tripsOnly' / 'none' still apply. Mirrored in firestore.rules
// (modAllowed / canAccessTechSupport) and functions (cleanUserModules).
export const MODULE_KEYS = ['dashboard', 'complaints', 'techSupport', 'lostFound', 'visits', 'trips', 'students', 'search', 'flowMap', 'reports', 'calls', 'waReports', 'assistant'];
export function moduleDefault(userData, key) {
  if (key === 'techSupport') return techSupportByRole(userData);
  if (key === 'trips') return tripsAccessOf(userData) !== 'none';
  // Call analytics (Bevatel) is given per employee.
  if (key === 'calls' || key === 'waReports') return false;
  return true;
}
export function canSeeModule(userData, key) {
  if (!userData) return false;
  if (userData.role === 'ADMIN') return true;
  if (userData.role === 'RECEPTIONIST') return key === 'visits';
  const trips = tripsAccessOf(userData);
  if (trips === 'tripsOnly') return key === 'trips';
  if (key === 'trips' && trips === 'none') return false;
  const v = userData.modules?.[key];
  return typeof v === 'boolean' ? v : moduleDefault(userData, key);
}

// 'assigned' — the employee only sees the complaints, tickets and lost &
// found reports assigned to them; 'branch' (default) — everything in their
// branches (or all branches with access 'all').
export const recordScopeOf = (userData) => (userData?.role !== 'ADMIN' && userData?.recordScope === 'assigned' ? 'assigned' : 'branch');

// The Firestore filter every list query of complaints / tech tickets /
// lost & found adds so it matches the rules: assigned-to-me, or the
// user's branches, or nothing for admins and all-branch accounts.
export function scopeConstraints(userData, { adminAll = false } = {}) {
  if (!userData || (adminAll && userData.role === 'ADMIN')) return [];
  if (recordScopeOf(userData) === 'assigned') return [where('assignedTo', 'array-contains', auth.currentUser?.uid || '__NONE__')];
  if (userData.access === 'all') return [];
  return [where('branch', 'in', branchScopeConstraintValues(userData))];
}

// Per-user access to the school trips section (set on the Users page,
// mirrored in firestore.rules tripsAccess()): 'all' (default) — everything,
// 'tripsOnly' — only the trips section, 'none' — everything but trips.
export function tripsAccessOf(userData) {
  if (userData?.role === 'ADMIN') return 'all';
  return ['tripsOnly', 'none'].includes(userData?.tripsAccess) ? userData.tripsAccess : 'all';
}
export const canSeeTrips = (userData) => canSeeModule(userData, 'trips');

// A staff user may be limited to certain grades (`stages`, e.g. G1..G5) for
// auto-assignment. An empty/missing list means every grade — the default,
// so existing accounts keep their behavior. Mirrored in functions/index.js.
export function coversStage(userData, stage) {
  const stages = Array.isArray(userData?.stages) ? userData.stages : [];
  return !stages.length || !stage || stages.includes(stage);
}

// Same idea per curriculum/section (`curricula`, the complaint/ticket
// `department` ids — AMERICAN, BRITISH, ...); empty/missing = every one.
export function coversCurriculum(userData, curriculum) {
  const list = Array.isArray(userData?.curricula) ? userData.curricula : [];
  return !list.length || !curriculum || list.includes(curriculum);
}
