import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

// "Student Logins by Campus - Classera & MIS Portal" workbook: one sheet per
// campus, a header row (ID, Full Name, Level, Section, Username, Password,
// Mobile, —, ID, Student Name, Grade, Class, Username, Password, Mobile),
// Classera on the left, the MIS student portal on the right; a student in
// only one system has the other side empty.
const SHEET_BRANCH = {
  'downtown girls': 'DOWN_TOWN_GIRLS',
  'downtown boys': 'DOWN_TOWN_BOYS',
  muhamdiya: 'AL_MOHAMMADIA',
  'muhamdiya british': 'AL_MOHAMMADIA',
  salamah: 'AL_SALAMA_GIRLS',
  'salamah british': 'AL_SALAMA_GIRLS',
  shate: 'AL_SHATI',
  'shate british': 'AL_SHATI',
  naeem: 'AL_NAEEM',
  zahra: 'AL_ZAHRA',
  sen: 'AL_SALAMA_BOYS',
};
const cell = (v) => String(v ?? '').trim();
const digits = (v) => cell(v).replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf)).replace(/\D/g, '');

export function parseAccountsWorkbook(XLSX, workbook) {
  const byId = new Map();
  const stats = { sheets: 0, both: 0, classeraOnly: 0, portalOnly: 0, noPortalPassword: 0, noClasseraPassword: 0 };
  const rec = (id, sheet) => {
    if (!byId.has(id)) byId.set(id, { nationalId: id, sheet, branch: SHEET_BRANCH[sheet.trim().toLowerCase()] || '', classera: null, portal: null, mobile: '' });
    return byId.get(id);
  };
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '' });
    const h = rows.findIndex((r) => r.some((c) => /^username$/i.test(cell(c))) && r.some((c) => /^password$/i.test(cell(c))));
    if (h < 0) continue;
    stats.sheets++;
    for (const r of rows.slice(h + 1)) {
      const left = digits(r[0]);
      const right = digits(r[8]);
      if (!left && !right) continue;
      if (left && right) stats.both++; else if (left) stats.classeraOnly++; else stats.portalOnly++;
      if (left) {
        const s = rec(left, sheet);
        s.classera = { username: cell(r[4]), password: cell(r[5]), name: cell(r[1]), level: cell(r[2]), section: cell(r[3]) };
        if (!s.classera.password) stats.noClasseraPassword++;
        s.mobile = s.mobile || digits(r[6]);
      }
      if (right) {
        const s = rec(right, sheet);
        s.portal = { username: cell(r[12]), password: cell(r[13]), name: cell(r[9]), grade: cell(r[10]), className: cell(r[11]) };
        if (!s.portal.password) stats.noPortalPassword++;
        s.mobile = s.mobile || digits(r[14]);
      }
    }
  }
  return { records: [...byId.values()], stats };
}

// Writes the logins (merge keeps send history), 400 per batch.
export async function importStudentAccounts(records, onProgress) {
  const importedAt = new Date().toISOString();
  for (let i = 0; i < records.length; i += 400) {
    const batch = writeBatch(db);
    records.slice(i, i + 400).forEach((r) => batch.set(doc(db, 'studentAccounts', r.nationalId), { ...r, importedAt }, { merge: true }));
    await batch.commit();
    onProgress?.(Math.min(i + 400, records.length), records.length);
  }
  return records.length;
}
