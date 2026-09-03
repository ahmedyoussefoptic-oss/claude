export const ITEM_CATEGORIES = [
  { id: 'CLOTHING', name: 'ملابس' },
  { id: 'ELECTRONICS', name: 'إلكترونيات' },
  { id: 'BOOKS_STATIONERY', name: 'كتب وأدوات مدرسية' },
  { id: 'ACCESSORIES', name: 'إكسسوارات' },
  { id: 'BAGS', name: 'حقائب' },
  { id: 'MONEY_VALUABLES', name: 'نقود ومقتنيات ثمينة' },
  { id: 'OTHER', name: 'أخرى' },
];

export const REPORT_TYPES = [
  { id: 'FOUND', name: 'تم العثور على غرض' },
  { id: 'LOST', name: 'بلاغ فقدان غرض' },
];

export const ITEM_STATUS_LABELS = {
  UNCLAIMED: 'بانتظار المطالبة',
  MATCHED: 'تمت المطابقة',
  RETURNED: 'تم التسليم',
  CLOSED: 'مغلقة',
};

export const ITEM_STATUS_BADGE = {
  UNCLAIMED: 'bg-blue-100 text-blue-800 border-blue-200',
  MATCHED: 'bg-amber-100 text-amber-800 border-amber-200',
  RETURNED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-800 border-slate-200',
};

export function generateItemCode() {
  const year = new Date().getFullYear();
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return `LF-${year}-${randomId}`;
}
