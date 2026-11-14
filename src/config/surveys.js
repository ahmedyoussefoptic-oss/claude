import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// «تقييمات أولياء الأمور» — see functions/surveys.js.
export const callSurvey = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
export const SURVEY_PATH = '/survey';
export const surveyUrl = (code, branch = '') => `${window.location.origin}${SURVEY_PATH}/${code}${branch ? `?branch=${branch}` : ''}`;

// The branches as parents know them (order of the school's forms); any other
// branch in «الإعدادات» follows with its own name.
export const SURVEY_BRANCHES = [
  ['AL_SHATI', 'الشاطئ', 'Al Shatee'], ['AL_NAEEM', 'النعيم', 'Al Naeem'], ['AL_SALAMA_GIRLS', 'السلامة', 'Al Salamah'],
  ['AL_ZAHRA', 'الزهراء', 'Al Zahraa'], ['AL_MOHAMMADIA', 'المحمدية', 'Al Muhammadiyah'], ['DOWN_TOWN_BOYS', 'الداون تاون بنين', 'Downtown - Boys'],
  ['DOWN_TOWN_GIRLS', 'الداون تاون بنات', 'Downtown - Girls'], ['AL_SALAMA_BOYS', 'السلامة 2', 'Al Salamah 2'],
].map(([id, ar, en]) => ({ id, ar, en }));
export const surveyBranchList = (branches) => [
  ...SURVEY_BRANCHES,
  ...branches.filter((b) => !SURVEY_BRANCHES.some((x) => x.id === b.id)).map((b) => ({ id: b.id, ar: b.name, en: b.name })),
];
export const CURRICULA = [{ id: 'AMERICAN', ar: 'أمريكي', en: 'American' }, { id: 'BRITISH', ar: 'بريطاني', en: 'British' }];
export const GRADES = ['KG1', 'KG2', 'KG3', ...Array.from({ length: 12 }, (_, i) => `G${i + 1}`)];
export const gradeLabel = (g, lang) => (g?.startsWith('G') ? `${lang === 'en' ? 'Grade' : 'الصف'} ${g.slice(1)}` : g || '');
export const CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const RATED = ['teacher', 'rating', 'agree'];
export const ITEM_TYPES = ['teacher', 'rating', 'agree', 'choice', 'text'];

// One language of a {ar, en} text, falling back to the other.
export const pick = (x, lang) => (lang === 'en' ? x?.en || x?.ar : x?.ar || x?.en) || '';
export const other = (x, lang) => {
  const a = pick(x, lang);
  const b = lang === 'en' ? x?.ar : x?.en;
  return b && b !== a ? b : '';
};

// --- templates -----------------------------------------------------------------
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const subjects = (list) => list.map(([id, ar, en]) => ({ id: `t_${id}`, type: 'teacher', ar, en, required: false, na: true }));
const NO_GROUP = { ar: '', en: '' };

// The school's «Parent-Teacher Conference» form, as sent by the school.
const conference = () => ({
  title: 'Parent-Teacher Conference - اجتماع أولياء الأمور والمعلمين',
  intro: {
    ar: 'أولياء الأمور الأعزاء،\n\nنحن ممتنون بصدق لمشاركتكم في اجتماع أولياء الأمور والمعلمين اليوم. إن رأيكم وملاحظاتكم القيمة ذات أهمية كبيرة بالنسبة لنا، حيث نسعى باستمرار لتحسين خدماتنا التعليمية في مدارس المكتشف العالمية.\n\nنرجو منكم مشاركة آرائكم وملاحظاتكم حول تجربتكم في الاجتماع من خلال تعبئة النموذج أدناه.\n\nمع خالص الشكر،\nإدارة مدارس المكتشف العالمية\n#مستعدون_للغد',
    en: "Dear Parents,\n\nWe are sincerely grateful for your participation in today's Parent-Teacher Conference. Your valuable insights and feedback are of great importance to us as we continually strive to enhance our educational services at MIS.\n\nWe kindly request that you take a moment to share your thoughts on your conference experience using the form below. Your input is invaluable, and we thank you for your partnership in making our school community even better.\n\nBest regards,\nMIS Administration\n#ReadyForTomorrow",
  },
  items: [
    ...subjects([
      ['ENGLISH', 'اللغة الإنجليزية', 'English'], ['MATH', 'الرياضيات', 'Math'], ['SCIENCE', 'العلوم', 'Science'],
      ['BIOLOGY', 'الأحياء', 'Biology'], ['CHEMISTRY', 'الكيمياء', 'Chemistry'], ['PHYSICS', 'الفيزياء', 'Physics'],
      ['ARABIC', 'اللغة العربية', 'Arabic'], ['ISLAMIC', 'العلوم الإسلامية', 'Islamic'], ['SOCIAL', 'الدراسات الاجتماعية', 'Social Studies'],
      ['KSA', 'الاجتماعيات', 'SS-KSA'], ['FRENCH', 'اللغة الفرنسية', 'French'], ['COMPUTER', 'الحاسب الآلي', 'Computer'],
    ]),
    ...[
      ['reconnect', 'كيف تقيم تجربتك مع برنامج الاستعدادات والمراجعة خلال الأسابيع الأولى في مدرستنا؟', "How would you rate your experience of our school's Reconnect Week?"],
      ['facilities', 'ما مدى رضاك عن المرافق المدرسية؟ وهذا يشمل البنية التحتية، الفصول الدراسية، الملاعب، المكتبات، والمرافق الأخرى المتاحة.', 'How satisfied are you with the current school facilities provided for your child? This includes the infrastructure, classrooms, playgrounds, computer labs, and other available facilities.'],
      ['activities', 'كيف تقيم جهود المدرسة في تقديم مجموعة متنوعة من الأنشطة والدعم لطلابنا وطالباتنا؟', "How would you rate the school's efforts in providing various extracurricular activities and educational support for your child?"],
      ['responsive', 'إلى أي مدى تشعر أن المدرسة تستجيب بشكل فعال لملاحظات أولياء الأمور وتعليقاتهم؟', "To what extent do you feel the school responds effectively to parents' input, feedback, and concerns?"],
    ].map(([id, ar, en]) => ({ id, type: 'rating', ar, en, required: false, na: false, group: { ar: 'المدرسة', en: 'The School' } })),
    { id: 'comment', type: 'text', ar: 'نستقبل مقترحاتكم وملاحظاتكم بكل ترحيب واهتمام.', en: 'Please feel free to provide any feedback or make any other suggestions.', required: false, group: NO_GROUP },
  ],
});

// The updated version (the printed form): «Reconnect Week» removed, the
// school statements from «صوت الطالب» worded for parents.
const conferenceV2 = () => ({
  title: 'تقييم اجتماع أولياء الأمور والمعلمين - Parent-Teacher Conference Feedback',
  intro: {
    ar: 'أولياء الأمور الكرام،\n\nشكراً لحضوركم اجتماع أولياء الأمور والمعلمين اليوم. رأيكم يهمنا ويساعدنا على التطوير، ولن يستغرق النموذج أكثر من بضع دقائق.\n\nإدارة مدارس المكتشف العالمية\n#مستعدون_للغد',
    en: "Dear Parents,\n\nThank you for attending today's Parent-Teacher Conference. Your feedback helps us improve. This short form takes only a few minutes.\n\nMIS Administration\n#ReadyForTomorrow",
  },
  items: [
    ...subjects([
      ['ENGLISH', 'اللغة الإنجليزية', 'English'], ['MATH', 'الرياضيات', 'Math'], ['SCIENCE', 'العلوم', 'Science'],
      ['BIOLOGY', 'الأحياء', 'Biology'], ['CHEMISTRY', 'الكيمياء', 'Chemistry'], ['PHYSICS', 'الفيزياء', 'Physics'],
      ['ARABIC', 'اللغة العربية', 'Arabic'], ['ISLAMIC', 'التربية الإسلامية', 'Islamic Studies'], ['SOCIAL', 'الدراسات الاجتماعية', 'Social Studies'],
      ['KSA', 'الاجتماعيات والمواطنة (المنهج السعودي)', 'KSA Social Studies'], ['FRENCH', 'اللغة الفرنسية', 'French'], ['COMPUTER', 'الحاسب الآلي', 'Computer Science'],
    ]),
    ...[
      ['التعليم والتعلم', 'Teaching & Learning', [
        ['feedback', 'يتلقى ابني/ابنتي ملاحظات واضحة تساعده على تحسين مستواه الدراسي.', 'My child receives clear feedback that helps them improve.'],
        ['abilities', 'يراعي المعلمون اختلاف قدرات الطلاب ومستوياتهم.', "Teachers take students' different abilities and levels into account."],
      ]],
      ['الرعاية والسلامة', 'Care & Safety', [
        ['safe', 'يشعر ابني/ابنتي بالأمان أثناء وجوده في المدرسة.', 'My child feels safe at school.'],
        ['bullying', 'تتعامل المدرسة بسرعة وجدية مع المضايقات أو التنمر بين الطلاب.', 'The school deals quickly and seriously with harassment or bullying.'],
        ['contact', 'أعرف بمن أتواصل في المدرسة عند وجود مشكلة تخص ابني/ابنتي.', 'I know whom to contact at school when my child has a problem.'],
      ]],
      ['البيئة المدرسية والخدمات', 'School Environment & Services', [
        ['facilities', 'مرافق المدرسة نظيفة وآمنة ومهيأة للتعلم (الفصول، دورات المياه، الملاعب، المختبرات).', 'School facilities are clean, safe and ready for learning (classrooms, restrooms, playgrounds, labs).'],
        ['activities', 'تقدّم المدرسة أنشطة تناسب اهتمامات الطلاب وتساعدهم على تنمية مواهبهم.', "The school offers activities that suit students' interests and develop their talents."],
        ['dismissal', 'يسير دخول الطلاب وانصرافهم بصورة منظمة وآمنة.', 'Student arrival and dismissal are organised and safe.'],
      ]],
      ['التواصل والانتماء', 'Communication & Belonging', [
        ['listens', 'تستمع المدرسة إلى ملاحظات أولياء الأمور وتتعامل معها بجدية.', "The school listens to parents' feedback and acts on it seriously."],
        ['stay', 'أرغب في استمرار ابني/ابنتي في الدراسة بالمدرسة العام القادم.', 'I would like my child to continue at the school next year.'],
      ]],
    ].flatMap(([gar, gen, list]) => list.map(([id, ar, en]) => ({ id, type: 'agree', ar, en, required: false, na: true, group: { ar: gar, en: gen } }))),
    {
      id: 'overall', type: 'choice', ar: 'كيف تقيّمون تجربتكم مع المدرسة بصورة عامة؟', en: 'Overall, how would you rate your experience with the school?', required: false, group: { ar: 'بصورة عامة', en: 'Overall' },
      options: [{ id: 'EXCELLENT', ar: 'ممتازة', en: 'Excellent' }, { id: 'GOOD', ar: 'جيدة', en: 'Good' }, { id: 'NEEDS', ar: 'تحتاج إلى تحسين', en: 'Needs improvement' }],
    },
    { id: 'like', type: 'text', ar: 'ما أكثر ما يعجبكم في المدرسة؟', en: 'What do you like most about the school?', required: false, group: { ar: 'ملاحظاتكم', en: 'Your Comments' } },
    { id: 'improve', type: 'text', ar: 'ما أهم أمر تتمنون تحسينه؟', en: 'What is the one thing you would most like us to improve?', required: false, group: { ar: 'ملاحظاتكم', en: 'Your Comments' } },
  ],
});

export const SURVEY_TEMPLATES = [
  { id: 'CONFERENCE', make: conference },
  { id: 'CONFERENCE_V2', make: conferenceV2 },
];

// A new, empty question of a type (for the editor).
export function newItem(type) {
  const base = { id: uid('q'), type, ar: '', en: '', required: false };
  if (type === 'teacher') return { ...base, na: true };
  if (type === 'choice') return { ...base, group: NO_GROUP, options: [{ id: 'O1', ar: '', en: '' }, { id: 'O2', ar: '', en: '' }] };
  return { ...base, group: NO_GROUP, ...(type === 'text' ? {} : { na: type === 'agree' }) };
}

// --- results -------------------------------------------------------------------
const mean = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100 : 0);
export { mean };

// Per question: the average, how many answered, the 1–5 spread, «N/A»;
// choices → count per option; text → the answers.
export function summarize(items, responses) {
  return items.map((it) => {
    const vals = responses.map((r) => r.answers?.[it.id]).filter((v) => v !== undefined && v !== null && v !== '');
    if (RATED.includes(it.type)) {
      const nums = vals.filter((v) => typeof v === 'number');
      const dist = [1, 2, 3, 4, 5].map((n) => nums.filter((v) => v === n).length);
      return { item: it, avg: mean(nums), n: nums.length, na: vals.filter((v) => v === 'NA').length, dist };
    }
    if (it.type === 'choice') return { item: it, n: vals.length, counts: Object.fromEntries((it.options || []).map((o) => [o.id, vals.filter((v) => v === o.id).length])) };
    return { item: it, n: vals.length };
  });
}

// A response's averages: its teachers, and the rest of the rated questions.
export function responseAverages(items, r) {
  const nums = (types) => items.filter((it) => types.includes(it.type)).map((it) => r.answers?.[it.id]).filter((v) => typeof v === 'number');
  return { teachers: mean(nums(['teacher'])), school: mean(nums(['rating', 'agree'])) };
}

// The colour of an average (or a single rating) out of 5.
export const scoreTone = (v) => (!v ? 'text-slate-400' : v >= 4 ? 'text-emerald-700' : v >= 3 ? 'text-amber-700' : 'text-rose-700');
export const barTone = (v) => (v >= 4 ? 'bg-emerald-500' : v >= 3 ? 'bg-amber-400' : 'bg-rose-500');
