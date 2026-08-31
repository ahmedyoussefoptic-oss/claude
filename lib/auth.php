<?php
require_once __DIR__ . '/util.php';

function startSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(SESSION_NAME);
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/', 'httponly' => true,
        'samesite' => 'Lax', 'secure' => $https,
    ]);
    session_start();
    if (isset($_SESSION['last']) && time() - $_SESSION['last'] > SESSION_IDLE_MINUTES * 60) {
        session_unset(); session_destroy(); session_start();
    }
    $_SESSION['last'] = time();
}

function currentUser(): ?array {
    static $u = null;
    if ($u !== null) return $u ?: null;
    startSession();
    if (empty($_SESSION['uid'])) { $u = false; return null; }
    $r = one("SELECT u.*, b.code AS branch_code, b.name AS branch_name
              FROM users u LEFT JOIN branches b ON b.id=u.branch_id
              WHERE u.id=? AND u.active=1", [$_SESSION['uid']]);
    $u = $r ?: false;
    return $r ?: null;
}

function requireLogin(): array {
    $u = currentUser();
    if (!$u) {
        if (str_ends_with($_SERVER['SCRIPT_NAME'] ?? '', 'api.php')) fail('انتهت الجلسة — يرجى تسجيل الدخول من جديد', 401);
        header('Location: login.php'); exit;
    }
    return $u;
}

/* ---------- CSRF ---------- */
function csrfToken(): string {
    startSession();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return $_SESSION['csrf'];
}
function checkCsrf(): void {
    startSession();
    $t = $_POST['csrf'] ?? $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!$t || !hash_equals($_SESSION['csrf'] ?? '', $t)) fail('رمز الحماية غير صالح — أعد تحميل الصفحة', 419);
}

/* ---------- الصلاحيات ---------- */
function isAdmin(?array $u = null): bool { $u = $u ?: currentUser(); return ($u['role'] ?? '') === 'admin'; }
function seesAll(?array $u = null): bool { $u = $u ?: currentUser(); return ($u['scope'] ?? 'branch') === 'all'; }
function canP(string $p, ?array $u = null): bool {
    $u = $u ?: currentUser();
    return match ($p) {
        'edit'   => (bool)($u['p_edit'] ?? 0),
        'delete' => (bool)($u['p_delete'] ?? 0),
        'users'  => (bool)($u['p_users'] ?? 0),
        default  => false,
    };
}
/** هل يرى المستخدم هذه الشكوى؟ */
function seesComplaint(array $c, ?array $u = null): bool {
    $u = $u ?: currentUser();
    if (seesAll($u)) return true;
    return (int)$c['branch_id'] === (int)($u['branch_id'] ?? 0);
}
/** شرط SQL يحصر النتائج بنطاق المستخدم */
function scopeSql(?array $u = null, string $alias = 'c'): array {
    $u = $u ?: currentUser();
    if (seesAll($u)) return ['1=1', []];
    return ["$alias.branch_id = ?", [(int)($u['branch_id'] ?? 0)]];
}
/** هل يجوز للمستخدم تنفيذ إجراء على شكوى؟ */
function canAct(string $action, ?array $c = null, ?array $u = null): bool {
    $u = $u ?: currentUser();
    if (!$u) return false;
    if ($c && !seesComplaint($c, $u)) return false;
    $role = $u['role'];
    return match ($action) {
        'create'                       => in_array($role, ['cs','manager','admin']),
        'start', 'resolve'             => ($role === 'spec' && $c && (int)$c['assignee'] === (int)$u['id'])
                                          || in_array($role, ['manager','admin']),
        'notify', 'close', 'reopen',
        'assign'                       => in_array($role, ['cs','manager','admin']),
        'comment', 'remind'            => true,
        'edit'                         => canP('edit', $u),
        'delete'                       => canP('delete', $u),
        'users'                        => canP('users', $u),
        default                        => false,
    };
}
function requireAct(string $action, ?array $c = null): void {
    if (!canAct($action, $c)) fail('لا تملك صلاحية تنفيذ هذا الإجراء', 403);
}
