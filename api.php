<?php
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/engine.php';

startSession();
$ME = requireLogin();
$a  = $_GET['a'] ?? $_POST['a'] ?? '';
$POST = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($POST) checkCsrf();

/* ============ أدوات مشتركة ============ */
function branchesAll(): array { return all("SELECT * FROM branches WHERE active=1 ORDER BY sort_order, id"); }
function usersAll(): array {
    return all("SELECT u.id,u.username,u.name,u.title,u.role,u.branch_id,u.dept,u.phone,u.email,u.scope,
                       u.p_edit,u.p_delete,u.p_users,u.active,u.last_login, b.code AS branch_code, b.name AS branch_name
                FROM users u LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.role, u.branch_id, u.name");
}
function loadComplaint(int $id): ?array {
    $c = one("SELECT c.*, b.code AS branch_code, b.name AS branch_name,
                     ua.name AS assignee_name, ur.name AS receiver_name, un.name AS notifier_name
              FROM complaints c
              LEFT JOIN branches b ON b.id=c.branch_id
              LEFT JOIN users ua ON ua.id=c.assignee
              LEFT JOIN users ur ON ur.id=c.received_by
              LEFT JOIN users un ON un.id=c.notified_by
              WHERE c.id=? AND c.deleted=0", [$id]);
    if (!$c) return null;
    $c['due_at']    = dueAt($c);
    $c['sla']       = slaFor($c['priority']);
    $c['history']   = all("SELECT h.*, u.name AS actor_name FROM history h LEFT JOIN users u ON u.id=h.actor_id
                           WHERE h.complaint_id=? ORDER BY h.at ASC, h.id ASC", [$id]);
    $c['attachments'] = all("SELECT id,name,mime,size,path FROM attachments WHERE complaint_id=?", [$id]);
    return $c;
}
function mustSee(int $id): array {
    $c = loadComplaint($id);
    if (!$c) fail('الشكوى غير موجودة', 404);
    if (!seesComplaint($c)) fail('هذه الشكوى خارج نطاق صلاحيتك', 403);
    return $c;
}
function csOfBranch(int $bid): array {
    return array_column(all("SELECT id FROM users WHERE role='cs' AND active=1 AND (scope='all' OR branch_id=?)", [$bid]), 'id');
}
function suggestAssignee(int $bid, string $type): ?int {
    $dept = deptOfType($type);
    $b = one("SELECT code FROM branches WHERE id=?", [$bid]);
    if ($b && $b['code'] === 'ALL') {   // شكوى عامة: تُسند لمختص الإدارة العامة إن وُجد، وإلا تبقى للإسناد اليدوي
        $u = one("SELECT id FROM users WHERE role='spec' AND active=1 AND dept=? ORDER BY id LIMIT 1", [$dept]);
        return $u ? (int)$u['id'] : null;
    }
    $u = one("SELECT id FROM users WHERE role='spec' AND active=1 AND branch_id=? AND dept=? ORDER BY id LIMIT 1", [$bid, $dept]);
    if ($u) return (int)$u['id'];
    $u = one("SELECT id FROM users WHERE role='spec' AND active=1 AND branch_id=? ORDER BY id LIMIT 1", [$bid]);
    return $u ? (int)$u['id'] : null;
}
function saveUploads(int $cid): int {
    global $ALLOWED_EXT;
    if (empty($_FILES['files'])) return 0;
    $f = $_FILES['files']; $n = 0;
    $dir = UPLOAD_DIR . '/' . date('Y') . '/' . date('m');
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $count = is_array($f['name']) ? count($f['name']) : 0;
    for ($i = 0; $i < $count; $i++) {
        if ($f['error'][$i] !== UPLOAD_ERR_OK) continue;
        if ($f['size'][$i] > MAX_UPLOAD_MB * 1024 * 1024) continue;
        $ext = strtolower(pathinfo($f['name'][$i], PATHINFO_EXTENSION));
        if (!in_array($ext, $ALLOWED_EXT)) continue;
        $safe = bin2hex(random_bytes(8)) . '.' . $ext;
        $rel  = UPLOAD_URL . '/' . date('Y') . '/' . date('m') . '/' . $safe;
        if (!move_uploaded_file($f['tmp_name'][$i], $dir . '/' . $safe)) continue;
        q("INSERT INTO attachments (complaint_id,name,mime,size,path,created_at) VALUES (?,?,?,?,?,?)",
          [$cid, mb_substr($f['name'][$i], 0, 240), mime_content_type($dir . '/' . $safe) ?: '', (int)$f['size'][$i], $rel, time()]);
        $n++;
    }
    return $n;
}

/* ============ الإجراءات ============ */
switch ($a) {

case 'bootstrap':
    runEngine(false);
    jsonOut([
        'ok' => true,
        'me' => [
            'id'=>(int)$ME['id'], 'name'=>$ME['name'], 'title'=>$ME['title'], 'role'=>$ME['role'],
            'branch_id'=>$ME['branch_id'] ? (int)$ME['branch_id'] : null, 'branch_name'=>$ME['branch_name'],
            'scope'=>$ME['scope'], 'dept'=>$ME['dept'],
            'perms'=>['edit'=>(bool)$ME['p_edit'], 'delete'=>(bool)$ME['p_delete'], 'users'=>(bool)$ME['p_users']],
        ],
        'branches' => branchesAll(),
        'users'    => usersAll(),
        'settings' => [
            'school_name'=>setting('school_name', SCHOOL_NAME),
            'logo'       =>setting('logo_path',''),
            'sla'        =>settingJson('sla'),
            'wa_template'=>setting('wa_template',''),
            'curricula'  =>settingJson('curricula'),
            'grades'     =>settingJson('grades'),
            'types'      =>settingJson('types'),
        ],
        'csrf' => csrfToken(),
        'base' => baseUrl(),
    ]);

case 'complaints':
    [$scope, $args] = scopeSql();
    $w = ["c.deleted=0", $scope]; $p = $args;
    if (!empty($_GET['branch']) && $_GET['branch'] !== '*') { $w[] = "c.branch_id=?";  $p[] = (int)$_GET['branch']; }
    if (!empty($_GET['status']))  { $w[] = "c.status=?";   $p[] = $_GET['status']; }
    if (!empty($_GET['type']))    { $w[] = "c.ctype=?";    $p[] = $_GET['type']; }
    if (!empty($_GET['priority'])){ $w[] = "c.priority=?"; $p[] = $_GET['priority']; }
    if (!empty($_GET['mine']))    { $w[] = "c.assignee=?"; $p[] = (int)$ME['id']; }
    if (!empty($_GET['q'])) {
        $w[] = "(c.ref LIKE ? OR c.student LIKE ? OR c.parent_name LIKE ? OR c.subject LIKE ? OR c.body LIKE ? OR c.phone LIKE ?)";
        $like = '%' . $_GET['q'] . '%';
        array_push($p, $like, $like, $like, $like, $like, $like);
    }
    $rows = all("SELECT c.*, b.name AS branch_name, b.code AS branch_code,
                        ua.name AS assignee_name, ur.name AS receiver_name
                 FROM complaints c
                 LEFT JOIN branches b ON b.id=c.branch_id
                 LEFT JOIN users ua ON ua.id=c.assignee
                 LEFT JOIN users ur ON ur.id=c.received_by
                 WHERE " . implode(' AND ', $w) . " ORDER BY c.created_at DESC LIMIT 500", $p);
    foreach ($rows as &$r) { $r['due_at'] = dueAt($r); $r['sla'] = slaFor($r['priority']); }
    jsonOut(['ok'=>true, 'rows'=>$rows]);

case 'complaint':
    jsonOut(['ok'=>true, 'c'=>mustSee((int)($_GET['id'] ?? 0))]);

case 'create':
    requireAct('create');
    $bid = (int)($_POST['branch_id'] ?? 0);
    $b   = one("SELECT * FROM branches WHERE id=? AND active=1", [$bid]);
    if (!$b) fail('الفرع غير صحيح');
    if (!seesAll($ME) && (int)$ME['branch_id'] !== $bid && $b['code'] !== 'ALL')
        fail('لا يمكنك تسجيل شكوى لفرع آخر', 403);
    foreach (['student','parent_name','phone','subject','body'] as $f)
        if (trim($_POST[$f] ?? '') === '') fail('الحقول الأساسية مطلوبة: اسم الطالب، ولي الأمر، الجوال، العنوان، نص الشكوى');

    $type = $_POST['ctype'] ?? 'إدارية';
    $pri  = $_POST['priority'] ?? detectPriority($type, $_POST['body']);
    $ref  = nextRef($b['code']);
    $recv = (int)($_POST['received_by'] ?? $ME['id']);
    q("INSERT INTO complaints (ref,branch_id,student,curriculum,grade,parent_name,phone,relation,channel,
        ctype,csub,priority,subject,body,status,received_by,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)",
      [$ref, $bid, trim($_POST['student']), $_POST['curriculum'] ?? '', $_POST['grade'] ?? '',
       trim($_POST['parent_name']), trim($_POST['phone']), $_POST['relation'] ?? '', $_POST['channel'] ?? '',
       $type, $_POST['csub'] ?? '', $pri, trim($_POST['subject']), trim($_POST['body']),
       $recv, (int)$ME['id'], time()]);
    $cid = lastId();
    $nf = saveUploads($cid);
    logHistory($cid, 'تسجيل الشكوى', 'استُلمت عبر ' . ($_POST['channel'] ?? '—') . ' — متلقي الشكوى: ' .
        (one("SELECT name FROM users WHERE id=?", [$recv])['name'] ?? $ME['name']) . ($nf ? " · مرفقات: $nf" : ''), $recv);

    $as = $_POST['assignee'] ?? '';
    $as = $as !== '' ? (int)$as : suggestAssignee($bid, $type);
    if ($as) {
        q("UPDATE complaints SET assignee=?, status='assigned' WHERE id=?", [$as, $cid]);
        $an = one("SELECT name FROM users WHERE id=?", [$as])['name'] ?? '';
        logHistory($cid, 'إسناد', "أُسندت إلى $an", (int)$ME['id']);
        $sl = slaFor($pri);
        notifyUser($as, "🔔 شكوى جديدة أُسندت إليك: $ref — {$b['name']} — {$_POST['subject']} (أولوية $pri · مدة الحل {$sl['resolve']} ساعة)", $cid, $ref);
    }
    auditLog('تسجيل شكوى', "$ref — {$b['name']}");
    jsonOut(['ok'=>true, 'id'=>$cid, 'ref'=>$ref, 'assignee'=>$as]);

case 'act':
    $in = body_json();
    $c  = mustSee((int)($in['id'] ?? 0));
    $act = $in['act'] ?? '';
    $note = trim($in['note'] ?? '');
    $t = time();

    switch ($act) {
    case 'assign':
        requireAct('assign', $c);
        $to = (int)($in['to'] ?? 0);
        $u  = one("SELECT * FROM users WHERE id=? AND active=1", [$to]);
        if (!$u) fail('الموظف غير موجود');
        q("UPDATE complaints SET assignee=?, status=CASE WHEN status='new' THEN 'assigned' ELSE status END WHERE id=?", [$to, $c['id']]);
        logHistory((int)$c['id'], 'إسناد', "أُسندت إلى {$u['name']}", (int)$ME['id']);
        notifyUser($to, "🔔 أُسندت إليك الشكوى {$c['ref']} — {$c['branch_name']} · {$c['subject']}", (int)$c['id'], $c['ref']);
        break;

    case 'start':
        requireAct('start', $c);
        q("UPDATE complaints SET status='progress', first_response_at=COALESCE(first_response_at,?) WHERE id=?", [$t, $c['id']]);
        logHistory((int)$c['id'], 'بدء المعالجة', $note ?: 'باشر المختص معالجة الشكوى', (int)$ME['id']);
        notifyUser(csOfBranch((int)$c['branch_id']), "الشكوى {$c['ref']} دخلت مرحلة المعالجة", (int)$c['id'], $c['ref']);
        break;

    case 'resolve':
        requireAct('resolve', $c);
        if ($note === '') fail('يجب كتابة ملخص الحل');
        $breach = $t > dueAt($c) ? 1 : (int)$c['breached'];
        q("UPDATE complaints SET status='resolved', resolved_at=?, resolution=?, breached=?,
             first_response_at=COALESCE(first_response_at,?) WHERE id=?", [$t, $note, $breach, $t, $c['id']]);
        logHistory((int)$c['id'], 'تسجيل الحل', $note, (int)$ME['id']);
        notifyUser(csOfBranch((int)$c['branch_id']), "✅ تم حل الشكوى {$c['ref']} — يرجى إبلاغ ولي الأمر", (int)$c['id'], $c['ref']);
        $mg = array_column(all("SELECT id FROM users WHERE role='manager' AND active=1 AND branch_id=?", [$c['branch_id']]), 'id');
        notifyUser($mg, "تم حل الشكوى {$c['ref']} خلال " . durAr($t - (int)$c['created_at']), (int)$c['id'], $c['ref']);
        if (!empty($in['kb']))
            q("INSERT INTO kb (title,ctype,csub,solution,ref,uses,created_at,created_by) VALUES (?,?,?,?,?,0,?,?)",
              [$c['subject'], $c['ctype'], $c['csub'], $note, $c['ref'], $t, (int)$ME['id']]);
        break;

    case 'notify':
        requireAct('notify', $c);
        if (!$c['resolved_at']) fail('لا يمكن إبلاغ ولي الأمر قبل تسجيل الحل');
        q("UPDATE complaints SET status='notified', parent_notified_at=?, notified_by=?, notify_channel=? WHERE id=?",
          [$t, (int)$ME['id'], $in['channel'] ?? 'اتصال هاتفي', $c['id']]);
        logHistory((int)$c['id'], 'إبلاغ ولي الأمر', 'عبر ' . ($in['channel'] ?? '—') . ($note ? " — $note" : ''), (int)$ME['id']);
        notifyUser($c['assignee'], "تم إبلاغ ولي الأمر بحل الشكوى {$c['ref']}", (int)$c['id'], $c['ref']);
        break;

    case 'wa_sent':
        q("UPDATE complaints SET wa_sent_at=?, wa_sent_by=? WHERE id=?", [$t, (int)$ME['id'], $c['id']]);
        logHistory((int)$c['id'], 'إرسال واتساب لولي الأمر', 'على الرقم ' . $c['phone'], (int)$ME['id']);
        break;

    case 'close':
        requireAct('close', $c);
        if ($c['status'] !== 'notified') fail('يجب إبلاغ ولي الأمر قبل الإغلاق');
        q("UPDATE complaints SET status='closed', closed_at=? WHERE id=?", [$t, $c['id']]);
        logHistory((int)$c['id'], 'إغلاق الشكوى', 'أُغلقت بعد إبلاغ ولي الأمر وأُتيح له رابط الاستبيان', (int)$ME['id']);
        notifyUser($c['assignee'], "أُغلقت الشكوى {$c['ref']} وأُرسل استبيان الرضا لولي الأمر", (int)$c['id'], $c['ref']);
        break;

    case 'reopen':
        requireAct('reopen', $c);
        if ($note === '') fail('سبب إعادة الفتح مطلوب');
        $pr = ['عاجلة','عالية','عادية'];
        $i  = array_search($c['priority'], $pr);
        $np = $i > 0 ? $pr[$i-1] : $c['priority'];
        q("UPDATE complaints SET status='reopened', reopened=reopened+1, resolved_at=NULL, closed_at=NULL, priority=? WHERE id=?", [$np, $c['id']]);
        logHistory((int)$c['id'], 'إعادة فتح', $note, (int)$ME['id']);
        notifyUser([$c['assignee']], "🔁 أُعيد فتح الشكوى {$c['ref']}: $note", (int)$c['id'], $c['ref']);
        break;

    case 'comment':
        if ($note === '') fail('الملاحظة فارغة');
        logHistory((int)$c['id'], 'ملاحظة', $note, (int)$ME['id']);
        notifyUser([$c['assignee']], "ملاحظة جديدة على الشكوى {$c['ref']} من {$ME['name']}", (int)$c['id'], $c['ref']);
        break;

    case 'remind':
        q("UPDATE complaints SET reminder_count=reminder_count+1, last_reminder_at=? WHERE id=?", [$t, $c['id']]);
        logHistory((int)$c['id'], 'تذكير يدوي', 'أُرسل تذكير من ' . $ME['name'], (int)$ME['id']);
        notifyUser($c['assignee'], "🔔 تذكير من {$ME['name']} بخصوص الشكوى {$c['ref']}", (int)$c['id'], $c['ref']);
        break;

    default: fail('إجراء غير معروف');
    }
    $c2 = loadComplaint((int)$c['id']);
    jsonOut(['ok'=>true, 'c'=>$c2, 'wa'=>waText($c2), 'wa_phone'=>waPhone($c2['phone'])]);

case 'update':
    $in = body_json();
    $c  = mustSee((int)($in['id'] ?? 0));
    requireAct('edit', $c);
    $fields = ['student'=>'اسم الطالب','parent_name'=>'ولي الأمر','phone'=>'الجوال','curriculum'=>'المنهج',
               'grade'=>'الصف','ctype'=>'النوع','csub'=>'التصنيف','priority'=>'الأولوية','subject'=>'العنوان','body'=>'نص الشكوى'];
    $sets = []; $args = []; $chg = [];
    foreach ($fields as $f => $lbl) {
        if (!array_key_exists($f, $in)) continue;
        $v = is_string($in[$f]) ? trim($in[$f]) : $in[$f];
        if ((string)$v !== (string)$c[$f]) { $sets[] = "$f=?"; $args[] = $v; $chg[] = "$lbl: «{$c[$f]}» ← «$v»"; }
    }
    if (isset($in['branch_id']) && (int)$in['branch_id'] !== (int)$c['branch_id']) {
        $nb = one("SELECT name FROM branches WHERE id=?", [(int)$in['branch_id']]);
        if ($nb) { $sets[] = "branch_id=?"; $args[] = (int)$in['branch_id']; $chg[] = "الفرع: «{$c['branch_name']}» ← «{$nb['name']}»"; }
    }
    if (isset($in['received_by']) && (int)$in['received_by'] !== (int)$c['received_by']) {
        $nr = one("SELECT name FROM users WHERE id=?", [(int)$in['received_by']]);
        if ($nr) { $sets[] = "received_by=?"; $args[] = (int)$in['received_by']; $chg[] = "متلقي الشكوى: «{$c['receiver_name']}» ← «{$nr['name']}»"; }
    }
    if (isset($in['assignee']) && (int)$in['assignee'] !== (int)$c['assignee']) {
        $na = one("SELECT name FROM users WHERE id=?", [(int)$in['assignee']]);
        if ($na) {
            $sets[] = "assignee=?"; $args[] = (int)$in['assignee'];
            $chg[] = "المختص: «{$c['assignee_name']}» ← «{$na['name']}»";
            notifyUser((int)$in['assignee'], "أُسندت إليك الشكوى {$c['ref']} بعد تعديل بيانات الإسناد", (int)$c['id'], $c['ref']);
        }
    }
    if (!$sets) jsonOut(['ok'=>true, 'changed'=>0, 'c'=>$c]);
    $args[] = (int)$c['id'];
    q("UPDATE complaints SET " . implode(',', $sets) . " WHERE id=?", $args);
    logHistory((int)$c['id'], 'تعديل بيانات الشكوى', implode(' · ', $chg), (int)$ME['id']);
    auditLog('تعديل شكوى', $c['ref'] . ' — ' . implode(' · ', $chg));
    jsonOut(['ok'=>true, 'changed'=>count($chg), 'c'=>loadComplaint((int)$c['id'])]);

case 'delete':
    $in = body_json();
    $c  = mustSee((int)($in['id'] ?? 0));
    requireAct('delete', $c);
    $reason = trim($in['reason'] ?? '');
    if ($reason === '') fail('سبب الحذف مطلوب');
    q("UPDATE complaints SET deleted=1 WHERE id=?", [$c['id']]);
    logHistory((int)$c['id'], 'حذف الشكوى', $reason, (int)$ME['id']);
    auditLog('حذف شكوى', "{$c['ref']} — {$c['subject']} · {$c['branch_name']} · السبب: $reason");
    jsonOut(['ok'=>true]);

/* ---------- الموظفون ---------- */
case 'user_save':
    requireAct('users');
    $in = body_json();
    $id = (int)($in['id'] ?? 0);
    $name = trim($in['name'] ?? ''); $username = trim($in['username'] ?? '');
    if ($name === '' || $username === '') fail('الاسم واسم المستخدم مطلوبان');
    $role = in_array($in['role'] ?? '', ['admin','manager','cs','spec']) ? $in['role'] : 'spec';
    $scope = !empty($in['scope_all']) ? 'all' : 'branch';
    $bid = ($role === 'admin' && $scope === 'all') ? null : (int)($in['branch_id'] ?? 0);
    if ($bid === 0) $bid = null;
    $dup = one("SELECT id FROM users WHERE username=?" . ($id ? " AND id<>?" : ''), $id ? [$username, $id] : [$username]);
    if ($dup) fail('اسم المستخدم مستخدم مسبقاً');
    $args = [$username, $name, trim($in['title'] ?? ''), $role, $bid, ($in['dept'] ?? '') ?: null,
             trim($in['phone'] ?? ''), trim($in['email'] ?? ''), $scope,
             !empty($in['p_edit'])?1:0, !empty($in['p_delete'])?1:0, !empty($in['p_users'])?1:0,
             !empty($in['active'])?1:0];
    if ($id) {
        $old = one("SELECT * FROM users WHERE id=?", [$id]);
        if (!$old) fail('الموظف غير موجود');
        q("UPDATE users SET username=?,name=?,title=?,role=?,branch_id=?,dept=?,phone=?,email=?,scope=?,p_edit=?,p_delete=?,p_users=?,active=? WHERE id=?",
          array_merge($args, [$id]));
        if (!empty($in['password'])) {
            if (strlen($in['password']) < 8) fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
            q("UPDATE users SET pass=? WHERE id=?", [password_hash($in['password'], PASSWORD_DEFAULT), $id]);
        }
        auditLog('تعديل موظف', "{$old['name']} ← $name · " . $role);
    } else {
        if (strlen($in['password'] ?? '') < 8) fail('كلمة مرور الموظف الجديد مطلوبة (8 أحرف فأكثر)');
        q("INSERT INTO users (username,name,title,role,branch_id,dept,phone,email,scope,p_edit,p_delete,p_users,active,pass,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          array_merge($args, [password_hash($in['password'], PASSWORD_DEFAULT), time()]));
        $id = lastId();
        auditLog('إضافة موظف', "$name — $role");
    }
    jsonOut(['ok'=>true, 'id'=>$id, 'users'=>usersAll()]);

case 'user_delete':
    requireAct('users');
    $in = body_json(); $id = (int)($in['id'] ?? 0);
    if ($id === (int)$ME['id']) fail('لا يمكنك حذف حسابك الحالي');
    $u = one("SELECT * FROM users WHERE id=?", [$id]);
    if (!$u) fail('الموظف غير موجود');
    $ph = implode(',', array_fill(0, count(OPEN_STATES), '?'));
    $open = (int) val("SELECT COUNT(*) FROM complaints WHERE assignee=? AND deleted=0 AND status IN ($ph)", array_merge([$id], OPEN_STATES));
    if ($open) fail("لا يمكن الحذف: لدى {$u['name']} $open شكوى مفتوحة — أعد إسنادها أولاً");
    if ((int) val("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1") <= 1 && $u['role'] === 'admin')
        fail('لا يمكن حذف آخر حساب مدير نظام');
    q("DELETE FROM users WHERE id=?", [$id]);
    auditLog('حذف موظف', "{$u['name']} — {$u['role']}");
    jsonOut(['ok'=>true, 'users'=>usersAll()]);

case 'change_pw':
    $in = body_json();
    $old = $in['old'] ?? ''; $new = $in['new'] ?? '';
    if (strlen($new) < 8) fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    $row = one("SELECT pass FROM users WHERE id=?", [(int)$ME['id']]);
    if (!password_verify($old, $row['pass'])) fail('كلمة المرور الحالية غير صحيحة');
    q("UPDATE users SET pass=? WHERE id=?", [password_hash($new, PASSWORD_DEFAULT), (int)$ME['id']]);
    auditLog('تغيير كلمة المرور', $ME['name']);
    jsonOut(['ok'=>true]);

case 'audit':
    requireAct('users');
    jsonOut(['ok'=>true, 'rows'=>all("SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
                                      ORDER BY a.at DESC LIMIT 60")]);

/* ---------- الإشعارات ---------- */
case 'notifs':
    jsonOut(['ok'=>true, 'rows'=>all("SELECT * FROM notifications WHERE user_id=? ORDER BY at DESC LIMIT 60", [(int)$ME['id']]),
             'unread'=>(int) val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0", [(int)$ME['id']])]);
case 'notifs_read':
    q("UPDATE notifications SET is_read=1 WHERE user_id=?", [(int)$ME['id']]);
    jsonOut(['ok'=>true]);

/* ---------- قاعدة المعرفة ---------- */
case 'kb':
    jsonOut(['ok'=>true, 'rows'=>all("SELECT * FROM kb ORDER BY uses DESC, id DESC LIMIT 200")]);
case 'kb_save':
    $in = body_json();
    if (trim($in['title'] ?? '') === '' || trim($in['solution'] ?? '') === '') fail('العنوان والحل مطلوبان');
    q("INSERT INTO kb (title,ctype,csub,solution,uses,created_at,created_by) VALUES (?,?,?,?,0,?,?)",
      [trim($in['title']), $in['ctype'] ?? '', $in['csub'] ?? '', trim($in['solution']), time(), (int)$ME['id']]);
    jsonOut(['ok'=>true]);

/* ---------- الإعدادات ---------- */
case 'settings_save':
    if (!isAdmin()) fail('الإعدادات متاحة لمدير النظام فقط', 403);
    $in = body_json();
    if (isset($in['sla']))         setSetting('sla', $in['sla']);
    if (isset($in['wa_template'])) setSetting('wa_template', $in['wa_template']);
    if (isset($in['school_name'])) setSetting('school_name', trim($in['school_name']));
    auditLog('تعديل الإعدادات', implode('، ', array_keys($in)));
    jsonOut(['ok'=>true]);

case 'branch_save':
    if (!isAdmin()) fail('غير مصرح', 403);
    $in = body_json();
    $name = trim($in['name'] ?? ''); $code = strtoupper(trim($in['code'] ?? ''));
    if ($name === '' || $code === '') fail('الاسم والرمز مطلوبان');
    if (!empty($in['id'])) { q("UPDATE branches SET name=?, active=? WHERE id=?", [$name, !empty($in['active'])?1:0, (int)$in['id']]); }
    else {
        if (val("SELECT COUNT(*) FROM branches WHERE code=?", [$code])) fail('الرمز مستخدم مسبقاً');
        q("INSERT INTO branches (code,name,active,sort_order) VALUES (?,?,1,50)", [$code, $name]);
    }
    auditLog('تعديل الفروع', "$code — $name");
    jsonOut(['ok'=>true, 'branches'=>branchesAll()]);

case 'logo_upload':
    if (!isAdmin()) fail('غير مصرح', 403);
    if (empty($_FILES['logo']) || $_FILES['logo']['error'] !== UPLOAD_ERR_OK) fail('لم يصل الملف');
    $ext = strtolower(pathinfo($_FILES['logo']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['png','jpg','jpeg','svg','webp'])) fail('الصيغ المسموحة: PNG, JPG, SVG, WEBP');
    if ($_FILES['logo']['size'] > 3 * 1024 * 1024) fail('حجم الشعار يجب ألا يتجاوز 3 ميجابايت');
    if (!is_dir(UPLOAD_DIR)) @mkdir(UPLOAD_DIR, 0775, true);
    $rel = UPLOAD_URL . '/logo.' . $ext;
    if (!move_uploaded_file($_FILES['logo']['tmp_name'], __DIR__ . '/' . $rel)) fail('تعذّر حفظ الملف');
    foreach (['png','jpg','jpeg','svg','webp'] as $x)
        if ($x !== $ext && file_exists(__DIR__ . '/' . UPLOAD_URL . '/logo.' . $x)) @unlink(__DIR__ . '/' . UPLOAD_URL . '/logo.' . $x);
    setSetting('logo_path', $rel);
    auditLog('تغيير الشعار', $rel);
    jsonOut(['ok'=>true, 'logo'=>$rel]);

/* ---------- الإحصاءات ---------- */
case 'stats':
    [$scope, $args] = scopeSql();
    $bfil = ''; $p = $args;
    if (!empty($_GET['branch']) && $_GET['branch'] !== '*') { $bfil = " AND c.branch_id=?"; $p[] = (int)$_GET['branch']; }
    $rows = all("SELECT c.*, b.name AS branch_name FROM complaints c LEFT JOIN branches b ON b.id=c.branch_id
                 WHERE c.deleted=0 AND $scope $bfil", $p);
    jsonOut(['ok'=>true, 'rows'=>array_map(fn($r) => [
        'branch_id'=>(int)$r['branch_id'], 'branch_name'=>$r['branch_name'], 'ctype'=>$r['ctype'],
        'status'=>$r['status'], 'priority'=>$r['priority'], 'created_at'=>(int)$r['created_at'],
        'resolved_at'=>$r['resolved_at'] ? (int)$r['resolved_at'] : null, 'due_at'=>dueAt($r),
        'escalation'=>(int)$r['escalation'], 'reopened'=>(int)$r['reopened'],
        'survey_overall'=>$r['survey_overall'] ? (int)$r['survey_overall'] : null,
    ], $rows)]);

case 'engine':
    jsonOut(['ok'=>true, 'r'=>runEngine(true)]);

default:
    fail('طلب غير معروف: ' . e($a), 404);
}
