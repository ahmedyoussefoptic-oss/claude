// A table saved as an Excel file (right-to-left sheet for Arabic).
export async function exportXlsx(fileName, sheetName, header, rows, { rtl = true } = {}) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.min(50, Math.max(10, String(h).length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
  const wb = XLSX.utils.book_new();
  if (rtl) wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}
