import { isComplaintOverdue, isEscalatedResolved } from '../config/complaintTypes';
import { RESOLVED_TICKET_STATUSES, isTicketOverdue, isTicketEscalatedResolved } from '../config/techSupport';
import { businessMs } from './businessTime';

const isResolved = (c) => c.status === 'SOLVED' || c.status === 'CLOSED';

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
  };
}
