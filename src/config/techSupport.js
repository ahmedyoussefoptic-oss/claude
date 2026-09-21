export const PROBLEM_TYPES = [
  { id: 'WRONG_USERNAME', name: 'اسم مستخدم غير صحيح' },
  { id: 'FORGOT_PASSWORD', name: 'رمز سري منسي' },
  { id: 'ACCOUNT_SUSPENDED', name: 'حساب موقوف' },
  { id: 'ACCOUNT_NOT_CREATED', name: 'لم يُنشأ الحساب' },
];

export const PLATFORMS = [
  { id: 'LMS', name: 'نظام إدارة التعلم (LMS)' },
  { id: 'TEAMS', name: 'مايكروسوفت تيمز' },
  { id: 'PORTAL', name: 'بوابة الطالب' },
  { id: 'OTHER', name: 'أخرى' },
];

export const RELATIONS = ['الأب', 'الأم', 'الطالب نفسه'];

// Class/section options for the "الصف" dropdown, derived from the chosen
// stage — e.g. G1 -> 1-1..1-6 and 1-A..1-E. KG stages keep their own code
// as the prefix (KG1-1, KG1-A, ...) since they have no numeric grade digit.
export function classOptionsForStage(stage) {
  if (!stage) return [];
  const match = stage.match(/^G(\d+)$/);
  const prefix = match ? match[1] : stage;
  const numeric = ['1', '2', '3', '4', '5', '6'].map((n) => `${prefix}-${n}`);
  const alpha = ['A', 'B', 'C', 'D', 'E'].map((l) => `${prefix}-${l}`);
  return [...numeric, ...alpha];
}

// Status flow: NEW -> ASSIGNED -> IN_PROGRESS -> SOLVED -> WAITING_CONFIRMATION -> CLOSED / REOPENED
// SOLVED is set the moment IT saves a resolution (credentials and/or a
// note) — before that message has necessarily been sent to the parent.
export const TICKET_STATUS_LABELS = {
  NEW: 'جديد',
  ASSIGNED: 'مُسند',
  IN_PROGRESS: 'قيد المعالجة',
  SOLVED: 'تم الحل',
  WAITING_CONFIRMATION: 'بانتظار تأكيد المستفيد',
  CLOSED: 'مغلق',
  REOPENED: 'معاد فتحه',
};

export const TICKET_STATUS_BADGE = {
  NEW: 'bg-blue-100 text-blue-800 border-blue-200',
  ASSIGNED: 'bg-purple-100 text-purple-800 border-purple-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-200',
  SOLVED: 'bg-teal-100 text-teal-800 border-teal-200',
  WAITING_CONFIRMATION: 'bg-sky-100 text-sky-800 border-sky-200',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REOPENED: 'bg-red-100 text-red-800 border-red-200',
};

export const OPEN_TICKET_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'SOLVED', 'WAITING_CONFIRMATION', 'REOPENED'];

export function generateTicketId() {
  const year = new Date().getFullYear();
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return `IT-${year}-${randomId}`;
}
