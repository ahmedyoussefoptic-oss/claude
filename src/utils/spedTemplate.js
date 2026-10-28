// The ministry's special-education import template (SpecialEducationImport_*.xlsx):
// reading its stage, year and dropdown lists when it is uploaded, and writing
// the parents' entries into its "Student List" sheet for download. The file
// itself is kept as is (styles, dropdowns, hidden lists, rules sheet) and only
// the data rows change, so the ministry's platform accepts it.

// Data columns in the template's order, with a word each header must contain.
export const SPED_COLUMNS = [
  ['#', '#'],
  ['studentName', 'Student Name'],
  ['studentId', 'Student National ID'],
  ['studentDob', 'Student DOB'],
  ['guardianName', 'Guardian Name'],
  ['guardianId', 'Guardian National ID'],
  ['guardianDob', 'Guardian DOB'],
  ['relation', 'Relation'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['altPhone', 'Alternate Phone'],
  ['grade', 'Grade'],
  ['inclusionType', 'Inclusion Type'],
  ['disability', 'Disability'],
];
const LIST_NAMES = {
  relations: 'SpecialEducationRelationships',
  grades: 'SpecialEducationGrades',
  inclusionTypes: 'SpecialEducationInclusionTypes',
  disabilities: 'SpecialEducationDisabilities',
};
const SHEET = 'Student List';
const FIRST_ROW = 3; // rows 1–2 are the headers
export const SPED_MAX_ROWS = 500;

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Reads an uploaded template → { meta, lists, template (base64) }; throws
// with an Arabic message when the file isn't this template.
export async function parseSpedTemplate(file) {
  const XLSX = await import('xlsx');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(bytes, { type: 'array' });
  const ws = wb.Sheets[SHEET];
  const rules = wb.Sheets['Rules and File Details'];
  if (!ws || !rules) throw new Error('الملف ليس نموذج التربية الخاصة من الوزارة (لا توجد ورقة Student List).');
  const headers = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[1] || [];
  const wrong = SPED_COLUMNS.find(([, word], i) => !String(headers[i] || '').toLowerCase().includes(word.toLowerCase()));
  if (wrong) throw new Error(`أعمدة الملف لا تطابق النموذج المعروف (العمود «${wrong[1]}»). أرسل الملف لمراجعته.`);

  const info = Object.fromEntries(XLSX.utils.sheet_to_json(rules, { header: 1, defval: '' }).map((r) => [String(r[1]).trim(), String(r[3] || r[2]).trim()]));
  const names = Object.fromEntries((wb.Workbook?.Names || []).map((n) => [n.Name, n.Ref]));
  const lists = {};
  for (const [key, name] of Object.entries(LIST_NAMES)) {
    const ref = names[name];
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(ref || '');
    const sheet = m && wb.Sheets[m[1]];
    if (!sheet) throw new Error(`لم يتم العثور على قائمة ${name} في الملف.`);
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: `${m[2]}${m[3]}:${m[4]}${m[5]}` }).map((r) => String(r[0]).trim()).filter(Boolean);
    if (!values.length) throw new Error(`قائمة ${name} فارغة في الملف.`);
    lists[key] = values;
  }
  return {
    meta: {
      version: info['File Version'] || '',
      stageId: info['Branch Stage ID'] || '',
      yearId: info['Academic Year ID'] || '',
      stageName: info.Stage || '',
      year: info['Academic Year'] || '',
    },
    lists,
    template: toBase64(bytes),
    fileName: file.name,
  };
}

const xmlText = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + i);
// "YYYY-MM-DD" → Excel date serial (the template's DOB columns are dd-MM-yyyy dates).
const excelDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : null;
};

// The entries written into the template → Blob (.xlsx).
export async function fillSpedTemplate(templateB64, entries) {
  const XLSX = await import('xlsx');
  const zip = XLSX.CFB.read(fromBase64(templateB64), { type: 'array' });
  const entry = (path) => zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith(path))];
  const read = (path) => new TextDecoder().decode(entry(path).content);

  // The "Student List" sheet's part, through the workbook's relationships.
  const rid = new RegExp(`<sheet [^>]*name="${SHEET}"[^>]*r:id="([^"]+)"`).exec(read('xl/workbook.xml'))?.[1];
  const target = new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(read('xl/_rels/workbook.xml.rels'));
  const sheetPath = `xl/${(target?.[1] || target?.[2] || 'worksheets/sheet1.xml').replace(/^\/?xl\//, '')}`;
  const sheet = entry(sheetPath);
  let xml = new TextDecoder().decode(sheet.content);

  // Column styles (text for IDs / phones, dd-MM-yyyy for dates).
  const styles = {};
  for (const [tag] of xml.matchAll(/<col [^>]*>/g)) {
    const attr = (n) => new RegExp(` ${n}="(\\d+)"`).exec(tag)?.[1];
    if (attr('style')) for (let c = +attr('min'); c <= +attr('max'); c++) styles[c - 1] = attr('style');
  }
  entries.slice(0, SPED_MAX_ROWS).forEach((e, i) => {
    const r = FIRST_ROW + i;
    const cells = SPED_COLUMNS.map(([key], c) => {
      const ref = `${colName(c)}${r}`;
      const s = styles[c] ? ` s="${styles[c]}"` : '';
      if (key === '#') return `<c r="${ref}" s="0"><v>${i + 1}</v></c>`;
      if (key === 'studentDob' || key === 'guardianDob') {
        const serial = excelDate(e[key]);
        return serial == null ? `<c r="${ref}"${s}/>` : `<c r="${ref}"${s}><v>${serial}</v></c>`;
      }
      const v = e[key];
      return v ? `<c r="${ref}"${s} t="inlineStr"><is><t>${xmlText(v)}</t></is></c>` : `<c r="${ref}"${s}/>`;
    }).join('');
    const row = new RegExp(`<row r="${r}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    xml = row.test(xml) ? xml.replace(row, `<row r="${r}">${cells}</row>`) : xml.replace('</sheetData>', `<row r="${r}">${cells}</row></sheetData>`);
  });
  sheet.content = new TextEncoder().encode(xml);
  sheet.size = sheet.content.length;
  const out = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
