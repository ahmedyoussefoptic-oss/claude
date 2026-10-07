// Notification categories a user (or an admin, per user) can switch off.
// Mirrored in functions/index.js NOTIFICATION_CATEGORIES — keep in sync.
// Stored on the user doc as notificationPrefs: { [category]: false } (a
// missing key means on) and notificationChannels: { push, email } (same).
export const NOTIFICATION_CATEGORIES = [
  { id: 'assigned', types: ['ASSIGNED', 'IT_ASSIGNED', 'LF_ASSIGNED'] },
  { id: 'escalation', types: ['ESCALATED', 'IT_ESCALATED', 'URGENT_CREATED'] },
  { id: 'slaWarning', types: ['SLA_WARNING'] },
  { id: 'internalComment', types: ['INTERNAL_COMMENT_ADDED', 'IT_INTERNAL_COMMENT_ADDED'] },
  { id: 'partialSolution', types: ['PARTIAL_SOLUTION_ADDED'] },
  { id: 'solved', types: ['SOLVED_NOTIFY_RECEIVER'] },
  { id: 'reopened', types: ['REOPENED', 'IT_REOPENED'] },
  { id: 'visit', types: ['VISIT_ARRIVED'] },
  { id: 'viewed', types: ['VIEWED', 'IT_VIEWED'] },
  { id: 'appointment', types: ['APPOINTMENT_REQUESTED'] },
  { id: 'trips', types: ['TRIP_APPROVAL_REQUESTED', 'TRIP_DECIDED', 'TRIP_RECEIPT'] },
  { id: 'reminder', types: ['REMINDER', 'IT_REMINDER', 'LF_REMINDER'] },
];
export const NOTIFICATION_CHANNELS = ['push', 'email'];
