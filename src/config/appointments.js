// A category means "the parent asks for a school visit appointment" when it
// is flagged `appointment` in Settings (on the complaint type or on the
// sub-type), or — so it works before anyone flags it — when the sub-type's
// name mentions an appointment / visit request.
const NAME_HINT = /موعد|زيارة|appointment/i;

export function isAppointmentCategory(typeId, subTypeName, complaintTypes, subTypes) {
  if (!typeId) return false;
  if (complaintTypes.find((ct) => ct.id === typeId)?.appointment) return true;
  const sub = subTypes.find((s) => s.parentType === typeId && s.name === subTypeName);
  if (sub?.appointment) return true;
  return Boolean(subTypeName && NAME_HINT.test(subTypeName) && /موعد|appointment/i.test(subTypeName));
}

export const APPOINTMENT_STATUS = {
  REQUESTED: ['بانتظار تأكيد المدرسة', 'bg-amber-100 text-amber-800 border-amber-200'],
  CONFIRMED: ['مؤكد', 'bg-emerald-100 text-emerald-800 border-emerald-200'],
  CHECKED_IN: ['وصل ولي الأمر', 'bg-sky-100 text-sky-800 border-sky-200'],
  CANCELLED: ['ملغى', 'bg-slate-100 text-slate-600 border-slate-200'],
};
