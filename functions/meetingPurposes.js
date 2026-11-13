// What parents want to talk to the teacher about: the purpose a parent writes
// for an interview, sorted into topics by keywords (Arabic and English). A
// purpose can fall under several topics; one with none is OTHER.

const norm = (s) => String(s || "")
  .replace(/[ً-ْـ]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
  .toLowerCase();

// Keywords are normalised like the text (below).
const TOPICS = [
  ["LEVEL", ["مستوي", "مستواه", "مستواها", "تحصيل", "اداء", "درجات", "درجه", "علامات", "نتيجه", "نتائج", "تقدم", "ضعف", "ضعيف", "تراجع", "انخفض", "انخفاض", "تدني", "متدني",
    "level", "grade", "performance", "progress", "marks", "score", "result", "weak"]],
  ["EXAMS", ["اختبار", "امتحان", "تقييم", "كويز", "quiz", "exam", "test", "assessment", "midterm"]],
  ["HOMEWORK", ["واجب", "مشروع", "مشاريع", "تكليف", "تكاليف", "ملف الانجاز", "homework", "assignment", "project"]],
  ["BEHAVIOR", ["سلوك", "انضباط", "تصرف", "مشاغب", "شغب", "عنف", "تنمر", "يضربه", "يضربها", "عدوان", "احترام", "عقاب", "behavior", "behaviour", "bully", "discipline", "conduct"]],
  ["LITERACY", ["قراءه", "القراءه", "يقرا", "كتابه", "الكتابه", "املاء", "الاملاء", "نطق", "تهجئه", "حروف", "الخط", "reading", "writing", "spelling", "phonics", "handwriting"]],
  ["FOCUS", ["مشاركه", "تركيز", "انتباه", "تشتت", "شرود", "سرحان", "داخل الفصل", "في الفصل", "الحصه", "participat", "focus", "attention", "concentrat", "distract"]],
  ["ATTENDANCE", ["غياب", "غيابه", "تاخر", "التاخير", "absence", "absent", "attendance", "late"]],
  ["SUPPORT", ["دعم", "تقويه", "علاجي", "خطه", "كيف نساعد", "نساعده", "نساعدها", "مساعدته", "مساعدتها", "تحسين", "تطوير", "تمارين", "اضافي", "نصائح", "اقتراحات", "في البيت", "بالبيت", "المنزل",
    "support", "help", "improve", "plan", "tips", "advice", "at home"]],
  ["SOCIAL", ["نفسي", "نفسيه", "اجتماعي", "اصدقاء", "صداقه", "زملاء", "زملايه", "خجل", "ثقه", "قلق", "خوف", "بكاء", "حزين", "emotional", "social", "friend", "confidence", "anxi", "shy"]],
  ["SPECIAL", ["دمج", "صعوبات", "صعوبه تعلم", "احتياجات", "فرط", "توحد", "special need", "iep", "adhd", "learning difficult"]],
  ["TEACHING", ["طريقه الشرح", "الشرح", "شرح", "اسلوب", "تعامل المعلم", "تعامل الاستاذ", "المنهج", "منهج", "الكتاب المدرسي", "teaching", "explain", "curriculum", "method"]],
  ["ADMIN", ["حافله", "الباص", "باص", "النقل", "رسوم", "الزي", "زي مدرسي", "الجدول", "تحويل", "نقل الي فصل", "bus", "fees", "uniform", "timetable", "transfer"]],
  ["GENERAL", ["متابعه", "اطمئنان", "الاطمئنان", "للاطمئنان", "بشكل عام", "عامه", "general", "follow", "overall", "check on"]],
];
TOPICS.forEach((x) => { x[1] = x[1].map(norm); });
const PURPOSE_TOPICS = [...TOPICS.map(([id]) => id), "OTHER"];

function topicsOf(text) {
  const t = norm(text);
  const hits = TOPICS.filter(([, words]) => words.some((w) => t.includes(w))).map(([id]) => id);
  return hits.length ? hits : ["OTHER"];
}

// Tally a list of {purpose, subject}; samples are a few short real purposes
// per topic (as written, trimmed).
function tallyPurposes(items) {
  const cats = Object.fromEntries(PURPOSE_TOPICS.map((id) => [id, { count: 0, samples: [] }]));
  const subjects = {};
  let total = 0;
  items.forEach(({ purpose, subject }) => {
    const text = String(purpose || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) return;
    total++;
    const topics = topicsOf(text);
    const sub = String(subject || "").trim() || "—";
    const s = subjects[sub] || (subjects[sub] = { subject: sub, total: 0, topics: {} });
    s.total++;
    topics.forEach((id) => {
      cats[id].count++;
      s.topics[id] = (s.topics[id] || 0) + 1;
      const c = cats[id].samples;
      if (c.length < 4 && text.length >= 8 && !c.includes(text)) c.push(text.length > 140 ? `${text.slice(0, 137)}…` : text);
    });
  });
  return {
    total,
    topics: PURPOSE_TOPICS.map((id) => ({ id, ...cats[id] })).filter((x) => x.count).sort((a, b) => (a.id === "OTHER") - (b.id === "OTHER") || b.count - a.count),
    bySubject: Object.values(subjects).sort((a, b) => b.total - a.total).slice(0, 15).map((s) => ({
      subject: s.subject, total: s.total,
      top: Object.entries(s.topics).filter(([id]) => id !== "OTHER").sort(([, a], [, b]) => b - a).slice(0, 3).map(([id, count]) => ({ id, count })),
    })),
  };
}

module.exports = { topicsOf, tallyPurposes, PURPOSE_TOPICS };
