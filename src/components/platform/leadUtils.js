import { businessMs } from '../../utils/businessTime';
import { LEAD_STAGES } from '../../config/platform';

export const tsMs = (ts) => (ts?.toMillis ? ts.toMillis() : typeof ts === 'number' ? ts : 0);

// A file is "open" until enrolled, lost or unqualified (postponed and
// waitlisted files are still followed up).
export const leadOpen = (l) => l.stage !== 'ENROLLED' && !['LOST', 'UNQUALIFIED'].includes(l.sideStatus);

// Working hours spent in the current stage vs that stage's limit.
export function stageOverdue(l, settings, slaCfg, now = Date.now()) {
  if (!leadOpen(l) || l.sideStatus) return false;
  const limitH = settings.stageSla?.[l.stage];
  if (!limitH) return false;
  return businessMs(tsMs(l.stageEnteredAt), now, slaCfg) > limitH * 3600e3;
}
export const followUpOverdue = (l, now = Date.now()) => leadOpen(l) && tsMs(l.nextFollowUp) > 0 && tsMs(l.nextFollowUp) < now;

export const stageIndex = (s) => LEAD_STAGES.indexOf(s);
// Has the file reached `stage` (now or earlier)?
export const reached = (l, stage) => stageIndex(l.stage) >= stageIndex(stage) || !!(l.stageHistory || {})[stage];
