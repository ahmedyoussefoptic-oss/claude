// Totals of parent meetings from the numbers kept on each meeting (stats):
// shared by the meetings page's indicators and «التقارير».
export const LIVE = (m) => m.status !== 'DRAFT' && m.status !== 'CANCELLED';
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// The numbers of the meetings (stats kept on each meeting).
export function meetingsTotals(meetings) {
  const live = meetings.filter(LIVE);
  const s = (k) => live.reduce((n, m) => n + (m.stats?.[k] || 0), 0);
  const surveys = s('surveys');
  const rated = live.reduce((n, m) => n + (m.stats?.avgOverall || 0) * (m.stats?.surveys || 0), 0);
  return {
    count: meetings.length, live: live.length,
    byStatus: meetings.reduce((o, m) => ({ ...o, [m.status]: (o[m.status] || 0) + 1 }), {}),
    families: s('families'), students: s('students'), responded: s('responded'), attend: s('attend'), remote: s('remote'), decline: s('decline'),
    attended: s('attended'), interviews: s('requests') + s('booked'), interviewsDone: s('requestsDone') + s('done'),
    surveys, avg: surveys ? Math.round((rated / surveys) * 10) / 10 : 0, low: s('low'),
    sent: s('sent'), delivered: s('delivered'), read: s('read'), failed: s('failed'), noPhone: s('noPhone'),
  };
}

export function meetingsByBranch(meetings, branchName) {
  const groups = {};
  meetings.forEach((m) => { const k = (m.branches || []).map(branchName).join(' + ') || '—'; (groups[k] = groups[k] || []).push(m); });
  return Object.entries(groups).map(([name, list]) => ({ name, ...meetingsTotals(list) })).sort((a, b) => b.families - a.families);
}

