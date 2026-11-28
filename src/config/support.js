import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// «برامج الدعم» — see functions/support.js.
export const callSupport = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
export const SUPPORT_TYPES = ['REMEDIAL', 'ENRICHMENT'];
// The curriculum (المنهج) a student is nominated under / a group is for.
export const SUPPORT_CURRICULA = ['AMERICAN', 'BRITISH'];
export const CURRICULUM_STYLE = { AMERICAN: 'bg-blue-50 text-blue-700 border-blue-200', BRITISH: 'bg-rose-50 text-rose-700 border-rose-200' };
export const SUPPORT_STATUSES = ['NOMINATED', 'APPROVED', 'PENDING_CONSENT', 'CONSENTED', 'DECLINED', 'PLEDGE_SENT', 'PLEDGE_SIGNED', 'REJECTED', 'WITHDRAWN'];
export const STATUS_STYLE = {
  NOMINATED: 'bg-slate-50 text-slate-700 border-slate-200',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-200',
  PENDING_CONSENT: 'bg-amber-50 text-amber-800 border-amber-200',
  CONSENTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DECLINED: 'bg-rose-50 text-rose-700 border-rose-200',
  PLEDGE_SENT: 'bg-orange-50 text-orange-700 border-orange-200',
  PLEDGE_SIGNED: 'bg-violet-50 text-violet-700 border-violet-200',
  REJECTED: 'bg-slate-100 text-slate-500 border-slate-200',
  WITHDRAWN: 'bg-slate-100 text-slate-500 border-slate-200',
};
export const TYPE_STYLE = { REMEDIAL: 'bg-amber-50 text-amber-800 border-amber-200', ENRICHMENT: 'bg-sky-50 text-sky-700 border-sky-200' };
export const MARKS = ['P', 'L', 'A', 'E'];
// The Cycle (round) a student came in with — Cycle 1 carried over, Cycle 2
// new — in the same groups; only a tag.
export const ROUNDS = [1, 2, 3, 4];
export const roundLabel = (n) => `Cycle ${n}`;
export const ROUND_STYLE = { 1: 'bg-indigo-50 text-indigo-700 border-indigo-200', 2: 'bg-teal-50 text-teal-700 border-teal-200', 3: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', 4: 'bg-lime-50 text-lime-700 border-lime-200' };
export const MARK_STYLE = {
  P: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-200 bg-white' },
  L: { on: 'bg-amber-500 text-white border-amber-500', off: 'text-amber-700 border-amber-200 bg-white' },
  A: { on: 'bg-rose-600 text-white border-rose-600', off: 'text-rose-700 border-rose-200 bg-white' },
  E: { on: 'bg-slate-600 text-white border-slate-600', off: 'text-slate-600 border-slate-200 bg-white' },
};
export const WEEKDAYS = [0, 1, 2, 3, 4];
export const SUBJECTS = ['اللغة العربية', 'اللغة الإنجليزية', 'الرياضيات', 'العلوم', 'الفيزياء', 'الكيمياء', 'الأحياء', 'التربية الإسلامية', 'الدراسات الاجتماعية', 'الحاسب الآلي', 'اللغة الفرنسية'];
export const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
export const time12 = (t) => { const [h, m] = String(t || '').split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}`; };
// Attendance rate of an enrollment: present + late over the marked classes.
export const attRate = (att = {}) => { const n = (att.P || 0) + (att.L || 0) + (att.A || 0) + (att.E || 0); return n ? Math.round((((att.P || 0) + (att.L || 0)) / n) * 100) : null; };
// The class teachers' link: each student's rating at a class, and the final evaluation.
export const RATINGS = ['EXCELLENT', 'GOOD', 'WEAK'];
export const RATING_STYLE = {
  EXCELLENT: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-200 bg-white' },
  GOOD: { on: 'bg-sky-600 text-white border-sky-600', off: 'text-sky-700 border-sky-200 bg-white' },
  WEAK: { on: 'bg-amber-500 text-white border-amber-500', off: 'text-amber-700 border-amber-200 bg-white' },
};
export const FINALS = ['CLEAR', 'PARTIAL', 'NONE'];
export const FINAL_STYLE = {
  CLEAR: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-200 bg-white', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PARTIAL: { on: 'bg-sky-600 text-white border-sky-600', off: 'text-sky-700 border-sky-200 bg-white', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  NONE: { on: 'bg-rose-600 text-white border-rose-600', off: 'text-rose-700 border-rose-200 bg-white', pill: 'bg-rose-50 text-rose-700 border-rose-200' },
};
