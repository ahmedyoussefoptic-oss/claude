# MIS-CRM — نظام علاقات العملاء لمدارس المكتشف العالمية

- الموقع: https://mis-complaints.web.app و https://mis-crm.web.app (نفس الإعداد، `hosting` مصفوفة موقعين في firebase.json)
- الرد على المستخدم بالعربية، باختصار. المستخدم هو مالك النظام (ADMIN, isOwner).

## التقنيات
- الواجهة: Vite + React 19 + Tailwind 4 + i18next. النصوص في `src/i18n/locales/ar.json` و `en.json` (أضف المفتاح في الملفين؛ JSON بمسافتين، `ensure_ascii=False`، سطر أخير فارغ).
- الخلفية: Firebase Functions v2 (`onCall` / `onSchedule`) في `functions/`. `index.js` كبير جداً — ابحث بـ grep ولا تقرأه كاملاً. وحدات منفصلة بنمط factory: `meetings.js`, `surveys.js`, `support.js` (تُستدعى من index.js بتمرير db وأدوات مشتركة).
- Firestore: القواعد في `firestore.rules`؛ مجموعات الوحدات (مثل `supportCycles`, `supportLinks`) مستثناة من القاعدة العامة ولا تُقرأ إلا عبر الدوال.
- واتساب عبر قوالب Taqnyat (`taqnyatSend`, 5 متغيرات + زر فرع).
- الطباعة / PDF: `printPage({title, subtitle, school, body, css, landscape, dir, lang})`.
- الصلاحيات: `canSeeModule` / `moduleDefault` في `src/utils/scope.js` + `modules` و `perms` لكل مستخدم (صفحة المستخدمين).

## الأوامر
- البناء: `npm run build` — الفحص: `npm run lint`
- فحص صياغة دالة: `node --check functions/<file>.js`
- النشر يقوم به المستخدم بنفسه. اكتب له الأمر فقط، بالصيغة:
  `npx firebase-tools deploy --only hosting,functions:<name>,...` (أمر `firebase` غير مثبت).
  انشر الدوال المتغيرة بالاسم لا كل الدوال (أكثر من 100 دالة → أخطاء 429 وفشل تفعيل الصفحات).

## Git
- الفرع الحالي `feature/trip-consent-v2`. بعد الالتزام: `git push -q origin HEAD:main && git branch -f main HEAD`
- رسالة الالتزام بالإنجليزية تصف الميزة، وتنتهي بـ `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `survey-design-preview/` مستثنى من git (ملفات مقترحات ومعاينات).

## قواعد ثابتة
- لا تكتب في Firestore الإنتاج، ولا ترسل رسائل لأولياء أمور حقيقيين، ولا تنفّذ إجراءات حقيقية كتجربة.
- لا تُدخل كلمات مرور أو مفاتيح API أو أسرار (إعدادات بيفاتيل / Teams / كلمة الإعدادات يُدخلها المالك فقط)، ولا تطبعها.
- أخفِ أرقام الهويات والجوالات في التقارير والعروض. البيانات التجريبية فقط في العروض.
- ما هو للمالك فقط يبقى للمالك فقط.
- الاختبار: للتعديلات الصغيرة يكفي `npm run build` و `node --check`؛ الاختبار في المتصفح أو بقاعدة بيانات وهمية للميزات الكبيرة فقط أو عند الطلب.
- النصوص التي فيها أوقات داخل نص عربي: اعزلها بـ `<span dir="ltr">` (أو U+2066/U+2069 في نصوص الخادم).
