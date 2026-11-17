// «برامج الدعم» — remedial (تقوية) and enrichment (إثرائي) classes after
// school. A cycle (دورة) has its days (Monday and Thursday by default) and
// time (1:15–2:15), its branches and its pledge text. Academics nominate
// students; a coordinator approves (when the cycle asks for it) and sends the
// parent a consent link; a parent who declines is sent the pledge (تعهد) to
// sign. Consenting students go into groups (teacher, room, supervisor); each
// supervisor takes attendance on a PIN page. Everything shows in the student
// record (supportForStudent).
//   supportCycles/{id}                     the cycle
//   supportCycles/{id}/students/{nid}      one student's enrollment (status, consent, pledge, group, attendance counts)
//   supportCycles/{id}/groups/{gid}        a group: type, branch, grades, subject, teacher, room, capacity, supervisor
//   supportCycles/{id}/supervisors/{sid}   a supervisor: name, link token, PIN
//   supportCycles/{id}/sessions/{day_gid}  one class: the marks
//   supportLinks/{token}                   a parent's or supervisor's link → its cycle (wrong-ID / PIN lock)
// Read and written only here (firestore.rules deny these collections).

const TYPES = ["REMEDIAL", "ENRICHMENT"];
const STATUSES = ["NOMINATED", "REJECTED", "APPROVED", "PENDING_CONSENT", "CONSENTED", "DECLINED", "PLEDGE_SENT", "PLEDGE_SIGNED", "WITHDRAWN"];
const MARKS = ["P", "A", "L", "E"];
const TYPE_AR = { REMEDIAL: "التقوية", ENRICHMENT: "الإثرائية" };
const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const LOCK = { fails: 10, ms: 15 * 60e3 };
const DEFAULT_PLEDGE = "أقرّ أنا ولي أمر الطالب/ة {student} بأنني اطّلعت على ترشيح المدرسة لابني/ابنتي لحصص {program}، وأنني لا أرغب في التحاقه/ا بها، وأتحمّل مسؤولية ذلك وما قد يترتب عليه من أثر على مستواه/ا الدراسي، وأتعهد بمتابعة مستواه/ا الدراسي في المنزل والتواصل مع المدرسة عند الحاجة.";

module.exports = function supportModule(d) {
  const {
    db, Timestamp, FieldValue, HttpsError, onCall, onSchedule, crypto, str, callerHasBranch, callerAll, normalizeDigits, studentGrade, studentSection,
    branchResolver, taqnyatSend, waParam, toIntlNumber, PUBLIC_APP_URL, SCHOOL_NAME, WA_API_ENABLED, riyadhDay, notifyUsers,
  } = d;
  const out = {};
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const cycles = () => db.collection("supportCycles");
  const token = (n = 24) => Array.from(crypto.randomBytes(n), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const pin = () => String(crypto.randomInt(1000, 10000));
  const cleanId = (v) => normalizeDigits(v).replace(/\D/g, "");
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}:\d{2}$/;

  // --- who ------------------------------------------------------------------
  // The section: principals, upper management and the academic department by
  // default, or as given on the Users page (modules.support).
  const sees = (u) => u && u.active !== false && (u.role === "ADMIN" || u.isOwner === true || (u.modules?.support === false ? false
    : u.modules?.support === true || u.isPrincipal === true || u.role === "UPPER_MANAGEMENT" || u.department === "ACADEMIC"));
  // Running a cycle (approve, send, groups, supervisors): admins, all-branch
  // upper management, those given supportManage, and principals of its branches.
  const manages = (u, c) => u.role === "ADMIN" || u.isOwner === true || u.perms?.supportManage === true
    || (u.role === "UPPER_MANAGEMENT" && callerAll(u)) || (u.isPrincipal === true && (c.branches || []).some((b) => callerHasBranch(u, b)));
  async function caller(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!sees(u)) throw new HttpsError("permission-denied", "لا تملك صلاحية «برامج الدعم».");
    return { uid: request.auth.uid, ...u };
  }
  const seesCycle = (u, c) => callerAll(u) || manages(u, c) || c.createdBy === u.uid || !(c.branches || []).length || c.branches.some((b) => callerHasBranch(u, b));
  async function loadCycle(id, u, { manage = false } = {}) {
    if (typeof id !== "string" || !/^[A-Za-z0-9]{6,40}$/.test(id)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
    const ref = cycles().doc(id);
    const c = (await ref.get()).data();
    if (!c || !seesCycle(u, c)) throw new HttpsError("not-found", "الدورة غير موجودة.");
    if (manage && !manages(u, c)) throw new HttpsError("permission-denied", "إدارة الدورة لمنسق البرنامج أو مدير الفرع.");
    return { ref, c };
  }

  // --- the cycle's days ---------------------------------------------------
  function sessionDays(c) {
    const days = [];
    const holidays = new Set(c.holidays || []);
    const d0 = new Date(`${c.startDay}T12:00:00Z`);
    const end = new Date(`${c.endDay}T12:00:00Z`);
    for (let x = d0; x <= end && days.length < 400; x = new Date(x.getTime() + 86400e3)) {
      const iso = x.toISOString().slice(0, 10);
      if ((c.weekdays || [1, 4]).includes(x.getUTCDay()) && !holidays.has(iso)) days.push(iso);
    }
    return days;
  }
  const time12 = (t) => { const [h, m] = String(t || "").split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")}`; };
  // The times kept left-to-right inside Arabic text (U+2066 … U+2069).
const whenText = (c) => `${(c.weekdays || [1, 4]).map((w) => DAY_AR[w]).join(" و")} \u2066${time12(c.startTime)}–${time12(c.endTime)}\u2069`;
  const typeName = (t) => `حصص ${TYPE_AR[t] || ""}`;

  const cycleOut = (id, c, u) => ({
    id, title: c.title, startDay: c.startDay, endDay: c.endDay, weekdays: c.weekdays || [1, 4], startTime: c.startTime, endTime: c.endTime,
    branches: c.branches || [], holidays: c.holidays || [], requireApproval: c.requireApproval !== false, pledgeText: c.pledgeText || DEFAULT_PLEDGE,
    absentWa: c.absentWa !== false, status: c.status, counts: c.counts || {}, createdByName: c.createdByName || "", createdAt: ms(c.createdAt),
    sessions: sessionDays(c), canManage: u ? manages(u, c) : false,
  });

  function cleanCycle(dd, u) {
    const title = str(dd.title, 120);
    if (!title) throw new HttpsError("invalid-argument", "اكتب اسم الدورة.");
    if (!dayRe.test(dd.startDay || "") || !dayRe.test(dd.endDay || "") || dd.endDay < dd.startDay) throw new HttpsError("invalid-argument", "حدد تاريخ البداية والنهاية.");
    const weekdays = [...new Set((Array.isArray(dd.weekdays) ? dd.weekdays : [1, 4]).map(Number).filter((w) => w >= 0 && w <= 6))].sort();
    if (!weekdays.length) throw new HttpsError("invalid-argument", "اختر يوماً واحداً على الأقل.");
    const startTime = timeRe.test(dd.startTime || "") ? dd.startTime : "13:15";
    const endTime = timeRe.test(dd.endTime || "") && dd.endTime > startTime ? dd.endTime : "14:15";
    let branches = Array.isArray(dd.branches) ? [...new Set(dd.branches.filter((b) => typeof b === "string" && /^[A-Z0-9_]{2,40}$/.test(b)))] : [];
    if (!callerAll(u) && u.role !== "ADMIN") {
      if (branches.some((b) => !callerHasBranch(u, b))) throw new HttpsError("permission-denied", "اختر من فروعك فقط.");
      if (!branches.length) branches = [...new Set([...(u.branches || []), u.branch].filter(Boolean))];
    }
    return {
      title, startDay: dd.startDay, endDay: dd.endDay, weekdays, startTime, endTime, branches,
      holidays: [...new Set((Array.isArray(dd.holidays) ? dd.holidays : []).filter((x) => dayRe.test(x)))].sort().slice(0, 80),
      requireApproval: dd.requireApproval !== false, pledgeText: str(dd.pledgeText, 3000) || DEFAULT_PLEDGE, absentWa: dd.absentWa !== false,
    };
  }

  // --- WhatsApp: the «supportNotice» template (or the generic meeting one) --
  // {{1}} student, {{2}} the programme, {{3}} days and time, {{4}} the
  // message, {{5}} the link — and the "contact the branch" button.
  async function waSettings() {
    if (!WA_API_ENABLED) return null;
    const s = (await db.collection("settings").doc("whatsappApi").get()).data() || {};
    const name = (s.templates || {}).supportNotice || (s.templates || {}).meetingNotice;
    return s.enabled && name ? { ...s, supportTemplate: name } : null;
  }
  const parentLink = (e) => `${PUBLIC_APP_URL}/support/${e.token}`;
  async function sendWa(settings, cRef, c, e, line, link = parentLink(e)) {
    const to = toIntlNumber(e.phone);
    if (!to) throw new Error("لا يوجد رقم جوال لولي الأمر.");
    await taqnyatSend({
      to, type: "template",
      template: { name: settings.supportTemplate, language: { code: settings.language || "ar" } },
      components: [
        { type: "body", parameters: [e.name, `${typeName(e.type)} — ${c.title}`, whenText(c), line, link].map((v) => ({ type: "text", text: waParam(v) })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `BR-${e.branch || ""}${e.section ? `-${e.section}` : ""}` }] },
      ],
    }, { kind: "support", cycleId: cRef.id, studentId: e.studentId });
  }
  const subjectsText = (e) => ((e.subjects || []).length ? ` في ${e.subjects.join("، ")}` : "");
  const LINES = {
    consent: (c, e) => `رُشّح ابنكم/ابنتكم لـ${typeName(e.type)}${subjectsText(e)} بعد نهاية اليوم الدراسي. نرجو تأكيد موافقتكم أو عدمها من الرابط.`,
    remind: (c, e) => `نذكّركم بالرد على ترشيح ابنكم/ابنتكم لـ${typeName(e.type)} من الرابط.`,
    pledge: () => "نحترم قراركم، ونرجو الاطلاع على التعهد وتوقيعه من الرابط.",
    confirmed: (c, e, x) => `تم تأكيد التحاق ابنكم/ابنتكم${x.group ? ` — المجموعة: ${x.group}` : ""}${x.room ? `، القاعة: ${x.room}` : ""}${x.first ? `، وأول حصة ${x.first}` : ""}.`,
    absent: (c, e, x) => `تغيّب ابنكم/ابنتكم عن ${typeName(e.type)} اليوم ${x.day}. نرجو الحرص على الحضور، وللاستفسار يرجى التواصل مع الفرع.`,
  };
  // Many at once, a few in parallel; returns {sent, failed}. Writes the
  // result on each enrollment (wa.{event}).
  async function sendMany(settings, cRef, c, list, event, extraFor = () => ({})) {
    let sent = 0;
    let failed = 0;
    const queue = [...list];
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const eRef = cRef.collection("students").doc(e.studentId);
        try {
          await sendWa(settings, cRef, c, e, LINES[event](c, e, extraFor(e)));
          sent++;
          await eRef.update({ [`wa.${event}`]: Timestamp.now(), "wa.status": "sent", "wa.error": FieldValue.delete() });
        } catch (err) {
          failed++;
          await eRef.update({ "wa.status": "failed", "wa.error": String(err.message).slice(0, 300), "wa.at": Timestamp.now() }).catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { sent, failed };
  }

  async function refreshCounts(ref) {
    const snap = await ref.collection("students").get();
    const counts = { total: snap.size };
    snap.docs.forEach((x) => { const s = x.data().status; counts[s] = (counts[s] || 0) + 1; const t = x.data().type; counts[t] = (counts[t] || 0) + 1; });
    await ref.update({ counts, updatedAt: Timestamp.now() });
    return counts;
  }

  // --- cycles ----------------------------------------------------------------
  out.supportList = onCall(async (request) => {
    const u = await caller(request);
    const snap = await cycles().orderBy("createdAt", "desc").limit(100).get();
    return { cycles: snap.docs.filter((x) => seesCycle(u, x.data())).map((x) => cycleOut(x.id, x.data(), u)), canCreate: manages(u, { branches: [...(u.branches || []), u.branch].filter(Boolean) }) };
  });

  out.supportSaveCycle = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const data = cleanCycle(dd, u);
    if (dd.id) {
      const { ref } = await loadCycle(dd.id, u, { manage: true });
      await ref.update({ ...data, updatedAt: Timestamp.now(), updatedBy: u.uid });
      return { id: ref.id };
    }
    if (!manages(u, data)) throw new HttpsError("permission-denied", "إنشاء الدورات لمنسق البرنامج أو مدير الفرع.");
    const ref = cycles().doc();
    await ref.set({ ...data, status: "ACTIVE", counts: {}, createdBy: u.uid, createdByName: u.name || "", createdAt: Timestamp.now() });
    return { id: ref.id };
  });

  const enrollOut = (x, e, canManage) => ({
    id: x.id, studentId: e.studentId, name: e.name, branch: e.branch, grade: e.grade, className: e.className, section: e.section || "",
    type: e.type, subjects: e.subjects || [], reason: e.reason || "", status: e.status, nominatedByName: e.nominatedByName || "", nominatedAt: ms(e.nominatedAt),
    reviewNote: e.reviewNote || "", consent: e.consent ? { ...e.consent, at: ms(e.consent.at) } : null, decline: e.decline ? { ...e.decline, at: ms(e.decline.at) } : null,
    pledge: e.pledge ? { ...e.pledge, at: ms(e.pledge.at) } : null, groupId: e.groupId || "", att: e.att || {}, hasPhone: !!e.phone,
    wa: e.wa ? { status: e.wa.status || "", error: e.wa.error || "", consent: ms(e.wa.consent), remind: ms(e.wa.remind), pledge: ms(e.wa.pledge) } : null,
    sentAt: ms(e.sentAt), ...(canManage ? { link: e.token ? parentLink(e) : "", phone: e.phone || "" } : {}),
  });

  out.supportGet = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const { ref, c } = await loadCycle(request.data?.id, u);
    const canManage = manages(u, c);
    const [st, gr, sv] = await Promise.all([ref.collection("students").get(), ref.collection("groups").get(), canManage ? ref.collection("supervisors").get() : Promise.resolve({ docs: [] })]);
    const students = st.docs.filter((x) => callerAll(u) || canManage || callerHasBranch(u, x.data().branch) || x.data().nominatedBy === u.uid).map((x) => enrollOut(x, x.data(), canManage));
    return {
      cycle: cycleOut(ref.id, c, u),
      students,
      groups: gr.docs.map((x) => ({ id: x.id, ...x.data(), createdAt: ms(x.data().createdAt) })),
      supervisors: sv.docs.map((x) => ({ id: x.id, name: x.data().name, phone: x.data().phone || "", branch: x.data().branch || "", pin: x.data().pin, link: `${PUBLIC_APP_URL}/support-attend/${x.data().token}` })),
      hasWa: !!(await waSettings()),
    };
  });

  // --- nominating --------------------------------------------------------------
  out.supportNominate = onCall({ timeoutSeconds: 120 }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u);
    if (c.status !== "ACTIVE") throw new HttpsError("failed-precondition", "الدورة مغلقة.");
    const type = TYPES.includes(dd.type) ? dd.type : null;
    if (!type) throw new HttpsError("invalid-argument", "اختر نوع البرنامج.");
    const ids = [...new Set((Array.isArray(dd.studentIds) ? dd.studentIds : []).map(cleanId).filter((x) => /^\d{6,15}$/.test(x)))].slice(0, 2000);
    if (!ids.length) throw new HttpsError("invalid-argument", "اختر الطلاب.");
    const subjects = [...new Set((Array.isArray(dd.subjects) ? dd.subjects : []).map((s) => str(s, 60)).filter(Boolean))].slice(0, 12);
    const reason = str(dd.reason, 600);
    const branchOf = await branchResolver();
    const now = Timestamp.now();
    const result = { added: 0, already: 0, notFound: 0, outOfScope: 0 };
    const auto = c.requireApproval === false || manages(u, c);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const [stu, cur] = await Promise.all([db.getAll(...chunk.map((x) => db.collection("students").doc(x))), db.getAll(...chunk.map((x) => ref.collection("students").doc(x)))]);
      const batch = db.batch();
      chunk.forEach((sid, j) => {
        const s = stu[j].data();
        if (!s) { result.notFound++; return; }
        const branch = branchOf(s);
        if (((c.branches || []).length && !c.branches.includes(branch)) || !(callerAll(u) || manages(u, c) || callerHasBranch(u, branch))) { result.outOfScope++; return; }
        if (cur[j].exists && cur[j].data().status !== "WITHDRAWN" && cur[j].data().status !== "REJECTED") { result.already++; return; }
        const tk = token();
        batch.set(db.collection("supportLinks").doc(tk), { kind: "parent", cycleId: ref.id, studentId: sid, fails: 0 });
        batch.set(ref.collection("students").doc(sid), {
          studentId: sid, name: str(s.nameAr || s.name, 120), branch, grade: studentGrade(s), className: str(s.className, 20), section: studentSection(s) || "",
          phone: toIntlNumber(s.mobile) || "", type, subjects, reason, status: auto ? "APPROVED" : "NOMINATED",
          nominatedBy: u.uid, nominatedByName: u.name || "", nominatedAt: now, token: tk, att: {},
          ...(auto ? { reviewedBy: u.uid, reviewedByName: u.name || "", reviewedAt: now } : {}),
        });
        result.added++;
      });
      await batch.commit();
    }
    await refreshCounts(ref);
    return result;
  });

  // --- the coordinator's actions -----------------------------------------------
  out.supportAction = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const ids = [...new Set((Array.isArray(dd.studentIds) ? dd.studentIds : []).map(String))].slice(0, 2000);
    const snaps = [];
    for (let i = 0; i < ids.length; i += 300) snaps.push(...await db.getAll(...ids.slice(i, i + 300).map((x) => ref.collection("students").doc(x))));
    const list = snaps.filter((x) => x.exists).map((x) => ({ ref: x.ref, ...x.data() }));
    const now = Timestamp.now();
    const by = { by: u.uid, byName: u.name || "" };
    const write = async (rows, patch) => {
      for (let i = 0; i < rows.length; i += 400) {
        const batch = db.batch();
        rows.slice(i, i + 400).forEach((e) => batch.update(e.ref, typeof patch === "function" ? patch(e) : patch));
        await batch.commit();
      }
    };
    let res = { done: 0 };
    const a = dd.action;
    if (a === "approve" || a === "reject") {
      const rows = list.filter((e) => e.status === "NOMINATED" || (a === "approve" && e.status === "REJECTED"));
      await write(rows, { status: a === "approve" ? "APPROVED" : "REJECTED", reviewNote: str(dd.note, 300), reviewedBy: u.uid, reviewedByName: u.name || "", reviewedAt: now });
      res.done = rows.length;
    } else if (a === "send" || a === "remind") {
      const rows = list.filter((e) => (a === "send" ? ["APPROVED", "PENDING_CONSENT"].includes(e.status) : e.status === "PENDING_CONSENT"));
      await write(rows.filter((e) => e.status === "APPROVED"), { status: "PENDING_CONSENT", sentAt: now });
      const settings = await waSettings();
      res = { done: rows.length, ...(settings ? await sendMany(settings, ref, c, rows, a === "send" ? "consent" : "remind") : { sent: 0, failed: 0, noWa: true }) };
    } else if (a === "sendPledge") {
      const rows = list.filter((e) => ["DECLINED", "PLEDGE_SENT"].includes(e.status));
      await write(rows, { status: "PLEDGE_SENT", pledgeSentAt: now });
      const settings = await waSettings();
      res = { done: rows.length, ...(settings ? await sendMany(settings, ref, c, rows, "pledge") : { sent: 0, failed: 0, noWa: true }) };
    } else if (a === "recordAnswer") {
      // The parent's answer taken by phone (or in person).
      const answer = dd.answer === "YES" ? "YES" : dd.answer === "NO" ? "NO" : null;
      if (!answer || list.length !== 1) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const e = list[0];
      if (!["APPROVED", "PENDING_CONSENT", "DECLINED", "CONSENTED"].includes(e.status)) throw new HttpsError("failed-precondition", "حالة الطالب لا تسمح بتسجيل الرد.");
      await e.ref.update(answer === "YES"
        ? { status: "CONSENTED", consent: { name: str(dd.parentName, 80), relation: str(dd.relation, 30), via: "STAFF", note: str(dd.note, 300), at: now, ...by }, decline: FieldValue.delete() }
        : { status: "DECLINED", decline: { name: str(dd.parentName, 80), relation: str(dd.relation, 30), reason: str(dd.note, 300), via: "STAFF", at: now, ...by } });
      res.done = 1;
    } else if (a === "withdraw") {
      await write(list, { status: "WITHDRAWN", withdrawnAt: now, withdrawNote: str(dd.note, 300), groupId: "" });
      res.done = list.length;
    } else if (a === "restore") {
      const rows = list.filter((e) => e.status === "WITHDRAWN");
      await write(rows, { status: "APPROVED" });
      res.done = rows.length;
    } else if (a === "setGroup") {
      const gid = String(dd.groupId || "");
      let g = null;
      if (gid) {
        g = (await ref.collection("groups").doc(gid).get()).data();
        if (!g) throw new HttpsError("not-found", "المجموعة غير موجودة.");
      }
      const rows = list.filter((e) => e.status === "CONSENTED" && (!g || e.type === g.type));
      if (g && g.capacity) {
        const inGroup = (await ref.collection("students").where("groupId", "==", gid).get()).size;
        if (inGroup + rows.filter((e) => e.groupId !== gid).length > g.capacity) throw new HttpsError("failed-precondition", `المجموعة تتسع لـ ${g.capacity} طالباً فقط.`);
      }
      await write(rows, { groupId: gid });
      res.done = rows.length;
      if (g && dd.notify) {
        const settings = await waSettings();
        const first = sessionDays(c).find((x) => x >= riyadhDay() && (g.days || c.weekdays || [1, 4]).includes(new Date(`${x}T12:00:00Z`).getUTCDay())) || "";
        if (settings) Object.assign(res, await sendMany(settings, ref, c, rows, "confirmed", () => ({ group: g.name, room: g.room, first: first ? `${DAY_AR[new Date(`${first}T12:00:00Z`).getUTCDay()]} ${first}` : "" })));
      }
    } else if (a === "edit") {
      if (list.length !== 1) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const patch = {};
      if (TYPES.includes(dd.type)) patch.type = dd.type;
      if (Array.isArray(dd.subjects)) patch.subjects = [...new Set(dd.subjects.map((s) => str(s, 60)).filter(Boolean))].slice(0, 12);
      if (typeof dd.reason === "string") patch.reason = str(dd.reason, 600);
      await list[0].ref.update(patch);
      res.done = 1;
    } else if (a === "close" || a === "open") {
      await ref.update({ status: a === "close" ? "CLOSED" : "ACTIVE", updatedAt: now });
      return { ok: true };
    } else {
      throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    }
    await refreshCounts(ref);
    return res;
  });

  // --- groups and supervisors ----------------------------------------------------
  out.supportSaveGroup = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const g = dd.group || {};
    const data = {
      name: str(g.name, 80), type: TYPES.includes(g.type) ? g.type : "REMEDIAL", branch: str(g.branch, 40), subject: str(g.subject, 60),
      grades: Array.isArray(g.grades) ? g.grades.map((x) => str(x, 10)).filter(Boolean).slice(0, 20) : [],
      teacher: str(g.teacher, 80), room: str(g.room, 40), capacity: Math.max(0, Math.min(200, Math.floor(Number(g.capacity) || 0))),
      supervisorId: str(g.supervisorId, 40), updatedAt: Timestamp.now(),
    };
    if (!data.name) throw new HttpsError("invalid-argument", "اكتب اسم المجموعة.");
    if (data.branch && (c.branches || []).length && !c.branches.includes(data.branch)) throw new HttpsError("invalid-argument", "الفرع ليس ضمن الدورة.");
    if (g.id) {
      const gRef = ref.collection("groups").doc(String(g.id));
      if (!(await gRef.get()).exists) throw new HttpsError("not-found", "المجموعة غير موجودة.");
      await gRef.update(data);
      return { id: gRef.id };
    }
    const gRef = ref.collection("groups").doc();
    await gRef.set({ ...data, createdAt: Timestamp.now() });
    return { id: gRef.id };
  });
  out.supportDeleteGroup = onCall(async (request) => {
    const u = await caller(request);
    const { ref } = await loadCycle(request.data?.id, u, { manage: true });
    const gid = String(request.data?.groupId || "");
    const inside = await ref.collection("students").where("groupId", "==", gid).get();
    const batch = db.batch();
    inside.docs.forEach((x) => batch.update(x.ref, { groupId: "" }));
    batch.delete(ref.collection("groups").doc(gid));
    await batch.commit();
    return { ok: true, freed: inside.size };
  });
  out.supportSaveSupervisor = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref } = await loadCycle(dd.id, u, { manage: true });
    const name = str(dd.name, 80);
    if (!name) throw new HttpsError("invalid-argument", "اكتب اسم المشرف.");
    const data = { name, phone: str(dd.phone, 20), branch: str(dd.branch, 40), updatedAt: Timestamp.now() };
    if (dd.supervisorId) {
      const sRef = ref.collection("supervisors").doc(String(dd.supervisorId));
      const cur = (await sRef.get()).data();
      if (!cur) throw new HttpsError("not-found", "المشرف غير موجود.");
      await sRef.update({ ...data, ...(dd.newPin ? { pin: pin() } : {}) });
      return { id: sRef.id };
    }
    const sRef = ref.collection("supervisors").doc();
    const tk = token();
    await sRef.set({ ...data, token: tk, pin: pin(), createdAt: Timestamp.now() });
    await db.collection("supportLinks").doc(tk).set({ kind: "supervisor", cycleId: ref.id, supervisorId: sRef.id, fails: 0 });
    return { id: sRef.id };
  });
  out.supportDeleteSupervisor = onCall(async (request) => {
    const u = await caller(request);
    const { ref } = await loadCycle(request.data?.id, u, { manage: true });
    const sRef = ref.collection("supervisors").doc(String(request.data?.supervisorId || ""));
    const s = (await sRef.get()).data();
    if (s?.token) await db.collection("supportLinks").doc(s.token).delete();
    await sRef.delete();
    return { ok: true };
  });

  // --- attendance overview (staff) -------------------------------------------
  out.supportAttendance = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const { ref } = await loadCycle(request.data?.id, u);
    const snap = await ref.collection("sessions").get();
    return { sessions: snap.docs.map((x) => { const s = x.data(); return { id: x.id, day: s.day, groupId: s.groupId, marks: s.marks || {}, byName: s.byName || "", at: ms(s.at) }; }) };
  });

  // --- links (parent, supervisor) -------------------------------------------------
  // A link token → its record; a wrong ID / PIN counts, and too many lock the
  // link for a while.
  async function linkOf(tk, kind) {
    if (typeof tk !== "string" || !/^[a-z0-9]{16,40}$/.test(tk)) throw new HttpsError("not-found", "الرابط غير صحيح.");
    const lRef = db.collection("supportLinks").doc(tk);
    const l = (await lRef.get()).data();
    if (!l || l.kind !== kind) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (ms(l.lockedUntil) > Date.now()) throw new HttpsError("resource-exhausted", "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة.");
    return { lRef, l };
  }
  async function wrong(lRef, l, what) {
    const fails = (l.fails || 0) + 1;
    await lRef.update(fails >= LOCK.fails ? { fails: 0, lockedUntil: Timestamp.fromMillis(Date.now() + LOCK.ms) } : { fails });
    const left = LOCK.fails - fails;
    throw new HttpsError("permission-denied", fails >= LOCK.fails ? "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة." : `${what} غير صحيح. المحاولات المتبقية: ${left}.`);
  }

  // Parent link: /support/<token>. Before the student's ID: only the
  // programme's kind. With it: the details, the consent, and the pledge.
  async function parentEnrollment(request) {
    const dd = request.data || {};
    const { lRef, l } = await linkOf(dd.token, "parent");
    const cRef = cycles().doc(l.cycleId);
    const eRef = cRef.collection("students").doc(l.studentId);
    const [c, e] = await Promise.all([cRef.get().then((x) => x.data()), eRef.get().then((x) => x.data())]);
    if (!c || !e || e.token !== dd.token) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (cleanId(dd.nationalId) !== e.studentId) await wrong(lRef, l, "رقم هوية الطالب");
    if (l.fails) await lRef.update({ fails: 0 });
    return { cRef, c, eRef, e };
  }
  const parentView = (c, e, g) => ({
    student: e.name, type: e.type, subjects: e.subjects || [], cycle: c.title, when: whenText(c), from: c.startDay, to: c.endDay, status: e.status,
    pledgeText: (c.pledgeText || DEFAULT_PLEDGE).replace(/\{student\}/g, e.name).replace(/\{program\}/g, TYPE_AR[e.type] || ""),
    consent: e.consent ? { name: e.consent.name, at: ms(e.consent.at) } : null, pledge: e.pledge ? { name: e.pledge.name, at: ms(e.pledge.at) } : null,
    group: g ? { name: g.name, room: g.room, teacher: g.teacher } : null, school: SCHOOL_NAME,
  });
  out.supportParentPeek = onCall(async (request) => {
    const { l } = await linkOf(request.data?.token, "parent");
    const c = (await cycles().doc(l.cycleId).get()).data();
    const e = (await cycles().doc(l.cycleId).collection("students").doc(l.studentId).get()).data();
    if (!c || !e) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    return { type: e.type, cycle: c.title, school: SCHOOL_NAME };
  });
  out.supportParentGet = onCall(async (request) => {
    const { cRef, c, e } = await parentEnrollment(request);
    const g = e.groupId ? (await cRef.collection("groups").doc(e.groupId).get()).data() : null;
    return parentView(c, e, g);
  });
  out.supportParentRespond = onCall(async (request) => {
    const { cRef, c, eRef, e } = await parentEnrollment(request);
    const dd = request.data || {};
    if (c.status !== "ACTIVE") throw new HttpsError("failed-precondition", "انتهت هذه الدورة.");
    if (!["APPROVED", "PENDING_CONSENT", "CONSENTED", "DECLINED", "PLEDGE_SENT"].includes(e.status)) throw new HttpsError("failed-precondition", "لا يمكن تعديل الرد الآن، يرجى التواصل مع المدرسة.");
    const now = Timestamp.now();
    const who = { name: str(dd.parentName, 80), relation: str(dd.relation, 30) };
    if (!who.name) throw new HttpsError("invalid-argument", "اكتب اسم ولي الأمر.");
    if (dd.answer === "YES") {
      await eRef.update({ status: "CONSENTED", consent: { ...who, via: "LINK", at: now }, decline: FieldValue.delete() });
    } else if (dd.answer === "NO") {
      await eRef.update({ status: "DECLINED", decline: { ...who, reason: str(dd.reason, 500), via: "LINK", at: now } });
      if (e.nominatedBy) await notifyUsers([e.nominatedBy], { title: "عدم موافقة ولي أمر", body: `ولي أمر ${e.name} لم يوافق على ${typeName(e.type)} (${c.title}).`, complaintId: cRef.id, type: "SUPPORT_DECLINED" }).catch(() => {});
    } else {
      throw new HttpsError("invalid-argument", "اختر الرد.");
    }
    await refreshCounts(cRef);
    return parentView(c, (await eRef.get()).data(), null);
  });
  out.supportParentPledge = onCall(async (request) => {
    const { cRef, c, eRef, e } = await parentEnrollment(request);
    const dd = request.data || {};
    if (!["DECLINED", "PLEDGE_SENT", "PLEDGE_SIGNED"].includes(e.status)) throw new HttpsError("failed-precondition", "التعهد غير مطلوب.");
    const name = str(dd.parentName, 80);
    if (!name || dd.agree !== true) throw new HttpsError("invalid-argument", "اكتب الاسم وأقرّ بالتعهد.");
    const text = (c.pledgeText || DEFAULT_PLEDGE).replace(/\{student\}/g, e.name).replace(/\{program\}/g, TYPE_AR[e.type] || "");
    await eRef.update({ status: "PLEDGE_SIGNED", pledge: { name, relation: str(dd.relation, 30), text, at: Timestamp.now() } });
    await refreshCounts(cRef);
    return parentView(c, (await eRef.get()).data(), null);
  });

  // Supervisor page: /support-attend/<token> + PIN. Today's classes of the
  // supervisor's groups (or another class day of the cycle), and the marks.
  async function supervisorOf(request) {
    const dd = request.data || {};
    const { lRef, l } = await linkOf(dd.token, "supervisor");
    const cRef = cycles().doc(l.cycleId);
    const [c, s] = await Promise.all([cRef.get().then((x) => x.data()), cRef.collection("supervisors").doc(l.supervisorId).get().then((x) => x.data())]);
    if (!c || !s) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (String(dd.pin || "") !== String(s.pin)) await wrong(lRef, l, "الرمز");
    if (l.fails) await lRef.update({ fails: 0 });
    return { cRef, c, s, supervisorId: l.supervisorId };
  }
  async function supervisorState(cRef, c, s, supervisorId, day) {
    const days = sessionDays(c);
    const today = riyadhDay();
    const theDay = days.includes(day) ? day : (days.includes(today) ? today : days.filter((x) => x <= today).pop() || days[0] || today);
    const groups = (await cRef.collection("groups").where("supervisorId", "==", supervisorId).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
    const lists = await Promise.all(groups.map((g) => cRef.collection("students").where("groupId", "==", g.id).get()));
    const sessions = await db.getAll(...(groups.length ? groups.map((g) => cRef.collection("sessions").doc(`${theDay}_${g.id}`)) : [cRef.collection("sessions").doc("_")]));
    return {
      supervisor: s.name, cycle: c.title, when: whenText(c), day: theDay, today, days: days.filter((x) => x <= today).slice(-30), isClassDay: days.includes(today),
      // Marking opens on the class day itself (and a past class day, until it is closed).
      groups: groups.map((g, i) => ({
        id: g.id, name: g.name, type: g.type, subject: g.subject || "", room: g.room || "", teacher: g.teacher || "",
        students: lists[i].docs.map((x) => x.data()).filter((e) => e.status === "CONSENTED").map((e) => ({ id: e.studentId, name: e.name, grade: e.grade, className: e.className }))
          .sort((a, b) => a.name.localeCompare(b.name, "ar")),
        marks: sessions[i]?.exists ? sessions[i].data().marks || {} : {}, savedAt: sessions[i]?.exists ? ms(sessions[i].data().at) : 0,
      })),
    };
  }
  out.supportSupervisor = onCall(async (request) => {
    const { cRef, c, s, supervisorId } = await supervisorOf(request);
    return supervisorState(cRef, c, s, supervisorId, request.data?.day);
  });
  out.supportMark = onCall({ timeoutSeconds: 120 }, async (request) => {
    const { cRef, c, s, supervisorId } = await supervisorOf(request);
    const dd = request.data || {};
    const day = String(dd.day || "");
    const today = riyadhDay();
    if (!sessionDays(c).includes(day) || day > today) throw new HttpsError("failed-precondition", "ليس يوم حصة.");
    if (today > day && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) > 7 * 86400e3) throw new HttpsError("failed-precondition", "انتهت مدة تعديل حضور هذا اليوم، يرجى التواصل مع المنسق.");
    const gRef = cRef.collection("groups").doc(String(dd.groupId || ""));
    const g = (await gRef.get()).data();
    if (!g || g.supervisorId !== supervisorId) throw new HttpsError("permission-denied", "المجموعة ليست من مجموعاتك.");
    const members = (await cRef.collection("students").where("groupId", "==", gRef.id).get()).docs.map((x) => x.data()).filter((e) => e.status === "CONSENTED");
    const ids = new Set(members.map((e) => e.studentId));
    const marks = {};
    Object.entries(dd.marks || {}).forEach(([sid, m]) => {
      if (!ids.has(sid) || !MARKS.includes(m?.s)) return;
      marks[sid] = { s: m.s, note: str(m.note, 200) };
    });
    const sRef = cRef.collection("sessions").doc(`${day}_${gRef.id}`);
    const now = Timestamp.now();
    const newlyAbsent = [];
    await db.runTransaction(async (tx) => {
      const prev = (await tx.get(sRef)).data()?.marks || {};
      tx.set(sRef, { day, groupId: gRef.id, marks, by: supervisorId, byName: s.name, at: now }, { merge: false });
      // The enrollment's counters follow the change of each mark.
      members.forEach((e) => {
        const before = prev[e.studentId]?.s;
        const after = marks[e.studentId]?.s;
        if (before === after) return;
        const inc = {};
        if (before) inc[`att.${before}`] = FieldValue.increment(-1);
        if (after) inc[`att.${after}`] = FieldValue.increment(1);
        if (after === "A") inc["att.lastAbsent"] = day;
        tx.update(cRef.collection("students").doc(e.studentId), inc);
        if (after === "A" && before !== "A") newlyAbsent.push(e);
      });
    });
    // Absence: WhatsApp to the parent (when on for the cycle), today only.
    let notified = 0;
    if (newlyAbsent.length && c.absentWa !== false && day === today) {
      const settings = await waSettings();
      if (settings) notified = (await sendMany(settings, cRef, c, newlyAbsent, "absent", () => ({ day: `${DAY_AR[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${day}` }))).sent;
    }
    return { ok: true, saved: Object.keys(marks).length, notified, state: await supervisorState(cRef, c, s, supervisorId, day) };
  });

  // --- the student record ------------------------------------------------------
  out.supportForStudent = onCall(async (request) => {
    const u = await caller(request);
    const sid = cleanId(request.data?.studentId);
    if (!/^\d{6,15}$/.test(sid)) return { items: [] };
    const all = (await cycles().orderBy("createdAt", "desc").limit(100).get()).docs.filter((x) => seesCycle(u, x.data()));
    const found = await Promise.all(all.map((x) => x.ref.collection("students").doc(sid).get()));
    const items = [];
    for (let i = 0; i < all.length; i++) {
      if (!found[i].exists) continue;
      const e = found[i].data();
      if (!(callerAll(u) || manages(u, all[i].data()) || callerHasBranch(u, e.branch))) continue;
      const g = e.groupId ? (await all[i].ref.collection("groups").doc(e.groupId).get()).data() : null;
      items.push({ cycleId: all[i].id, cycle: all[i].data().title, ...enrollOut(found[i], e, false), group: g ? { name: g.name, teacher: g.teacher || "", room: g.room || "" } : null });
    }
    return { items };
  });

  // Morning reminder to parents who haven't answered in two days (once).
  out.supportReminders = onSchedule({ schedule: "0 10 * * 0-4", timeZone: "Asia/Riyadh" }, async () => {
    const settings = await waSettings();
    if (!settings) return;
    const active = await cycles().where("status", "==", "ACTIVE").get();
    for (const x of active.docs) {
      const c = x.data();
      const waiting = (await x.ref.collection("students").where("status", "==", "PENDING_CONSENT").get()).docs.map((y) => y.data())
        .filter((e) => ms(e.sentAt) && Date.now() - ms(e.sentAt) > 48 * 3600e3 && !e.wa?.remind);
      if (waiting.length) await sendMany(settings, x.ref, c, waiting, "remind");
    }
  });

  return out;
};

module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
