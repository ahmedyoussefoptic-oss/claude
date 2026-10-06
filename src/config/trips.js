import { STAGES } from './complaintTypes';
import { userBranches } from '../utils/scope';

// School trips — mirrors the trips section at the end of functions/index.js.
export const TRIP_STAGES = [...STAGES, 'SEN'];
export const TRIP_PAY_METHODS = ['BANK', 'RECEPTION'];
export const TRIP_DECLINE_REASONS = ['COST', 'TIMING', 'FAMILY', 'HEALTH', 'OTHER'];
export const TRIP_RATINGS = ['organization', 'safety', 'benefit', 'cost'];

export const TRIP_STATUS_STYLES = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 border-amber-200',
  OPEN: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-sky-100 text-sky-700 border-sky-200',
  COMPLETED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  CANCELLED: 'bg-rose-100 text-rose-700 border-rose-200',
};
export const TRIP_STATUSES = Object.keys(TRIP_STATUS_STYLES);
// Calendar chip colors per status.
export const TRIP_DOT = {
  DRAFT: 'bg-slate-400', PENDING_APPROVAL: 'bg-amber-500', OPEN: 'bg-emerald-500',
  CLOSED: 'bg-sky-500', COMPLETED: 'bg-indigo-500', CANCELLED: 'bg-rose-400',
};

// Per-student status — same rules as enrollmentStatus() server-side.
export const ENROLLMENT_STATUS_STYLES = {
  NO_RESPONSE: 'bg-slate-100 text-slate-600 border-slate-200',
  DECLINED: 'bg-rose-100 text-rose-700 border-rose-200',
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800 border-amber-200',
  RECEIPT_REVIEW: 'bg-sky-100 text-sky-700 border-sky-200',
  RECEIPT_REJECTED: 'bg-orange-100 text-orange-700 border-orange-200',
  CONFIRMED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};
export const ENROLLMENT_STATUSES = Object.keys(ENROLLMENT_STATUS_STYLES);

export function enrollmentStatus(e, fee) {
  if (!e) return 'NO_RESPONSE';
  if (e.decision === 'DECLINED') return 'DECLINED';
  if (!(fee > 0) || e.payStatus === 'PAID') return 'CONFIRMED';
  if (e.payStatus === 'REVIEW') return 'RECEIPT_REVIEW';
  if (e.payStatus === 'REJECTED') return 'RECEIPT_REJECTED';
  return 'AWAITING_PAYMENT';
}

const hasBranch = (u, b) => u?.role === 'ADMIN' || u?.access === 'all' || userBranches(u).includes(b);

// Same checks as tripPerm in functions/index.js (the server enforces them).
export function tripPermissions(u, trip, uid) {
  const branches = trip?.branches || [];
  const isAdmin = u?.role === 'ADMIN';
  const manage = isAdmin || (!!(u?.perms?.trips || u?.isPrincipal) && branches.some((b) => hasBranch(u, b)));
  const approve = isAdmin || (u?.isPrincipal === true && branches.length > 0 && branches.every((b) => hasBranch(u, b)));
  const finance = isAdmin || (u?.perms?.tripFinance === true && branches.some((b) => hasBranch(u, b)));
  const supervise = manage || finance || (trip?.supervisors || []).includes(uid);
  return { manage, approve, finance, supervise, seeStudents: supervise || approve || (u?.isPrincipal === true && branches.some((b) => hasBranch(u, b))) };
}

export const canCreateTrips = (u) => u?.role === 'ADMIN' || !!u?.perms?.trips || u?.isPrincipal === true;

// Trips on the same day that share a branch and a grade (an empty grade
// list means every grade).
export function tripConflicts(trip, trips) {
  if (!trip?.date) return [];
  const overlap = (a, b) => !a.length || !b.length || a.some((x) => b.includes(x));
  return trips.filter((o) => o.id !== trip.id && o.status !== 'CANCELLED' && o.date === trip.date
    && (o.branches || []).some((b) => (trip.branches || []).includes(b))
    && overlap(o.stages || [], trip.stages || []));
}

export const tripLink = (code) => `${window.location.origin}/trip/${code}`;

// "YYYY-MM-DD" → Date at local noon (avoids timezone day shifts).
export const dayToDate = (day) => {
  const [y, m, d] = String(day || '').split('-').map(Number);
  return y ? new Date(y, m - 1, d, 12) : null;
};
