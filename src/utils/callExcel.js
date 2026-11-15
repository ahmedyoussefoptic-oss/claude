// Reading a call campaign's Excel file («مهام الاتصال»): the first sheet's
// header row and data rows, with a guess at which columns hold the student
// ID, the parent's mobile and the name (the supervisor can change them).

const digits = (v) => String(v ?? '')
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
  .replace(/\D/g, '');
export const looksId = (v) => /^\d{10}$/.test(digits(v));
export function toMobile(v) {
  let d = digits(v);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) d = d.slice(3);
  if (/^5\d{8}$/.test(d)) d = `0${d}`;
  return /^05\d{8}$/.test(d) ? d : '';
}
const MAX_COLUMNS = 20;

export async function readCallSheet(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  const shown = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  const values = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
  // Long whole numbers (IDs, 9665… mobiles) from the cell's value: Excel's
  // display can shorten them (9.66501E+11); everything else as displayed.
  const cell = (i, j) => {
    const v = values[i]?.[j];
    return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1e6 ? String(v) : String(shown[i]?.[j] ?? '').trim();
  };
  const rows = shown.map((r, i) => r.map((_, j) => cell(i, j))).filter((r) => r.some(Boolean));
  // The header: the first of the top rows with two or more cells and no ID or mobile in it.
  const hi = rows.slice(0, 10).findIndex((r) => r.filter(Boolean).length >= 2 && !r.some((c) => looksId(c) || toMobile(c)));
  const data = hi >= 0 ? rows.slice(hi + 1) : rows;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const seen = {};
  const headers = Array.from({ length: width }, (_, i) => {
    const h = (hi >= 0 && rows[hi][i]) || `#${i + 1}`;
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h} (${seen[h]})` : h;
  });
  // Share of a column's filled cells that pass `test`.
  const share = (i, test) => {
    const cells = data.map((r) => r[i]).filter(Boolean);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };
  const best = (test, skip = []) => {
    let col = -1;
    let top = 0.5;
    headers.forEach((_, i) => { if (skip.includes(i)) return; const v = share(i, test); if (v > top) { top = v; col = i; } });
    return col;
  };
  const idCol = best(looksId);
  const phoneCol = best((c) => !!toMobile(c), [idCol]);
  const named = headers.map((h, i) => ({ h, i })).filter(({ i }) => i !== idCol && i !== phoneCol);
  const nameCol = (named.find(({ h }) => /(اسم|name).*(طالب|student)|(طالب|student).*(اسم|name)/i.test(h))
    || named.find(({ h }) => /اسم|name/i.test(h)))?.i ?? -1;
  return { sheet: wb.SheetNames[0], headers, data, idCol, phoneCol, nameCol };
}

// The rows sent to saveCallCampaign: the chosen columns, and every other
// column (up to 20) as the call's extra details.
export function callRows(sheet, cols) {
  // A row-number column («م», #, No.) isn't worth carrying.
  const counter = (h) => /^(م|ت|#|no\.?|s\.?\s?n\.?|seq)$/i.test(h.trim());
  const extraCols = sheet.headers.map((h, i) => ({ h, i })).filter(({ h, i }) => ![cols.idCol, cols.phoneCol, cols.nameCol].includes(i) && !counter(h)).slice(0, MAX_COLUMNS);
  const columns = [...new Set(extraCols.map((c) => c.h))];
  const rows = sheet.data.map((r) => ({
    id: cols.idCol >= 0 ? digits(r[cols.idCol]) : '',
    phone: cols.phoneCol >= 0 ? toMobile(r[cols.phoneCol]) || r[cols.phoneCol] || '' : '',
    name: cols.nameCol >= 0 ? r[cols.nameCol] || '' : '',
    extra: Object.fromEntries(extraCols.map(({ h, i }) => [h, r[i] || '']).filter(([, v]) => v)),
  }));
  return { rows, columns };
}
