import { doc, getDoc, collection, query, where, orderBy, limit, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

const STUDENTS_COLLECTION = 'students';

// Arabic / Persian digits → Latin, spaces removed.
const latinDigits = (v) => String(v ?? '').replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

export function normalizeStudentId(id) {
  return latinDigits(id).replace(/\s+/g, '').trim();
}

// Parent mobile as the forms use it: 05xxxxxxxx. The roster file stores it
// as a number (5xxxxxxxx, leading 0 lost) or as 9665xxxxxxxx.
export function normalizeMobile(v) {
  let d = latinDigits(v).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3)}`;
  if (/^5\d{8}$/.test(d)) return `0${d}`;
  return d;
}

// Search keys: English lower-case, Arabic without diacritics / letter variants.
export function normalizeArabic(s) {
  return String(s ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}
const normalizeLatin = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeTerm = (s) => (/[؀-ۿ]/.test(s) ? normalizeArabic(s) : normalizeLatin(s));

// Roster stage_name → the forms' section (department) id.
const SECTION_BY_STAGE_NAME = {
  'أمريكي': 'AMERICAN', 'امريكي': 'AMERICAN',
  'بريطاني': 'BRITISH',
  'تربية خاصة': 'SPECIAL_EDUCATION', 'التربية الخاصة': 'SPECIAL_EDUCATION',
  // Kindergarten classes belong to the American section (as on past records).
  'رياض أطفال': 'AMERICAN', 'رياض اطفال': 'AMERICAN',
};

// Roster grade_name ("Grade 5", "KG 2", "SEN") → the forms' stage (G5, KG2, SEN).
export function stageFromGradeName(g) {
  const s = String(g ?? '').trim();
  let m = /^grade\s*(\d{1,2})$/i.exec(s);
  if (m) return `G${Number(m[1])}`;
  m = /^kg\s*([1-3])$/i.exec(s);
  if (m) return `KG${m[1]}`;
  if (/^sen$/i.test(s)) return 'SEN';
  return '';
}

// Roster class_name ("MA5-1", "SM-B5-A", "DK3-A", "SM-K2-B") → the forms'
// class ("5-1", "5-A", "KG3-A"). The letters before the grade are the
// branch/section code. Anything else (e.g. SEN "A6 (SURFERS)") is kept as is.
export function classFromClassName(className, stage) {
  const c = String(className ?? '').trim();
  const m = /(\d{1,2})-([A-Z0-9]{1,3})$/i.exec(c);
  if (m && stage && stage !== 'SEN') {
    const prefix = stage.startsWith('KG') ? stage : String(Number(m[1]));
    return `${prefix}-${m[2].toUpperCase()}`;
  }
  return c;
}

// Branch names as written in the roster file → branch code. Exact name
// first (with or without "فرع "), then known spellings of this school's file.
const BRANCH_ALIASES = {
  'السلامة بنات': 'AL_SALAMA_GIRLS',
  'السلامة 1': 'AL_SALAMA_GIRLS',
  'التربية الخاصة - السلامة 2': 'AL_SALAMA_BOYS',
  'السلامة 2 - التربيه الخاصة': 'AL_SALAMA_BOYS',
  'السلامة 2': 'AL_SALAMA_BOYS',
};
export function matchBranchCode(branchName, branches) {
  const name = String(branchName ?? '').trim().replace(/^فرع\s+/, '');
  if (!name) return '';
  const norm = normalizeArabic(name);
  const found = branches.find((b) => normalizeArabic(String(b.name || '').replace(/^فرع\s+/, '')) === norm);
  if (found) return found.id;
  const alias = Object.entries(BRANCH_ALIASES).find(([k]) => normalizeArabic(k) === norm);
  return alias ? alias[1] : '';
}

export function normalizeGender(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/^(m|male|boy|ذكر|بنين|ولد)$/.test(s)) return 'M';
  if (/^(f|female|girl|أنثى|انثى|أنثي|انثي|بنات|بنت)$/.test(s)) return 'F';
  return '';
}

// Every word of both names (normalized) — lets staff find a student by
// any one of their names.
function searchKeywords(name, nameAr) {
  const words = [...normalizeLatin(name).split(' '), ...normalizeArabic(nameAr).split(' ')].filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 20);
}

// Parses a raw sheet (array of row objects from XLSX.utils.sheet_to_json)
// into normalized student records, tolerant of header casing/whitespace.
// Columns: id_num, name, name_ar, branch_name, stage_name, grade_name,
// class_name, mobile, father_id (parent national ID), optional gender.
export function parseStudentRows(rows, branches) {
  const records = [];
  const skipped = [];
  const unmatchedBranches = {};
  let missingMobile = 0;
  let missingParentId = 0;

  rows.forEach((row, index) => {
    const get = (...keys) => {
      for (const key of Object.keys(row)) {
        const normalizedKey = key.trim().toLowerCase();
        if (keys.includes(normalizedKey)) return row[key];
      }
      return undefined;
    };

    const nationalId = normalizeStudentId(get('id_num', 'national_id', 'nationalid', 'student_id'));
    const name = String(get('name', 'student_name', 'name_en') ?? '').trim();
    const nameAr = String(get('name_ar', 'arabic_name', 'student_name_ar') ?? '').trim();

    if (!nationalId || (!name && !nameAr)) {
      skipped.push(index + 2); // +2: 1-based + header row
      return;
    }

    const branchName = String(get('branch_name', 'branch') ?? '').trim();
    const branch = matchBranchCode(branchName, branches);
    if (!branch && branchName) unmatchedBranches[branchName] = (unmatchedBranches[branchName] || 0) + 1;
    const stageName = String(get('stage_name', 'stage') ?? '').trim();
    const gradeName = String(get('grade_name', 'grade') ?? '').trim();
    const className = String(get('class_name', 'class') ?? '').trim();
    const stage = stageFromGradeName(gradeName);
    const mobile = normalizeMobile(get('mobile', 'phone', 'parent_mobile'));
    const parentNationalId = normalizeStudentId(get('father_id', 'parent_id', 'guardian_id', 'parent_national_id'));
    if (!mobile) missingMobile++;
    if (!parentNationalId) missingParentId++;

    records.push({
      nationalId,
      name: name || nameAr,
      nameAr,
      branchName,
      branch,
      stageName,
      gradeName,
      className,
      // Ready-made form values (stage / section / class dropdowns).
      stage,
      department: SECTION_BY_STAGE_NAME[normalizeArabic(stageName)] || SECTION_BY_STAGE_NAME[stageName] || '',
      grade: classFromClassName(className, stage),
      mobile,
      parentNationalId,
      // Optional gender column → 'M' / 'F' (used by boys-/girls-only trips).
      gender: normalizeGender(get('gender', 'sex', 'الجنس', 'student_gender')),
      nameLower: normalizeLatin(name),
      nameArNorm: normalizeArabic(nameAr),
      keywords: searchKeywords(name, nameAr),
      active: true,
    });
  });

  return { records, skipped, unmatchedBranches, missingMobile, missingParentId };
}

// Merges (creates or updates) student records in batches of 400 — comfortably
// under Firestore's 500-writes-per-batch limit. With `deactivateIds`, the
// students no longer in the file (moved / graduated) are marked inactive.
export async function upsertStudents(records, onProgress, deactivateIds = []) {
  const BATCH_SIZE = 400;
  const importedAt = new Date().toISOString();
  const ops = [
    ...records.map((record) => [record.nationalId, { ...record, importedAt }]),
    ...deactivateIds.map((id) => [id, { active: false, deactivatedAt: importedAt }]),
  ];
  let written = 0;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(([id, data]) => batch.set(doc(db, STUDENTS_COLLECTION, id), data, { merge: true }));
    await batch.commit();
    written += chunk.length;
    onProgress?.(written, ops.length);
  }
  return written;
}

// IDs of every student currently in the roster (to find who left).
export async function listStudentIds() {
  const snap = await getDocs(collection(db, STUDENTS_COLLECTION));
  return snap.docs.filter((d) => d.data().active !== false).map((d) => d.id);
}

// Direct doc-id lookup — students are keyed by their national ID, so this is
// a single cheap read rather than a query over the whole roster.
export async function lookupStudentById(nationalId) {
  const id = normalizeStudentId(nationalId);
  if (!id) return null;
  const snap = await getDoc(doc(db, STUDENTS_COLLECTION, id));
  return snap.exists() && snap.data().active !== false ? snap.data() : null;
}

const run = async (q) => (await getDocs(q)).docs.map((d) => d.data()).filter((s) => s.active !== false);

// One box for everything in the roster: student national ID, parent
// national ID (all siblings), parent mobile (all siblings), or any part of
// the English / Arabic name. Returns up to `max` students.
export async function searchStudents(term, max = 10) {
  const raw = String(term ?? '').trim();
  if (raw.length < 2) return [];
  const digits = normalizeStudentId(raw);
  const found = new Map();
  const add = (list) => list.forEach((s) => { if (s?.nationalId && !found.has(s.nationalId)) found.set(s.nationalId, s); });
  const students = collection(db, STUDENTS_COLLECTION);

  if (/^\d+$/.test(digits)) {
    if (digits.length >= 9) {
      const byId = await lookupStudentById(digits);
      if (byId) add([byId]);
      add(await run(query(students, where('parentNationalId', '==', digits), limit(max))));
      const mobile = normalizeMobile(digits);
      if (/^05\d{8}$/.test(mobile)) add(await run(query(students, where('mobile', '==', mobile), limit(max))));
    }
    return [...found.values()].slice(0, max);
  }

  const norm = normalizeTerm(raw);
  const words = norm.split(' ').filter(Boolean);
  const isArabic = /[؀-ۿ]/.test(raw);
  // Whole-name prefix (e.g. "محمد خالد" or "mohammed kh").
  const field = isArabic ? 'nameArNorm' : 'nameLower';
  add(await run(query(students, orderBy(field), where(field, '>=', norm), where(field, '<=', `${norm}`), limit(max))));
  // Any single name (first, father, family…).
  if (found.size < max && words[0]?.length >= 2) {
    const byWord = await run(query(students, where('keywords', 'array-contains', words[words.length > 1 ? words.length - 1 : 0]), limit(40)));
    add(byWord.filter((s) => words.every((w) => (s.keywords || []).some((k) => k.startsWith(w)))));
  }
  // Older roster rows (imported before the search keys existed).
  if (found.size < max && !isArabic) {
    add(await run(query(students, orderBy('name'), where('name', '>=', raw), where('name', '<=', `${raw}`), limit(max))));
  }
  return [...found.values()].slice(0, max);
}

// Kept for older callers.
export const searchStudentsByName = searchStudents;

// Display name: Arabic when the roster has it.
export const studentDisplayName = (s) => s?.nameAr || s?.name || '';

// Everything the forms can take from a roster student.
export function studentFormValues(s) {
  if (!s) return {};
  const stage = s.stage || stageFromGradeName(s.gradeName);
  return {
    studentName: studentDisplayName(s),
    studentId: s.nationalId || '',
    branch: s.branch || '',
    department: s.department || SECTION_BY_STAGE_NAME[normalizeArabic(s.stageName)] || '',
    stage: stage === 'SEN' || !stage ? stage || '' : stage,
    grade: s.grade || classFromClassName(s.className, stage),
    parentPhone: normalizeMobile(s.mobile),
    parentNationalId: s.parentNationalId || '',
  };
}

// A class dropdown's options plus the current value when it isn't one of
// them (e.g. a SEN class name from the roster), so it still shows.
export const withCurrentOption = (options, value) => (value && !options.includes(value) ? [value, ...options] : options);
