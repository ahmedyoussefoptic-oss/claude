<?php
require_once __DIR__ . '/util.php';

const OPEN_STATES = ['new','assigned','progress','resolved','notified','reopened'];

/** محرك التذكير والتصعيد — يُستدعى دورياً (cron.php) أو تلقائياً كل 10 دقائق */
function runEngine(bool $force = false): array {
    $last = (int) setting('engine_last', 0);
    if (!$force && time() - $last < 600) return ['skipped' => true];
    setSetting('engine_last', time());

    $t = time(); $rem = 0; $esc = 0;
    $ph = implode(',', array_fill(0, count(OPEN_STATES), '?'));
    $rows = all("SELECT c.*, b.name AS branch_name FROM complaints c
                 LEFT JOIN branches b ON b.id=c.branch_id
                 WHERE c.deleted=0 AND c.status IN ($ph)", OPEN_STATES);

    foreach ($rows as $c) {
        $s   = slaFor($c['priority']);
        $due = dueAt($c);

        // تذكير دوري للمختص
        if (in_array($c['status'], ['assigned','progress','reopened']) && $c['assignee']) {
            $lastRem = (int)($c['last_reminder_at'] ?: $c['created_at']);
            if ($t - $lastRem >= (int)$s['remind'] * HOUR) {
                q("UPDATE complaints SET last_reminder_at=?, reminder_count=reminder_count+1 WHERE id=?", [$t, $c['id']]);
                logHistory((int)$c['id'], 'تذكير آلي', 'تذكير رقم ' . ((int)$c['reminder_count'] + 1) . ' للمختص بشأن المدة المتبقية', null, 'النظام');
                notifyUser($c['assignee'], "تذكير: الشكوى {$c['ref']} ما زالت دون حل — يتبقى " . durAr($due - $t), (int)$c['id'], $c['ref']);
                $rem++;
            }
        }
        // تذكير خدمة العملاء بإبلاغ ولي الأمر
        if ($c['status'] === 'resolved' && $t - (int)$c['resolved_at'] >= 2 * HOUR
            && (!$c['notify_reminder_at'] || $t - (int)$c['notify_reminder_at'] >= 4 * HOUR)) {
            q("UPDATE complaints SET notify_reminder_at=? WHERE id=?", [$t, $c['id']]);
            logHistory((int)$c['id'], 'تذكير آلي', 'تذكير خدمة العملاء بإبلاغ ولي الأمر بالحل', null, 'النظام');
            $cs = array_column(all("SELECT id FROM users WHERE role='cs' AND active=1 AND (scope='all' OR branch_id=?)", [$c['branch_id']]), 'id');
            notifyUser($cs, "الشكوى {$c['ref']} تم حلها ولم يُبلَّغ ولي الأمر بعد", (int)$c['id'], $c['ref']);
            $rem++;
        }
        // التصعيد
        if (!$c['resolved_at'] && $t > $due) {
            $over = $t - $due;
            $lvl  = $over > (int)$s['resolve'] * HOUR * 0.5 ? 2 : 1;
            if ((int)$c['escalation'] < $lvl) {
                q("UPDATE complaints SET escalation=?, breached=1 WHERE id=?", [$lvl, $c['id']]);
                if ($lvl === 1) {
                    $to  = array_column(all("SELECT id FROM users WHERE role='manager' AND active=1 AND branch_id=?", [$c['branch_id']]), 'id');
                    $who = 'مدير الفرع';
                } else {
                    $to  = array_column(all("SELECT id FROM users WHERE role='admin' AND active=1"), 'id');
                    $who = 'الإدارة العامة';
                }
                logHistory((int)$c['id'], 'تصعيد آلي', "تجاوزت مدة الحل — تصعيد إلى $who (المستوى $lvl)", null, 'النظام');
                notifyUser($to, "تصعيد (مستوى $lvl): الشكوى {$c['ref']} — {$c['branch_name']} تجاوزت مدة الحل المعتمدة", (int)$c['id'], $c['ref']);
                notifyUser($c['assignee'], "تم تصعيد الشكوى {$c['ref']} إلى $who لتجاوزها المدة", (int)$c['id'], $c['ref']);
                $esc++;
            }
        }
    }
    return ['reminders' => $rem, 'escalations' => $esc];
}
