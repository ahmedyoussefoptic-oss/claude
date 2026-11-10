// Report filters by grade level (`stage`, e.g. G4) and class (`grade`,
// e.g. 4-2). Classes are typed in different ways across forms and imports
// ("4-2", "Grade 4 - 2", "G4/2", Arabic digits), so they are compared in a
// normalized form; a record with no stage still matches a stage filter when
// its class starts with that grade.
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normClass(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/^(grade|g)\s*/, '')
    .replace(/[\s/_.\\]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const stageKey = (stage) => String(stage || '').replace(/^G(\d+)$/, '$1').toLowerCase();

export function matchesClass(rec, { stage, grade } = {}) {
  if (stage && rec.stage !== stage && !(!rec.stage && normClass(rec.grade).split('-')[0] === stageKey(stage))) return false;
  if (grade && normClass(rec.grade) !== normClass(grade)) return false;
  return true;
}

// The class choices for a stage: the standard ones plus any other class
// spelling found in the records of that stage, shown as recorded.
export function classOptions(stage, records, standard) {
  if (!stage) return [];
  const seen = new Set(standard.map(normClass));
  const extra = [];
  records.forEach((r) => {
    if (!r.grade || !matchesClass(r, { stage })) return;
    const key = normClass(r.grade);
    if (key && !seen.has(key)) {
      seen.add(key);
      extra.push(r.grade);
    }
  });
  return [...standard, ...extra.sort()];
}

// "G4 — 4-2" for tables and Excel.
export const stageClassLabel = (rec) => [rec.stage, rec.grade].filter(Boolean).join(' — ');

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

// Roster class_name → the class as staff write it, keeping a section letter
// that stands on its own: "MA5-1" → "5-1", "MA-B5-1" / "B5-1" → "B5-1",
// "DK3-A" (KG3) → "KG3-A". The branch code in front is dropped; unlike
// classFromClassName, British "B5-1" and American "5-1" stay apart.
export function rosterClassCode(className, stage) {
  const c = String(className ?? '').trim();
  if (!stage || stage === 'SEN') return c;
  if (stage.startsWith('KG')) return classFromClassName(c, stage);
  const sec = /(?:^|-)([A-JL-Z])(\d{1,2})-([A-Z0-9]{1,3})$/i.exec(c);
  if (sec) return `${sec[1].toUpperCase()}${Number(sec[2])}-${sec[3].toUpperCase()}`;
  const m = /(\d{1,2})-([A-Z0-9]{1,3})$/i.exec(c);
  return m ? `${Number(m[1])}-${m[2].toUpperCase()}` : c;
}
