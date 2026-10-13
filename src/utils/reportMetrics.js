import { isComplaintOverdue, isEscalatedResolved } from '../config/complaintTypes';
import { RESOLVED_TICKET_STATUSES, isTicketOverdue, isTicketEscalatedResolved } from '../config/techSupport';
import { businessMs } from './businessTime';

const isResolved = (c) => c.status === 'SOLVED' || c.status === 'CLOSED';
const ms = (ts) => (ts?.toMillis ? ts.toMillis() : null);

// Resolution time: working time from receipt to resolution.
export const complaintResolutionMs = (c, cfg) => (c.solvedAt && c.createdAt ? businessMs(ms(c.createdAt), ms(c.solvedAt), cfg) : null);
export const ticketResolutionMs = (tk, cfg) => (tk.resolutionMessageSentAt && tk.createdAt ? businessMs(ms(tk.createdAt), ms(tk.resolutionMessageSentAt), cfg) : null);

// Delay: working time past the due date (dueDate, set from the SLA
// settings) — until the record was resolved, until the SLA was paused
// waiting for the parent, or until now while it is still open.
// 0 = within the deadline, null = no deadline / not applicable.
export function complaintDelayMs(c, cfg, now = Date.now()) {
  if (!ms(c.dueDate) || c.status === 'REJECTED') return null;
  const done = ms(c.solvedAt) || ms(c.closedAt);
  const end = done || (isResolved(c) ? null : c.status === 'WAITING_PARENT_RESPONSE' && ms(c.slaPausedAt) ? ms(c.slaPausedAt) : now);
  if (!end) return null;
  const due = ms(c.dueDate);
  return end > due ? businessMs(due, end, cfg) : 0;
}
export function ticketDelayMs(tk, cfg, now = Date.now()) {
  if (!ms(tk.dueDate)) return null;
  const resolved = RESOLVED_TICKET_STATUSES.includes(tk.status);
  const end = ms(tk.resolutionMessageSentAt) || (resolved ? null : now);
  if (!end) return null;
  const due = ms(tk.dueDate);
  return end > due ? businessMs(due, end, cfg) : 0;
}

const median = (list) => {
  if (!list.length) return null;
  const a = [...list].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
// Shared timing indicators for a list of resolution times and delays.
function timingStats(resolutions, delays) {
  const late = delays.filter((d) => d > 0);
  return {
    medianResolutionMs: median(resolutions),
    measuredCount: delays.length,
    onTimeCount: delays.length - late.length,
    delayedCount: late.length,
    avgDelayMs: late.length ? late.reduce((s, d) => s + d, 0) / late.length : null,
    maxDelayMs: late.length ? Math.max(...late) : null,
    delayBuckets: {
      lt1d: late.filter((d) => d < 86400e3).length,
      d1to3: late.filter((d) => d >= 86400e3 && d <= 3 * 86400e3).length,
      gt3d: late.filter((d) => d > 3 * 86400e3).length,
    },
  };
}

// One row per record for the timing section, the per-employee table and
// the exports (complaints, plus tech tickets when merged).
export function timingRows(complaints, tickets, cfg, now = Date.now()) {
  return [
    ...complaints.map((c) => ({ kind: 'complaint', rec: c, number: c.complaintId, branch: c.branch, names: c.assignedToNames || [], resolved: isResolved(c), resolutionMs: complaintResolutionMs(c, cfg), delayMs: complaintDelayMs(c, cfg, now) })),
    ...tickets.map((tk) => ({ kind: 'ticket', rec: tk, number: tk.ticketId, branch: tk.branch, names: tk.assignedToNames || [], resolved: RESOLVED_TICKET_STATUSES.includes(tk.status), resolutionMs: ticketResolutionMs(tk, cfg), delayMs: ticketDelayMs(tk, cfg, now) })),
  ];
}

// Per assignee (a record counts for each of its assignees; '' = unassigned).
export function timingByAssignee(rows) {
  const map = new Map();
  rows.forEach((r) => (r.names.length ? r.names : ['']).forEach((name) => {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(r);
  }));
  return [...map.entries()].map(([name, list]) => {
    const res = list.map((r) => r.resolutionMs).filter((v) => v != null);
    const delays = list.map((r) => r.delayMs).filter((v) => v != null);
    return {
      name, total: list.length, resolved: list.filter((r) => r.resolved).length,
      avgResolutionMs: res.length ? res.reduce((s, v) => s + v, 0) / res.length : null,
      openDelayed: list.filter((r) => !r.resolved && r.delayMs > 0).length,
      ...timingStats(res, delays),
    };
  }).sort((a, b) => b.delayedCount - a.delayedCount || b.total - a.total);
}

// Every number the report shows for a set of complaints. The status
// buckets (resolved / in progress / escalated-open / rejected) add up to
// `total`; overdue and escalated-resolved are overlapping indicators.
// `cfg` (settings/sla) makes resolution times count working time only.
export function complaintMetrics(list, cfg) {
  const total = list.length;
  const resolved = list.filter(isResolved).length;
  const escalatedOpen = list.filter((c) => c.status === 'ESCALATED').length;
  const rejected = list.filter((c) => c.status === 'REJECTED').length;
  const solvedDocs = list.filter((c) => c.solvedAt && c.createdAt);
  const withDue = solvedDocs.filter((c) => c.dueDate);
  const rated = list.filter((c) => typeof c.satisfactionRate === 'number');
  return {
    total,
    resolved,
    inProgress: total - resolved - escalatedOpen - rejected,
    escalatedOpen,
    escalatedResolved: list.filter(isEscalatedResolved).length,
    overdue: list.filter(isComplaintOverdue).length,
    rejected,
    reopened: list.filter((c) => c.reopened).length,
    resolutionRate: total ? Math.round((resolved / total) * 100) : null,
    avgResolutionMs: solvedDocs.length ? solvedDocs.reduce((s, c) => s + businessMs(c.createdAt.toMillis(), c.solvedAt.toMillis(), cfg), 0) / solvedDocs.length : null,
    slaCompliance: withDue.length ? Math.round((withDue.filter((c) => c.solvedAt.toMillis() <= c.dueDate.toMillis()).length / withDue.length) * 100) : null,
    satisfaction: rated.length ? rated.reduce((s, c) => s + c.satisfactionRate, 0) / rated.length : null,
    satisfactionCount: rated.length,
    openDelayed: list.filter((c) => !isResolved(c) && complaintDelayMs(c, cfg) > 0).length,
    ...timingStats(solvedDocs.map((c) => complaintResolutionMs(c, cfg)), list.map((c) => complaintDelayMs(c, cfg)).filter((d) => d != null)),
  };
}

// Same shape for tech-support tickets (no REJECTED; "escalated-open" is
// the overdue flag, as on the dashboard).
export function ticketMetrics(list, cfg) {
  const total = list.length;
  const resolved = list.filter((tk) => RESOLVED_TICKET_STATUSES.includes(tk.status)).length;
  const overdue = list.filter(isTicketOverdue).length;
  const done = list.filter((tk) => tk.resolutionMessageSentAt && tk.createdAt);
  return {
    total,
    resolved,
    inProgress: total - resolved - overdue,
    escalatedOpen: overdue,
    escalatedResolved: list.filter(isTicketEscalatedResolved).length,
    overdue,
    rejected: 0,
    reopened: list.filter((tk) => (tk.reopenCount || 0) > 0).length,
    resolutionRate: total ? Math.round((resolved / total) * 100) : null,
    avgResolutionMs: done.length ? done.reduce((s, tk) => s + businessMs(tk.createdAt.toMillis(), tk.resolutionMessageSentAt.toMillis(), cfg), 0) / done.length : null,
    slaCompliance: null,
    satisfaction: null,
    satisfactionCount: 0,
    openDelayed: list.filter((tk) => !RESOLVED_TICKET_STATUSES.includes(tk.status) && ticketDelayMs(tk, cfg) > 0).length,
    ...timingStats(done.map((tk) => ticketResolutionMs(tk, cfg)), list.map((tk) => ticketDelayMs(tk, cfg)).filter((d) => d != null)),
  };
}
