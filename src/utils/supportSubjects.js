// A subject as typed («الرياضيات», «رياضيات», «Math») → one key; its family
// also joins related ones (physics, chemistry, biology → science; Quran →
// Islamic studies). Mirrors subjectKey / subjectFamily in functions/support.js.
const SUBJECT_KEYS = [
  ['حاسب', /حاسب|حاسوب|كمبيوتر|\bict\b|comput/], ['رياضيات', /رياض|math/], ['انجليزي', /انجليز|انكليز|english|phonics/], ['فرنسي', /فرنس|french/],
  ['عربي', /عربي|لغتي|نحو|املاء|arabic/], ['فيزياء', /فيزي|physic/], ['كيمياء', /كيمي|chemi/], ['احياء', /احيا|biolog/], ['علوم', /علوم|science/],
  ['قران', /قران|تجويد|quran/], ['اسلامي', /اسلامي|توحيد|فقه|حديث|تفسير|islam/], ['اجتماعيات', /اجتماع|social|تاريخ|جغراف/],
];
const SUBJECT_FAMILY = { فيزياء: 'علوم', كيمياء: 'علوم', احياء: 'علوم', قران: 'اسلامي' };

export const subjectKey = (x) => {
  const t = String(x || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
  const hit = SUBJECT_KEYS.find(([, re]) => re.test(t));
  return hit ? hit[0] : t.split(/\s+/).map((w) => w.replace(/^ال/, '')).join('');
};
// A group's subject may be several («الفيزياء / الكيمياء»): its first decides.
export const subjectFamily = (x) => { const k = subjectKey(String(x || '').split('/')[0]); return SUBJECT_FAMILY[k] || k; };
