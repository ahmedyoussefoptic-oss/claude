const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

// Identifies the same student across complaints, tech tickets and lost &
// found records. The national ID is the identity (spaces removed, Arabic
// digits folded to Latin so "١٠٩٨" and "1098" match); records without an ID
// fall back to the name so they still group instead of being dropped.
export function studentKey(studentId, studentName) {
  const id = String(studentId || '').replace(/[٠-٩]/g, (d) => ARABIC_DIGITS.indexOf(d)).replace(/\s+/g, '');
  if (id) return `id:${id}`;
  const name = String(studentName || '').trim().replace(/\s+/g, ' ');
  return name ? `name:${name}` : null;
}
