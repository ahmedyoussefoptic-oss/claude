export const STAGES = ['KG1', 'KG2', 'KG3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12'];

export const COMPLAINT_TYPES = [
  { id: 'ACADEMIC', name: 'أكاديمية' },
  { id: 'ADMINISTRATIVE', name: 'إدارية' },
  { id: 'BEHAVIORAL', name: 'سلوكية' },
];

// Sub-classifications shown once a top-level complaint type is chosen —
// mirrors the department each type routes to (see src/pages/Users.jsx).
export const SUB_TYPES = {
  ACADEMIC: ['مستوى التحصيل الدراسي', 'الاختبارات والدرجات', 'الواجبات والمنصات', 'أداء معلم', 'الخطة الدراسية', 'صعوبات التعلم', 'أخرى'],
  ADMINISTRATIVE: ['الرسوم والمدفوعات', 'النقل والحافلات', 'الشهادات والوثائق', 'التسجيل والقبول', 'الزي المدرسي', 'المقصف والتغذية', 'المرافق والصيانة', 'غياب خطأ', 'أخرى'],
  BEHAVIORAL: ['تنمّر', 'مشاجرة بين طلاب', 'انضباط داخل الصف', 'الغياب والتأخر', 'السلامة والإشراف', 'أخرى'],
};
