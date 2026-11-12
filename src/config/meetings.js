import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { rosterClassCode } from '../utils/classFilter';

// «اجتماعات أولياء الأمور» — shared constants (see functions/meetings.js).
export const MEETING_TYPES = ['REQUESTS', 'BOTH', 'INDIVIDUAL', 'GENERAL'];
// Interviews on request (no appointments): who the parent can ask to meet.
export const STAFF_ROLES = ['TEACHER', 'ACADEMIC', 'ADMIN'];
// The managers' positions (what parents choose from) and the subjects a
// subject supervisor can be for.
export const STAFF_POSITIONS = {
  ADMIN: ['PRINCIPAL', 'VICE_PRINCIPAL', 'COUNSELOR'],
  ACADEMIC: ['ACADEMIC_DIRECTOR', 'ACADEMIC_DEPUTY', 'SUBJECT_SUPERVISOR'],
};
export const SUBJECTS = ['ARABIC', 'ENGLISH', 'MATH', 'SCIENCE', 'ISLAMIC', 'QURAN', 'SOCIAL', 'ICT', 'FRENCH', 'ART', 'PE', 'LIFE_SKILLS'];
// The label of a staff member's position ('' when none is set).
export const positionLabel = (t, x) => {
  if (!x?.position) return '';
  if (x.position === 'SUBJECT_SUPERVISOR') {
    return x.posSubject ? t('meetings.positions.supervisorOf', { subject: t(`meetings.subjects.${x.posSubject}`) }) : t('meetings.positions.SUBJECT_SUPERVISOR');
  }
  return t(`meetings.positions.${x.position}`);
};
// Who came for the family: their relation to the student.
export const RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'GRANDFATHER', 'GRANDMOTHER', 'UNCLE', 'AUNT', 'GUARDIAN', 'OTHER'];
// Branches where only women attend parent meetings (as in functions/meetings.js).
export const WOMEN_ONLY_BRANCHES = ['AL_NAEEM', 'AL_ZAHRA', 'AL_SHATI', 'AL_SALAMA_GIRLS', 'DOWN_TOWN_GIRLS'];
export const MALE_RELATIONS = ['FATHER', 'BROTHER', 'GRANDFATHER', 'UNCLE'];
export const isWomenOnly = (students) => (students || []).length > 0 && students.every((s) => WOMEN_ONLY_BRANCHES.includes(s.branch));
export const relationsFor = (womenOnly) => (womenOnly ? RELATIONS.filter((r) => !MALE_RELATIONS.includes(r)) : RELATIONS);
export const isRequests = (m) => m?.type === 'REQUESTS';
export const REQUEST_STATUS_STYLES = {
  REQUESTED: 'bg-slate-50 text-slate-600 border-slate-200',
  DIRECTED: 'bg-amber-50 text-amber-800 border-amber-200',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border-sky-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-rose-50 text-rose-600 border-rose-200',
};
export const MEETING_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'];
export const MEETING_STATUS_STYLES = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  OPEN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-sky-50 text-sky-700 border-sky-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200',
};
export const RESPONSE_STYLES = {
  ATTEND: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REMOTE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DECLINE: 'bg-rose-50 text-rose-700 border-rose-200',
  '': 'bg-slate-50 text-slate-500 border-slate-200',
};
export const WA_STATUS_STYLES = {
  read: 'text-sky-600', delivered: 'text-emerald-600', sent: 'text-slate-600', manual: 'text-slate-600',
  failed: 'text-rose-600', pending: 'text-slate-400', noPhone: 'text-amber-600', walkIn: 'text-slate-400',
};
export const FOLLOW_TYPES = ['ACADEMIC', 'BEHAVIORAL', 'ADMINISTRATIVE', 'FINANCE'];
export const isIndividual = (m) => m?.type === 'INDIVIDUAL' || m?.type === 'BOTH';

export const callMeeting = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

// "13:30" → "1:30 م" / "1:30 PM".
export function meetingTime(hhmm, lang = 'ar') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return hhmm || '';
  const h = Number(m[1]);
  const pm = h >= 12;
  return `${h % 12 || 12}:${m[2]} ${lang === 'ar' ? (pm ? 'م' : 'ص') : (pm ? 'PM' : 'AM')}`;
}
// "G4|MA4-2" → "G4 · 4-2" (the roster's branch code dropped, as staff write it).
export const classLabel = (key) => {
  const [g, c] = String(key || '').split('|');
  return [g, c && rosterClassCode(c, g)].filter(Boolean).join(' · ');
};
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// Codes for the teacher / reception links, kept in this browser.
export function savedPin(kind, token) {
  try { return localStorage.getItem(`meeting:${kind}:${token}`) || ''; } catch { return ''; }
}
export function savePin(kind, token, pin) {
  try { localStorage.setItem(`meeting:${kind}:${token}`, pin); } catch { /* storage unavailable */ }
  if (kind !== 'desk') return;
  // The reception phone remembers its desks so a parent's QR checks in.
  try {
    const list = JSON.parse(localStorage.getItem('meeting:desks') || '[]').filter((d) => d.token !== token);
    localStorage.setItem('meeting:desks', JSON.stringify([{ token, pin }, ...list].slice(0, 6)));
  } catch { /* storage unavailable */ }
}
export function savedDesks() {
  try { return JSON.parse(localStorage.getItem('meeting:desks') || '[]'); } catch { return []; }
}
