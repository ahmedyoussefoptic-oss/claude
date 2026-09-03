# Technical Specification — نظام شكاوى مكتشف

> **الحالة:** Draft Technical Specification  
> **المصدر الأساسي:** وثيقة متطلبات "نظام شكاوي مكتشف" المرفوعة مع المشروع.  
> **ملاحظة:** أي قرار تقني غير محدد في الوثيقة الأصلية مذكور صراحةً على أنه **اقتراح/قرار تنفيذي** وليس متطلباً من المصدر.

---

## 1. الهدف

بناء نظام Ticketing مركزي لإدارة شكاوى أولياء الأمور من لحظة الاستقبال وحتى الحل، التقييم، الإغلاق أو التصعيد، مع:

- تتبع كامل لحالة الشكوى.
- SLA حسب أولوية الشكوى.
- إسناد الشكوى للمختص المناسب.
- التصعيد التلقائي عند تجاوز SLA.
- Activity Log غير قابل للفقد.
- مرفقات وتسجيلات صوتية.
- إشعارات وقوالب رسائل.
- Dashboard وتقارير.
- بحث متقدم وتصدير.
- دعم العربية والإنجليزية.

---

## 2. نطاق النظام

### 2.1 القنوات المدعومة

```text
CENTER_CALL
WHATSAPP
EMAIL
PARENT_PORTAL
VISIT
MOBILE_APP
```

### 2.2 الفروع

```text
DOWN_TOWN_BOYS
DOWN_TOWN_GIRLS
AL_SHATI
AL_MOHAMMADIA
AL_SALAMA_GIRLS
AL_SALAMA_BOYS
AL_NAEEM
AL_ZAHRA
```

> أسماء الفروع أعلاه تم تحويلها إلى identifiers برمجية مقترحة. يجب ربطها بأسماء العرض العربية/الإنجليزية في إعدادات النظام.

### 2.3 الأقسام

```text
AMERICAN
BRITISH
SPECIAL_EDUCATION
```

### 2.4 المراحل

- KG1 إلى G12 حسب القسم.
- يجب عدم افتراض قائمة مختلفة للمراحل ما لم يتم اعتمادها من إدارة النظام.

### 2.5 أنواع الشكاوى

```text
ACADEMIC
ADMINISTRATIVE
BEHAVIORAL
LOST_FOUND
```

### 2.6 الأولوية

```text
NORMAL
HIGH
URGENT
```

---

# 3. الأدوار والصلاحيات

## 3.1 Customer Service Employee

الصلاحيات:

- إنشاء شكوى.
- إدخال بيانات ولي الأمر والطالب.
- تحديد مصدر الشكوى.
- رفع المرفقات.
- إضافة تسجيل صوتي.
- إرسال الشكوى للمختص.
- متابعة حالة الشكوى.
- التواصل مع ولي الأمر بعد الحل.
- إرسال استبيان الرضا.

## 3.2 Complaint Resolver / Specialist

الصلاحيات:

- مشاهدة الشكاوى المسندة إليه.
- تأكيد الاستلام.
- إضافة ملاحظات داخلية.
- معالجة الشكوى.
- إدخال طريقة الحل وتفاصيله.
- إعادة الشكوى لموظف خدمة العملاء.
- طلب/قبول تحويل الشكوى حسب الصلاحيات.

## 3.3 Department Manager

الصلاحيات:

- مشاهدة شكاوى القسم.
- متابعة SLA.
- متابعة الشكاوى المتأخرة.
- تصعيد الشكاوى.
- مراقبة أداء الموظفين.

## 3.4 Upper Management

الصلاحيات:

- استلام الشكاوى المصعدة.
- متابعة الشكاوى المتأخرة.
- اتخاذ القرارات.
- مشاهدة التقارير العامة والاستراتيجية.

## 3.5 Admin

الصلاحيات الكاملة:

- إدارة المستخدمين.
- إدارة الأدوار والصلاحيات.
- إدارة الفروع والأقسام.
- إدارة الإعدادات.
- إدارة قوالب الرسائل.
- إدارة إعدادات الإشعارات.
- إدارة النظام.

---

# 4. حالات الشكوى

الحالات الأساسية:

```text
RECEIVED
IN_PROGRESS
WAITING_PARENT_RESPONSE
SOLVED
REJECTED
ESCALATED
CLOSED
```

## 4.1 الانتقالات المقترحة

```text
RECEIVED
   ↓
IN_PROGRESS
   ├── WAITING_PARENT_RESPONSE
   │        ↓
   │    IN_PROGRESS
   │
   ├── SOLVED
   │
   ├── ESCALATED
   │        ↓
   │    IN_PROGRESS / SOLVED
   │
   └── REJECTED

SOLVED
   ↓
CLOSED

CLOSED
   ↓
REOPENED (إعادة فتح الشكوى)
   ↓
IN_PROGRESS
```

> `REOPENED` ورد كوظيفة في الوثيقة، بينما قائمة حالات التذكرة في الوثيقة لا تسميه كحالة مستقلة. لذلك يمكن تنفيذ إعادة الفتح كحالة مستقلة أو كحدث يعيد الحالة إلى `IN_PROGRESS` حسب القرار النهائي للتصميم.

---

# 5. SLA

| الأولوية | الحد الأقصى للحل |
|---|---:|
| URGENT | 6 ساعات |
| HIGH | 24 ساعة |
| NORMAL | 48 ساعة |

### قواعد SLA

- يبدأ احتساب SLA بعد استلام/تأكيد الشكوى وفق تدفق النظام.
- الجمعة والسبت لا يدخلان ضمن وقت SLA.
- يجب حفظ:
  - وقت بدء SLA.
  - وقت الاستحقاق.
  - الوقت المتبقي.
  - وقت التوقف إن تم اعتماد إيقاف SLA في حالات معينة.

> الوثيقة لا تحدد صراحةً قواعد إيقاف SLA أثناء `WAITING_PARENT_RESPONSE`؛ لذلك لا ينبغي تنفيذ هذا السلوك تلقائياً إلا بعد اعتماد قاعدة العمل.

---

# 6. التصعيد

## 6.1 تجاوز SLA

عند تجاوز مدة الحل:

1. إرسال تنبيه للمدير.
2. تسجيل الحدث في `activityLog`.
3. تغيير الحالة إلى `ESCALATED` أو تسجيل التصعيد مع إبقاء الحالة الحالية حسب قرار UX/Business.
4. إرسال إشعار للإدارة العليا وفق إعدادات النظام.

## 6.2 التصعيد التلقائي

إذا لم يتخذ المدير إجراءً خلال ساعتين:

```text
SLA BREACHED
     ↓
Notify Department Manager
     ↓
Wait 2 Hours
     ↓
No Manager Action
     ↓
Auto Escalate to Upper Management
```

يجب اعتبار "إجراء المدير" Event قابلاً للتتبع، مثل:
- فتح الشكوى.
- إضافة تعليق.
- إعادة إسناد.
- اعتماد إجراء.
- تغيير الحالة.

---

# 7. نموذج البيانات

## 7.1 Complaint

```ts
type Complaint = {
  complaintId: string;

  parentName: string;
  parentPhone: string;
  parentEmail?: string;

  studentName: string;
  studentId: string;

  branch: string;
  department: string;
  stage: string;
  grade: string;

  complaintType: string;
  priority: string;
  source: string;

  receiver: string;

  attachments: Attachment[];
  voiceNote?: string;

  details: string;

  status: ComplaintStatus;

  assignedTo?: string;
  assignedAt?: Timestamp;

  solutionDetails?: string;
  solvedAt?: Timestamp;

  escalatedAt?: Timestamp;
  escalatedTo?: string;

  parentFeedback?: string;
  satisfactionRate?: number;

  reopened: boolean;

  activityLog: ActivityLogEntry[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  closedAt?: Timestamp;
};
```

## 7.2 Attachment

```ts
type Attachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: Timestamp;
};
```

## 7.3 Activity Log

```ts
type ActivityLogEntry = {
  id: string;
  complaintId: string;

  action: string;
  actorId: string;

  metadata?: Record<string, unknown>;

  createdAt: Timestamp;
};
```

أمثلة Actions:

```text
COMPLAINT_CREATED
COMPLAINT_ASSIGNED
COMPLAINT_RECEIVED
COMPLAINT_STATUS_CHANGED
COMPLAINT_TRANSFERRED
INTERNAL_COMMENT_ADDED
SOLUTION_ADDED
COMPLAINT_SOLVED
COMPLAINT_ESCALATED
PARENT_CONTACTED
SURVEY_SENT
SURVEY_SUBMITTED
COMPLAINT_REOPENED
COMPLAINT_CLOSED
```

---

# 8. قاعدة البيانات

الوثيقة تقترح:

```text
SQL / Firestore
```

### قرار التنفيذ المقترح

إذا كان المشروع يعتمد Firebase، يمكن استخدام Firestore.

إذا كان المشروع يحتاج:
- تقارير SQL معقدة.
- علاقات كثيرة.
- استعلامات تحليلية متقدمة.
- معاملات Transactional قوية.

فيمكن استخدام PostgreSQL.

> اختيار SQL أو Firestore ليس محسومًا في وثيقة المتطلبات؛ يجب ربط القرار بالـstack الفعلي للمشروع.

---

# 9. API Contract مقترح

## 9.1 إنشاء شكوى

```http
POST /api/complaints
```

Request:

```json
{
  "parentName": "string",
  "parentPhone": "string",
  "parentEmail": "string",
  "studentName": "string",
  "studentId": "string",
  "branch": "AL_SHATI",
  "department": "AMERICAN",
  "stage": "G8",
  "grade": "8",
  "complaintType": "ACADEMIC",
  "priority": "HIGH",
  "source": "CENTER_CALL",
  "details": "string"
}
```

Response:

```json
{
  "complaintId": "COM-2026-001",
  "status": "RECEIVED",
  "createdAt": "2026-09-01T10:00:00+03:00"
}
```

## 9.2 الحصول على شكوى

```http
GET /api/complaints/{complaintId}
```

## 9.3 البحث

```http
GET /api/complaints
```

Query parameters:

```text
complaintId
studentName
studentId
parentName
branch
status
priority
complaintType
from
to
assignedTo
page
limit
```

## 9.4 إسناد

```http
POST /api/complaints/{complaintId}/assign
```

```json
{
  "assignedTo": "USER_ID"
}
```

## 9.5 تأكيد الاستلام

```http
POST /api/complaints/{complaintId}/acknowledge
```

## 9.6 تحويل

```http
POST /api/complaints/{complaintId}/transfer
```

```json
{
  "toUserId": "USER_ID",
  "reason": "Wrong classification"
}
```

## 9.7 إضافة الحل

```http
POST /api/complaints/{complaintId}/solution
```

```json
{
  "solutionDetails": "string"
}
```

## 9.8 التصعيد

```http
POST /api/complaints/{complaintId}/escalate
```

```json
{
  "reason": "SLA exceeded"
}
```

## 9.9 إعادة الفتح

```http
POST /api/complaints/{complaintId}/reopen
```

## 9.10 الإغلاق

```http
POST /api/complaints/{complaintId}/close
```

## 9.11 التعليق الداخلي

```http
POST /api/complaints/{complaintId}/internal-comments
```

```json
{
  "comment": "string"
}
```

---

# 10. التحقق من البيانات

## Required Fields

عند إنشاء الشكوى:

```text
parentName
parentPhone
studentName
studentId
branch
department
stage
grade
complaintType
priority
source
details
receiver
```

### قواعد مقترحة

- `parentPhone`: رقم صالح حسب تنسيق النظام.
- `parentEmail`: اختياري لكنه يجب أن يكون بصيغة صحيحة عند إدخاله.
- `satisfactionRate`: عدد صحيح من 1 إلى 5.
- `reopened`: Boolean.
- `complaintId`: فريد.
- `priority`, `source`, `complaintType`, `status`, `department`, `branch` يجب أن تكون قيمًا من Enumerations معتمدة.

---

# 11. إنشاء رقم الشكوى

النمط المقترح حسب الوثيقة:

```text
COM-2026-001
```

### المتطلبات

- Unique.
- Auto-generated.
- قابل للبحث.
- لا يتغير بعد إنشاء الشكوى.

---

# 12. Activity Log

كل تغيير مهم يجب أن ينتج Event.

مثال:

```json
{
  "id": "LOG_001",
  "complaintId": "COM-2026-001",
  "action": "COMPLAINT_ASSIGNED",
  "actorId": "USER_123",
  "metadata": {
    "fromUserId": null,
    "toUserId": "USER_456"
  },
  "createdAt": "2026-09-01T10:15:00+03:00"
}
```

### متطلبات Audit

- لا يسمح للمستخدم العادي بحذف السجل.
- يجب حفظ التاريخ والوقت.
- يجب حفظ المستخدم المنفذ.
- يجب حفظ تفاصيل التغيير عند الحاجة.

---

# 13. الإشعارات

## Events

```text
NEW_COMPLAINT
COMPLAINT_ASSIGNED
COMPLAINT_RECEIVED
SLA_WARNING
SLA_BREACHED
COMPLAINT_SOLVED
COMPLAINT_ESCALATED
SURVEY_REQUEST
```

## قنوات الإشعار

```text
IN_APP
EMAIL
VOICE (عند الإمكان)
```

### تذكير SLA

يرسل تذكير قبل انتهاء المدة بساعتين عبر:
- Email.
- In-app.

### عند الحل

يرسل إشعار لولي الأمر يحتوي:
- رقم الشكوى.
- طريقة/ملخص الحل.
- رابط استبيان الرضا.

---

# 14. قوالب الرسائل

يجب أن تكون القوالب قابلة للإدارة من Admin.

### Confirmation

```text
شكراً لتواصلكم مع مدارس مكتشف العالمية.
تم استلام شكواكم رقم [رقم الشكوى]
وسيتم الرد عليكم خلال [المدة المحددة].
```

### Assignment

```text
تم إسناد شكواكم رقم [رقم الشكوى]
إلى المختص [اسم المختص] للمعالجة.
```

### Resolution

```text
تم حل شكواكم رقم [رقم الشكوى]
وذلك بـ [طريقة الحل].
يرجى تقييم الخدمة من خلال الرابط التالي:
[رابط الاستبيان]
```

### Escalation

```text
تم تصعيد شكواكم رقم [رقم الشكوى]
إلى الإدارة العليا لمتابعتها.
```

يجب توفير نسخة عربية وإنجليزية، واختيار اللغة حسب تفضيل ولي الأمر.

---

# 15. استبيان الرضا

Schema:

```ts
type SatisfactionSurvey = {
  complaintId: string;

  resolutionSpeed: number; // 1-5
  solutionQuality: number; // 1-5
  staffProfessionalism: number; // 1-5

  wantsReopen: boolean;

  additionalComments?: string;

  submittedAt: Timestamp;
};
```

### Validation

```text
1 <= resolutionSpeed <= 5
1 <= solutionQuality <= 5
1 <= staffProfessionalism <= 5
```

---

# 16. Dashboard

يجب توفير مؤشرات على الأقل لـ:

1. عدد الشكاوى حسب الفرع.
2. عدد الشكاوى حسب النوع.
3. متوسط وقت الحل.
4. عدد الشكاوى المصعدة.
5. رضا أولياء الأمور.
6. أداء الموظفين:
   - عدد الشكاوى المحلولة.
   - متوسط وقت الحل.

### Filters مقترحة

```text
date range
branch
department
complaint type
priority
status
assigned user
source
```

---

# 17. التقارير والتصدير

## Export

الصيغ المطلوبة:

```text
Excel
PDF
```

### تقرير تفاصيل الشكوى

يجب أن يتضمن عند التصدير:
- بيانات الشكوى.
- بيانات الطالب.
- بيانات ولي الأمر.
- الحالة.
- المختص.
- الحل.
- التصعيد.
- التقييم.
- Activity Log حسب صلاحية المستخدم.

---

# 18. البحث المتقدم

الحقول:

```text
complaintId
studentName
studentId
parentName
branch
date range
status
```

ويفضل إضافة:

```text
priority
complaintType
assignedTo
source
department
```

---

# 19. المرفقات والتسجيل الصوتي

## Attachments

يجب دعم:

```text
Images
Video
Audio
Documents
```

### متطلبات

- حفظ metadata.
- التحقق من نوع الملف.
- تحديد حد أقصى للحجم من إعدادات النظام.
- صلاحيات وصول للمرفقات.
- عدم جعل الملفات الحساسة Public.

## Voice Note

```ts
voiceNote: string
```

يمثل رابط/مرجع التسجيل الصوتي.

كما يجب دعم التسجيل المباشر من داخل النظام حسب إمكانيات الواجهة.

---

# 20. التعليقات الداخلية

التعليقات الداخلية لا تظهر لولي الأمر.

```http
POST /api/complaints/{complaintId}/internal-comments
```

يجب ربط كل تعليق بـ:

```text
complaintId
authorId
comment
createdAt
```

ويجب أن تكون صلاحية قراءتها محصورة بالمستخدمين الداخليين المصرح لهم.

---

# 21. إعادة فتح الشكوى

يمكن إعادة فتح الشكوى في حال:

- عدم رضا ولي الأمر عن الحل.
- تكرار الشكوى.

عند إعادة الفتح:

```text
reopened = true
```

ويجب إنشاء Activity Log:

```text
COMPLAINT_REOPENED
```

ويعاد توجيه الشكوى لمسار المعالجة حسب قواعد النظام.

---

# 22. الأرشفة

بعد:

```text
Solution Accepted
+
Satisfaction Survey
+
Final Closure
```

يمكن نقل الشكوى إلى Archive.

### متطلبات الأرشيف

- قابل للبحث.
- قابل للتحليل.
- لا يفقد Activity Log.
- لا يسمح بالتعديل العادي بعد الإغلاق النهائي.

---

# 23. Authentication & Authorization

> الوثيقة الأصلية تحدد الأدوار والصلاحيات لكنها لا تحدد آلية Authentication.

### متطلب تنفيذي

يجب تطبيق RBAC.

```text
User
  ↓
Role
  ↓
Permissions
```

مثال:

```text
complaints.create
complaints.read
complaints.assign
complaints.solve
complaints.transfer
complaints.escalate
complaints.close
complaints.reopen
reports.view
reports.export
users.manage
settings.manage
```

---

# 24. قواعد الوصول

### Customer Service

يرى الشكاوى التي يحتاجها لمعالجة خدمة العملاء، ولا يرى التعليقات الداخلية إلا إذا كانت الصلاحية تسمح بذلك.

### Specialist

يرى الشكاوى المسندة إليه وما يلزم لمعالجتها.

### Manager

يرى شكاوى قسمه.

### Upper Management

يرى الشكاوى المصعدة والتقارير العامة.

### Admin

Full Access.

> نطاق الرؤية الدقيق لكل دور يحتاج اعتمادًا نهائيًا من مالك النظام.

---

# 25. Background Jobs

يفضل تنفيذ Jobs مجدولة لـ:

```text
SLA deadline monitoring
SLA reminder
SLA breach detection
Automatic escalation
Survey reminders
Notification retry
```

مثال:

```text
Every 1 minute
   ↓
Find active complaints
   ↓
Calculate SLA
   ↓
If 2h remaining → send reminder
   ↓
If deadline exceeded → escalate
   ↓
If manager inactive for 2h → upper management
```

---

# 26. Idempotency

عمليات الإشعارات والتصعيد يجب ألا تنفذ مرتين بسبب retry.

مثال:

```text
eventId
complaintId
action
```

يجب استخدام unique constraint أو idempotency key للعمليات الحساسة.

---

# 27. التعامل مع الأخطاء

API Response موحد مقترح:

```json
{
  "success": false,
  "error": {
    "code": "COMPLAINT_NOT_FOUND",
    "message": "Complaint not found"
  }
}
```

أمثلة:

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
COMPLAINT_NOT_FOUND
INVALID_STATUS_TRANSITION
INVALID_PRIORITY
SLA_CONFIGURATION_ERROR
FILE_UPLOAD_FAILED
NOTIFICATION_FAILED
```

---

# 28. Observability

يجب تسجيل:

- API errors.
- Background job failures.
- Notification failures.
- SLA processing failures.
- File upload failures.
- Authentication failures.
- Important business events.

مع تجنب تسجيل البيانات الحساسة غير الضرورية في logs.

---

# 29. Security Requirements

- RBAC إلزامي.
- HTTPS.
- التحقق من صلاحيات كل API.
- حماية المرفقات.
- Validation لكل مدخلات المستخدم.
- منع الوصول إلى شكوى عبر تغيير `complaintId` دون authorization.
- Audit Log للأحداث المهمة.
- عدم كشف التعليقات الداخلية خارج المستخدمين المصرح لهم.
- حماية بيانات ولي الأمر والطالب.
- عدم تخزين كلمات المرور بشكل نصي إذا كان النظام يدير الحسابات مباشرة.

---

# 30. Localization

اللغات:

```text
ar
en
```

يجب فصل:

```text
UI translations
Message templates
Validation messages
Notification messages
```

ويفضل تخزين اللغة المفضلة لولي الأمر:

```ts
preferredLanguage: "ar" | "en"
```

> هذا الحقل إضافة تنفيذية مقترحة لتطبيق متطلب "اللغة المفضلة لولي الأمر".

---

# 31. State Machine Rules

لا يجب السماح بتغيير الحالة بشكل عشوائي من الواجهة.

يجب أن يتحقق Backend من الانتقالات.

مثال:

```text
RECEIVED
→ IN_PROGRESS

IN_PROGRESS
→ WAITING_PARENT_RESPONSE
→ SOLVED
→ ESCALATED
→ REJECTED

WAITING_PARENT_RESPONSE
→ IN_PROGRESS
→ SOLVED

ESCALATED
→ IN_PROGRESS
→ SOLVED

SOLVED
→ CLOSED

CLOSED
→ IN_PROGRESS   // فقط عبر Reopen workflow
```

---

# 32. Definition of Done

## Complaint Creation

- [ ] إنشاء رقم فريد.
- [ ] حفظ بيانات ولي الأمر.
- [ ] حفظ بيانات الطالب.
- [ ] حفظ الفرع والقسم والمرحلة والصف.
- [ ] حفظ النوع والأولوية والمصدر.
- [ ] حفظ التفاصيل.
- [ ] تسجيل `createdAt`.
- [ ] إضافة Activity Log.

## Assignment

- [ ] إسناد للمختص.
- [ ] حفظ `assignedTo`.
- [ ] حفظ `assignedAt`.
- [ ] إرسال إشعار.
- [ ] تسجيل Activity Log.

## Resolution

- [ ] المختص يؤكد الاستلام.
- [ ] إضافة الحل.
- [ ] حفظ `solutionDetails`.
- [ ] حفظ `solvedAt`.
- [ ] إشعار خدمة العملاء/ولي الأمر.
- [ ] إرسال استبيان الرضا.

## SLA

- [ ] حساب 6 ساعات للعاجل.
- [ ] حساب 24 ساعة للعالي.
- [ ] حساب 48 ساعة للعادي.
- [ ] استثناء الجمعة والسبت.
- [ ] تذكير قبل ساعتين.
- [ ] تصعيد عند التجاوز.
- [ ] تصعيد تلقائي بعد ساعتين من عدم إجراء المدير.

## Audit

- [ ] كل إجراء مهم مسجل.
- [ ] المستخدم والتاريخ والوقت مسجلون.
- [ ] السجل غير قابل للحذف من المستخدم العادي.

---

# 33. ملاحظات غير محسومة تحتاج قرار Product

النقاط التالية غير محددة بالكامل في الوثيقة الأصلية ويجب عدم افتراضها برمجياً:

1. التقنية النهائية لقاعدة البيانات: SQL أم Firestore.
2. نظام Authentication ومصدر المستخدمين.
3. تفاصيل التكامل الفعلي مع WhatsApp.
4. تفاصيل التكامل مع البريد الإلكتروني.
5. هل يوجد SMS Gateway أم لا.
6. آلية الاتصال الهاتفي ومركز الاتصال.
7. سياسة إيقاف SLA أثناء انتظار ولي الأمر.
8. تعريف "إجراء المدير" الذي يمنع التصعيد التلقائي بعد ساعتين.
9. حدود أحجام وأنواع المرفقات.
10. سياسة الاحتفاظ بالملفات والتسجيلات الصوتية.
11. الصلاحيات الدقيقة لرؤية الشكاوى بين الفروع والأقسام.
12. هل `REOPENED` حالة مستقلة أم Event يعيد الشكوى إلى `IN_PROGRESS`.
13. هل الحل يحتاج اعتمادًا من موظف خدمة العملاء قبل الإرسال لولي الأمر.
14. تفاصيل قالب الرسائل الإنجليزية.
15. هل استبيان الرضا إلزامي قبل الإغلاق أم اختياري.
16. هل الجمعة والسبت ثابتان أم قابلان للتغيير من Admin.
17. المنطقة الزمنية المعتمدة للنظام.
18. سياسة حذف/إخفاء البيانات الحساسة.
19. هل التقرير يحتاج Real-time Dashboard أم تقارير دورية.
20. هل التصدير متاح لكل الأدوار أم للإدارة فقط.

---

# 34. Suggested Project Modules

```text
src/
├── auth/
├── users/
├── roles/
├── branches/
├── departments/
├── complaints/
│   ├── complaints.controller
│   ├── complaints.service
│   ├── complaints.repository
│   ├── complaints.validation
│   ├── complaint-state-machine
│   └── complaint.types
├── attachments/
├── activity-log/
├── sla/
│   ├── sla.service
│   ├── sla.worker
│   └── escalation.service
├── notifications/
├── templates/
├── surveys/
├── dashboard/
├── reports/
├── exports/
└── settings/
```

> هذا الهيكل **اقتراح معماري** وليس جزءًا منصوصًا عليه في وثيقة المتطلبات.

---

# 35. الخلاصة التنفيذية

النظام هو منصة Ticketing لإدارة دورة حياة الشكوى:

```text
Channel
   ↓
Create Complaint
   ↓
Classify
   ↓
Assign
   ↓
Acknowledge
   ↓
Process
   ↓
SLA Monitoring
   ├── On Time → Solve
   └── Breach → Escalate
                    ↓
                 Upper Management
   ↓
Customer Service Contact
   ↓
Satisfaction Survey
   ↓
Reopen? ── Yes → Processing
   │
   No
   ↓
Final Close
   ↓
Archive
```

**القاعدة الأساسية:** كل خطوة مؤثرة على الشكوى يجب أن تكون قابلة للتتبع عبر `Activity Log`، وكل صلاحية يجب أن يفرضها الـBackend وليس الواجهة فقط.
