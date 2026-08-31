<?php
require_once __DIR__ . '/lib/auth.php';
startSession();
if (!empty($_SESSION['uid']))
    q("INSERT INTO audit (at, user_id, action, note, ip) VALUES (?,?,?,?,?)",
      [time(), $_SESSION['uid'], 'تسجيل خروج', '', $_SERVER['REMOTE_ADDR'] ?? '']);
session_unset(); session_destroy();
header('Location: login.php'); exit;
