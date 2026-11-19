// The teachers' nomination form for the support programmes
// (public/files/support-nomination-template.xlsx, built by
// scripts/make_support_nomination_template.py) and reading it back.

export const NOMINATION_TEMPLATE_URL = '/files/support-nomination-template.xlsx';

const latin = (v) => String(v ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
const idOf = (v) => { const d = latin(typeof v === 'number' ? v.toFixed(0) : v).replace(/\D/g, ''); return /^\d{10}$/.test(d) ? d : ''; };
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// Header text → field.
const FIELDS = [
  ['studentId', /هوي|اقام|إقام|iqama|national|\bid\b/i],
  ['name', /اسم الطالب|الطالب|student/i],
  ['grade', /الصف|grade/i],
  ['className', /الفصل|الشعبة|class|section/i],
  ['type', /البرنامج|النوع|program|type/i],
  ['subjects', /الماد|subject/i],
  ['reason', /سبب|الاحتياج|ملاحظ|reason|note/i],
  ['teacher', /المعلم|teacher/i],
];
export const typeOf = (v) => {
  const s = clean(v).toLowerCase();
  if (/تقوي|علاج|دعم|remed/.test(s)) return 'REMEDIAL';
  if (/إثراء|اثراء|ثراء|تميز|enrich/.test(s)) return 'ENRICHMENT';
  return '';
};

// One sheet → { rows: [{studentId, name, grade, className, type, subjects, reason, teacher}], form: bool }.
// `form` is false for a plain list (no header row found): then every
// 10-digit number anywhere in it is a student, as before.
export function readNominationRows(XLSX, wb) {
  const sheetName = wb.SheetNames.find((n) => /ترشيح|nominat/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  const headAt = aoa.findIndex((r) => r.some((v) => FIELDS[0][1].test(clean(v))));
  if (headAt < 0) {
    const ids = [...new Set(aoa.flat().map(idOf).filter(Boolean))];
    return { form: false, rows: ids.map((studentId) => ({ studentId, name: '', grade: '', className: '', type: '', subjects: [], reason: '', teacher: '' })) };
  }
  const col = {};
  aoa[headAt].forEach((h, i) => {
    const text = clean(h);
    if (!text) return;
    const hit = FIELDS.find(([k, re]) => col[k] == null && re.test(text));
    if (hit) col[hit[0]] = i;
  });
  const seen = new Set();
  const rows = [];
  aoa.slice(headAt + 1).forEach((r) => {
    const studentId = idOf(r[col.studentId]);
    if (!studentId || seen.has(studentId)) return;
    seen.add(studentId);
    const get = (k) => (col[k] == null ? '' : clean(r[col[k]]));
    rows.push({
      studentId, name: get('name'), grade: get('grade'), className: get('className'),
      type: typeOf(get('type')), subjects: get('subjects').split(/[،,؛;/]+/).map(clean).filter(Boolean),
      reason: get('reason'), teacher: get('teacher'),
    });
  });
  return { form: true, rows };
}
