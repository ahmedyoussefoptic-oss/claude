<?php
/* =====================================================================
   نظام شكاوى أولياء الأمور — مدارس المكتشف العالمية
   ملف الإعدادات — عدّل بيانات قاعدة البيانات ثم افتح install.php
   ===================================================================== */

// نوع قاعدة البيانات: mysql للاستضافة الفعلية، sqlite للتجربة المحلية فقط
define('DB_DRIVER', getenv('MIS_DB_DRIVER') ?: 'mysql');

// ---------- بيانات MySQL (من لوحة تحكم الاستضافة) ----------
define('DB_HOST', getenv('MIS_DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('MIS_DB_NAME') ?: 'mis_complaints');
define('DB_USER', getenv('MIS_DB_USER') ?: 'mis_user');
define('DB_PASS', getenv('MIS_DB_PASS') ?: 'ضع_كلمة_المرور_هنا');
define('DB_PORT', getenv('MIS_DB_PORT') ?: '3306');

// ---------- مسار ملف SQLite (للتجربة المحلية) ----------
define('DB_SQLITE_PATH', __DIR__ . '/data/mis.sqlite');

// ---------- إعدادات عامة ----------
define('APP_NAME',      'نظام شكاوى أولياء الأمور');
define('SCHOOL_NAME',   'مدارس المكتشف العالمية');
define('UPLOAD_DIR',    __DIR__ . '/uploads');
define('UPLOAD_URL',    'uploads');
define('MAX_UPLOAD_MB', 15);
define('SESSION_NAME',  'MIS_SESSION');
define('SESSION_IDLE_MINUTES', 120);   // إنهاء الجلسة بعد خمول

// امتدادات المرفقات المسموح بها
$ALLOWED_EXT = ['jpg','jpeg','png','gif','webp','heic','mp3','m4a','wav','ogg','webm','amr','pdf','doc','docx','xls','xlsx'];

// اضبطها true بعد تركيب شهادة SSL على الدومين (مستحسن جداً)
define('FORCE_HTTPS', false);
