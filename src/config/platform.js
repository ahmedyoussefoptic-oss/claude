import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

// منصة المكتشف — shared constants for the owner-only platform modules
// (leave permissions, new customers, current students). Mirrored in
// functions/index.js where the server needs them.

// --- Leave permissions --------------------------------------------------------
export const LEAVE_REASONS = ['MEDICAL', 'ILLNESS', 'FAMILY', 'OFFICIAL', 'OTHER'];
export const LEAVE_STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  APPROVED: 'bg-sky-100 text-sky-700 border-sky-200',
  CALLED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  EXITED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-teal-100 text-teal-700 border-teal-200',
  REJECTED: 'bg-rose-100 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};
export const LEAVE_STATUSES = Object.keys(LEAVE_STATUS_STYLES);
export const LEAVE_OPEN = ['PENDING', 'APPROVED', 'CALLED'];
export const PICKUP_RELATIONS = ['FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'UNCLE', 'GRANDPARENT', 'DRIVER', 'OTHER'];

// --- New customers (enrollment follow-up) -----------------------------------
export const LEAD_STAGES = ['INQUIRY', 'QUALIFIED', 'VISIT_BOOKED', 'VISITED', 'TEST', 'RESULT', 'DOCUMENTS', 'PAYMENT', 'ENROLLED'];
export const LEAD_SIDE = ['POSTPONED', 'LOST', 'UNQUALIFIED', 'WAITLIST'];
export const LOSS_REASONS = ['PRICE', 'DISTANCE', 'OTHER_SCHOOL', 'NO_SEAT', 'BAD_SERVICE', 'NO_ANSWER', 'OTHER'];
export const LEAD_SOURCES = ['CALL_CENTER', 'WHATSAPP', 'WALK_IN', 'WEBSITE', 'CAMPAIGN', 'REFERRAL', 'OTHER'];
export const INTEREST_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
export const ACTIVITY_TYPES = ['CALL', 'WHATSAPP', 'VISIT', 'NOTE', 'NO_ANSWER'];
export const TEST_RESULTS = ['ACCEPTED', 'CONDITIONAL', 'REJECTED'];
export const LEAD_DOCUMENTS = ['nationalId', 'birthCertificate', 'vaccination', 'lastCertificate'];
export const STAGE_COLORS = {
  INQUIRY: 'bg-slate-500', QUALIFIED: 'bg-sky-500', VISIT_BOOKED: 'bg-cyan-500', VISITED: 'bg-teal-500', TEST: 'bg-indigo-500',
  RESULT: 'bg-violet-500', DOCUMENTS: 'bg-amber-500', PAYMENT: 'bg-orange-500', ENROLLED: 'bg-emerald-600',
};
export const SIDE_STYLES = {
  POSTPONED: 'bg-amber-100 text-amber-800', LOST: 'bg-rose-100 text-rose-700', UNQUALIFIED: 'bg-slate-200 text-slate-700', WAITLIST: 'bg-violet-100 text-violet-700',
};
// Maximum working hours a file may stay in each stage (editable in the
// platform settings); past it the file is flagged overdue.
// Visit / school-tour appointments for a lead (leadVisits collection).
export const VISIT_TYPES = ['VISIT_TOUR', 'VISIT', 'TOUR'];
export const VISIT_STATUSES = ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'];
export const VISIT_ACTIVE = ['SCHEDULED', 'CONFIRMED'];
export const VISIT_STATUS_STYLES = {
  REQUESTED: 'bg-amber-100 text-amber-700 border-amber-200',
  SCHEDULED: 'bg-sky-100 text-sky-700 border-sky-200',
  CONFIRMED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  ATTENDED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  NO_SHOW: 'bg-rose-100 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};
export const DEFAULT_STAGE_SLA = { INQUIRY: 1, QUALIFIED: 24, VISIT_BOOKED: 72, VISITED: 8, TEST: 120, RESULT: 48, DOCUMENTS: 168, PAYMENT: 168, ENROLLED: 24 };

// --- Current students / re-enrollment ----------------------------------------
export const REENROLL_INTENTS = ['RETURNING', 'UNDECIDED', 'NOT_RETURNING', 'NO_RESPONSE'];
export const REENROLL_STYLES = {
  RETURNING: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  UNDECIDED: 'bg-amber-100 text-amber-800 border-amber-200',
  NOT_RETURNING: 'bg-rose-100 text-rose-700 border-rose-200',
  NO_RESPONSE: 'bg-slate-100 text-slate-600 border-slate-200',
};
export const REENROLL_REASONS = ['PRICE', 'RELOCATION', 'ACADEMIC', 'SERVICE', 'TRANSPORT', 'OTHER_SCHOOL', 'PERSONAL', 'OTHER'];

export function defaultAcademicYear(now = new Date()) {
  // Re-enrollment is for the coming year: from January, the next September.
  const y = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
  return `${y}-${y + 1}`;
}

export const DEFAULT_PLATFORM_SETTINGS = {
  leaveMonthlyLimit: 3,
  leaveUrgentMinutes: 15,
  stageSla: DEFAULT_STAGE_SLA,
  academicYear: defaultAcademicYear(),
  capacity: {}, // { [branchId]: { [grade]: seats } }
  leadVisitTemplate: '', // WhatsApp API template for visit confirmations / reminders
  leadVisitAutoRemind: false, // remind tomorrow's visits every day at 17:00
};

export function usePlatformSettings() {
  const [settings, setSettings] = useState(DEFAULT_PLATFORM_SETTINGS);
  useEffect(() => onSnapshot(doc(db, 'platformSettings', 'main'), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    setSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...data, stageSla: { ...DEFAULT_STAGE_SLA, ...(data.stageSla || {}) } });
  }, () => {}), []);
  return settings;
}

// Same normalization as the server (toIntlNumber): 05xxxxxxxx → 9665xxxxxxxx.
export function normalizePhone(phone) {
  const normalized = String(phone || '').replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
  let digits = normalized.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `966${digits.slice(1)}`;
  return digits;
}

export const randomCode = (prefix) => `${prefix}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

// Roster grade_name ("Grade 5", "KG 2", "SEN") → STAGES id, as on the server.
export function rosterGrade(s) {
  const g = String(s?.gradeName || '').trim();
  let m = /^grade\s*(\d{1,2})$/i.exec(g);
  if (m) return `G${Number(m[1])}`;
  m = /^kg\s*([1-3])$/i.exec(g);
  if (m) return `KG${m[1]}`;
  if (/^sen$/i.test(g)) return 'SEN';
  return g;
}
