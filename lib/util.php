<?php
require_once __DIR__ . '/db.php';

function e($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function jsonOut($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): void { jsonOut(['ok' => false, 'error' => $msg], $code); }

function body_json(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

/* ---------- الوقت ---------- */
const HOUR = 3600;
function durAr(?int $sec): string {
    if ($sec === null) return '—';
    $neg = $sec < 0; $sec = abs($sec);
    $h = intdiv($sec, 3600); $m = intdiv($sec % 3600, 60);
    $d = intdiv($h, 24); $rh = $h % 24;
    if ($d > 0)      $s = $d . ' يوم' . ($rh ? " و$rh ساعة" : '');
    elseif ($h > 0)  $s = $h . ' ساعة' . ($m ? " و$m دقيقة" : '');
    else             $s = $m . ' دقيقة';
    return ($neg ? 'متأخرة بـ ' : '') . $s;
}
function fmtAr(?int $ts): string {
    if (!$ts) return '—';
    return date('Y/m/d — H:i', $ts);
}

/* ---------- الواتساب ---------- */
function waPhone(string $p): string {
    $d = preg_replace('/\D+/', '', $p);
    if (str_starts_with($d, '00')) $d = substr($d, 2);
    if (str_starts_with($d, '966')) return $d;
    if (str_starts_with($d, '0'))   return '966' . substr($d, 1);
    if (strlen($d) === 9)           return '966' . $d;
    return $d;
}
function baseUrl(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == 443;
    $host  = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir   = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https://' : 'http://') . $host . $dir;
}
function waText(array $c): string {
    $tpl = setting('wa_template', '');
    $map = [
        '{ولي_الأمر}'      => $c['parent_name'] ?? '',
        '{الطالب}'         => $c['student'] ?? '',
        '{الفرع}'          => $c['branch_name'] ?? '',
        '{المدرسة}'        => setting('school_name', SCHOOL_NAME),
        '{الرقم_المرجعي}'  => $c['ref'] ?? '',
        '{عنوان_الشكوى}'   => $c['subject'] ?? '',
        '{الحل}'           => $c['resolution'] ?? '—',
        '{مدة_المعالجة}'   => !empty($c['resolved_at']) ? durAr($c['resolved_at'] - $c['created_at']) : '—',
        '{رابط_التتبع}'    => baseUrl() . '/track.php?ref=' . urlencode($c['ref'] ?? ''),
    ];
    return strtr($tpl, $map);
}

/* ---------- SLA ---------- */
function slaFor(string $priority): array {
    $sla = settingJson('sla', []);
    return $sla[$priority] ?? ['response'=>8, 'resolve'=>72, 'remind'=>24, 'desc'=>''];
}
function dueAt(array $c): int { return (int)$c['created_at'] + (int)slaFor($c['priority'])['resolve'] * HOUR; }

/* ---------- سجل ---------- */
function logHistory(int $cid, string $action, string $note, $actorId = null, ?string $actorLabel = null): void {
    q("INSERT INTO history (complaint_id, at, actor_id, actor_label, action, note) VALUES (?,?,?,?,?,?)",
       [$cid, time(), $actorId, $actorLabel, $action, $note]);
}
function notifyUser($userId, string $text, ?int $cid = null, ?string $ref = null): void {
    if (!$userId) return;
    foreach ((array)$userId as $u) {
        if (!$u) continue;
        q("INSERT INTO notifications (user_id, complaint_id, ref, body, at, is_read) VALUES (?,?,?,?,?,0)",
           [$u, $cid, $ref, $text, time()]);
    }
}
function auditLog(string $action, string $note): void {
    q("INSERT INTO audit (at, user_id, action, note, ip) VALUES (?,?,?,?,?)",
       [time(), $_SESSION['uid'] ?? null, $action, $note, $_SERVER['REMOTE_ADDR'] ?? '']);
}

/* ---------- الرقم المرجعي ---------- */
function nextRef(string $code): string {
    $yr  = date('Y');
    $key = $code . '-' . $yr;
    db()->beginTransaction();
    try {
        $n = val("SELECT n FROM counters WHERE ckey=?", [$key]);
        if ($n === null) { q("INSERT INTO counters (ckey, n) VALUES (?,1)", [$key]); $n = 1; }
        else { $n = (int)$n + 1; q("UPDATE counters SET n=? WHERE ckey=?", [$n, $key]); }
        db()->commit();
    } catch (Exception $ex) { db()->rollBack(); throw $ex; }
    return sprintf('%s-%s-%04d', $code, $yr, $n);
}

function detectPriority(string $type, string $text): string {
    foreach (settingJson('urgent_words', []) as $w)
        if ($w !== '' && mb_strpos($text, $w) !== false) return 'عاجلة';
    return $type === 'سلوكية' ? 'عالية' : 'عادية';
}
function deptOfType(string $type): ?string {
    $types = settingJson('types', []);
    return $types[$type]['dept'] ?? null;
}
