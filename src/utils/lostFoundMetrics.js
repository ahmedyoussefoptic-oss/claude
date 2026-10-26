// Lost & found report numbers (Reports › المفقودات), shared by the on-screen
// report and its Excel export. Times are calendar time from the report.
const ms = (ts) => (ts?.toMillis ? ts.toMillis() : null);
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
const span = (item, field) => (ms(item[field]) && ms(item.createdAt) ? ms(item[field]) - ms(item.createdAt) : null);
export const LF_OPEN = ['UNCLAIMED', 'SEARCHING', 'MATCHED'];
const LATE_ACK_MS = 24 * 3600 * 1000;

export function lostFoundMetrics(items, now = Date.now()) {
  const durations = (list, field) => list.map((i) => span(i, field)).filter((v) => v != null && v >= 0);
  const returned = items.filter((i) => i.status === 'RETURNED');
  const summarize = (list) => {
    const ret = list.filter((i) => i.status === 'RETURNED').length;
    return {
      total: list.length,
      lost: list.filter((i) => i.reportType === 'LOST').length,
      found: list.filter((i) => i.reportType === 'FOUND').length,
      returned: ret,
      open: list.filter((i) => LF_OPEN.includes(i.status)).length,
      closed: list.filter((i) => i.status === 'CLOSED').length,
      returnRate: list.length ? Math.round((ret / list.length) * 100) : 0,
      avgAck: avg(durations(list, 'acknowledgedAt')),
      avgFound: avg(durations(list, 'foundAt')),
      avgReturn: avg(durations(list, 'returnedAt')),
    };
  };
  const group = (key) => {
    const map = new Map();
    items.forEach((i) => { const k = key(i) || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
    return [...map.entries()].map(([k, list]) => ({ key: k, ...summarize(list) })).sort((a, b) => b.total - a.total);
  };
  // Who moved the reports through each step.
  const staff = new Map();
  const bump = (name, field) => { if (!name) return; const s = staff.get(name) || { name, acknowledged: 0, found: 0, returned: 0 }; s[field]++; staff.set(name, s); };
  items.forEach((i) => { bump(i.acknowledgedByName, 'acknowledged'); bump(i.foundByName, 'found'); bump(i.returnedByName, 'returned'); });
  const notAcknowledged = items.filter((i) => i.status === 'UNCLAIMED' && ms(i.createdAt) && now - ms(i.createdAt) > LATE_ACK_MS);
  const openList = items.filter((i) => LF_OPEN.includes(i.status)).sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
  return {
    ...summarize(items),
    byStatus: ['UNCLAIMED', 'SEARCHING', 'MATCHED', 'RETURNED', 'CLOSED'].map((s) => ({ status: s, count: items.filter((i) => i.status === s).length })),
    byBranch: group((i) => i.branch),
    byCategory: group((i) => i.category),
    byStaff: [...staff.values()].sort((a, b) => (b.acknowledged + b.found + b.returned) - (a.acknowledged + a.found + a.returned)),
    notAcknowledged: notAcknowledged.length,
    openList,
    ageMs: (i) => now - (ms(i.createdAt) || now),
    returnedCount: returned.length,
  };
}
