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
