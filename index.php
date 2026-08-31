<?php
require_once __DIR__ . '/lib/auth.php';
startSession();
if (!tableExists('users')) { header('Location: install.php'); exit; }
$ME = requireLogin();
$SCHOOL = setting('school_name', SCHOOL_NAME);
?><!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e(APP_NAME) ?> — <?= e($SCHOOL) ?></title>
<link rel="stylesheet" href="assets/app.css?v=3">
</head>
<body>
<header class="top">
  <div class="brand">
    <?php include __DIR__ . '/lib/logo.php'; ?>
    <div class="brandtxt"><?= e($SCHOOL) ?>
      <small><?= e(APP_NAME) ?></small></div>
  </div>
  <div class="spacer"></div>
  <div class="who">
    <span>👤</span>
    <b id="meName"><?= e($ME['name']) ?></b>
    <span class="pill-sm" id="meRole"><?= e($ME['title'] ?: '') ?></span>
  </div>
  <select id="branchScope" onchange="setScope(this.value)" title="نطاق الفرع"></select>
  <button class="bell" onclick="openNotifs()">🔔<span class="dot hidden" id="notifDot">0</span></button>
  <a class="btn ghost sm" href="logout.php">↩️ خروج</a>
</header>

<nav class="tabs" id="tabs"></nav>


<main>
  <!-- ================= DASHBOARD ================= -->
  <section id="tab-dash" class="tabpane">
    <div class="grid g4" style="margin-bottom:16px">
      <div class="tile"><div class="lbl">📋 إجمالي الشكاوى</div><div class="val" id="k-total">0</div><div class="sub" id="k-total-sub"></div></div>
      <div class="tile"><div class="lbl">🔓 شكاوى مفتوحة</div><div class="val" id="k-open">0</div><div class="sub" id="k-open-sub"></div></div>
      <div class="tile"><div class="lbl">⏰ متجاوزة المدة</div><div class="val" id="k-late" style="color:var(--crit)">0</div><div class="sub" id="k-late-sub"></div></div>
      <div class="tile"><div class="lbl">⚡ متوسط زمن الحل</div><div class="val" id="k-avg">—</div><div class="sub">من الفتح حتى الحل</div></div>
    </div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="tile"><div class="lbl">⭐ رضا أولياء الأمور</div><div class="val" id="k-sat">—</div><div class="sub" id="k-sat-sub">من 5 — نتائج الاستبيان</div></div>
      <div class="tile"><div class="lbl">✅ الالتزام بمدة الحل</div><div class="val" id="k-sla">—</div><div class="sub">نسبة الشكاوى المحلولة داخل المدة</div></div>
      <div class="tile"><div class="lbl">🔺 مصعّدة</div><div class="val" id="k-esc" style="color:#a35a00">0</div><div class="sub">تجاوزت المدة وصُعّدت</div></div>
      <div class="tile"><div class="lbl">🔁 معاد فتحها</div><div class="val" id="k-re">0</div><div class="sub">لم يقتنع ولي الأمر بالحل</div></div>
    </div>

    <div class="grid g2">
      <div class="card">
        <h3>الشكاوى حسب الفرع <span class="sub">العدد الكلي</span></h3>
        <div class="chart" id="ch-branch"></div>
        <div class="hint">اللون يعبّر عن المقدار فقط (مقياس أحادي اللون)، والقيم مكتوبة بجانب كل عمود.</div>
      </div>
      <div class="card">
        <h3>الشكاوى حسب النوع</h3>
        <div class="chart" id="ch-type"></div>
        <h3 style="margin-top:18px">توزيع الحالات</h3>
        <div class="chart" id="ch-status"></div>
      </div>
    </div>

    <div class="card">
      <h3>أداء الفروع <span class="sub">جدول مقارن — يمكن تصديره</span></h3>
      <div style="overflow-x:auto"><table class="tbl" id="branchTable"></table></div>
      <div class="row" style="margin-top:12px">
        <button class="btn ghost sm" onclick="exportCSV('branches')">⬇️ تصدير أداء الفروع (CSV)</button>
        <button class="btn ghost sm" onclick="exportCSV('complaints')">⬇️ تصدير كل الشكاوى (CSV)</button>
      </div>
    </div>
  </section>

  <!-- ================= NEW COMPLAINT ================= -->
  <section id="tab-new" class="tabpane hidden">
    <div class="card">
      <h3>📝 تسجيل شكوى جديدة <span class="sub">يُعبّأ من موظف خدمة العملاء أثناء تواصل ولي الأمر</span></h3>
      <div class="grid g3">
        <div>
          <label class="f"><span>اسم الطالب <b class="req">*</b></span><input type="text" id="f-student" placeholder="الاسم الرباعي"></label>
          <label class="f"><span>الفرع <b class="req">*</b></span><select id="f-branch"></select></label>
          <label class="f"><span>المنهج <b class="req">*</b></span><select id="f-curr"></select></label>
          <label class="f"><span>الصف الدراسي <b class="req">*</b></span><select id="f-grade"></select></label>
        </div>
        <div>
          <label class="f"><span>اسم ولي الأمر <b class="req">*</b></span><input type="text" id="f-parent" placeholder="اسم مقدّم الشكوى"></label>
          <label class="f"><span>جوال ولي الأمر <b class="req">*</b></span><input type="tel" id="f-phone" placeholder="05xxxxxxxx"></label>
          <label class="f"><span>صلة القرابة</span><select id="f-rel"><option>الأب</option><option>الأم</option><option>ولي أمر بديل</option></select></label>
          <label class="f"><span>قناة الاستلام</span><select id="f-channel"><option>اتصال هاتفي</option><option>واتساب</option><option>حضور شخصي</option><option>البريد الإلكتروني</option><option>تطبيق المدرسة</option></select></label>
          <label class="f"><span>متلقي الشكوى — خدمة العملاء <b class="req">*</b></span><select id="f-receiver"></select>
            <div class="hint">اسم الموظف الذي استقبل الشكوى ويُسجَّل في سجل التدقيق.</div></label>
        </div>
        <div>
          <label class="f"><span>طبيعة الشكوى <b class="req">*</b></span><select id="f-type" onchange="autoPriority()"></select></label>
          <label class="f"><span>التصنيف الفرعي</span><select id="f-sub"></select></label>
          <label class="f"><span>الأولوية <b class="req">*</b></span><select id="f-pri" onchange="showSla()"></select>
            <div class="hint" id="slaHint"></div></label>
          <label class="f"><span>المختص المسند إليه</span><select id="f-assignee"></select>
            <div class="hint">يُقترح تلقائياً حسب الفرع ونوع الشكوى، ويمكن تغييره.</div></label>
        </div>
      </div>
      <label class="f"><span>عنوان مختصر للشكوى <b class="req">*</b></span><input type="text" id="f-subject" placeholder="مثال: تأخر إصدار شهادة الفصل الأول"></label>
      <label class="f"><span>نص الشكوى <b class="req">*</b></span><textarea id="f-text" placeholder="اكتب الشكوى كما ذكرها ولي الأمر بالتفصيل..."></textarea></label>

      <label class="f"><span>المرفقات (صور / ملفات صوتية / مستندات)</span></label>
      <div class="drop" onclick="document.getElementById('f-files').click()"
           ondragover="event.preventDefault();this.style.borderColor='var(--s1)'"
           ondragleave="this.style.borderColor='var(--line)'"
           ondrop="dropFiles(event,this)">
        📎 اضغط لاختيار الملفات أو اسحبها هنا — صور، تسجيلات صوتية، PDF
      </div>
      <input type="file" id="f-files" multiple accept="image/*,audio/*,.pdf,.doc,.docx" class="hidden" onchange="pickFiles(this.files)">
      <div class="row" style="margin-top:10px">
        <button class="btn ghost sm" id="recBtn" onclick="toggleRec()">🎙️ تسجيل صوتي مباشر</button>
        <span class="hint" id="recHint"></span>
      </div>
      <div class="att" id="f-attList"></div>

      <div class="row" style="margin-top:18px">
        <button class="btn" onclick="submitComplaint()">✅ حفظ الشكوى وإسنادها</button>
        <button class="btn ghost" onclick="resetForm()">مسح الحقول</button>
      </div>
    </div>
  </section>

  <!-- ================= LIST ================= -->
  <section id="tab-list" class="tabpane hidden">
    <div class="card">
      <h3>📂 سجل الشكاوى</h3>
      <div class="row" style="margin-bottom:12px">
        <input type="text" id="q" placeholder="🔎 بحث بالرقم المرجعي / الطالب / ولي الأمر / النص" style="max-width:340px" oninput="renderList()">
        <select id="fltStatus" onchange="renderList()"></select>
        <select id="fltType" onchange="renderList()"></select>
        <select id="fltPri" onchange="renderList()"></select>
        <label class="row" style="gap:5px;font-size:13px"><input type="checkbox" id="fltLate" onchange="renderList()" style="width:auto"> المتأخرة فقط</label>
        <label class="row" style="gap:5px;font-size:13px"><input type="checkbox" id="fltMine" onchange="renderList()" style="width:auto"> المسندة لي فقط</label>
      </div>
      <div style="overflow-x:auto"><table class="tbl" id="listTable"></table></div>
    </div>
  </section>

  <!-- ================= REMINDERS / ESCALATION ================= -->
  <section id="tab-follow" class="tabpane hidden">
    <div class="grid g3" style="margin-bottom:16px">
      <div class="tile"><div class="lbl">🔴 متجاوزة مدة الحل</div><div class="val" id="f-late" style="color:var(--crit)">0</div><div class="sub">تستوجب تصعيداً فورياً</div></div>
      <div class="tile"><div class="lbl">🟠 اقتربت من المدة</div><div class="val" id="f-soon" style="color:#a35a00">0</div><div class="sub">تجاوزت 75% من المدة</div></div>
      <div class="tile"><div class="lbl">🔵 بانتظار إبلاغ ولي الأمر</div><div class="val" id="f-wait" style="color:var(--s1)">0</div><div class="sub">تم الحل ولم يُبلَّغ ولي الأمر</div></div>
    </div>
    <div class="card">
      <h3>⏰ لوحة التذكيرات والتصعيد <span class="sub">تُحدَّث آلياً حسب مدد الخدمة</span></h3>
      <div class="row" style="margin-bottom:10px">
        <button class="btn ghost sm" onclick="runEngine(true)">🔄 تشغيل محرك التذكير والتصعيد الآن</button>
        <span class="hint">في النظام الفعلي يعمل تلقائياً كل ساعة ويرسل تنبيهاً للمختص ومدير الفرع.</span>
      </div>
      <div id="followList"></div>
    </div>
  </section>

  <!-- ================= FLOW MAP ================= -->
  <section id="tab-map" class="tabpane hidden">
    <div class="card">
      <h3>🗺️ خريطة مسار الشكوى <span class="sub">الأعداد أدناه فعلية وتتغير مع بيانات النظام</span></h3>
      <div class="flow" id="flowMap"></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="note"><b>مسار الاستثناء — التصعيد:</b> عند تجاوز مدة الحل يُصعَّد تلقائياً إلى <b>مدير الفرع</b> (المستوى الأول)، وعند تجاوز 1.5 ضعف المدة يُصعَّد إلى <b>الإدارة العامة</b> (المستوى الثاني)، مع إشعار المختص في كل مرة.</div>
        <div class="note"><b>مسار الاستثناء — إعادة الفتح:</b> إذا لم يقتنع ولي الأمر بالحل عند إبلاغه، تُعاد الشكوى إلى حالة «قيد المعالجة» مع رفع الأولوية درجة واحدة وتسجيل السبب.</div>
      </div>
    </div>
    <div class="card">
      <h3>⏱️ مدد الاستجابة والحل المعتمدة (SLA) <span class="sub">قابلة للتعديل</span></h3>
      <div style="overflow-x:auto"><table class="tbl" id="slaTable"></table></div>
      <div class="hint" style="margin-top:8px">المدد بالساعات وتُحتسب من لحظة تسجيل الشكوى. عدّل القيم ثم اضغط حفظ لتطبيقها على احتساب التأخير مباشرة.</div>
      <button class="btn sm" style="margin-top:10px" onclick="saveSla()">💾 حفظ المدد</button>
    </div>
    <div class="card">
      <h3>🧭 مصفوفة الإسناد <span class="sub">من يعالج ماذا في كل فرع</span></h3>
      <div style="overflow-x:auto"><table class="tbl" id="routeTable"></table></div>
    </div>
  </section>

  <!-- ================= KNOWLEDGE ================= -->
  <section id="tab-kb" class="tabpane hidden">
    <div class="card">
      <h3>📚 قاعدة المعرفة <span class="sub">حلول الشكاوى المتكررة — تُختصر بها مدة المعالجة</span></h3>
      <input type="text" id="kbq" placeholder="🔎 ابحث في الحلول المعتمدة" style="max-width:360px" oninput="renderKB()">
      <div id="kbList" style="margin-top:12px"></div>
    </div>
  </section>

  <!-- ================= PARENT PORTAL ================= -->
  <section id="tab-parent" class="tabpane hidden">
    <div class="card">
      <h3>👨‍👩‍👦 بوابة تتبّع ولي الأمر <span class="sub">صفحة عامة لا تحتاج تسجيل دخول</span></h3>
      <p class="hint" style="margin-top:0">يتتبّع ولي الأمر شكواه بالرقم المرجعي مع آخر أربعة أرقام من جواله، ويعبّئ استبيان الرضا بعد الإغلاق.</p>
      <div class="row">
        <input type="text" id="trackRef" placeholder="الرقم المرجعي — مثال: SHT-2026-0003" style="max-width:300px">
        <button class="btn" onclick="openTrack()">🔍 فتح صفحة التتبع</button>
        <button class="btn ghost" onclick="copyTrack()">📋 نسخ رابط التتبع</button>
      </div>
      <div class="note" style="margin-top:12px">رابط البوابة العامة: <b id="trackBase"></b><br>
        أرسل هذا الرابط لولي الأمر مع الرقم المرجعي، أو استخدم زر الواتساب داخل الشكوى فيُرسل الرابط تلقائياً ضمن الرسالة.</div>
      <div id="trackResult" style="margin-top:14px"></div>
    </div>
  </section>

  <!-- ================= STAFF ================= -->
  <section id="tab-staff" class="tabpane hidden">
    <div class="card">
      <h3>👥 إدارة الموظفين والمسند إليهم <span class="sub">إضافة وتعديل وحذف وإعادة تعيين كلمة المرور</span></h3>
      <div class="row" style="margin-bottom:12px">
        <button class="btn" onclick="openStaffForm()">➕ إضافة موظف</button>
        <input type="text" id="staffQ" placeholder="🔎 بحث بالاسم أو الجوال أو البريد" style="max-width:260px" oninput="renderStaff()">
        <select id="staffBranch" onchange="renderStaff()" style="max-width:200px"></select>
        <select id="staffRole" onchange="renderStaff()" style="max-width:170px"></select>
        <button class="btn ghost sm" onclick="exportCSV('staff')">⬇️ تصدير القائمة</button>
      </div>
      <div style="overflow-x:auto"><table class="tbl" id="staffTable"></table></div>
    </div>
    <div class="card">
      <h3>🧾 سجل العمليات <span class="sub">من نفّذ ماذا ومتى</span></h3>
      <div id="auditList"></div>
    </div>
  </section>

  <!-- ================= SETTINGS ================= -->
  <section id="tab-set" class="tabpane hidden">
    <div class="grid g2">
      <div class="card">
        <h3>🏫 الفروع <span class="sub">يشمل خيار «جميع الفروع» للشكاوى العامة</span></h3>
        <div style="overflow-x:auto"><table class="tbl" id="brTable"></table></div>
        <div class="row" style="margin-top:12px">
          <input type="text" id="nbCode" placeholder="الرمز (مثال: RWD)" style="max-width:150px">
          <input type="text" id="nbName" placeholder="اسم الفرع" style="max-width:240px">
          <button class="btn sm" onclick="addBranch()">➕ إضافة فرع</button>
        </div>
      </div>
      <div class="card">
        <h3>🖼️ شعار المدرسة</h3>
        <div class="row" style="align-items:flex-start;gap:18px">
          <div id="logoBox" style="background:#fff;border:1px solid var(--grid);border-radius:10px;padding:10px"></div>
          <div>
            <input type="file" id="logoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp">
            <div class="hint">PNG أو SVG بخلفية شفافة — الحد الأقصى 3 ميجابايت.</div>
            <button class="btn sm" style="margin-top:8px" onclick="uploadLogo()">⬆️ رفع الشعار</button>
          </div>
        </div>
        <label class="f" style="margin-top:16px"><span>اسم المدرسة كما يظهر في الترويسة والرسائل</span>
          <input type="text" id="schoolName"></label>
        <button class="btn sm" onclick="saveSchool()">💾 حفظ الاسم</button>
      </div>
    </div>
    <div class="card">
      <h3>💬 قالب رسالة الواتساب لولي الأمر</h3>
      <textarea id="waTpl" style="min-height:180px"></textarea>
      <div class="hint">المتغيرات: <b>{ولي_الأمر}</b> · <b>{الطالب}</b> · <b>{الفرع}</b> · <b>{المدرسة}</b> · <b>{الرقم_المرجعي}</b> · <b>{عنوان_الشكوى}</b> · <b>{الحل}</b> · <b>{مدة_المعالجة}</b> · <b>{رابط_التتبع}</b></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" onclick="saveWaTpl()">💾 حفظ القالب</button></div>
    </div>
    <div class="card">
      <h3>🔑 كلمة المرور الخاصة بي</h3>
      <div class="grid g3">
        <label class="f"><span>كلمة المرور الحالية</span><input type="password" id="pw0"></label>
        <label class="f"><span>كلمة المرور الجديدة</span><input type="password" id="pw1"></label>
        <label class="f"><span>تأكيد كلمة المرور</span><input type="password" id="pw2"></label>
      </div>
      <button class="btn sm" onclick="changePw()">💾 تغيير كلمة المرور</button>
    </div>
    <div class="card">
      <h3>🛡️ تشغيل آمن — تذكير</h3>
      <ul style="margin:0;padding-inline-start:20px;font-size:13.5px;line-height:1.9">
        <li>احذف ملف <code>install.php</code> من الخادم بعد التثبيت.</li>
        <li>فعّل شهادة SSL على الدومين واضبط <code>FORCE_HTTPS</code> في <code>config.php</code>.</li>
        <li>اضبط مهمة مجدولة (Cron) على <code>cron.php</code> كل ساعة لتشغيل التذكير والتصعيد.</li>
        <li>خذ نسخة احتياطية يومية من قاعدة البيانات ومجلد <code>uploads</code>.</li>
      </ul>
    </div>
  </section>
</main>



<div id="modalHost"></div>
<div id="toastHost"></div>
<script>
  window.CSRF = <?= json_encode(csrfToken()) ?>;
  window.LOGO = <?= json_encode(setting('logo_path','')) ?>;
</script>
<script src="assets/app.js?v=3"></script>
</body>
</html>
