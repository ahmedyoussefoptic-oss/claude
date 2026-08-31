<?php
require_once __DIR__ . '/lib/auth.php';
startSession();

if (!tableExists('users')) { header('Location: install.php'); exit; }
if (currentUser()) { header('Location: index.php'); exit; }

$err = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $u = trim($_POST['username'] ?? '');
    $p = $_POST['password'] ?? '';
    $row = one("SELECT * FROM users WHERE username=?", [$u]);
    // تأخير بسيط يبطئ محاولات التخمين
    usleep(250000);
    if (!$row || !password_verify($p, $row['pass'])) {
        $err = 'اسم المستخدم أو كلمة المرور غير صحيحة';
        q("INSERT INTO audit (at, user_id, action, note, ip) VALUES (?,?,?,?,?)",
          [time(), null, 'محاولة دخول فاشلة', 'اسم المستخدم: ' . $u, $_SERVER['REMOTE_ADDR'] ?? '']);
    } elseif (!$row['active']) {
        $err = 'هذا الحساب موقوف — راجع مدير النظام';
    } else {
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$row['id'];
        $_SESSION['last'] = time();
        q("UPDATE users SET last_login=? WHERE id=?", [time(), $row['id']]);
        q("INSERT INTO audit (at, user_id, action, note, ip) VALUES (?,?,?,?,?)",
          [time(), $row['id'], 'تسجيل دخول', $row['name'], $_SERVER['REMOTE_ADDR'] ?? '']);
        header('Location: index.php'); exit;
    }
}
?><!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تسجيل الدخول — <?= e(setting('school_name', SCHOOL_NAME)) ?></title>
<link rel="stylesheet" href="assets/app.css">
</head><body class="plain">
<div class="authwrap">
  <div class="authcard">
    <div class="authlogo"><?php include __DIR__ . '/lib/logo.php'; ?></div>
    <h2><?= e(APP_NAME) ?></h2>
    <p class="hint" style="margin-top:-6px"><?= e(setting('school_name', SCHOOL_NAME)) ?></p>
    <?php if ($err): ?><div class="critbox"><?= e($err) ?></div><?php endif; ?>
    <form method="post" autocomplete="on">
      <label class="f"><span>اسم المستخدم</span><input type="text" name="username" required autofocus autocomplete="username"></label>
      <label class="f"><span>كلمة المرور</span><input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn" style="width:100%" type="submit">🔐 دخول</button>
    </form>
    <div class="authfoot">
      <a href="track.php">👨‍👩‍👦 بوابة أولياء الأمور — تتبّع شكوى برقمها المرجعي</a>
    </div>
  </div>
</div>
</body></html>
