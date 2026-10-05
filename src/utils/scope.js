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
  return userData?.role === 'ADMIN' || userData?.role === 'CUSTOMER_SERVICE' || userData?.department === 'IT' || userData?.isPrincipal === true || userData?.isQuality === true;
}

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
