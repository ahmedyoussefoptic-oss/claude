<?php
/* مخطط قاعدة البيانات — يعمل على MySQL و SQLite */

function schemaStatements(): array {
    $my = DB_DRIVER !== 'sqlite';
    $ID  = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $ENG = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $TXT = 'TEXT';
    return [
"CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(64) PRIMARY KEY,
  sval $TXT
)$ENG",

"CREATE TABLE IF NOT EXISTS branches (
  id $ID,
  code VARCHAR(12) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  active INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
)$ENG",

"CREATE TABLE IF NOT EXISTS users (
  id $ID,
  username VARCHAR(60) NOT NULL UNIQUE,
  pass VARCHAR(255) NOT NULL,
  name VARCHAR(150) NOT NULL,
  title VARCHAR(150),
  role VARCHAR(20) NOT NULL,
  branch_id INT,
  dept VARCHAR(20),
  phone VARCHAR(25),
  email VARCHAR(150),
  scope VARCHAR(10) NOT NULL DEFAULT 'branch',
  p_edit INT NOT NULL DEFAULT 0,
  p_delete INT NOT NULL DEFAULT 0,
  p_users INT NOT NULL DEFAULT 0,
  active INT NOT NULL DEFAULT 1,
  must_change INT NOT NULL DEFAULT 0,
  created_at INT,
  last_login INT
)$ENG",

"CREATE TABLE IF NOT EXISTS counters (
  ckey VARCHAR(40) PRIMARY KEY,
  n INT NOT NULL DEFAULT 0
)$ENG",

"CREATE TABLE IF NOT EXISTS complaints (
  id $ID,
  ref VARCHAR(32) NOT NULL UNIQUE,
  branch_id INT NOT NULL,
  student VARCHAR(180) NOT NULL,
  curriculum VARCHAR(80),
  grade VARCHAR(80),
  parent_name VARCHAR(180) NOT NULL,
  phone VARCHAR(25) NOT NULL,
  relation VARCHAR(40),
  channel VARCHAR(40),
  ctype VARCHAR(30) NOT NULL,
  csub VARCHAR(80),
  priority VARCHAR(20) NOT NULL,
  subject VARCHAR(250) NOT NULL,
  body $TXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  received_by INT,
  created_by INT,
  assignee INT,
  created_at INT NOT NULL,
  first_response_at INT,
  resolved_at INT,
  resolution $TXT,
  parent_notified_at INT,
  notified_by INT,
  notify_channel VARCHAR(40),
  closed_at INT,
  wa_sent_at INT,
  wa_sent_by INT,
  escalation INT NOT NULL DEFAULT 0,
  breached INT NOT NULL DEFAULT 0,
  reopened INT NOT NULL DEFAULT 0,
  reminder_count INT NOT NULL DEFAULT 0,
  last_reminder_at INT,
  notify_reminder_at INT,
  survey_speed INT, survey_quality INT, survey_overall INT,
  survey_comment $TXT, survey_at INT,
  deleted INT NOT NULL DEFAULT 0
)$ENG",

"CREATE TABLE IF NOT EXISTS attachments (
  id $ID,
  complaint_id INT NOT NULL,
  name VARCHAR(255),
  mime VARCHAR(120),
  size INT,
  path VARCHAR(255),
  created_at INT
)$ENG",

"CREATE TABLE IF NOT EXISTS history (
  id $ID,
  complaint_id INT NOT NULL,
  at INT NOT NULL,
  actor_id INT,
  actor_label VARCHAR(80),
  action VARCHAR(80),
  note $TXT
)$ENG",

"CREATE TABLE IF NOT EXISTS notifications (
  id $ID,
  user_id INT NOT NULL,
  complaint_id INT,
  ref VARCHAR(32),
  body $TXT,
  at INT NOT NULL,
  is_read INT NOT NULL DEFAULT 0
)$ENG",

"CREATE TABLE IF NOT EXISTS kb (
  id $ID,
  title VARCHAR(250),
  ctype VARCHAR(30),
  csub VARCHAR(80),
  solution $TXT,
  ref VARCHAR(32),
  uses INT NOT NULL DEFAULT 0,
  created_at INT,
  created_by INT
)$ENG",

"CREATE TABLE IF NOT EXISTS audit (
  id $ID,
  at INT NOT NULL,
  user_id INT,
  action VARCHAR(80),
  note $TXT,
  ip VARCHAR(45)
)$ENG",

"CREATE INDEX IF NOT EXISTS idx_c_branch  ON complaints (branch_id)",
"CREATE INDEX IF NOT EXISTS idx_c_status  ON complaints (status)",
"CREATE INDEX IF NOT EXISTS idx_c_assign  ON complaints (assignee)",
"CREATE INDEX IF NOT EXISTS idx_h_c       ON history (complaint_id)",
"CREATE INDEX IF NOT EXISTS idx_n_user    ON notifications (user_id, is_read)",
"CREATE INDEX IF NOT EXISTS idx_a_c       ON attachments (complaint_id)",
    ];
}

function defaultBranches(): array {
    return [
        ['DTG', 'فرع الداون تاون بنات'],
        ['DTB', 'فرع الداون تاون بنين'],
        ['SHT', 'فرع الشاطئ'],
        ['MHD', 'فرع المحمدية'],
        ['NAM', 'فرع النعيم'],
        ['SLM', 'فرع السلامة'],
        ['ZHR', 'فرع الزهراء'],
    ];
}

function defaultSettings(): array {
    return [
        'school_name' => SCHOOL_NAME,
        'logo_path'   => '',
        'sla' => json_encode([
            'عاجلة' => ['response'=>1,'resolve'=>8,'remind'=>2,'desc'=>'مساس بسلامة الطالب أو حالة طارئة'],
            'عالية' => ['response'=>4,'resolve'=>24,'remind'=>6,'desc'=>'أثر مباشر على انتظام الطالب أو حالة سلوكية'],
            'عادية' => ['response'=>8,'resolve'=>72,'remind'=>24,'desc'=>'طلب أو ملاحظة لا تحتمل الطابع العاجل'],
        ], JSON_UNESCAPED_UNICODE),
        'wa_template' =>
"السلام عليكم ورحمة الله، {ولي_الأمر}\n".
"نشكر لكم تواصلكم مع {الفرع} — {المدرسة}.\n".
"بخصوص شكواكم رقم ({الرقم_المرجعي}) حول: {عنوان_الشكوى}\n".
"نفيدكم بأنه تم اتخاذ الإجراء التالي:\n{الحل}\n".
"وقد استغرقت المعالجة {مدة_المعالجة}. نأمل أن يكون الحل قد نال رضاكم، ونسعد بتقييمكم للخدمة عبر الرابط:\n{رابط_التتبع}\n".
"إدارة خدمة المستفيدين",
        'curricula' => json_encode(['المنهج الوطني (السعودي)','المنهج الأمريكي','المنهج البريطاني','المنهج الدولي IB'], JSON_UNESCAPED_UNICODE),
        'grades' => json_encode(['روضة KG1','روضة KG2','تمهيدي KG3','الأول الابتدائي','الثاني الابتدائي','الثالث الابتدائي','الرابع الابتدائي','الخامس الابتدائي','السادس الابتدائي','الأول المتوسط','الثاني المتوسط','الثالث المتوسط','الأول الثانوي','الثاني الثانوي','الثالث الثانوي'], JSON_UNESCAPED_UNICODE),
        'types' => json_encode([
            'إدارية'   => ['dept'=>'admin',    'subs'=>['الرسوم والمدفوعات','النقل والحافلات','الشهادات والوثائق','التسجيل والقبول','الزي المدرسي','المقصف والتغذية','المرافق والصيانة','أخرى']],
            'أكاديمية' => ['dept'=>'academic', 'subs'=>['مستوى التحصيل الدراسي','الاختبارات والدرجات','الواجبات والمنصات','أداء معلم','الخطة الدراسية','صعوبات التعلم','أخرى']],
            'سلوكية'   => ['dept'=>'behavior', 'subs'=>['تنمّر','مشاجرة بين طلاب','انضباط داخل الصف','الغياب والتأخر','السلامة والإشراف','أخرى']],
        ], JSON_UNESCAPED_UNICODE),
        'urgent_words' => json_encode(['تنمر','تنمّر','إصابة','اصابة','حادث','سلامة','ضرب','اعتداء','خطر','طارئ','مفقود','تهديد'], JSON_UNESCAPED_UNICODE),
    ];
}
