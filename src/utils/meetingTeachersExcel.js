import { normClass } from './classFilter';

// Meeting teachers from an Excel sheet (the meeting form → «استيراد من
// Excel»). The header row may be Arabic or English, in any order; the
// classes cell lists classes separated by commas / «،» / new lines, written
// as "4-2" or with the grade ("G4 4-2", "Grade 4 - 2").
const COLUMNS = {
  name: ['اسم المعلم', 'الاسم', 'المعلم', 'name', 'teacher', 'teacher name'],
  subject: ['المادة', 'subject'],
  room: ['القاعة', 'الفصل الدراسي', 'room'],
  phone: ['الجوال', 'رقم الجوال', 'الهاتف', 'phone', 'mobile'],
  classes: ['الفصول', 'فصول المعلم', 'classes', 'class'],
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const AR_DIGITS = /[٠-٩]/g;

export const TEMPLATE_HEADERS = ['اسم المعلم', 'المادة', 'القاعة', 'الجوال', 'الفصول'];

export async function downloadTeachersTemplate() {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['أ. منى أحمد', 'الرياضيات', 'قاعة 101', '0500000000', '4-1، 4-2'],
    ['أ. هند خالد', 'اللغة العربية', 'قاعة 102', '', ''],
  ]);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المعلمون');
  XLSX.writeFile(wb, 'نموذج المعلمين.xlsx');
}

function cleanPhone(v) {
  let d = String(v ?? '').replace(AR_DIGITS, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/\D/g, '');
  if (/^5\d{8}$/.test(d)) d = `0${d}`;
  if (/^9665\d{8}$/.test(d)) d = `0${d.slice(3)}`;
  return d;
}

// One class written in the sheet → the meeting's class keys ("G4|4-2").
// "4-2" alone matches that class in any grade; with a grade it must match it.
function matchClass(token, keys) {
  const raw = String(token).trim();
  if (!raw) return [];
  const exact = keys.filter((k) => k === raw);
  if (exact.length) return exact;
  const gradeMatch = /^(?:g|grade)\s*(\d{1,2})\s*[|\s·_/-]+\s*(.+)$/i.exec(raw.replace(AR_DIGITS, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))));
  const grade = gradeMatch ? `G${Number(gradeMatch[1])}` : '';
  // "Grade 4 - 1" / "G4/1": the part after the grade is the section → 4-1.
  const rest = gradeMatch ? normClass(gradeMatch[2]) : '';
  const cls = gradeMatch ? (rest.includes('-') ? rest : `${Number(gradeMatch[1])}-${rest}`) : normClass(raw);
  return keys.filter((k) => {
    const [g, c] = k.split('|');
    return normClass(c) === cls && (!grade || g === grade);
  });
}

// → { teachers: [{name, subject, room, phone, classes}], unmatched: [class text], skipped: rows without a name }
export async function readTeachersFile(file, classKeys) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.name.includes(norm(c))));
  if (headerAt < 0) throw new Error('header');
  const header = rows[headerAt].map(norm);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const unmatched = new Set();
  let skipped = 0;
  const teachers = [];
  rows.slice(headerAt + 1).forEach((r) => {
    if (!r.some((c) => String(c).trim())) return;
    const name = get(r, 'name');
    if (!name) { skipped++; return; }
    const classes = new Set();
    get(r, 'classes').split(/[,،;\n]+/).map((x) => x.trim()).filter(Boolean).forEach((tok) => {
      const found = matchClass(tok, classKeys);
      if (found.length) found.forEach((k) => classes.add(k));
      else unmatched.add(tok);
    });
    teachers.push({ name, subject: get(r, 'subject'), room: get(r, 'room'), phone: cleanPhone(get(r, 'phone')), classes: [...classes] });
  });
  return { teachers, unmatched: [...unmatched], skipped };
}
