<?php
/* مهمة مجدولة: تشغيل محرك التذكير والتصعيد
   اضبطها في cPanel → Cron Jobs كل ساعة:
   /usr/local/bin/php /home/USER/public_html/complaints/cron.php
   أو عبر الرابط: https://school.edu.sa/complaints/cron.php?key=KEY  */
require_once __DIR__ . '/lib/engine.php';

$cli = php_sapi_name() === 'cli';
if (!$cli) {
    $key = setting('cron_key', '');
    if ($key === '') { $key = bin2hex(random_bytes(12)); setSetting('cron_key', $key); }
    if (($_GET['key'] ?? '') !== $key) { http_response_code(403); exit('مفتاح غير صحيح'); }
}
$r = runEngine(true);
echo "تم التشغيل — تذكيرات: {$r['reminders']} · تصعيدات: {$r['escalations']}\n";
