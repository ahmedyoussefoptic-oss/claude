import { normClass } from './classFilter';

// Meeting teachers from Excel. Two uses:
//  - «دليل المعلمين» (one file for every branch, with a «الفرع» column),
//    read by readTeacherDirectoryFile and kept per branch on the server;
//  - one meeting's teachers (MeetingForm → «استيراد من Excel»), readTeachersFile.
// The header row may be Arabic or English, in any order, below a title row.
// Classes are listed separated by commas / «،» / new lines, written as
// "4-2", "G4 4-2" or "Grade 4 - 2".
const COLUMNS = {
  branch: ['الفرع', 'branch'],
  name: ['اسم المعلم', 'الاسم', 'المعلم', 'name', 'teacher', 'teacher name'],
  subject: ['المادة', 'subject'],
  classes: ['الفصول', 'فصول المعلم', 'classes', 'class'],
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const AR = '٠١٢٣٤٥٦٧٨٩';
const latinDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (x) => String(AR.indexOf(x)));

// The ready-made form (public/files) — the branches are a drop-down list.
export const DIRECTORY_TEMPLATE_URL = '/files/meeting-teachers-template.xlsx';

export async function downloadTeachersTemplate() {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['اسم المعلم', 'المادة', 'الفصول'],
    ['أ. منى أحمد', 'الرياضيات', '4-1، 4-2'],
  ]);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المعلمون');
  XLSX.writeFile(wb, 'نموذج المعلمين.xlsx');
}


// One class as written → the meeting's class keys ("G4|4-2"). "4-2" alone
// matches that class in any grade; with a grade it must match it.
export function matchClass(token, keys) {
  const raw = String(token).trim();
  if (!raw) return [];
  const exact = keys.filter((k) => k === raw);
  if (exact.length) return exact;
  const gradeMatch = /^(?:g|grade)\s*(\d{1,2})\s*[|\s·_/-]+\s*(.+)$/i.exec(latinDigits(raw));
  const grade = gradeMatch ? `G${Number(gradeMatch[1])}` : '';
  // "Grade 4 - 1" / "G4/1": the part after the grade is the section → 4-1.
  const rest = gradeMatch ? normClass(gradeMatch[2]) : '';
  const cls = gradeMatch ? (rest.includes('-') ? rest : `${Number(gradeMatch[1])}-${rest}`) : normClass(raw);
  return keys.filter((k) => {
    const [g, c] = k.split('|');
    return normClass(c) === cls && (!grade || g === grade);
  });
}
export const splitClasses = (text) => String(text || '').split(/[,،;\n]+/).map((x) => x.trim()).filter(Boolean);

// A teacher's written classes → keys of this meeting; `teaches` is false when
// the teacher lists classes and none of them is in the meeting.
export function teacherForMeeting(t, keys) {
  const tokens = splitClasses(t.classes);
  const unmatched = [];
  const classes = new Set();
  tokens.forEach((tok) => {
    const found = matchClass(tok, keys);
    if (found.length) found.forEach((k) => classes.add(k));
    else unmatched.push(tok);
  });
  return { teacher: { name: t.name, subject: t.subject || '', room: '', classes: [...classes] }, teaches: !tokens.length || classes.size > 0, unmatched };
}

async function readRows(file, required = []) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  // The sheet with the header (the form keeps its instructions in another sheet).
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
    const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.name.includes(norm(c))));
    if (headerAt < 0) continue;
    const header = rows[headerAt].map(norm);
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
    if (required.some((k) => col[k] < 0)) continue;
    const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
    return rows.slice(headerAt + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => ({
      branch: get(r, 'branch'), name: get(r, 'name'), subject: get(r, 'subject'), classes: get(r, 'classes'),
    }));
  }
  throw new Error(required.includes('branch') ? 'branchHeader' : 'header');
}

// One meeting's teachers → { teachers, unmatched, skipped }.
export async function readTeachersFile(file, classKeys) {
  const rows = await readRows(file);
  const unmatched = new Set();
  let skipped = 0;
  const teachers = [];
  rows.forEach((r) => {
    if (!r.name) { skipped++; return; }
    const { teacher, unmatched: u } = teacherForMeeting(r, classKeys);
    u.forEach((x) => unmatched.add(x));
    teachers.push(teacher);
  });
  return { teachers, unmatched: [...unmatched], skipped };
}

// «دليل المعلمين» → { byBranch: {id: [teacher]}, unknownBranches: [text], noBranch, skipped }.
// The branch is matched by its name (with or without «فرع») or its code.
export async function readTeacherDirectoryFile(file, branches) {
  const rows = await readRows(file, ['branch']);
  const key = (s) => norm(s).replace(/^فرع\s+/, '').replace(/[ةه]$/g, 'ه').replace(/[أإآ]/g, 'ا');
  const byKey = new Map();
  branches.forEach((b) => { byKey.set(key(b.name), b.id); byKey.set(key(b.id), b.id); });
  const byBranch = {};
  const unknown = new Set();
  let noBranch = 0;
  let skipped = 0;
  const seen = new Map();
  rows.forEach((r) => {
    if (!r.name) { skipped++; return; }
    if (!r.branch) { noBranch++; return; }
    const id = byKey.get(key(r.branch));
    if (!id) { unknown.add(r.branch); return; }
    // The same teacher on two rows of a branch: one teacher, classes merged.
    const dup = seen.get(`${id}|${key(r.name)}`);
    if (dup) {
      dup.classes = [...new Set([...splitClasses(dup.classes), ...splitClasses(r.classes)])].join('، ');
      ['subject'].forEach((k) => { if (!dup[k]) dup[k] = r[k]; });
      return;
    }
    const tch = { name: r.name, subject: r.subject, classes: splitClasses(r.classes).join('، ') };
    seen.set(`${id}|${key(r.name)}`, tch);
    (byBranch[id] = byBranch[id] || []).push(tch);
  });
  return { byBranch, unknownBranches: [...unknown], noBranch, skipped };
}
