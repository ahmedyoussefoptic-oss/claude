// Shared "X hours/days" formatter for resolution/response times, reusing
// the reports.* i18n keys already defined for Reports.jsx's duration
// display so the wording is identical everywhere a duration is shown.
export function formatDuration(ms, t) {
  if (ms == null) return '—';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return t('reports.lessThanHour');
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return remHours > 0 ? t('reports.daysAndHours', { days, hours: remHours }) : t('reports.daysOnly', { days });
  return t('reports.hoursOnly', { hours });
}

// "45 دقيقة" / "1 ساعة و20 دقيقة" for waiting times given in minutes.
export function formatMinutes(min, t) {
  if (min == null) return '—';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return t('duration.minutes', { n: m });
  const h = Math.floor(m / 60);
  return m % 60 ? t('duration.hoursMinutes', { h, m: m % 60 }) : t('duration.hours', { h });
}
