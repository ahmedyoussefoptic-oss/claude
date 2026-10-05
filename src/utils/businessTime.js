import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

// SLA / resolution-time settings (settings/sla, edited in Settings). Kept
// in sync with functions/businessTime.js — the server uses the same rules
// to set due dates, the UI to show resolution times.
export const DEFAULT_SLA = {
  complaintHours: { NORMAL: 48, HIGH: 24, URGENT: 6 },
  techHours: 4,
  // Count only official working hours (workStart–workEnd on workDays).
  // Off: every hour of a working day counts (weekends still skipped).
  businessHoursOnly: false,
  workDays: [0, 1, 2, 3, 4], // Sun..Thu (Date#getDay numbering)
  workStart: '07:00',
  workEnd: '15:00',
};

const TZ_MS = 3 * 3600 * 1000; // Saudi Arabia: UTC+3, no daylight saving
const DAY = 24 * 3600 * 1000;
const toMin = (hhmm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

export function normalizeSla(data) {
  const d = data || {};
  return {
    ...DEFAULT_SLA,
    ...d,
    complaintHours: { ...DEFAULT_SLA.complaintHours, ...(d.complaintHours || {}) },
    workDays: Array.isArray(d.workDays) && d.workDays.length ? d.workDays : DEFAULT_SLA.workDays,
  };
}

// The counted window of a local day (local midnight given in shifted ms),
// or null on a day off.
function windowOf(dayStart, cfg) {
  const weekday = new Date(dayStart).getUTCDay();
  if (!cfg.workDays.includes(weekday)) return null;
  if (!cfg.businessHoursOnly) return [dayStart, dayStart + DAY];
  const a = toMin(cfg.workStart, 420), b = toMin(cfg.workEnd, 900);
  return b > a ? [dayStart + a * 60000, dayStart + b * 60000] : null;
}

// Counted time between two instants (ms).
export function businessMs(startMs, endMs, cfg = DEFAULT_SLA) {
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

// Resolution time of a record as shown in the UI (Firestore Timestamps in).
export function elapsedMs(startTs, endTs, cfg) {
  if (!startTs?.toMillis || !endTs?.toMillis) return null;
  return businessMs(startTs.toMillis(), endTs.toMillis(), cfg);
}

export function useSlaSettings() {
  const [cfg, setCfg] = useState(DEFAULT_SLA);
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'sla'), (snap) => setCfg(normalizeSla(snap.exists() ? snap.data() : null)), () => setCfg(DEFAULT_SLA));
    return () => unsubscribe();
  }, []);
  return cfg;
}
