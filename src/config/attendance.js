// «الحضور الافتراضي»: a student's status in one virtual class (functions/index.js, vcStatusOf).
export const VC_STATUSES = ['PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED'];
export const VC_STATUS_STYLES = {
  PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LATE: 'bg-amber-50 text-amber-700 border-amber-200',
  PARTIAL: 'bg-orange-50 text-orange-700 border-orange-200',
  ABSENT: 'bg-rose-50 text-rose-700 border-rose-200',
  EXCUSED: 'bg-sky-50 text-sky-700 border-sky-200',
};
export const VC_STATUS_BAR = { PRESENT: 'bg-emerald-500', LATE: 'bg-amber-400', PARTIAL: 'bg-orange-500', ABSENT: 'bg-rose-500', EXCUSED: 'bg-sky-400' };
// Attended in some form: what the attendance rate counts.
export const VC_ATTENDED = ['PRESENT', 'LATE', 'PARTIAL'];
export const vcRate = (counts) => {
  const base = VC_STATUSES.reduce((n, s) => n + (s === 'EXCUSED' ? 0 : counts[s] || 0), 0);
  return base ? Math.round((100 * VC_ATTENDED.reduce((n, s) => n + (counts[s] || 0), 0)) / base) : null;
};
