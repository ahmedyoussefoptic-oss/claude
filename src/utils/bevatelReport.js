// Reads a call report exported from Bevatel («تفاصيل المكالمات الصادرة» or the
// inbound report). The caller-number column tells them apart; the rows go to
// importBevatelCalls as they are.
const norm = (v) => String(v ?? '').trim().replace(/[إأآ]/g, 'ا');
const COLUMNS = { date: 'التاريخ', agent: 'الموظف', event: 'الحدث', wait: 'وقت الانتظار', talk: 'وقت التحدث', did: 'DID', queue: 'قائمة الانتظار' };

export class BevatelReportError extends Error {}

export async function readBevatelReport(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const headerAt = sheet.findIndex((row) => row.some((c) => norm(c) === COLUMNS.date) && row.some((c) => norm(c) === COLUMNS.event));
  const header = headerAt < 0 ? [] : sheet[headerAt].map(norm);
  const dir = header.includes('رقم المتصل') ? 'in' : header.includes('رقم الهاتف') ? 'out' : null;
  if (!dir) throw new BevatelReportError(file.name);
  const col = (name) => header.indexOf(name);
  const number = col(dir === 'in' ? 'رقم المتصل' : 'رقم الهاتف');
  const rows = sheet.slice(headerAt + 1).filter((r) => String(r[col(COLUMNS.date)] ?? '').trim()).map((r) => ({
    dir,
    number: r[number],
    ...Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, col(name) < 0 ? '' : r[col(name)]])),
  }));
  return { dir, rows };
}
