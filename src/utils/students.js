import { doc, getDoc, collection, query, where, orderBy, limit, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

const STUDENTS_COLLECTION = 'students';

export function normalizeStudentId(id) {
  return String(id ?? '').trim();
}

// Direct doc-id lookup — students are keyed by their national ID, so this is
// a single cheap read rather than a query over the whole roster.
export async function lookupStudentById(nationalId) {
  const id = normalizeStudentId(nationalId);
  if (!id) return null;
  const snap = await getDoc(doc(db, STUDENTS_COLLECTION, id));
  return snap.exists() ? snap.data() : null;
}

// Prefix search on `name` for the autocomplete dropdown — a single-field
// range query, no composite index required.
export async function searchStudentsByName(term, max = 8) {
  const prefix = String(term ?? '').trim();
  if (prefix.length < 2) return [];
  const q = query(
    collection(db, STUDENTS_COLLECTION),
    orderBy('name'),
    where('name', '>=', prefix),
    where('name', '<=', prefix + ''),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// Matches an Excel branch_name value against the app's branch list by exact
// label — returns the branch code, or '' if no branch has that exact name.
export function matchBranchCode(branchName, branches) {
  const name = String(branchName ?? '').trim();
  if (!name) return '';
  const found = branches.find((b) => b.name.trim() === name);
  return found ? found.id : '';
}

// Parses a raw sheet (array of row objects from XLSX.utils.sheet_to_json)
// into normalized student records, tolerant of header casing/whitespace.
export function parseStudentRows(rows, branches) {
  const records = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const get = (...keys) => {
      for (const key of Object.keys(row)) {
        const normalizedKey = key.trim().toLowerCase();
        if (keys.includes(normalizedKey)) return row[key];
      }
      return undefined;
    };

    const nationalId = normalizeStudentId(get('id_num', 'national_id', 'nationalid'));
    const name = String(get('name', 'student_name') ?? '').trim();

    if (!nationalId || !name) {
      skipped.push(index + 2); // +2: 1-based + header row
      return;
    }

    const branchName = String(get('branch_name', 'branch') ?? '').trim();
    records.push({
      nationalId,
      name,
      branchName,
      branch: matchBranchCode(branchName, branches),
      stageName: String(get('stage_name', 'stage') ?? '').trim(),
      gradeName: String(get('grade_name', 'grade') ?? '').trim(),
      className: String(get('class_name', 'class') ?? '').trim(),
      mobile: String(get('mobile', 'phone') ?? '').trim(),
    });
  });

  return { records, skipped };
}

// Merges (creates or updates) student records in batches of 400 — comfortably
// under Firestore's 500-writes-per-batch limit.
export async function upsertStudents(records, onProgress) {
  const BATCH_SIZE = 400;
  let written = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((record) => {
      batch.set(doc(db, STUDENTS_COLLECTION, record.nationalId), record, { merge: true });
    });
    await batch.commit();
    written += chunk.length;
    onProgress?.(written, records.length);
  }

  return written;
}
