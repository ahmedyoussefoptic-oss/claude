<?php
/* بوابة ولي الأمر — صفحة عامة لا تتطلب تسجيل دخول
   يتطلب: الرقم المرجعي + آخر 4 أرقام من جوال ولي الأمر */
require_once __DIR__ . '/lib/util.php';
require_once __DIR__ . '/lib/logo.php';
session_start();

$ref  = trim($_REQUEST['ref'] ?? '');
$last4= trim($_REQUEST['last4'] ?? '');
$c = null; $err = null; $ok = null;

function loadPublic(string $ref): ?array {
    return one("SELECT c.*, b.name AS branch_name FROM complaints c
                LEFT JOIN branches b ON b.id=c.branch_id
                WHERE UPPER(c.ref)=? AND c.deleted=0", [strtoupper($ref)]);
}

if ($ref !== '' && $last4 !== '') {
    $row = loadPublic($ref);
    if (!$row) $err = 'لم يُعثر على شكوى بهذا الرقم المرجعي.';
    elseif (substr(preg_replace('/\D/', '', $row['phone']), -4) !== preg_replace('/\D/', '', $last4))
        $err = 'الأرقام الأربعة الأخيرة من الجوال غير مطابقة للشكوى.';
    else {
        $c = $row;
        // إرسال الاستبيان
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['overall'])) {
            if ($c['status'] !== 'closed') $err = 'الاستبيان يُتاح بعد إغلاق الشكوى.';
            elseif ($c['survey_overall']) $err = 'سبق تسجيل تقييمك لهذه الشكوى. شكراً لك.';
            else {
                $sp = max(1, min(5, (int)($_POST['speed'] ?? 0)));
                $ql = max(1, min(5, (int)($_POST['quality'] ?? 0)));
                $ov = max(1, min(5, (int)$_POST['overall']));
                q("UPDATE complaints SET survey_speed=?, survey_quality=?, survey_overall=?, survey_comment=?, survey_at=? WHERE id=?",
                  [$sp, $ql, $ov, mb_substr(trim($_POST['comment'] ?? ''), 0, 1000), time(), $c['id']]);
                logHistory((int)$c['id'], 'استبيان الرضا', "التقييم العام $ov/5" . (trim($_POST['comment'] ?? '') ? ' — ' . trim($_POST['comment']) : ''), null, 'ولي الأمر');
                $to = array_filter([$c['assignee']]);
                foreach (all("SELECT id FROM users WHERE role='admin' AND active=1") as $u) $to[] = $u['id'];
                notifyUser($to, "قيّم ولي الأمر معالجة الشكوى {$c['ref']} بـ $ov/5", (int)$c['id'], $c['ref']);
                $ok = 'شكراً لك — سُجّل تقييمك ووصل لفريق الجودة.';
                $c = loadPublic($ref);
            }
        }
        // طلب إعادة الفتح
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['reopen_reason'])) {
            $reason = trim($_POST['reopen_reason']);
            if ($reason === '') $err = 'يرجى توضيح سبب عدم الاقتناع بالحل.';
            elseif (!in_array($c['status'], ['notified','closed'])) $err = 'لا يمكن إعادة الفتح في هذه المرحلة.';
            else {
                $pr = ['عاجلة','عالية','عادية']; $i = array_search($c['priority'], $pr);
                $np = $i > 0 ? $pr[$i-1] : $c['priority'];
                q("UPDATE complaints SET status='reopened', reopened=reopened+1, resolved_at=NULL, closed_at=NULL, priority=? WHERE id=?", [$np, $c['id']]);
                logHistory((int)$c['id'], 'إعادة فتح', 'من ولي الأمر: ' . mb_substr($reason, 0, 500), null, 'ولي الأمر');
                $to = array_filter([$c['assignee']]);
                foreach (all("SELECT id FROM users WHERE active=1 AND ((role='manager' AND branch_id=?) OR role='admin')", [$c['branch_id']]) as $u) $to[] = $u['id'];
                notifyUser($to, "🔁 ولي الأمر أعاد فتح الشكوى {$c['ref']}: " . mb_substr($reason, 0, 120), (int)$c['id'], $c['ref']);
                $ok = 'أُعيد فتح شكواك وأُشعر المختص ومدير الفرع. سنعاود التواصل معك.';
                $c = loadPublic($ref);
            }
        }
    }
} elseif ($ref !== '' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $err = 'يرجى إدخال آخر أربعة أرقام من جوال ولي الأمر للتحقق.';
}

$STATUS_AR = ['new'=>'استُلمت','assigned'=>'أُسندت للمختص','progress'=>'قيد المعالجة',
  'resolved'=>'تم التوصل إلى حل','notified'=>'أُبلغت بالحل','closed'=>'مغلقة','reopened'=>'أُعيد فتحها'];
$SCHOOL = setting('school_name', SCHOOL_NAME);
?><!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تتبّع الشكوى — <?= e($SCHOOL) ?></title>
<link rel="stylesheet" href="assets/app.css?v=3">
</head><body>
<div class="trackhead">
  <?= renderLogo('logo-img', 44) ?>
  <div class="brandtxt"><b><?= e($SCHOOL) ?></b><br><small>بوابة تتبّع شكاوى أولياء الأمور</small></div>
</div>
<div class="trackwrap">

  <div class="card">
    <h3>🔍 تتبّع شكوى</h3>
    <form method="post" class="row" style="align-items:flex-end">
      <label class="f" style="margin:0;flex:1;min-width:220px"><span>الرقم المرجعي</span>
        <input type="text" name="ref" value="<?= e($ref) ?>" placeholder="مثال: SHT-2026-0003" required></label>
      <label class="f" style="margin:0;max-width:200px"><span>آخر 4 أرقام من جوالك</span>
        <input type="text" name="last4" value="<?= e($last4) ?>" maxlength="4" inputmode="numeric" placeholder="****" required></label>
      <button class="btn" type="submit">عرض حالة الشكوى</button>
    </form>
    <div class="hint" style="margin-top:8px">للتحقق من هويتك، أدخل آخر أربعة أرقام من الجوال المسجّل في الشكوى.</div>
  </div>

  <?php if ($err): ?><div class="critbox"><?= e($err) ?></div><?php endif; ?>
  <?php if ($ok):  ?><div class="okbox"><?= e($ok) ?></div><?php endif; ?>

  <?php if ($c):
    $steps = [
      ['استلمنا شكواك', (int)$c['created_at']],
      ['أُسندت للمختص', (int) (val("SELECT at FROM history WHERE complaint_id=? AND action='إسناد' ORDER BY id LIMIT 1", [$c['id']]) ?? 0)],
      ['جارٍ العمل عليها', (int)$c['first_response_at']],
      ['تم التوصل إلى حل', (int)$c['resolved_at']],
      ['أبلغناك بالحل', (int)$c['parent_notified_at']],
      ['أُغلقت الشكوى', (int)$c['closed_at']],
    ];
    $firstOpen = -1; foreach ($steps as $i=>$s) if (!$s[1]) { $firstOpen = $i; break; }
  ?>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><b style="font-size:17px"><?= e($c['ref']) ?></b> — <?= e($c['subject']) ?>
        <div class="hint">الطالب: <?= e($c['student']) ?> · <?= e($c['branch_name']) ?> · <?= e($c['grade']) ?></div></div>
      <span class="badge b-<?= $c['status']==='closed'?'closed':'assigned' ?>"><?= e($STATUS_AR[$c['status']] ?? $c['status']) ?></span>
    </div>

    <div class="stepper" style="margin-top:14px">
      <?php foreach ($steps as $i=>$s): ?>
        <div class="step <?= $s[1] ? 'done' : ($i===$firstOpen ? 'current' : '') ?>">
          <div class="dot"><?= $s[1] ? '✓' : $i+1 ?></div>
          <div><div class="t"><?= e($s[0]) ?></div><div class="m"><?= $s[1] ? e(fmtAr($s[1])) : '—' ?></div></div>
        </div>
      <?php endforeach; ?>
    </div>

    <?php if ($c['resolution'] && in_array($c['status'], ['notified','closed'])): ?>
      <div class="okbox"><b>ما تم بشأن شكواك:</b><br><?= nl2br(e($c['resolution'])) ?></div>
    <?php elseif (!$c['resolved_at']): ?>
      <div class="note">الموعد المتوقع للرد: <b><?= e(fmtAr(dueAt($c))) ?></b></div>
    <?php endif; ?>

    <?php if ($c['status']==='closed' && !$c['survey_overall']): ?>
      <div class="card" style="margin-top:14px">
        <h3>📋 استبيان الرضا — نودّ معرفة رأيك</h3>
        <form method="post">
          <input type="hidden" name="ref" value="<?= e($ref) ?>"><input type="hidden" name="last4" value="<?= e($last4) ?>">
          <?php foreach ([['speed','سرعة الاستجابة'],['quality','جودة الحل المقدَّم'],['overall','رضاك العام عن المعالجة']] as [$k,$lbl]): ?>
            <div style="margin-bottom:10px"><div style="font-size:13.5px;margin-bottom:4px"><?= $lbl ?></div>
              <div class="row" style="gap:6px">
                <?php for ($n=5; $n>=1; $n--): ?>
                  <label class="chip"><input type="radio" name="<?= $k ?>" value="<?= $n ?>" <?= $k==='overall'?'required':'' ?> style="width:auto"> <?= str_repeat('⭐', $n) ?></label>
                <?php endfor; ?>
              </div></div>
          <?php endforeach; ?>
          <label class="f"><span>ملاحظات إضافية</span><textarea name="comment" style="min-height:80px"></textarea></label>
          <button class="btn ok" type="submit">إرسال التقييم</button>
        </form>
      </div>
    <?php elseif ($c['survey_overall']): ?>
      <div class="okbox">✅ شكراً لتقييمك — التقييم العام <?= (int)$c['survey_overall'] ?>/5</div>
    <?php endif; ?>

    <?php if (in_array($c['status'], ['notified','closed'])): ?>
      <details style="margin-top:12px"><summary style="cursor:pointer;color:var(--crit);font-weight:700">لم تُحل مشكلتي — طلب إعادة فتح الشكوى</summary>
        <form method="post" style="margin-top:10px">
          <input type="hidden" name="ref" value="<?= e($ref) ?>"><input type="hidden" name="last4" value="<?= e($last4) ?>">
          <label class="f"><span>وضّح سبب عدم الاقتناع بالحل</span><textarea name="reopen_reason" required style="min-height:80px"></textarea></label>
          <button class="btn danger" type="submit">إعادة فتح الشكوى</button>
        </form>
      </details>
    <?php endif; ?>
  </div>
  <?php endif; ?>

  <div class="hint" style="text-align:center;margin-top:18px">
    <?= e($SCHOOL) ?> — إدارة خدمة المستفيدين · <a href="login.php">دخول الموظفين</a>
  </div>
</div>
</body></html>
