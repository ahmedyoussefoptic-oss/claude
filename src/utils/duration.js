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
