export const STAGES = ['KG1', 'KG2', 'KG3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'SEN'];

export const COMPLAINT_TYPES = [
  { id: 'ACADEMIC', name: 'أكاديمية' },
  { id: 'ADMINISTRATIVE', name: 'إدارية' },
  { id: 'BEHAVIORAL', name: 'سلوكية' },
  { id: 'FINANCE', name: 'مالية' },
];

// Financial feedback (fees, invoices, refunds...) — a built-in category
// routed to the finance department (users.department FINANCE) and shown in
// its own section (/finance) instead of the general feedback list, with its
// own tab on the parent link. useOrgData keeps it listed even before it is
// saved in Settings.
export const FINANCE_TYPE = 'FINANCE';
export const isFinanceComplaint = (c) => complaintTypesOf(c).includes(FINANCE_TYPE);
// Belongs to the finance section rather than the general list: its main
// category is the financial one.
export const isFinancePrimary = (c) => c?.complaintType === FINANCE_TYPE;

// Sub-classifications shown once a top-level complaint type is chosen —
// mirrors the department each type routes to (see src/pages/Users.jsx).
export const SUB_TYPES = {
  ACADEMIC: ['مستوى التحصيل الدراسي', 'الاختبارات والدرجات', 'الواجبات والمنصات', 'أداء معلم', 'الخطة الدراسية', 'صعوبات التعلم', 'أخرى'],
  ADMINISTRATIVE: ['الرسوم والمدفوعات', 'النقل والحافلات', 'الشهادات والوثائق', 'التسجيل والقبول', 'الزي المدرسي', 'المقصف والتغذية', 'المرافق والصيانة', 'غياب خطأ', 'أخرى'],
  BEHAVIORAL: ['تنمّر', 'مشاجرة بين طلاب', 'انضباط داخل الصف', 'الغياب والتأخر', 'السلامة والإشراف', 'أخرى'],
  FINANCE: ['الرسوم الدراسية', 'الفواتير والسداد', 'الأقساط وخطط السداد', 'استرداد المبالغ', 'الخصومات والمنح', 'رسوم النقل', 'أخرى'],
};

// A complaint is resolved once solved/closed (or rejected) — at that point
// it is no longer "overdue", even though the isOverdue flag the SLA engine
// set when it passed its deadline is never cleared (it records that it ran
// late; see functions/index.js).
export const RESOLVED_COMPLAINT_STATUSES = ['SOLVED', 'CLOSED', 'REJECTED'];
export const isComplaintOverdue = (complaint) => Boolean(complaint.isOverdue) && !RESOLVED_COMPLAINT_STATUSES.includes(complaint.status);

// "Was escalated at some point": `wasEscalated` is set on manual escalation
// (ComplaintDetails) and backfilled server-side from the activity log; the
// SLA engine escalates by setting isOverdue + ESCALATED together, so
// isOverdue covers automatic escalations too.
export const wasComplaintEscalated = (c) => Boolean(c.wasEscalated || c.isOverdue || c.status === 'ESCALATED');
export const isEscalatedResolved = (c) => wasComplaintEscalated(c) && ['SOLVED', 'CLOSED'].includes(c.status);

// Status label that keeps the escalation visible once resolved:
// "مصعدة وتم حلها" instead of plain "تم الحل".
export const complaintStatusLabel = (c, t) => (isEscalatedResolved(c)
  ? t('statuses.complaint.ESCALATED_RESOLVED')
  : t(`statuses.complaint.${c.status}`, c.status));

// Every category a complaint carries: the primary complaintType plus any
// extra ones (`extraTypes: [{ type, subType }]`, see ExtraTypesEditor).
export function complaintTypesOf(c) {
  const extra = Array.isArray(c?.extraTypes) ? c.extraTypes.map((x) => x?.type) : [];
  return [...new Set([c?.complaintType, ...extra].filter(Boolean))];
}
export const complaintHasType = (c, type) => complaintTypesOf(c).includes(type);

// "type — subType" for every category, joined for display.
export function complaintTypesLabel(c, typeName, sep = '، ') {
  const rows = [{ type: c?.complaintType, subType: c?.subType }, ...(Array.isArray(c?.extraTypes) ? c.extraTypes : [])].filter((r) => r?.type);
  return rows.map((r) => [typeName(r.type), r.subType].filter(Boolean).join(' — ')).join(sep);
}
