<?php
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/schema.php';
require_once __DIR__ . '/lib/util.php';
require_once __DIR__ . '/lib/auth.php';

startSession();
$done = []; $err = null;

/* هل النظام مثبّت مسبقاً؟ */
$installed = tableExists('users') && (int) val("SELECT COUNT(*) FROM users") > 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$installed) {
    try {
        foreach (schemaStatements() as $sql) {
            try { db()->exec($sql); }
            catch (Exception $ex) { if (!str_contains($sql, 'CREATE INDEX')) throw $ex; }
        }
        $done[] = 'أُنشئت جداول قاعدة البيانات';

        // الإعدادات الافتراضية
        foreach (defaultSettings() as $k => $v)
            if (val("SELECT COUNT(*) FROM settings WHERE skey=?", [$k]) == 0)
                q("INSERT INTO settings (skey, sval) VALUES (?,?)", [$k, $v]);
        $done[] = 'حُفظت الإعدادات الافتراضية ومدد الخدمة (SLA)';

        // الفروع
        $i = 0;
        foreach (defaultBranches() as [$code, $name]) {
            if (val("SELECT COUNT(*) FROM branches WHERE code=?", [$code]) == 0)
                q("INSERT INTO branches (code, name, active, sort_order) VALUES (?,?,1,?)", [$code, $name, $i]);
            $i++;
        }
        // خيار «جميع الفروع» — للشكاوى العامة على مستوى المدارس
        if (val("SELECT COUNT(*) FROM branches WHERE code='ALL'") == 0)
            q("INSERT INTO branches (code, name, active, sort_order) VALUES ('ALL','جميع الفروع (شكوى عامة)',1,99)");
        $done[] = 'أُضيفت الفروع السبعة + خيار «جميع الفروع»';

        // حساب مدير النظام
        $name = trim($_POST['name'] ?? '');
        $user = trim($_POST['username'] ?? '');
        $pass = $_POST['password'] ?? '';
        $phone= trim($_POST['phone'] ?? '');
        $email= trim($_POST['email'] ?? '');
        if ($name === '' || $user === '' || strlen($pass) < 8)
            throw new Exception('يرجى تعبئة الاسم واسم المستخدم وكلمة مرور لا تقل عن 8 أحرف');

        q("INSERT INTO users (username, pass, name, title, role, branch_id, phone, email, scope, p_edit, p_delete, p_users, active, created_at)
           VALUES (?,?,?,?,'admin',NULL,?,?,'all',1,1,1,1,?)",
          [$user, password_hash($pass, PASSWORD_DEFAULT), $name, 'مدير النظام', $phone, $email, time()]);
        $done[] = 'أُنشئ حساب مدير النظام: ' . e($user);

        // بيانات تجريبية اختيارية
        if (!empty($_POST['demo'])) { require __DIR__ . '/lib/demo.php'; seedDemo(); $done[] = 'أُضيفت بيانات تجريبية (موظفون وشكاوى) — احذفها قبل التشغيل الفعلي'; }

        if (!is_dir(UPLOAD_DIR)) @mkdir(UPLOAD_DIR, 0775, true);
        @file_put_contents(UPLOAD_DIR . '/.htaccess', "php_flag engine off\nOptions -ExecCGI\nAddType text/plain .php .phtml .php3 .php4 .php5 .php7 .php8\n");
        $done[] = 'جُهّز مجلد المرفقات وحُمي من تنفيذ السكربتات';

        $installed = true;
    } catch (Exception $ex) { $err = $ex->getMessage(); }
}
?><!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تثبيت النظام — <?= e(SCHOOL_NAME) ?></title>
<link rel="stylesheet" href="assets/app.css">
</head><body class="plain">
<div class="authwrap">
  <div class="authcard" style="max-width:620px">
    <div class="authlogo"><?php include __DIR__ . '/lib/logo.php'; ?></div>
    <h2>تثبيت نظام شكاوى أولياء الأمور</h2>

    <?php if ($err): ?><div class="critbox"><?= e($err) ?></div><?php endif; ?>

    <?php if ($installed && $done): ?>
      <div class="okbox"><b>تم التثبيت بنجاح ✅</b><ul style="margin:8px 0 0;padding-inline-start:20px">
        <?php foreach ($done as $d) echo '<li>' . $d . '</li>'; ?></ul></div>
      <div class="warnbox" style="margin-top:12px">
        <b>خطوة أمان مهمة:</b> احذف الملف <code>install.php</code> من الخادم الآن.
      </div>
      <a class="btn" style="margin-top:14px" href="login.php">الانتقال إلى تسجيل الدخول ←</a>

    <?php elseif ($installed): ?>
      <div class="warnbox">النظام مثبّت مسبقاً. لإعادة التثبيت من الصفر احذف جداول قاعدة البيانات أولاً.</div>
      <a class="btn" style="margin-top:14px" href="login.php">تسجيل الدخول ←</a>

    <?php else: ?>
      <p class="hint">سيتم إنشاء الجداول والفروع السبعة وحساب مدير النظام. تأكد أولاً من صحة بيانات الاتصال في <code>config.php</code>.</p>
      <form method="post">
        <label class="f"><span>اسم مدير النظام <b class="req">*</b></span><input type="text" name="name" required placeholder="الاسم الكامل"></label>
        <label class="f"><span>اسم المستخدم للدخول <b class="req">*</b></span><input type="text" name="username" required placeholder="admin" autocomplete="username"></label>
        <label class="f"><span>كلمة المرور (8 أحرف فأكثر) <b class="req">*</b></span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <div class="grid g2">
          <label class="f"><span>الجوال</span><input type="tel" name="phone" placeholder="05xxxxxxxx"></label>
          <label class="f"><span>البريد الإلكتروني</span><input type="text" name="email" placeholder="admin@almuktashef.edu.sa"></label>
        </div>
        <label class="row" style="gap:8px;margin:8px 0"><input type="checkbox" name="demo" value="1" style="width:auto" checked> إضافة بيانات تجريبية (موظفون وشكاوى) لتجربة النظام</label>
        <button class="btn" type="submit">🚀 تثبيت النظام</button>
      </form>
    <?php endif; ?>
  </div>
</div>
</body></html>
