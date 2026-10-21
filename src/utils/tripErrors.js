// The trip Cloud Functions answer parents in Arabic; the English page shows
// these instead (unknown messages pass through unchanged).
const EN = {
  'الرابط غير صحيح.': 'This link is not valid.',
  'هذه الرحلة غير متاحة.': 'This trip is not available.',
  'أدخل رقم هوية الطالب/ة.': "Enter the student's national ID.",
  'أدخل رقم جوال ولي الأمر (05xxxxxxxx).': "Enter the parent's mobile number (05xxxxxxxx).",
  'محاولات كثيرة، حاول بعد ساعة أو تواصل مع الفرع.': 'Too many attempts. Try again in an hour or contact the branch.',
  'لم يتم العثور على الطالب/ة. تأكد من رقم الهوية.': 'Student not found. Please check the national ID.',
  'هذه الرحلة غير مخصصة لصف الطالب/ة أو فرعه.': "This trip is not for the student's grade or branch.",
  'انتهى موعد التسجيل في هذه الرحلة. للاستفسار تواصل مع الفرع.': 'Registration for this trip has closed. For enquiries, contact the branch.',
  'تم تسجيل الرد على هذه الرحلة من رقم جوال آخر. للتعديل تواصل مع الفرع.': 'A response for this trip was already submitted from another mobile number. To change it, contact the branch.',
  'اختر الموافقة أو الاعتذار.': 'Choose to approve or decline.',
  'يجب الإقرار بالاطلاع على تعليمات الرحلة.': 'Please confirm you have read the trip instructions.',
  'اختر طريقة الدفع.': 'Choose a payment method.',
  'تم تأكيد المشاركة ودفع الرسوم. لأي تعديل تواصل مع الفرع.': 'Participation is confirmed and the fee is paid. For any change, contact the branch.',
  'يرجى إرفاق سند التحويل البنكي.': 'Please attach the bank transfer receipt.',
  'اكتمل العدد المحدد للرحلة. للاستفسار تواصل مع الفرع.': 'This trip is full. For enquiries, contact the branch.',
  'بيانات المرفق غير مكتملة.': 'The attachment is incomplete.',
  'الحد الأقصى لحجم كل ملف هو 4 ميجابايت.': 'Each file can be at most 4 MB.',
  'الاستبيان متاح بعد تنفيذ الرحلة.': 'The survey opens after the trip.',
  'الاستبيان لأولياء أمور الطلاب المشاركين في الرحلة.': 'The survey is for parents of students who took part in the trip.',
  'تم استلام تقييمكم لهذه الرحلة مسبقاً، شكراً لكم.': 'We already received your rating for this trip. Thank you.',
  'قيّم جميع البنود من 1 إلى 5.': 'Rate every item from 1 to 5.',
  'أجب عن سؤال تكرار الرحلة.': 'Please answer whether you recommend repeating the trip.',
};

export function tripErrorText(message, lang) {
  return lang === 'ar' ? message : EN[String(message || '').trim()] || message;
}
