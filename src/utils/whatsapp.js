// Best-effort formatting for wa.me links: normalizes Arabic-Indic/Persian
// digits (commonly entered on Arabic keyboards) to ASCII, strips
// punctuation/spaces, and assumes a Saudi (+966) local number when no
// country code is present.
export function toWhatsAppNumber(phone) {
  const normalized = (phone || '').replace(/[٠-٩۰-۹]/g, (d) =>
    String(d.charCodeAt(0) & 0xf)
  );
  let digits = normalized.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '966' + digits.slice(1);
  return digits;
}

export function trackingLink(complaintId) {
  return `${window.location.origin}/track?id=${encodeURIComponent(complaintId)}`;
}

export function waLink(phone, message) {
  return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
}

// Default WhatsApp message templates, editable from Settings > قوالب
// الرسائل (stored at settings/messageTemplates). `{{placeholders}}` are
// substituted by renderTemplate() below — an admin can reword the message
// around them but the placeholders themselves must stay intact.
export const DEFAULT_TEMPLATES = {
  receipt: [
    'مرحباً {{parentName}}،',
    'شكراً لتواصلكم مع مدارس مكتشف العالمية.',
    'تم استلام ملاحظتكم رقم {{complaintId}} الخاصة بالطالب/ة {{studentName}} وسيتم التواصل معكم قريباً.',
    '',
    'يمكنكم متابعة حالة الملاحظة عبر الرابط التالي: {{trackingLink}}',
    '',
    'مدارس مكتشف العالمية',
  ].join('\n'),
  resolution: [
    'مرحباً {{parentName}}،',
    'تم حل الملاحظة رقم {{complaintId}} الخاصة بالطالب/ة {{studentName}}.',
    '',
    'طريقة الحل:',
    '{{solutionDetails}}',
    '',
    'يمكنكم تقييم الخدمة عبر الرابط التالي: {{trackingLink}}',
    '',
    'مدارس مكتشف العالمية',
  ].join('\n'),
  credential: [
    'مدارس المكتشف العالمية',
    'عزيزي ولي أمر الطالب/ة: {{studentName}}',
    'تم إعادة تفعيل حساب {{platformName}} بناءً على بلاغكم رقم {{ticketId}}.',
    '',
    '• رابط المنصة: {{platformLink}}',
    '• اسم المستخدم: {{username}}',
    '• الرمز السري المؤقت: {{tempPassword}}',
    '',
    'يُرجى تغيير الرمز السري فور أول دخول. الرمز صالح لمدة 24 ساعة.',
    'لأي استفسار: مركز خدمة العملاء',
  ].join('\n'),
};

// The placeholder tokens each template may use — surfaced in Settings so an
// admin editing the wording knows what's available to insert.
export const TEMPLATE_PLACEHOLDERS = {
  receipt: ['parentName', 'complaintId', 'studentName', 'trackingLink'],
  resolution: ['parentName', 'complaintId', 'studentName', 'solutionDetails', 'trackingLink'],
  credential: ['studentName', 'ticketId', 'platformName', 'platformLink', 'username', 'tempPassword'],
};

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ''));
}

export function buildReceiptMessage(complaint, template = DEFAULT_TEMPLATES.receipt) {
  return renderTemplate(template, {
    parentName: complaint.parentName,
    complaintId: complaint.complaintId,
    studentName: complaint.studentName,
    trackingLink: trackingLink(complaint.complaintId),
  });
}

export function buildResolutionMessage(complaint, solutionDetails, template = DEFAULT_TEMPLATES.resolution) {
  return renderTemplate(template, {
    parentName: complaint.parentName,
    complaintId: complaint.complaintId,
    studentName: complaint.studentName,
    solutionDetails,
    trackingLink: trackingLink(complaint.complaintId),
  });
}

// One-time platform-credential message for the tech-support module. The
// caller must never persist `username`/`tempPassword` anywhere — build the
// link, let the browser open WhatsApp, then discard the values from state.
export function buildCredentialMessage({ ticketId, studentName, platformName, platformLink, username, tempPassword }, template = DEFAULT_TEMPLATES.credential) {
  return renderTemplate(template, {
    ticketId,
    studentName,
    platformName: platformName || 'المنصة التعليمية',
    platformLink: platformLink || '—',
    username,
    tempPassword,
  });
}
