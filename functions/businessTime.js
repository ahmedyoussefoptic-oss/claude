// Server copy of src/utils/businessTime.js (keep the two in sync): turns an
// SLA in hours into a due date that only counts working time, per the
// settings/sla document edited in the app's Settings page.
const DEFAULT_SLA = {
  complaintHours: { NORMAL: 48, HIGH: 24, URGENT: 6 },
  techHours: 4,
  businessHoursOnly: false,
  workDays: [0, 1, 2, 3, 4],
  workStart: "07:00",
  workEnd: "15:00",
};
const TZ_MS = 3 * 3600 * 1000; // Saudi Arabia: UTC+3, no daylight saving
const DAY = 24 * 3600 * 1000;
const toMin = (hhmm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

function normalizeSla(data) {
  const d = data || {};
  return {
    ...DEFAULT_SLA,
    ...d,
    complaintHours: { ...DEFAULT_SLA.complaintHours, ...(d.complaintHours || {}) },
    workDays: Array.isArray(d.workDays) && d.workDays.length ? d.workDays : DEFAULT_SLA.workDays,
  };
}

function windowOf(dayStart, cfg) {
  const weekday = new Date(dayStart).getUTCDay();
  if (!cfg.workDays.includes(weekday)) return null;
  if (!cfg.businessHoursOnly) return [dayStart, dayStart + DAY];
  const a = toMin(cfg.workStart, 420), b = toMin(cfg.workEnd, 900);
  return b > a ? [dayStart + a * 60000, dayStart + b * 60000] : null;
}

function businessMs(startMs, endMs, cfg) {
  if (!(endMs > startMs)) return 0;
  const s = startMs + TZ_MS, e = endMs + TZ_MS;
  let total = 0;
  for (let d = Math.floor(s / DAY) * DAY, i = 0; d < e && i < 4000; d += DAY, i++) {
    const w = windowOf(d, cfg);
    if (!w) continue;
    const a = Math.max(s, w[0]), b = Math.min(e, w[1]);
    if (b > a) total += b - a;
  }
  return total;
}

// The instant reached after `ms` of counted time from `startMs`.
function addBusinessMs(startMs, ms, cfg) {
  if (!(ms > 0)) return startMs;
  const s = startMs + TZ_MS;
  let remaining = ms;
  for (let d = Math.floor(s / DAY) * DAY, i = 0; i < 4000; d += DAY, i++) {
    const w = windowOf(d, cfg);
    if (!w) continue;
    const a = Math.max(s, w[0]);
    if (a >= w[1]) continue;
    const avail = w[1] - a;
    if (remaining <= avail) return a + remaining - TZ_MS;
    remaining -= avail;
  }
  return startMs + ms; // no working days configured — fall back to wall-clock
}

module.exports = { DEFAULT_SLA, normalizeSla, businessMs, addBusinessMs };
