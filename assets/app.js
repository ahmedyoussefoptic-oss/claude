/* =====================================================================
   نظام شكاوى أولياء الأمور — مدارس المكتشف العالمية
   واجهة المستخدم (تتصل بقاعدة البيانات عبر api.php)
   ===================================================================== */

const H = 3600; // ثانية
let ME = null, BRANCHES = [], USERS = [], SET = {}, SCOPE = '*', CURTAB = 'dash';
let LIST = [], STATS = [], PENDING = [], LAST_ASSIGN = null;

const STATUS = {
  new:      {label:'جديدة',                             cls:'b-new',      icon:'🆕'},
  assigned: {label:'مسندة للمختص',                      cls:'b-assigned', icon:'📨'},
  progress: {label:'قيد المعالجة',                      cls:'b-prog',     icon:'⚙️'},
  resolved: {label:'تم الحل — بانتظار إبلاغ ولي الأمر', cls:'b-resolved', icon:'✅'},
  notified: {label:'تم إبلاغ ولي الأمر',                cls:'b-notified', icon:'📞'},
  closed:   {label:'مغلقة',                             cls:'b-closed',   icon:'🔒'},
  reopened: {label:'معاد فتحها',                        cls:'b-reopened', icon:'🔁'},
};
const OPEN_STATES = ['new','assigned','progress','resolved','notified','reopened'];
const PRIORITIES  = ['عاجلة','عالية','عادية'];
const DEPT_NAME   = {admin:'الشؤون الإدارية', academic:'الشؤون الأكاديمية', behavior:'التوجيه والإرشاد الطلابي'};
const ROLES = {
  admin:  {label:'مدير النظام', desc:'اطلاع وتعديل وحذف على جميع الفروع + إدارة الموظفين'},
  manager:{label:'مدير فرع',    desc:'اطلاع وتعديل داخل فرعه فقط'},
  cs:     {label:'خدمة العملاء',desc:'استقبال الشكاوى وتسجيلها وإبلاغ أولياء الأمور'},
  spec:   {label:'مختص',        desc:'معالجة الشكاوى المسندة إليه'},
};
const TABS = [
  {id:'dash',   label:'📊 لوحة المؤشرات',       roles:['cs','spec','manager','admin']},
  {id:'new',    label:'📝 شكوى جديدة',          roles:['cs','manager','admin']},
  {id:'list',   label:'📂 سجل الشكاوى',         roles:['cs','spec','manager','admin']},
  {id:'follow', label:'⏰ التذكيرات والتصعيد',  roles:['cs','spec','manager','admin']},
  {id:'map',    label:'🗺️ خريطة المسار والمدد', roles:['cs','spec','manager','admin']},
  {id:'kb',     label:'📚 قاعدة المعرفة',       roles:['cs','spec','manager','admin']},
  {id:'parent', label:'👨‍👩‍👦 بوابة ولي الأمر',   roles:['cs','manager','admin']},
  {id:'staff',  label:'👥 الموظفون',            roles:['admin']},
  {id:'set',    label:'⚙️ الإعدادات',           roles:['admin']},
];

/* ================= أدوات ================= */
const $  = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowS = () => Math.floor(Date.now()/1000);
const opt = (v,t) => `<option value="${esc(v)}">${esc(t==null?v:t)}</option>`;

function fmt(ts){ if(!ts) return '—';
  const d = new Date(ts*1000);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} — ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dur(sec){
  if(sec==null) return '—';
  const neg = sec<0; sec = Math.abs(sec);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), d = Math.floor(h/24), rh = h%24;
  const s = d>0 ? `${d} يوم${rh?` و${rh} ساعة`:''}` : (h>0 ? `${h} ساعة${m?` و${m} د`:''}` : `${m} دقيقة`);
  return (neg?'متأخرة بـ ':'') + s;
}
function toast(msg, bad){
  const el = document.createElement('div');
  el.className='toast'; el.textContent=msg;
  if(bad) el.style.background='#8c1c1c';
  $('toastHost').appendChild(el); setTimeout(()=>el.remove(), 4200);
}
async function api(a, o={}){
  let url = 'api.php?a=' + encodeURIComponent(a);
  if(o.query) url += '&' + new URLSearchParams(o.query);
  const opts = {method:'GET', headers:{}};
  if(o.json){ opts.method='POST'; opts.headers['Content-Type']='application/json'; opts.headers['X-CSRF']=window.CSRF; opts.body=JSON.stringify(o.json); }
  if(o.form){ opts.method='POST'; o.form.append('csrf', window.CSRF); opts.body=o.form; }
  const r = await fetch(url, opts);
  if(r.status===401){ location.href='login.php'; throw new Error('انتهت الجلسة'); }
  let d; try{ d = await r.json(); }catch(e){ throw new Error('استجابة غير صالحة من الخادم'); }
  if(!r.ok || d.ok===false) throw new Error(d.error || ('خطأ '+r.status));
  return d;
}
async function go2(fn){ try{ await fn(); }catch(e){ toast(e.message, true); } }

const branchById = id => BRANCHES.find(b=>+b.id===+id) || {name:'—', code:''};
const userById   = id => USERS.find(u=>+u.id===+id) || null;
const userName   = id => (userById(id)||{}).name || '—';
const isAdmin    = () => ME.role==='admin';
const seesAll    = () => ME.scope==='all';
const canP       = p => !!(ME.perms && ME.perms[p]);
function canAct(act, c){
  if(c && !seesAll() && +c.branch_id !== +ME.branch_id) return false;
  switch(act){
    case 'create': return ['cs','manager','admin'].includes(ME.role);
    case 'start': case 'resolve':
      return (ME.role==='spec' && c && +c.assignee===+ME.id) || ['manager','admin'].includes(ME.role);
    case 'notify': case 'close': case 'reopen': case 'assign':
      return ['cs','manager','admin'].includes(ME.role);
    case 'edit':   return canP('edit');
    case 'delete': return canP('delete');
    default: return true;
  }
}
function slaOf(c){ return (SET.sla && SET.sla[c.priority]) || {response:8, resolve:72, remind:24}; }
function dueAt(c){ return +c.due_at || (+c.created_at + slaOf(c).resolve*H); }
function slaState(c){
  if(c.status==='closed') return +c.breached ? 'late' : 'ok';
  const end = c.resolved_at ? +c.resolved_at : nowS();
  const left = dueAt(c) - end;
  if(left < 0) return 'late';
  if(left < slaOf(c).resolve*H*0.25) return 'soon';
  return 'ok';
}
function slaBadge(c){
  if(c.resolved_at || c.closed_at){
    const t = (+c.resolved_at || +c.closed_at) - (+c.created_at);
    const ok = (+c.resolved_at || +c.closed_at) <= dueAt(c);
    return `<span class="badge ${ok?'sla-ok':'sla-late'}">${ok?'✔ داخل المدة':'✖ تجاوز المدة'} · ${dur(t)}</span>`;
  }
  const left = dueAt(c) - nowS(), st = slaState(c);
  if(st==='late') return `<span class="badge sla-late">⏰ متأخرة ${dur(left)}</span>`;
  if(st==='soon') return `<span class="badge sla-soon">⚠️ يتبقى ${dur(left)}</span>`;
  return `<span class="badge sla-ok">🕒 يتبقى ${dur(left)}</span>`;
}

/* ================= الإقلاع ================= */
async function boot(){
  const d = await api('bootstrap');
  ME = d.me; BRANCHES = d.branches; USERS = d.users; SET = d.settings;
  window.CSRF = d.csrf; window.BASE = d.base;
  SCOPE = seesAll() ? '*' : String(ME.branch_id);
  $('meRole').textContent = (ME.title || ROLES[ME.role].label) + (seesAll() ? ' · كل الفروع' : ' · ' + branchById(ME.branch_id).name);
  initUI();
  renderTabs();
  await renderAll();
  updBell();
  setInterval(updBell, 60000);
}
function initUI(){
  $('branchScope').innerHTML = (seesAll()? opt('*','🏫 جميع الفروع') : '') +
    BRANCHES.filter(b=>seesAll() || +b.id===+ME.branch_id).map(b=>opt(b.id, b.name)).join('');
  $('branchScope').value = SCOPE;
  $('branchScope').disabled = !seesAll();

  $('f-branch').innerHTML  = BRANCHES.filter(b=>seesAll() || +b.id===+ME.branch_id || b.code==='ALL')
                                     .map(b=>opt(b.id,b.name)).join('');
  $('f-curr').innerHTML    = (SET.curricula||[]).map(c=>opt(c)).join('');
  $('f-grade').innerHTML   = (SET.grades||[]).map(g=>opt(g)).join('');
  $('f-type').innerHTML    = Object.keys(SET.types||{}).map(t=>opt(t)).join('');
  $('f-pri').innerHTML     = PRIORITIES.map(p=>opt(p)).join('');
  $('f-branch').onchange   = autoPriority;
  $('f-text').onblur       = autoPriority;

  $('fltStatus').innerHTML = opt('','كل الحالات') + Object.keys(STATUS).map(s=>opt(s,STATUS[s].label)).join('');
  $('fltType').innerHTML   = opt('','كل الأنواع') + Object.keys(SET.types||{}).map(t=>opt(t)).join('');
  $('fltPri').innerHTML    = opt('','كل الأولويات') + PRIORITIES.map(p=>opt(p)).join('');

  if($('staffBranch')){
    $('staffBranch').innerHTML = opt('*','🏫 جميع الفروع') + BRANCHES.map(b=>opt(b.id,b.name)).join('');
    $('staffRole').innerHTML   = opt('','كل الأدوار') + Object.keys(ROLES).map(r=>opt(r,ROLES[r].label)).join('');
  }
  if($('waTpl'))      $('waTpl').value = SET.wa_template || '';
  if($('schoolName')) $('schoolName').value = SET.school_name || '';
  if($('trackBase'))  $('trackBase').textContent = (window.BASE||'') + '/track.php';
  autoPriority();
}
function renderTabs(){
  const vis = TABS.filter(t=>t.roles.includes(ME.role));
  if(!vis.find(t=>t.id===CURTAB)) CURTAB = vis[0].id;
  $('tabs').innerHTML = vis.map(t=>`<button class="${t.id===CURTAB?'active':''}" onclick="go('${t.id}')">${t.label}</button>`).join('');
  TABS.forEach(t=>{ const el=$('tab-'+t.id); if(el) el.classList.add('hidden'); });
  $('tab-'+CURTAB).classList.remove('hidden');
}
function go(id){ CURTAB=id; renderTabs(); renderAll(); window.scrollTo({top:0,behavior:'smooth'}); }
function setScope(v){ SCOPE=v; renderAll(); }

async function renderAll(){
  await go2(async ()=>{
    if(CURTAB==='dash')   await renderDash();
    if(CURTAB==='list')   await renderList();
    if(CURTAB==='follow') await renderFollow();
    if(CURTAB==='map')  { await renderMap(); renderSlaTable(); renderRoute(); }
    if(CURTAB==='kb')     await renderKB();
    if(CURTAB==='staff')  await renderStaff();
    if(CURTAB==='set')    await renderSettings();
  });
}

/* ================= لوحة المؤشرات ================= */
function bars(el, rows, color){
  const max = Math.max(1, ...rows.map(r=>r.val));
  el.innerHTML = rows.map(r=>`
    <div class="bar-row" title="${esc(r.name)}: ${r.val}">
      <div class="name">${esc(r.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.val/max*100).toFixed(1)}%;background:${color||'var(--seq-450)'}"></div></div>
      <div class="num">${r.val}</div></div>`).join('') || '<div class="empty">لا توجد بيانات</div>';
}
function stats(rows){
  const open = rows.filter(c=>OPEN_STATES.includes(c.status));
  const late = open.filter(c=>slaState(c)==='late');
  const done = rows.filter(c=>c.resolved_at);
  const avg  = done.length ? done.reduce((s,c)=>s+(c.resolved_at-c.created_at),0)/done.length : null;
  const inS  = done.filter(c=>c.resolved_at<=dueAt(c)).length;
  const sv   = rows.filter(c=>c.survey_overall);
  return {total:rows.length, open:open.length, late:late.length, avg,
    slaPct: done.length? Math.round(inS/done.length*100):null,
    sat: sv.length? sv.reduce((s,c)=>s+c.survey_overall,0)/sv.length : null, satN: sv.length,
    esc: rows.filter(c=>c.escalation>0).length, re: rows.filter(c=>c.reopened>0).length,
    closed: rows.filter(c=>c.status==='closed').length,
    waiting: rows.filter(c=>c.status==='resolved').length};
}
async function renderDash(){
  const d = await api('stats', {query:{branch:SCOPE}});
  STATS = d.rows;
  const s = stats(STATS), set=(id,v)=>$(id).textContent=v;
  set('k-total', s.total); $('k-total-sub').textContent = `مغلقة: ${s.closed} · ${SCOPE==='*'?'جميع الفروع':branchById(SCOPE).name}`;
  set('k-open', s.open);   $('k-open-sub').textContent  = `تشمل ${s.waiting} بانتظار إبلاغ ولي الأمر`;
  set('k-late', s.late);   $('k-late-sub').textContent  = s.late? 'تحتاج تدخلاً فورياً':'لا توجد تجاوزات حالياً';
  set('k-avg', s.avg? dur(s.avg):'—');
  set('k-sat', s.sat? s.sat.toFixed(1)+' / 5':'—');
  $('k-sat-sub').textContent = s.satN? `بناءً على ${s.satN} استبيان`:'لا توجد استبيانات بعد';
  set('k-sla', s.slaPct!=null? s.slaPct+'%':'—');
  set('k-esc', s.esc); set('k-re', s.re);

  bars($('ch-branch'), BRANCHES.filter(b=>SCOPE==='*'||+b.id===+SCOPE)
      .map(b=>({name:b.name.replace('فرع ',''), val:STATS.filter(c=>+c.branch_id===+b.id).length}))
      .sort((a,b)=>b.val-a.val));
  bars($('ch-type'), Object.keys(SET.types||{})
      .map(t=>({name:t, val:STATS.filter(c=>c.ctype===t).length})).sort((a,b)=>b.val-a.val));
  bars($('ch-status'), Object.keys(STATUS)
      .map(k=>({name:STATUS[k].label, val:STATS.filter(c=>c.status===k).length}))
      .filter(r=>r.val>0).sort((a,b)=>b.val-a.val), 'var(--seq-250)');

  const rows = BRANCHES.filter(b=>SCOPE==='*'||+b.id===+SCOPE).map(b=>{
    const st = stats(STATS.filter(c=>+c.branch_id===+b.id));
    return `<tr><td><b>${esc(b.name)}</b> <span class="pill-sm">${esc(b.code)}</span></td>
      <td>${st.total}</td><td>${st.open}</td>
      <td>${st.late? `<span style="color:var(--crit);font-weight:700">${st.late}</span>`:'0'}</td>
      <td>${st.avg? dur(st.avg):'—'}</td><td>${st.slaPct!=null? st.slaPct+'%':'—'}</td>
      <td>${st.sat? '⭐ '+st.sat.toFixed(1):'—'}</td></tr>`;}).join('');
  $('branchTable').innerHTML =
    `<thead><tr><th>الفرع</th><th>الإجمالي</th><th>مفتوحة</th><th>متأخرة</th><th>متوسط زمن الحل</th><th>الالتزام بالمدة</th><th>الرضا</th></tr></thead><tbody>${rows}</tbody>`;
}

/* ================= سجل الشكاوى ================= */
async function fetchList(extra){
  const qy = {branch:SCOPE};
  if($('q').value.trim())      qy.q = $('q').value.trim();
  if($('fltStatus').value)     qy.status = $('fltStatus').value;
  if($('fltType').value)       qy.type = $('fltType').value;
  if($('fltPri').value)        qy.priority = $('fltPri').value;
  if($('fltMine').checked)     qy.mine = 1;
  Object.assign(qy, extra||{});
  const d = await api('complaints', {query:qy});
  LIST = d.rows;
  return LIST;
}
async function renderList(){
  await fetchList();
  let L = LIST;
  if($('fltLate').checked) L = L.filter(c=>slaState(c)==='late');
  const rows = L.map(c=>`<tr>
    <td class="ref" onclick="openC(${c.id})">${esc(c.ref)}</td>
    <td>${esc(c.student)}<div class="hint">${esc(c.grade||'')} · ${esc((c.curriculum||'').replace('المنهج ',''))}</div></td>
    <td>${esc((c.branch_name||'').replace('فرع ',''))}</td>
    <td>${esc(c.ctype)}<div class="hint">${esc(c.csub||'')}</div></td>
    <td><span class="pri pri-${esc(c.priority)}">${esc(c.priority)}</span></td>
    <td><span class="badge ${STATUS[c.status].cls}">${STATUS[c.status].icon} ${STATUS[c.status].label}</span>
        ${+c.escalation? `<div style="margin-top:3px"><span class="badge sla-late">🔺 مصعّدة م${c.escalation}</span></div>`:''}</td>
    <td>${esc(c.assignee_name||'—')}</td>
    <td>${slaBadge(c)}</td>
    <td><button class="btn ghost sm" onclick="openC(${c.id})">فتح</button></td></tr>`).join('');
  $('listTable').innerHTML =
    `<thead><tr><th>الرقم المرجعي</th><th>الطالب</th><th>الفرع</th><th>النوع</th><th>الأولوية</th><th>الحالة</th><th>المختص</th><th>المدة</th><th></th></tr></thead>
     <tbody>${rows || '<tr><td colspan="9" class="empty">لا توجد شكاوى مطابقة</td></tr>'}</tbody>`;
}

/* ================= التذكيرات والتصعيد ================= */
async function renderFollow(){
  const d = await api('complaints', {query:{branch:SCOPE}});
  const L = d.rows.filter(c=>OPEN_STATES.includes(c.status));
  const late = L.filter(c=>slaState(c)==='late');
  const soon = L.filter(c=>slaState(c)==='soon');
  const wait = L.filter(c=>c.status==='resolved');
  $('f-late').textContent=late.length; $('f-soon').textContent=soon.length; $('f-wait').textContent=wait.length;
  const block = (title, arr, cls, msg) => !arr.length ? '' : `
    <h3 style="margin:16px 0 8px;font-size:15px">${title} <span style="color:var(--muted);font-weight:400">(${arr.length})</span></h3>
    ${arr.map(c=>`<div class="${cls}" style="margin-bottom:8px"><div class="row" style="justify-content:space-between">
      <div><b class="ref" style="cursor:pointer" onclick="openC(${c.id})">${esc(c.ref)}</b> — ${esc(c.subject)}
        <div class="hint">${esc(c.branch_name)} · ${esc(c.ctype)} · المختص: ${esc(c.assignee_name||'لم يُسند')} · ${msg(c)}</div></div>
      <div class="row"><button class="btn ghost sm" onclick="sendReminder(${c.id})">🔔 تذكير</button>
        <button class="btn ghost sm" onclick="openC(${c.id})">فتح</button></div></div></div>`).join('')}`;
  $('followList').innerHTML =
      block('🔴 متجاوزة مدة الحل', late, 'critbox', c=>`تأخرت ${dur(dueAt(c)-nowS())} · مستوى التصعيد ${c.escalation||0}`)
    + block('🟠 اقتربت من انتهاء المدة', soon, 'warnbox', c=>`يتبقى ${dur(dueAt(c)-nowS())}`)
    + block('🔵 بانتظار إبلاغ ولي الأمر', wait, 'note', c=>`حُلّت منذ ${dur(nowS()-c.resolved_at)}`)
    || '<div class="okbox">✅ لا توجد شكاوى تحتاج تذكيراً أو تصعيداً في هذا النطاق.</div>';
}
function sendReminder(id){ go2(async()=>{ await api('act',{json:{id, act:'remind'}}); toast('أُرسل التذكير للمختص'); renderAll(); }); }
function runEngine(){ go2(async()=>{ const d = await api('engine'); toast(`تم التشغيل: ${d.r.reminders||0} تذكير و ${d.r.escalations||0} تصعيد`); renderAll(); }); }

/* ================= خريطة المسار ================= */
async function renderMap(){
  const d = await api('stats', {query:{branch:SCOPE}});
  const R = d.rows;
  const nodes = [
    ['new','استلام الشكوى','موظف خدمة العملاء'],
    ['assigned','الإسناد للمختص','آلي حسب النوع والفرع'],
    ['progress','المعالجة','المختص'],
    ['resolved','تسجيل الحل','المختص → إشعار خدمة العملاء'],
    ['notified','إبلاغ ولي الأمر','خدمة العملاء / واتساب'],
    ['closed','الإغلاق + الاستبيان','النظام'],
  ];
  $('flowMap').innerHTML = nodes.map((n,i)=>`
    ${i?'<div class="arrow">◀</div>':''}
    <div class="node" style="border-color:${i===0?'var(--s1)':'var(--grid)'}">
      <b>${i+1}. ${n[1]}</b><div class="cnt">${R.filter(c=>c.status===n[0]).length}</div>
      <div class="who">${n[2]}</div></div>`).join('');
}
function renderSlaTable(){
  $('slaTable').innerHTML =
   `<thead><tr><th>الأولوية</th><th>متى تُستخدم</th><th>الاستجابة (ساعة)</th><th>الحل (ساعة)</th><th>التذكير (ساعة)</th><th>التصعيد</th></tr></thead><tbody>` +
   PRIORITIES.map(p=>{ const s=(SET.sla||{})[p]||{};
     return `<tr><td><b class="pri pri-${p}">${p}</b></td><td class="hint">${esc(s.desc||'')}</td>
     <td><input type="number" min="1" id="sla-${p}-r" value="${s.response||''}" style="width:90px" ${isAdmin()?'':'disabled'}></td>
     <td><input type="number" min="1" id="sla-${p}-x" value="${s.resolve||''}" style="width:90px" ${isAdmin()?'':'disabled'}></td>
     <td><input type="number" min="1" id="sla-${p}-m" value="${s.remind||''}" style="width:90px" ${isAdmin()?'':'disabled'}></td>
     <td class="hint">مدير الفرع عند التجاوز · الإدارة العامة عند 1.5×</td></tr>`;}).join('') + '</tbody>';
}
function saveSla(){
  if(!isAdmin()) return toast('تعديل المدد متاح لمدير النظام فقط', true);
  const sla = {};
  PRIORITIES.forEach(p=>{ const o=(SET.sla||{})[p]||{};
    sla[p] = {response:+$(`sla-${p}-r`).value||o.response, resolve:+$(`sla-${p}-x`).value||o.resolve,
              remind:+$(`sla-${p}-m`).value||o.remind, desc:o.desc||''}; });
  go2(async()=>{ await api('settings_save',{json:{sla}}); SET.sla=sla; toast('حُفظت المدد وطُبّقت على احتساب التأخير'); renderAll(); });
}
function renderRoute(){
  const types = Object.keys(SET.types||{});
  $('routeTable').innerHTML =
    `<thead><tr><th>الفرع</th>${types.map(t=>`<th>${esc(t)}<div class="hint">${DEPT_NAME[SET.types[t].dept]}</div></th>`).join('')}<th>التصعيد الأول</th></tr></thead><tbody>` +
    BRANCHES.map(b=>{
      const spec = d => (USERS.find(u=>u.role==='spec' && +u.branch_id===+b.id && u.dept===d && u.active)||{}).name || '<span class="hint">لم يُعيَّن</span>';
      const mgr  = (USERS.find(u=>u.role==='manager' && +u.branch_id===+b.id && u.active)||{}).name || '<span class="hint">لم يُعيَّن</span>';
      return `<tr><td><b>${esc(b.name)}</b></td>${types.map(t=>`<td>${spec(SET.types[t].dept)}</td>`).join('')}<td>${mgr}</td></tr>`;
    }).join('') + '</tbody>';
}

/* ================= قاعدة المعرفة ================= */
let KB = [];
async function renderKB(){
  if(!KB.length){ const d = await api('kb'); KB = d.rows; }
  const q = ($('kbq').value||'').trim();
  const L = KB.filter(k=>!q || (k.title+k.solution+k.ctype+(k.csub||'')).includes(q));
  $('kbList').innerHTML = L.map(k=>`
    <div class="card" style="margin-bottom:10px;background:#fafbfc">
      <div class="row" style="justify-content:space-between"><b>${esc(k.title)}</b>
      <span><span class="pill-sm">${esc(k.ctype||'')}</span> <span class="pill-sm">${esc(k.csub||'')}</span></span></div>
      <div style="font-size:13.5px;margin-top:7px">${esc(k.solution)}</div>
      ${k.ref?`<div class="hint">مصدرها الشكوى ${esc(k.ref)}</div>`:''}</div>`).join('')
    || '<div class="empty">لا توجد حلول مطابقة</div>';
}

/* ================= شكوى جديدة ================= */
function autoPriority(){
  const t = $('f-type').value, T = (SET.types||{})[t];
  if(!T) return;
  $('f-sub').innerHTML = T.subs.map(s=>opt(s)).join('');
  const bid = +$('f-branch').value;
  const cs = USERS.filter(u=>u.role==='cs' && u.active && (u.scope==='all' || +u.branch_id===bid));
  const rv = $('f-receiver');
  rv.innerHTML = (cs.length?cs:[{id:ME.id,name:ME.name,title:''}])
      .map(u=>`<option value="${u.id}" ${+u.id===+ME.id?'selected':''}>${esc(u.name)}${u.title?' — '+esc(u.title):''}</option>`).join('');
  const isAll = (branchById(bid).code === 'ALL');
  const specs = USERS.filter(u=>u.role==='spec' && u.active && (isAll || +u.branch_id===bid));
  const sug = specs.find(u=>u.dept===T.dept);
  $('f-assignee').innerHTML = specs.length
    ? specs.map(u=>`<option value="${u.id}" ${sug&&u.id===sug.id?'selected':''}>${esc(u.name)} — ${esc(u.title||'')}</option>`).join('')
    : '<option value="">لا يوجد مختص مسجّل لهذا الفرع</option>';
  showSla();
}
function showSla(){
  const s = (SET.sla||{})[$('f-pri').value] || {};
  $('slaHint').innerHTML = `⏱️ الاستجابة <b>${s.response}</b> ساعة · الحل <b>${s.resolve}</b> ساعة (${(s.resolve/24).toFixed(1)} يوم) · تذكير كل <b>${s.remind}</b> ساعة`;
}
function pickFiles(files){ [...files].forEach(f=>PENDING.push(f)); renderAtt(); }
function dropFiles(e, el){ e.preventDefault(); el.style.borderColor='var(--line)'; pickFiles(e.dataTransfer.files); }
function renderAtt(){
  $('f-attList').innerHTML = PENDING.map((f,i)=>{
    const u = URL.createObjectURL(f);
    const body = f.type.startsWith('image') ? `<img src="${u}">`
              : f.type.startsWith('audio') ? `<audio controls src="${u}"></audio>`
              : `<div style="padding:22px;text-align:center;font-size:26px">📄</div>`;
    return `<div class="item">${body}<div class="nm">${esc(f.name)} <span class="pill-sm">${(f.size/1024).toFixed(0)} KB</span></div>
      <button class="btn danger sm" style="margin-top:6px;width:100%" onclick="PENDING.splice(${i},1);renderAtt()">إزالة</button></div>`;
  }).join('');
}
let REC=null, CHUNKS=[];
async function toggleRec(){
  const btn=$('recBtn'), hint=$('recHint');
  if(REC && REC.state==='recording'){ REC.stop(); btn.textContent='🎙️ تسجيل صوتي مباشر'; return; }
  try{
    const st = await navigator.mediaDevices.getUserMedia({audio:true});
    REC = new MediaRecorder(st); CHUNKS=[];
    REC.ondataavailable = e=>CHUNKS.push(e.data);
    REC.onstop = ()=>{ const b = new Blob(CHUNKS,{type:'audio/webm'});
      PENDING.push(new File([b], 'تسجيل_شكوى_'+Date.now()+'.webm', {type:'audio/webm'}));
      st.getTracks().forEach(t=>t.stop()); renderAtt(); hint.textContent='تم حفظ التسجيل ضمن المرفقات.'; };
    REC.start(); btn.textContent='⏹️ إيقاف التسجيل'; hint.textContent='جارٍ التسجيل...';
  }catch(e){ hint.textContent='تعذّر الوصول إلى الميكروفون — يمكن إرفاق ملف صوتي بدلاً من ذلك.'; }
}
function resetForm(){
  ['f-student','f-parent','f-phone','f-subject','f-text'].forEach(i=>$(i).value='');
  PENDING=[]; renderAtt(); autoPriority();
}
function submitComplaint(){
  go2(async()=>{
    const fd = new FormData();
    const g = i => $(i).value.trim();
    const req = {'اسم الطالب':g('f-student'),'اسم ولي الأمر':g('f-parent'),'جوال ولي الأمر':g('f-phone'),
                 'عنوان الشكوى':g('f-subject'),'نص الشكوى':g('f-text')};
    const miss = Object.keys(req).filter(k=>!req[k]);
    if(miss.length) return toast('الحقول التالية مطلوبة: '+miss.join('، '), true);
    fd.append('branch_id', $('f-branch').value);
    fd.append('student', g('f-student'));       fd.append('curriculum', $('f-curr').value);
    fd.append('grade', $('f-grade').value);     fd.append('parent_name', g('f-parent'));
    fd.append('phone', g('f-phone'));           fd.append('relation', $('f-rel').value);
    fd.append('channel', $('f-channel').value); fd.append('received_by', $('f-receiver').value);
    fd.append('ctype', $('f-type').value);      fd.append('csub', $('f-sub').value);
    fd.append('priority', $('f-pri').value);    fd.append('subject', g('f-subject'));
    fd.append('body', g('f-text'));             fd.append('assignee', $('f-assignee').value || '');
    PENDING.forEach(f=>fd.append('files[]', f));
    const d = await api('create', {form:fd});
    LAST_ASSIGN = d.assignee;
    resetForm();
    toast('سُجّلت الشكوى برقم ' + d.ref + (d.assignee? ' وأُسندت إلى ' + userName(d.assignee) + ' مع إشعاره' : ''));
    if(d.assignee){
      const u = userById(d.assignee);
      if(u && u.phone && confirm('هل تريد إشعار المختص ' + u.name + ' عبر واتساب أيضاً؟'))
        waStaff(u.phone, `🔔 شكوى جديدة أُسندت إليك\nالرقم المرجعي: ${d.ref}\nالموضوع: ${g('f-subject')}\nالأولوية: ${$('f-pri').value}`);
    }
    go('list'); setTimeout(()=>openC(d.id), 300);
  });
}
function waStaff(phone, text){ window.open('https://wa.me/'+waNum(phone)+'?text='+encodeURIComponent(text), '_blank'); }
function waNum(p){
  let d = String(p||'').replace(/\D/g,'');
  if(d.startsWith('00')) d=d.slice(2);
  if(d.startsWith('966')) return d;
  if(d.startsWith('0')) return '966'+d.slice(1);
  if(d.length===9) return '966'+d;
  return d;
}

/* ================= نافذة الشكوى ================= */
function closeModal(){ $('modalHost').innerHTML=''; }
function openC(id){
  go2(async()=>{
    const d = await api('complaint', {query:{id}});
    drawComplaint(d.c);
  });
}
function drawComplaint(c){
  const hist = k => (c.history.find(h=>h.action===k)||{}).at || null;
  const steps = [
    ['استلام الشكوى وتسجيلها', +c.created_at, 'بواسطة '+(c.receiver_name||'—')+' عبر '+(c.channel||'—')],
    ['الإسناد للمختص', hist('إسناد'), c.assignee_name ? c.assignee_name : 'لم تُسند بعد'],
    ['بدء المعالجة', c.first_response_at&&+c.first_response_at, c.first_response_at? 'زمن الاستجابة '+dur(c.first_response_at-c.created_at):'بانتظار مباشرة المختص'],
    ['تسجيل الحل', c.resolved_at&&+c.resolved_at, c.resolved_at? 'زمن الحل '+dur(c.resolved_at-c.created_at):'قيد المعالجة'],
    ['إبلاغ ولي الأمر بالحل', c.parent_notified_at&&+c.parent_notified_at, c.parent_notified_at? 'بواسطة '+(c.notifier_name||'—')+' عبر '+(c.notify_channel||'—'):'لم يُبلَّغ بعد'],
    ['الإغلاق وإتاحة الاستبيان', c.closed_at&&+c.closed_at, c.survey_overall? 'تقييم ولي الأمر '+c.survey_overall+'/5' : (c.closed_at?'بانتظار تعبئة الاستبيان':'لم تُغلق بعد')],
  ];
  const firstOpen = steps.findIndex(s=>!s[1]);
  const stepHtml = steps.map((s,i)=>`
    <div class="step ${s[1]?'done':(i===firstOpen?'current':'')}">
      <div class="dot">${s[1]?'✓':i+1}</div>
      <div><div class="t">${s[0]}</div><div class="m">${s[1]? fmt(s[1])+' — ':''}${esc(s[2])}</div></div></div>`).join('');

  const A = [];
  if(c.status==='new' && canAct('assign',c)) A.push(`<button class="btn" onclick="actAssign(${c.id})">📨 إسناد لمختص</button>`);
  if(c.status==='assigned' && canAct('start',c)) A.push(`<button class="btn" onclick="doAct(${c.id},'start')">▶️ بدء المعالجة</button>`);
  if(['assigned','progress','reopened'].includes(c.status) && canAct('resolve',c)) A.push(`<button class="btn ok" onclick="doAct(${c.id},'resolve')">✅ تسجيل الحل</button>`);
  if(c.status==='resolved' && canAct('notify',c)) A.push(`<button class="btn" onclick="doAct(${c.id},'notify')">📞 إبلاغ ولي الأمر</button>`);
  if(['resolved','notified','closed'].includes(c.status)) A.push(`<button class="btn" style="background:#128C7E" onclick="waParent(${c.id})">💬 واتساب لولي الأمر</button>`);
  if(c.status==='notified' && canAct('close',c)) A.push(`<button class="btn ok" onclick="doAct(${c.id},'close')">🔒 إغلاق الشكوى</button>`);
  if(['notified','closed'].includes(c.status) && canAct('reopen',c)) A.push(`<button class="btn danger" onclick="doAct(${c.id},'reopen')">🔁 إعادة الفتح</button>`);
  if(c.assignee && OPEN_STATES.includes(c.status)){
    const u = userById(c.assignee);
    if(u && u.phone) A.push(`<button class="btn ghost" onclick="waStaff('${u.phone}','بخصوص الشكوى ${c.ref}')">💬 واتساب للمختص</button>`);
  }
  if(canAct('assign',c) && c.status!=='new') A.push(`<button class="btn ghost" onclick="actAssign(${c.id})">🔀 إعادة الإسناد</button>`);
  A.push(`<button class="btn ghost" onclick="doAct(${c.id},'comment')">💬 ملاحظة</button>`);
  A.push(`<button class="btn ghost" onclick="sendReminder(${c.id})">🔔 تذكير المختص</button>`);
  if(canAct('edit',c))   A.push(`<button class="btn ghost" onclick="openEdit(${c.id})">✏️ تعديل البيانات</button>`);
  if(canAct('delete',c)) A.push(`<button class="btn danger" onclick="delC(${c.id})">🗑️ حذف</button>`);

  const att = (c.attachments||[]).map(a=>{
    const body = (a.mime||'').startsWith('image') ? `<img src="${esc(a.path)}" alt="">`
      : (a.mime||'').startsWith('audio') ? `<audio controls src="${esc(a.path)}"></audio>`
      : `<div style="padding:22px;text-align:center;font-size:26px">📄</div>`;
    return `<div class="item"><a href="${esc(a.path)}" target="_blank">${body}</a>
      <div class="nm">${esc(a.name)} <span class="pill-sm">${(a.size/1024).toFixed(0)} KB</span></div></div>`;}).join('');

  $('modalHost').innerHTML = `
  <div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="mh"><h3>${esc(c.ref)} — ${esc(c.subject)}</h3>
      <span class="badge ${STATUS[c.status].cls}">${STATUS[c.status].icon} ${STATUS[c.status].label}</span>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="mb">
      ${+c.escalation? `<div class="critbox" style="margin-bottom:12px">🔺 <b>شكوى مصعّدة (المستوى ${c.escalation})</b> — تجاوزت المدة المعتمدة.</div>`:''}
      ${+c.reopened? `<div class="warnbox" style="margin-bottom:12px">🔁 أُعيد فتح هذه الشكوى ${c.reopened} مرة.</div>`:''}
      ${c.wa_sent_at? `<div class="okbox" style="margin-bottom:12px">💬 أُرسلت رسالة واتساب لولي الأمر على ${esc(c.phone)} — ${fmt(+c.wa_sent_at)}</div>`:''}
      <div class="grid g2">
        <div>
          <div class="kv">
            <div class="k">الطالب</div><div><b>${esc(c.student)}</b></div>
            <div class="k">الفرع</div><div>${esc(c.branch_name)}</div>
            <div class="k">المنهج / الصف</div><div>${esc(c.curriculum||'')} — ${esc(c.grade||'')}</div>
            <div class="k">ولي الأمر</div><div>${esc(c.parent_name)} (${esc(c.relation||'')}) · ${esc(c.phone)}</div>
            <div class="k">نوع الشكوى</div><div>${esc(c.ctype)} — ${esc(c.csub||'')}</div>
            <div class="k">الأولوية</div><div><span class="pri pri-${esc(c.priority)}">${esc(c.priority)}</span> · مدة الحل ${slaOf(c).resolve} ساعة</div>
            <div class="k">قناة الاستلام</div><div>${esc(c.channel||'')}</div>
            <div class="k">متلقي الشكوى</div><div>${esc(c.receiver_name||'—')}</div>
            <div class="k">المختص</div><div>${esc(c.assignee_name||'لم يُسند')}</div>
            <div class="k">تاريخ التسجيل</div><div>${fmt(+c.created_at)}</div>
            <div class="k">الموعد النهائي</div><div>${fmt(dueAt(c))} ${slaBadge(c)}</div>
          </div>
          <div class="note" style="margin-top:12px"><b>نص الشكوى:</b><br>${esc(c.body)}</div>
          ${att? `<div style="margin-top:12px"><b style="font-size:13.5px">المرفقات (${c.attachments.length}):</b><div class="att">${att}</div></div>`:''}
          ${c.resolution? `<div class="okbox" style="margin-top:12px"><b>الحل المسجّل:</b><br>${esc(c.resolution)}</div>`:''}
          ${c.survey_overall? `<div class="okbox" style="margin-top:12px"><b>استبيان رضا ولي الأمر:</b><br>
             سرعة الاستجابة ${'⭐'.repeat(c.survey_speed||0)} · جودة الحل ${'⭐'.repeat(c.survey_quality||0)} · التقييم العام <b>${c.survey_overall}/5</b>
             ${c.survey_comment? '<br>«'+esc(c.survey_comment)+'»':''}</div>`:''}
        </div>
        <div>
          <b style="font-size:13.5px">🗺️ مسار الشكوى</b>
          <div class="stepper" style="margin-top:8px">${stepHtml}</div>
          <b style="font-size:13.5px">📜 سجل التدقيق (${c.history.length})</b>
          <div class="log">${c.history.slice().reverse().map(h=>`
            <div class="e"><b>${esc(h.action)}</b> — ${esc(h.note||'')}
            <div class="w">${fmt(+h.at)} · ${esc(h.actor_name || h.actor_label || 'النظام')}</div></div>`).join('')}</div>
        </div>
      </div>
      <div class="row" style="margin-top:16px;border-top:1px solid var(--grid);padding-top:14px">${A.join('')}</div>
    </div>
  </div></div>`;
}
function doAct(id, act){
  go2(async()=>{
    let note='', extra={};
    if(act==='resolve'){
      note = prompt('اكتب ملخص الحل الذي تم اتخاذه:'); if(!note) return;
      extra.kb = confirm('هل تريد إضافة هذا الحل إلى قاعدة المعرفة للشكاوى المتكررة؟');
    }
    if(act==='notify'){
      extra.channel = prompt('قناة إبلاغ ولي الأمر (واتساب / اتصال هاتفي / رسالة نصية):','واتساب'); if(!extra.channel) return;
      note = prompt('ملاحظة عن ردّ ولي الأمر (اختياري):','') || '';
    }
    if(act==='reopen'){ note = prompt('سبب إعادة الفتح:'); if(!note) return; }
    if(act==='comment'){ note = prompt('الملاحظة:'); if(!note) return; }
    const d = await api('act', {json:{id, act, note, ...extra}});
    KB = [];
    const msgs = {start:'بدأت المعالجة', resolve:'سُجّل الحل وأُشعرت خدمة العملاء', notify:'سُجّل إبلاغ ولي الأمر',
                  close:'أُغلقت الشكوى وأُتيح استبيان الرضا لولي الأمر', reopen:'أُعيد فتح الشكوى ورُفعت أولويتها', comment:'أُضيفت الملاحظة'};
    toast(msgs[act] || 'تم');
    drawComplaint(d.c);
    if(act==='resolve' && confirm('هل تريد فتح واتساب الآن لإرسال الحل إلى ولي الأمر على الرقم '+d.c.phone+'؟')) waParent(id);
    if(act==='notify' && (extra.channel||'').includes('واتس')) waParent(id);
  });
}
function actAssign(id){
  go2(async()=>{
    const d = await api('complaint',{query:{id}});
    const c = d.c;
    const isAll = (branchById(c.branch_id).code === 'ALL');
    const cands = USERS.filter(u=>u.role==='spec' && u.active && (isAll || +u.branch_id===+c.branch_id));
    if(!cands.length) return toast('لا يوجد مختصون مسجّلون لهذا الفرع — أضفهم من تبويب الموظفين', true);
    const pick = prompt('اختر رقم المختص:\n'+cands.map((u,i)=>`${i+1}) ${u.name} — ${u.title||''}`).join('\n'), '1');
    const u = cands[(+pick||0)-1]; if(!u) return;
    const r = await api('act',{json:{id, act:'assign', to:u.id}});
    toast('أُسندت الشكوى إلى '+u.name+' وأُشعر داخل النظام');
    drawComplaint(r.c);
    if(u.phone && confirm('إشعار '+u.name+' عبر واتساب أيضاً؟'))
      waStaff(u.phone, `🔔 أُسندت إليك الشكوى ${c.ref}\nالفرع: ${c.branch_name}\nالموضوع: ${c.subject}`);
  });
}
function waParent(id){
  go2(async()=>{
    const d = await api('act', {json:{id, act:'wa_sent'}});
    window.open('https://wa.me/'+d.wa_phone+'?text='+encodeURIComponent(d.wa), '_blank');
    drawComplaint(d.c);
  });
}
function delC(id){
  const reason = prompt('تأكيد الحذف — اكتب سبب حذف الشكوى (إلزامي):');
  if(!reason) return;
  go2(async()=>{ await api('delete',{json:{id, reason}}); closeModal(); toast('حُذفت الشكوى وسُجّل ذلك في سجل العمليات'); renderAll(); });
}
function openEdit(id){
  go2(async()=>{
    const c = (await api('complaint',{query:{id}})).c;
    const sel = (v,o)=>o.map(x=>`<option value="${esc(x[0])}" ${String(x[0])===String(v)?'selected':''}>${esc(x[1])}</option>`).join('');
    const isAll = (branchById(c.branch_id).code === 'ALL');
    const specs = USERS.filter(u=>u.role==='spec' && u.active && (isAll || +u.branch_id===+c.branch_id));
    const cs    = USERS.filter(u=>u.role==='cs' && u.active);
    $('modalHost').innerHTML = `
    <div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:780px">
      <div class="mh"><h3>✏️ تعديل بيانات الشكوى ${esc(c.ref)}</h3><button class="x" onclick="closeModal()">✕</button></div>
      <div class="mb"><div class="grid g2">
        <label class="f"><span>اسم الطالب</span><input type="text" id="e-student" value="${esc(c.student)}"></label>
        <label class="f"><span>اسم ولي الأمر</span><input type="text" id="e-parent" value="${esc(c.parent_name)}"></label>
        <label class="f"><span>جوال ولي الأمر (رقم الواتساب)</span><input type="tel" id="e-phone" value="${esc(c.phone)}"></label>
        <label class="f"><span>الفرع</span><select id="e-branch">${sel(c.branch_id, BRANCHES.map(b=>[b.id,b.name]))}</select></label>
        <label class="f"><span>المنهج</span><select id="e-curr">${sel(c.curriculum, (SET.curricula||[]).map(x=>[x,x]))}</select></label>
        <label class="f"><span>الصف</span><select id="e-grade">${sel(c.grade, (SET.grades||[]).map(x=>[x,x]))}</select></label>
        <label class="f"><span>النوع</span><select id="e-type">${sel(c.ctype, Object.keys(SET.types||{}).map(x=>[x,x]))}</select></label>
        <label class="f"><span>الأولوية</span><select id="e-pri">${sel(c.priority, PRIORITIES.map(x=>[x,x]))}</select></label>
        <label class="f"><span>متلقي الشكوى</span><select id="e-recv">${sel(c.received_by, cs.map(u=>[u.id,u.name]))}</select></label>
        <label class="f"><span>المختص المسند إليه</span><select id="e-ass">${sel(c.assignee, specs.map(u=>[u.id,u.name+' — '+(u.title||'')]))}</select></label>
      </div>
      <label class="f"><span>عنوان الشكوى</span><input type="text" id="e-subject" value="${esc(c.subject)}"></label>
      <label class="f"><span>نص الشكوى</span><textarea id="e-body">${esc(c.body)}</textarea></label>
      <div class="warnbox">كل تعديل يُسجَّل في سجل التدقيق باسمك وتاريخه.</div>
      <div class="row" style="margin-top:14px">
        <button class="btn" onclick="saveEdit(${c.id})">💾 حفظ التعديلات</button>
        <button class="btn ghost" onclick="openC(${c.id})">إلغاء</button></div>
      </div></div></div>`;
  });
}
function saveEdit(id){
  go2(async()=>{
    const d = await api('update', {json:{
      id, student:$('e-student').value, parent_name:$('e-parent').value, phone:$('e-phone').value,
      branch_id:+$('e-branch').value, curriculum:$('e-curr').value, grade:$('e-grade').value,
      ctype:$('e-type').value, priority:$('e-pri').value, received_by:+$('e-recv').value,
      assignee:+$('e-ass').value||null, subject:$('e-subject').value, body:$('e-body').value }});
    toast(d.changed? 'حُفظت التعديلات وسُجّلت في سجل التدقيق' : 'لا توجد تغييرات');
    drawComplaint(d.c);
  });
}

/* ================= الإشعارات ================= */
async function updBell(){
  try{
    const d = await api('notifs');
    const el = $('notifDot');
    el.textContent = d.unread; el.classList.toggle('hidden', !d.unread);
    window._notifs = d.rows;
  }catch(e){}
}
function openNotifs(){
  go2(async()=>{
    const d = await api('notifs');
    $('modalHost').innerHTML = `
    <div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:560px">
      <div class="mh"><h3>🔔 إشعاراتي</h3><button class="x" onclick="closeModal()">✕</button></div>
      <div class="mb">${d.rows.length? d.rows.map(n=>`
        <div class="note" style="margin-bottom:8px;${+n.is_read?'opacity:.62':''}">${esc(n.body)}
          <div class="hint">${fmt(+n.at)}</div>
          ${n.complaint_id?`<button class="btn ghost sm" style="margin-top:6px" onclick="closeModal();openC(${n.complaint_id})">فتح الشكوى</button>`:''}
        </div>`).join('') : '<div class="empty">لا توجد إشعارات</div>'}</div></div></div>`;
    await api('notifs_read', {json:{}});
    updBell();
  });
}

/* ================= الموظفون ================= */
async function renderStaff(){
  const q  = ($('staffQ').value||'').trim();
  const br = $('staffBranch').value, rl = $('staffRole').value;
  const L = USERS.filter(u=>{
    if(br!=='*' && +u.branch_id!==+br && u.scope!=='all') return false;
    if(rl && u.role!==rl) return false;
    if(q && ![u.name,u.phone,u.email,u.title,u.username].join(' ').includes(q)) return false;
    return true;
  });
  const yes = v => +v? '<span class="badge sla-ok">✔</span>' : '<span class="badge b-closed">—</span>';
  $('staffTable').innerHTML =
    `<thead><tr><th>الموظف</th><th>اسم الدخول</th><th>الدور</th><th>نطاق الاطلاع</th><th>التواصل</th>
      <th>تعديل</th><th>حذف</th><th>موظفون</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>` +
    (L.map(u=>`<tr>
      <td><b>${esc(u.name)}</b>${+u.id===+ME.id?' <span class="pill-sm">أنت</span>':''}<div class="hint">${esc(u.title||'')}</div></td>
      <td class="hint">${esc(u.username)}</td>
      <td><span class="pill-sm">${ROLES[u.role].label}</span>${u.dept?`<div class="hint">${DEPT_NAME[u.dept]}</div>`:''}</td>
      <td>${u.scope==='all'? '<span class="badge b-assigned">🌐 جميع الفروع</span>' : esc(branchById(u.branch_id).name)}</td>
      <td class="hint">${esc(u.phone||'—')}<div>${esc(u.email||'')}</div></td>
      <td>${yes(u.p_edit)}</td><td>${yes(u.p_delete)}</td><td>${yes(u.p_users)}</td>
      <td>${+u.active? '<span class="badge sla-ok">نشط</span>':'<span class="badge b-reopened">موقوف</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn ghost sm" onclick="openStaffForm(${u.id})">✏️ تعديل</button>
        <button class="btn danger sm" onclick="delStaff(${u.id})">🗑️ حذف</button></td></tr>`).join('')
     || '<tr><td colspan="10" class="empty">لا يوجد موظفون مطابقون</td></tr>') + '</tbody>';
  const a = await api('audit');
  $('auditList').innerHTML = a.rows.length ? `<div class="log">${a.rows.map(r=>`
      <div class="e"><b>${esc(r.action)}</b> — ${esc(r.note||'')}
      <div class="w">${fmt(+r.at)} · ${esc(r.user_name||'—')}</div></div>`).join('')}</div>`
    : '<div class="empty">لا توجد عمليات مسجّلة</div>';
}
function openStaffForm(id){
  const u = id ? userById(id) : {role:'spec', branch_id:BRANCHES[0].id, scope:'branch', active:1};
  const sel=(v,o)=>o.map(x=>`<option value="${esc(x[0])}" ${String(x[0])===String(v)?'selected':''}>${esc(x[1])}</option>`).join('');
  $('modalHost').innerHTML = `
  <div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:700px">
    <div class="mh"><h3>${id?'✏️ تعديل بيانات '+esc(u.name):'➕ إضافة موظف جديد'}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="mb"><div class="grid g2">
      <label class="f"><span>الاسم الكامل <b class="req">*</b></span><input type="text" id="u-name" value="${esc(u.name||'')}"></label>
      <label class="f"><span>المسمى الوظيفي</span><input type="text" id="u-title" value="${esc(u.title||'')}" placeholder="مثال: وكيل الشؤون التعليمية"></label>
      <label class="f"><span>اسم المستخدم للدخول <b class="req">*</b></span><input type="text" id="u-username" value="${esc(u.username||'')}" autocomplete="off"></label>
      <label class="f"><span>${id?'كلمة مرور جديدة (اتركها فارغة لإبقائها)':'كلمة المرور <b class="req">*</b>'}</span><input type="password" id="u-pass" autocomplete="new-password"></label>
      <label class="f"><span>الدور <b class="req">*</b></span><select id="u-role" onchange="roleChanged()">${sel(u.role, Object.keys(ROLES).map(r=>[r,ROLES[r].label]))}</select>
        <div class="hint" id="u-roleDesc">${esc(ROLES[u.role].desc)}</div></label>
      <label class="f"><span>الفرع <b class="req">*</b></span><select id="u-branch">${sel(u.branch_id, BRANCHES.map(b=>[b.id,b.name]))}</select></label>
      <label class="f"><span>القسم (للمختصين)</span><select id="u-dept">${sel(u.dept||'', [['','— لا ينطبق —'],...Object.keys(DEPT_NAME).map(d=>[d,DEPT_NAME[d]])])}</select>
        <div class="hint">يحدّد نوع الشكاوى التي تُسند إليه آلياً.</div></label>
      <label class="f"><span>الجوال (للواتساب) <b class="req">*</b></span><input type="tel" id="u-phone" value="${esc(u.phone||'')}" placeholder="05xxxxxxxx"></label>
      <label class="f"><span>البريد الإلكتروني</span><input type="text" id="u-email" value="${esc(u.email||'')}"></label>
      <label class="f"><span>الحالة</span><select id="u-active">${sel(+u.active?1:0, [[1,'نشط'],[0,'موقوف']])}</select></label>
    </div>
    <div class="note"><b>نطاق الاطلاع والصلاحيات</b>
      <div class="row" style="margin-top:8px;gap:18px">
        <label class="row" style="gap:6px"><input type="checkbox" id="u-all" ${u.scope==='all'?'checked':''} style="width:auto"> 🌐 اطلاع على جميع الفروع</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="u-edit" ${+u.p_edit?'checked':''} style="width:auto"> ✏️ تعديل الشكاوى</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="u-del" ${+u.p_delete?'checked':''} style="width:auto"> 🗑️ حذف الشكاوى</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="u-users" ${+u.p_users?'checked':''} style="width:auto"> 👥 إدارة الموظفين</label>
      </div>
      <div class="hint" style="margin-top:6px">بدون «اطلاع على جميع الفروع» لن يرى الموظف إلا شكاوى فرعه فقط — ويُطبَّق ذلك على مستوى الخادم.</div></div>
    <div class="row" style="margin-top:16px">
      <button class="btn" onclick="saveStaff(${id||0})">💾 حفظ</button>
      <button class="btn ghost" onclick="closeModal()">إلغاء</button></div>
    </div></div></div>`;
}
function roleChanged(){
  const r = $('u-role').value;
  $('u-roleDesc').textContent = ROLES[r].desc;
  if(r==='admin'){ ['u-all','u-edit','u-del','u-users'].forEach(i=>$(i).checked=true); }
  if(r==='manager'){ $('u-edit').checked = true; }
}
function saveStaff(id){
  go2(async()=>{
    const d = await api('user_save', {json:{
      id: id||0, name:$('u-name').value, title:$('u-title').value, username:$('u-username').value,
      password:$('u-pass').value, role:$('u-role').value, branch_id:+$('u-branch').value,
      dept:$('u-dept').value, phone:$('u-phone').value, email:$('u-email').value,
      scope_all:$('u-all').checked, p_edit:$('u-edit').checked, p_delete:$('u-del').checked,
      p_users:$('u-users').checked, active:+$('u-active').value }});
    USERS = d.users; closeModal(); toast(id?'حُفظت التعديلات':'أُضيف الموظف وأصبح بإمكانه الدخول باسم المستخدم وكلمة المرور');
    renderStaff();
  });
}
function delStaff(id){
  const u = userById(id);
  if(!confirm(`تأكيد حذف الموظف «${u.name}»؟`)) return;
  go2(async()=>{ const d = await api('user_delete',{json:{id}}); USERS = d.users; toast('حُذف الموظف'); renderStaff(); });
}

/* ================= الإعدادات ================= */
async function renderSettings(){
  $('brTable').innerHTML = `<thead><tr><th>الفرع</th><th>الرمز</th><th>الشكاوى</th><th>الحالة</th></tr></thead><tbody>` +
    BRANCHES.map(b=>`<tr><td><b>${esc(b.name)}</b></td><td><span class="pill-sm">${esc(b.code)}</span></td>
      <td>${STATS.filter(c=>+c.branch_id===+b.id).length}</td>
      <td>${+b.active?'<span class="badge sla-ok">مفعّل</span>':'<span class="badge b-closed">موقوف</span>'}</td></tr>`).join('') + '</tbody>';
  $('logoBox').innerHTML = SET.logo ? `<img src="${esc(SET.logo)}?t=${Date.now()}" style="height:64px">` : '<span class="hint">الشعار الافتراضي مستخدم حالياً</span>';
  $('waTpl').value = SET.wa_template || '';
  $('schoolName').value = SET.school_name || '';
}
function addBranch(){
  const code = $('nbCode').value.trim(), name = $('nbName').value.trim();
  if(!code || !name) return toast('أدخل الرمز واسم الفرع', true);
  go2(async()=>{ const d = await api('branch_save',{json:{code,name}}); BRANCHES = d.branches;
    $('nbCode').value=''; $('nbName').value=''; initUI(); renderSettings(); toast('أُضيف الفرع'); });
}
function uploadLogo(){
  const f = $('logoFile').files[0];
  if(!f) return toast('اختر ملف الشعار أولاً', true);
  const fd = new FormData(); fd.append('logo', f);
  go2(async()=>{ const d = await api('logo_upload',{form:fd}); SET.logo = d.logo;
    toast('رُفع الشعار — سيظهر في الترويسة وصفحات الدخول والتتبع'); renderSettings();
    document.querySelectorAll('header.top .brand svg, header.top .brand img').forEach(el=>{
      const img = document.createElement('img'); img.className='logo-img'; img.src=d.logo+'?t='+Date.now(); el.replaceWith(img); });
  });
}
function saveSchool(){
  go2(async()=>{ await api('settings_save',{json:{school_name:$('schoolName').value}});
    SET.school_name = $('schoolName').value; toast('حُفظ اسم المدرسة'); });
}
function saveWaTpl(){
  go2(async()=>{ await api('settings_save',{json:{wa_template:$('waTpl').value}});
    SET.wa_template = $('waTpl').value; toast('حُفظ قالب رسالة الواتساب'); });
}
function changePw(){
  const a=$('pw0').value, b=$('pw1').value, c=$('pw2').value;
  if(b.length<8) return toast('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف', true);
  if(b!==c) return toast('كلمتا المرور غير متطابقتين', true);
  go2(async()=>{
    await api('change_pw', {json:{old:a, new:b}});
    $('pw0').value=$('pw1').value=$('pw2').value='';
    toast('تم تغيير كلمة المرور بنجاح');
  });
}

/* ================= بوابة ولي الأمر ================= */
function trackUrl(){ return (window.BASE||'') + '/track.php?ref=' + encodeURIComponent(($('trackRef').value||'').trim()); }
function openTrack(){ window.open(trackUrl(), '_blank'); }
function copyTrack(){
  navigator.clipboard.writeText(trackUrl()).then(()=>toast('نُسخ رابط التتبع'), ()=>toast('انسخ الرابط يدوياً: '+trackUrl()));
}

/* ================= التصدير ================= */
function dl(name, content){
  const b = new Blob(['﻿'+content], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
}
function csvRow(r){ return r.map(v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`).join(','); }
function exportCSV(kind){
  go2(async()=>{
    if(kind==='staff'){
      const head=['الاسم','اسم الدخول','الدور','المسمى','الفرع','نطاق الاطلاع','القسم','الجوال','البريد','تعديل','حذف','إدارة موظفين','الحالة'];
      const rows=USERS.map(u=>[u.name,u.username,ROLES[u.role].label,u.title||'',branchById(u.branch_id).name,
        u.scope==='all'?'جميع الفروع':'فرعه فقط', u.dept?DEPT_NAME[u.dept]:'', u.phone||'', u.email||'',
        +u.p_edit?'نعم':'لا', +u.p_delete?'نعم':'لا', +u.p_users?'نعم':'لا', +u.active?'نشط':'موقوف']);
      return dl('الموظفون.csv',[head,...rows].map(csvRow).join('\n'));
    }
    if(kind==='branches'){
      const head=['الفرع','الإجمالي','مفتوحة','متأخرة','متوسط زمن الحل (ساعة)','الالتزام %','متوسط الرضا'];
      const rows=BRANCHES.map(b=>{ const s=stats(STATS.filter(c=>+c.branch_id===+b.id));
        return [b.name,s.total,s.open,s.late,s.avg?(s.avg/3600).toFixed(1):'',s.slaPct??'',s.sat?s.sat.toFixed(2):'']; });
      return dl('أداء_الفروع.csv',[head,...rows].map(csvRow).join('\n'));
    }
    const d = await api('complaints', {query:{branch:SCOPE}});
    const head=['الرقم المرجعي','الفرع','الطالب','المنهج','الصف','ولي الأمر','الجوال','النوع','التصنيف','الأولوية','الحالة',
                'متلقي الشكوى','المختص','تاريخ التسجيل','الموعد النهائي','تاريخ الحل','زمن الحل (ساعة)','داخل المدة','التصعيد','التقييم','العنوان'];
    const rows=d.rows.map(c=>[c.ref,c.branch_name,c.student,c.curriculum,c.grade,c.parent_name,c.phone,c.ctype,c.csub,c.priority,
      STATUS[c.status].label,c.receiver_name||'',c.assignee_name||'',fmt(+c.created_at),fmt(dueAt(c)),fmt(+c.resolved_at||0),
      c.resolved_at?((c.resolved_at-c.created_at)/3600).toFixed(1):'',
      c.resolved_at?(c.resolved_at<=dueAt(c)?'نعم':'لا'):'', c.escalation||0, c.survey_overall||'', c.subject]);
    dl('الشكاوى.csv',[head,...rows].map(csvRow).join('\n'));
    toast('تم تنزيل الملف');
  });
}

/* ================= بدء ================= */
go2(boot);
