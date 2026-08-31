<?php
require_once __DIR__ . '/../config.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    try {
        if (DB_DRIVER === 'sqlite') {
            if (!is_dir(dirname(DB_SQLITE_PATH))) @mkdir(dirname(DB_SQLITE_PATH), 0775, true);
            $pdo = new PDO('sqlite:' . DB_SQLITE_PATH);
            $pdo->exec('PRAGMA foreign_keys = ON');
        } else {
            $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            $pdo = new PDO($dsn, DB_USER, DB_PASS);
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    } catch (PDOException $e) {
        http_response_code(500);
        die('<div style="font-family:sans-serif;direction:rtl;padding:30px">
             <h2>تعذّر الاتصال بقاعدة البيانات</h2>
             <p>تأكد من بيانات الاتصال في ملف <code>config.php</code>.</p>
             <pre style="background:#f4f4f4;padding:12px;border-radius:8px">' . htmlspecialchars($e->getMessage()) . '</pre></div>');
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}
function one(string $sql, array $args = []) { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }
function val(string $sql, array $args = []) { $r = q($sql, $args)->fetch(PDO::FETCH_NUM); return $r === false ? null : $r[0]; }
function lastId(): int { return (int) db()->lastInsertId(); }

function tableExists(string $t): bool {
    try {
        if (DB_DRIVER === 'sqlite')
            return (bool) val("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [$t]);
        return (bool) val("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name=?", [DB_NAME, $t]);
    } catch (Exception $e) { return false; }
}

/* ---------- الإعدادات المخزّنة ---------- */
function setting(string $k, $default = null) {
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try { foreach (all("SELECT skey, sval FROM settings") as $r) $cache[$r['skey']] = $r['sval']; }
        catch (Exception $e) { /* قبل التثبيت */ }
    }
    return array_key_exists($k, $cache) ? $cache[$k] : $default;
}
function settingJson(string $k, $default = []) {
    $v = setting($k); if ($v === null) return $default;
    $d = json_decode($v, true); return $d === null ? $default : $d;
}
function setSetting(string $k, $v): void {
    $v = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string) $v;
    if (val("SELECT COUNT(*) FROM settings WHERE skey=?", [$k]))
        q("UPDATE settings SET sval=? WHERE skey=?", [$v, $k]);
    else
        q("INSERT INTO settings (skey, sval) VALUES (?,?)", [$k, $v]);
}
