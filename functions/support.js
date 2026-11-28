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
//   supportCycles/{id}/lessons/{day_gid}   one class as its teacher wrote it: teacher, subject, topic, note, each student's rating
//   supportLinks/{token}                   a parent's, supervisor's, the teachers' (nominating) or the class teachers' link → its cycle (wrong-ID / PIN lock)
// Read and written only here (firestore.rules deny these collections).

const TYPES = ["REMEDIAL", "ENRICHMENT"];
// The curriculum (المنهج) a student is nominated under and a group is for —
// the roster's section (stage_name) unless chosen when nominating.
const CURRICULA = ["AMERICAN", "BRITISH"];
const CURRICULUM_AR = { AMERICAN: "أمريكي", BRITISH: "بريطاني" };
const curriculumOf = (v) => (CURRICULA.includes(v) ? v : "");
// An enrollment's curriculum: its own, or (older ones) the roster section.
const enrollCurriculum = (e) => curriculumOf(e.curriculum) || curriculumOf(e.section);
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
    loadActiveUsers, addSupportCallTasks,
  } = d;
  const out = {};
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const cycles = () => db.collection("supportCycles");
  const token = (n = 24) => Array.from(crypto.randomBytes(n), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const pin = () => String(crypto.randomInt(1000, 10000));
  const cleanId = (v) => normalizeDigits(v).replace(/\D/g, "");
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}:\d{2}$/;
  const addMin = (t, n) => { const [h, m] = String(t).split(":").map(Number); const x = Math.min(23 * 60 + 59, h * 60 + m + n); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  // Now in Riyadh as HH:MM.
  const riyadhTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  // Attendance closes (absence messages and calls go out) a quarter of an hour after the class, unless set.
  const closeTimeOf = (c) => (timeRe.test(c.closeTime || "") ? c.closeTime : addMin(c.endTime || "14:15", 15));
  const dayLabel = (day) => `${DAY_AR[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${day}`;

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
    absentWa: c.absentWa !== false, absentCall: c.absentCall !== false, noReplyCall: c.noReplyCall !== false, closeTime: closeTimeOf(c),
    absentAlertAt: Number.isInteger(c.absentAlertAt) ? c.absentAlertAt : 3, callAgents: c.callAgents || [], callCampaignId: c.callCampaign ? `support_${id}` : "", status: c.status, counts: c.counts || {}, createdByName: c.createdByName || "", createdAt: ms(c.createdAt),
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
      absentCall: dd.absentCall !== false, noReplyCall: dd.noReplyCall !== false,
      closeTime: timeRe.test(dd.closeTime || "") && dd.closeTime >= endTime ? dd.closeTime : addMin(endTime, 15),
      absentAlertAt: Math.max(0, Math.min(20, Math.floor(Number(dd.absentAlertAt ?? 3)) || 0)),
      callAgents: [...new Set((Array.isArray(dd.callAgents) ? dd.callAgents : []).filter((x) => typeof x === "string" && /^[A-Za-z0-9]{10,40}$/.test(x)))].slice(0, 30),
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
    pledgeRemind: () => "نذكّركم بتوقيع التعهد الخاص بعدم الالتحاق من الرابط.",
    confirmed: (c, e, x) => `تم تأكيد التحاق ابنكم/ابنتكم${x.group ? ` — المجموعة: ${x.group}` : ""}${x.room ? `، القاعة: ${x.room}` : ""}${x.first ? `، وأول حصة ${x.first}` : ""}.`,
    absent: (c, e, x) => `تغيّب ابنكم/ابنتكم عن ${typeName(e.type)} اليوم ${x.day}. نرجو الحرص على الحضور، وللاستفسار يرجى التواصل مع الفرع.`,
  };
  // Many at once, a few in parallel; returns {sent, failed}. Writes the
  // result on each enrollment (wa.{event}).
  async function sendMany(settings, cRef, c, list, event, extraFor = () => ({}), onEach = () => {}) {
    let sent = 0;
    let failed = 0;
    const queue = [...list];
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const eRef = cRef.collection("students").doc(e.studentId);
        try {
          await sendWa(settings, cRef, c, e, LINES[event](c, e, extraFor(e)));
          sent++;
          onEach(e, true);
          await eRef.update({ [`wa.${event}`]: Timestamp.now(), "wa.status": "sent", "wa.error": FieldValue.delete() });
        } catch (err) {
          failed++;
          onEach(e, false);
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
    id: x.id, studentId: e.studentId, name: e.name, branch: e.branch, grade: e.grade, className: e.className, section: e.section || "", curriculum: enrollCurriculum(e),
    type: e.type, subjects: e.subjects || [], reason: e.reason || "", round: e.round || 0, status: e.status, nominatedByName: e.nominatedByName || "", nominatedTeacher: e.nominatedTeacher || "", nominatedTeacherSubject: e.nominatedTeacherSubject || "", nominatedAt: ms(e.nominatedAt),
    reviewNote: e.reviewNote || "", consent: e.consent ? { ...e.consent, at: ms(e.consent.at) } : null, decline: e.decline ? { ...e.decline, at: ms(e.decline.at) } : null,
    pledge: e.pledge ? { ...e.pledge, at: ms(e.pledge.at) } : null, groupId: e.groupId || "", att: e.att || {}, hasPhone: !!e.phone,
    wa: e.wa ? { status: e.wa.status || "", error: e.wa.error || "", consent: ms(e.wa.consent), remind: ms(e.wa.remind), pledge: ms(e.wa.pledge) } : null,
    sentAt: ms(e.sentAt), pledgeSentAt: ms(e.pledgeSentAt), withdrawNote: e.withdrawNote || "",
    calls: (e.calls || []).map((x) => ({ id: x.id, kind: x.kind, day: x.day || "", at: ms(x.at) })), notes: e.notes || [],
    final: e.final ? { r: e.final.r, note: e.final.note || "", byName: e.final.byName || "", at: ms(e.final.at) } : null,
    absenceAlert: e.absenceAlert ? { level: e.absenceAlert.level || 0, count: e.absenceAlert.count || 0, at: ms(e.absenceAlert.at) } : null,
    ...(canManage ? { link: e.token ? parentLink(e) : "", phone: e.phone || "" } : {}),
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
      teacherLink: canManage ? teacherLinkOut(c) : null,
      classLink: canManage ? classLinkOut(c) : null,
    };
  });

  // --- nominating --------------------------------------------------------------
  const subjectsOf = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 12);
  // Still in a programme (not rejected / withdrawn / declined by the parent).
  const LIVE = ["NOMINATED", "APPROVED", "PENDING_CONSENT", "CONSENTED"];
  // Students already in another active cycle: id → { cycle, type }. A student
  // takes one programme at a time — within a cycle the enrollment is one
  // record, and across cycles this keeps them out of a second one.
  async function inOtherCycles(cycleId, ids) {
    const others = (await cycles().where("status", "==", "ACTIVE").get()).docs.filter((x) => x.id !== cycleId);
    const want = new Set(ids);
    const found = new Map();
    const lists = await Promise.all(others.map((o) => o.ref.collection("students").where("status", "in", LIVE).get()));
    lists.forEach((snap, i) => snap.docs.forEach((x) => { if (want.has(x.id) && !found.has(x.id)) found.set(x.id, { cycle: others[i].data().title || "", type: x.data().type }); }));
    return found;
  }
  // The shared part: `per` is id → { type?, subjects?, reason?, teacher? }
  // over `base` (the request's programme, subjects, reason); `by` says who,
  // `inScope(branch)` whether they may nominate from that branch.
  async function nominate(ref, c, per, base, by, inScope) {
    const ids = [...per.keys()].filter((x) => /^\d{6,15}$/.test(x)).slice(0, 2000);
    if (!ids.length) throw new HttpsError("invalid-argument", "اختر الطلاب.");
    if (!base.type && ids.some((x) => !per.get(x).type)) throw new HttpsError("invalid-argument", "اختر نوع البرنامج.");
    const [branchOf, elsewhere] = await Promise.all([branchResolver(), inOtherCycles(ref.id, ids)]);
    const now = Timestamp.now();
    const result = { added: 0, already: 0, retagged: 0, notFound: 0, outOfScope: 0, otherCycle: 0, notFoundIds: [], otherCycleList: [] };
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const [stu, cur] = await Promise.all([db.getAll(...chunk.map((x) => db.collection("students").doc(x))), db.getAll(...chunk.map((x) => ref.collection("students").doc(x)))]);
      const batch = db.batch();
      chunk.forEach((sid, j) => {
        const s = stu[j].data();
        if (!s) { result.notFound++; if (result.notFoundIds.length < 100) result.notFoundIds.push(sid); return; }
        const branch = branchOf(s);
        const row = per.get(sid);
        if (((c.branches || []).length && !c.branches.includes(branch)) || !inScope(branch)) { result.outOfScope++; return; }
        const round = row.round || base.round || 0;
        const curriculum = row.curriculum || base.curriculum || curriculumOf(studentSection(s));
        if (cur[j].exists && cur[j].data().status !== "WITHDRAWN" && cur[j].data().status !== "REJECTED") {
          result.already++;
          // Already here: a file that says which Cycle they're from tags them.
          if (round && (cur[j].data().round || 0) !== round) { batch.update(cur[j].ref, { round }); result.retagged++; }
          // …and a curriculum chosen for them is set on them.
          if ((row.curriculum || base.curriculum) && enrollCurriculum(cur[j].data()) !== curriculum) batch.update(cur[j].ref, { curriculum });
          return;
        }
        const other = elsewhere.get(sid);
        if (other) {
          result.otherCycle++;
          if (result.otherCycleList.length < 100) result.otherCycleList.push({ name: str(s.nameAr || s.name, 120), cycle: other.cycle, type: other.type });
          return;
        }
        const tk = token();
        batch.set(db.collection("supportLinks").doc(tk), { kind: "parent", cycleId: ref.id, studentId: sid, fails: 0 });
        batch.set(ref.collection("students").doc(sid), {
          studentId: sid, name: str(s.nameAr || s.name, 120), branch, grade: studentGrade(s), className: str(s.className, 20), section: studentSection(s) || "",
          phone: toIntlNumber(s.mobile) || "", type: row.type || base.type, subjects: row.subjects || base.subjects, reason: row.reason || base.reason, ...(round ? { round } : {}), ...(curriculum ? { curriculum } : {}),
          ...(row.teacher ? { nominatedTeacher: row.teacher } : {}), ...(by.teacherSubject ? { nominatedTeacherSubject: by.teacherSubject, nominatedTeacherStage: by.teacherStage } : {}), ...(by.via ? { nominatedVia: by.via } : {}), status: by.auto ? "APPROVED" : "NOMINATED",
          nominatedBy: by.uid || "", nominatedByName: by.name || "", nominatedAt: now, token: tk, att: {},
          ...(by.auto ? { reviewedBy: by.uid, reviewedByName: by.name || "", reviewedAt: now } : {}),
        });
        result.added++;
      });
      await batch.commit();
    }
    await refreshCounts(ref);
    return result;
  }
  // The Cycle (round) a student is from — Cycle 1 students carried over and
  // Cycle 2's new ones sit in the same groups; the tag only tells them apart.
  const roundOf = (v) => { const n = Math.floor(Number(v) || 0); return n >= 1 && n <= 9 ? n : 0; };
  // One row of the Excel form / the teachers' page → per-student overrides.
  const rowOf = (x) => {
    const rowSubjects = subjectsOf(x.subjects);
    return {
      ...(TYPES.includes(x.type) ? { type: x.type } : {}), ...(rowSubjects.length ? { subjects: rowSubjects } : {}), ...(roundOf(x.round) ? { round: roundOf(x.round) } : {}),
      ...(curriculumOf(x.curriculum) ? { curriculum: x.curriculum } : {}), ...(str(x.reason, 600) ? { reason: str(x.reason, 600) } : {}), teacher: str(x.teacher, 80),
    };
  };

  out.supportNominate = onCall({ timeoutSeconds: 120 }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u);
    if (c.status !== "ACTIVE") throw new HttpsError("failed-precondition", "الدورة مغلقة.");
    // One per student: the request's programme / subjects / reason, or — from
    // the teachers' Excel form — the row's own, with the teacher's name.
    const per = new Map();
    (Array.isArray(dd.studentIds) ? dd.studentIds : []).forEach((x) => per.set(cleanId(x), {}));
    (Array.isArray(dd.entries) ? dd.entries : []).slice(0, 2000).forEach((x) => { if (x && typeof x === "object") per.set(cleanId(x.studentId), rowOf(x)); });
    const base = { type: TYPES.includes(dd.type) ? dd.type : null, subjects: subjectsOf(dd.subjects), reason: str(dd.reason, 600), round: roundOf(dd.round), curriculum: curriculumOf(dd.curriculum) };
    const auto = c.requireApproval === false || manages(u, c);
    return nominate(ref, c, per, base, { uid: u.uid, name: u.name || "", auto }, (b) => callerAll(u) || manages(u, c) || callerHasBranch(u, b));
  });

  // --- the teachers' link -----------------------------------------------------------
  // /support-nominate/<token> + PIN, one per cycle: a teacher (no account —
  // teachers change) enters the PIN with their name, subject and stage, then
  // picks a class of that stage and nominates from it. Each teacher who
  // enters is listed for the coordinator (supportCycles/{id}/teachers). The
  // page never sees national IDs — each student goes by a key made from the
  // link's token.
  const teacherKey = (tk, sid) => crypto.createHmac("sha256", tk).update(sid).digest("base64url").slice(0, 16);
  const TEACHER_STAGES = ["KG", "PRIMARY", "MIDDLE", "SECONDARY"];
  // «G4» / «KG2» → its stage: KG, 1–6 primary, 7–9 middle, 10–12 secondary.
  const stageOfGrade = (g) => {
    const x = String(g || "");
    if (/^KG/i.test(x)) return "KG";
    const n = Number((x.match(/\d+/) || [])[0]);
    return !n ? "" : n <= 6 ? "PRIMARY" : n <= 9 ? "MIDDLE" : n <= 12 ? "SECONDARY" : "";
  };
  // A student without a known stage (e.g. SEN) is shown to every stage.
  const inStage = (stage, grade) => { const st = stageOfGrade(grade); return !st || st === stage; };
  const teacherLinkOut = (c) => (c.teacherLink?.token ? { link: `${PUBLIC_APP_URL}/support-nominate/${c.teacherLink.token}`, pin: c.teacherLink.pin, enabled: c.teacherLink.enabled !== false } : null);
  const teachersOut = async (ref) => (await ref.collection("teachers").get()).docs.map((x) => {
    const t = x.data();
    return { id: x.id, name: t.name, subject: t.subject || "", stage: t.stage || "", curriculum: t.curriculum || "", opens: t.opens || 0, nominated: t.nominated || 0, firstAt: ms(t.firstAt), lastAt: ms(t.lastAt) };
  }).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  out.supportTeacherLink = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const old = c.teacherLink || {};
    if (dd.action === "list") {
      return old.token ? { ...teacherLinkOut(c), teachers: await teachersOut(ref) } : null;
    }
    if (dd.action === "removeTeacher") {
      await ref.collection("teachers").doc(str(dd.teacherId, 40) || "-").delete();
    } else if (dd.action === "renew" || !old.token) {
      const tk = token();
      if (old.token) await db.collection("supportLinks").doc(old.token).delete().catch(() => {});
      await db.collection("supportLinks").doc(tk).set({ kind: "teacher", cycleId: ref.id, fails: 0 });
      await ref.update({ teacherLink: { token: tk, pin: pin(), enabled: true } });
    } else if (dd.action === "disable" || dd.action === "enable") {
      await ref.update({ "teacherLink.enabled": dd.action === "enable" });
    }
    return { ...teacherLinkOut((await ref.get()).data()), teachers: await teachersOut(ref) };
  });
  async function teacherOf(request) {
    const dd = request.data || {};
    const { lRef, l } = await linkOf(dd.token, "teacher");
    const cRef = cycles().doc(l.cycleId);
    const c = (await cRef.get()).data();
    if (!c || c.teacherLink?.token !== dd.token) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (String(dd.pin || "") !== String(c.teacherLink.pin)) await wrong(lRef, l, "الرمز");
    if (l.fails) await lRef.update({ fails: 0 });
    if (c.teacherLink.enabled === false) throw new HttpsError("failed-precondition", "أُوقف رابط الترشيح، يرجى التواصل مع منسق البرنامج.");
    if (c.status !== "ACTIVE") throw new HttpsError("failed-precondition", "انتهت هذه الدورة.");
    const t = dd.teacher && typeof dd.teacher === "object" ? dd.teacher : {};
    const teacher = { name: str(t.name, 80), subject: str(t.subject, 60), stage: TEACHER_STAGES.includes(t.stage) ? t.stage : "", curriculum: curriculumOf(t.curriculum) };
    if (!teacher.name) throw new HttpsError("invalid-argument", "اكتب اسم المعلم.");
    if (!teacher.subject) throw new HttpsError("invalid-argument", "اختر المادة التي تدرّسها.");
    if (!teacher.stage) throw new HttpsError("invalid-argument", "اختر المرحلة.");
    // One record per teacher (name + subject + stage, spaces ignored; the
    // curriculum is kept as last given).
    const tid = crypto.createHash("sha256").update(`${teacher.name}|${teacher.subject}|${teacher.stage}`.replace(/\s+/g, "")).digest("base64url").slice(0, 20);
    return { cRef, c, tk: dd.token, teacher, tRef: cRef.collection("teachers").doc(tid) };
  }
  // The cycle's branches' students (active) of the teacher's stage and
  // curriculum (a student with no American/British section — KG, SEN — is
  // shown to both), with whether each is already in this cycle or another
  // active one.
  const inCurriculum = (curriculum, s) => { const x = curriculumOf(studentSection(s)); return !curriculum || !x || x === curriculum; };
  async function teacherRoster(cRef, c, tk, stage, curriculum = "") {
    const [branchOf, snap, mine, brSnap] = await Promise.all([
      branchResolver(), db.collection("students").select("nameAr", "name", "branch", "branchName", "gradeName", "className", "stageName", "active").get(),
      cRef.collection("students").get(), db.collection("branches").get(),
    ]);
    const all = !(c.branches || []).length;
    const rows = snap.docs.filter((x) => x.data().active !== false).map((x) => ({ id: x.id, s: x.data(), branch: branchOf(x.data()) }))
      .filter((x) => /^\d{6,15}$/.test(x.id) && x.branch && (all || c.branches.includes(x.branch)) && inStage(stage, studentGrade(x.s)) && inCurriculum(curriculum, x.s));
    const here = new Map(mine.docs.filter((x) => !["WITHDRAWN", "REJECTED"].includes(x.data().status)).map((x) => [x.id, x.data().type]));
    const elsewhere = await inOtherCycles(cRef.id, rows.map((x) => x.id).filter((x) => !here.has(x)));
    const branchName = Object.fromEntries(brSnap.docs.map((x) => [x.id, x.data().name || x.id]));
    return {
      cycle: c.title, when: whenText(c), from: c.startDay, to: c.endDay, school: SCHOOL_NAME, needsApproval: c.requireApproval !== false,
      branches: [...new Set(rows.map((x) => x.branch))].map((b) => ({ id: b, name: branchName[b] || b })),
      students: rows.map((x) => {
        const other = elsewhere.get(x.id);
        return {
          k: teacherKey(tk, x.id), name: str(x.s.nameAr || x.s.name, 120), branch: x.branch, grade: studentGrade(x.s), className: str(x.s.className, 20),
          ...(here.has(x.id) ? { inThis: here.get(x.id) } : {}), ...(other ? { inOther: other.cycle } : {}),
        };
      }).sort((a, b) => a.name.localeCompare(b.name, "ar")),
    };
  }
  out.supportTeacherOpen = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const { cRef, c, tk, teacher, tRef } = await teacherOf(request);
    const now = Timestamp.now();
    const seen = await tRef.get();
    await tRef.set({ ...teacher, lastAt: now, opens: FieldValue.increment(1), ...(seen.exists ? {} : { firstAt: now, nominated: 0 }) }, { merge: true });
    return teacherRoster(cRef, c, tk, teacher.stage, teacher.curriculum);
  });
  out.supportTeacherNominate = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const { cRef, c, tk, teacher, tRef } = await teacherOf(request);
    const dd = request.data || {};
    const entries = (Array.isArray(dd.entries) ? dd.entries : []).slice(0, 100).filter((x) => x && typeof x === "object" && typeof x.k === "string");
    if (!entries.length) throw new HttpsError("invalid-argument", "اختر الطلاب.");
    if (entries.some((x) => !TYPES.includes(x.type))) throw new HttpsError("invalid-argument", "اختر البرنامج لكل طالب.");
    // Key → national ID, over the cycle's branches.
    const branchOf = await branchResolver();
    const snap = await db.collection("students").select("branch", "branchName", "gradeName", "active").get();
    const all = !(c.branches || []).length;
    const byKey = new Map();
    snap.docs.forEach((x) => {
      if (x.data().active !== false && (all || c.branches.includes(branchOf(x.data()))) && inStage(teacher.stage, studentGrade(x.data()))) byKey.set(teacherKey(tk, x.id), x.id);
    });
    const per = new Map();
    entries.forEach((x) => { const sid = byKey.get(x.k); if (sid) per.set(sid, rowOf({ ...x, teacher: teacher.name })); });
    // A row without a subject takes the teacher's own.
    const result = await nominate(cRef, c, per, { type: null, subjects: [teacher.subject], reason: "", curriculum: teacher.curriculum },
      { uid: "", name: `${teacher.name} (رابط المعلمين)`, auto: c.requireApproval === false, via: "TEACHER_LINK", teacherSubject: teacher.subject, teacherStage: teacher.stage }, () => true);
    if (result.added) await tRef.update({ nominated: FieldValue.increment(result.added), lastAt: Timestamp.now() }).catch(() => {});
    return { result, state: await teacherRoster(cRef, (await cRef.get()).data(), tk, teacher.stage, teacher.curriculum) };
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
    } else if (a === "consentMany") {
      // The parents' consent recorded by hand, for one student or many (the
      // school took it outside the link — a form, a meeting).
      const rows = list.filter((e) => ["APPROVED", "PENDING_CONSENT", "DECLINED", "PLEDGE_SENT"].includes(e.status));
      await write(rows, { status: "CONSENTED", consent: { name: "ولي الأمر (موافقة يدوية)", relation: "", via: "STAFF", note: str(dd.note, 300), at: now, ...by }, decline: FieldValue.delete() });
      res.done = rows.length;
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
      // A group for one curriculum takes only its students (and those with none).
      const fits = (e) => !g || (e.type === g.type && (!g.curriculum || !enrollCurriculum(e) || enrollCurriculum(e) === g.curriculum));
      const rows = list.filter((e) => e.status === "CONSENTED" && fits(e));
      res.otherCurriculum = list.filter((e) => e.status === "CONSENTED" && g && e.type === g.type && !fits(e)).length;
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
    } else if (a === "setCurriculum") {
      const curriculum = curriculumOf(dd.curriculum);
      await write(list, { curriculum: curriculum || FieldValue.delete() });
      res.done = list.length;
    } else if (a === "setRound") {
      const round = roundOf(dd.round);
      await write(list, { round: round || FieldValue.delete() });
      res.done = list.length;
    } else if (a === "edit") {
      if (list.length !== 1) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const patch = {};
      if (TYPES.includes(dd.type)) patch.type = dd.type;
      if (Array.isArray(dd.subjects)) patch.subjects = [...new Set(dd.subjects.map((s) => str(s, 60)).filter(Boolean))].slice(0, 12);
      if (typeof dd.reason === "string") patch.reason = str(dd.reason, 600);
      if (typeof dd.curriculum === "string") patch.curriculum = curriculumOf(dd.curriculum) || FieldValue.delete();
      await list[0].ref.update(patch);
      res.done = 1;
    } else if (a === "linkNote") {
      // A note («ملاحظة») opened on a student's case (repeated absence…).
      if (list.length !== 1) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const cd = (await db.collection("complaints").doc(String(dd.complaintDocId || "")).get()).data();
      if (!cd) throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
      await list[0].ref.update({ notes: FieldValue.arrayUnion({ id: String(dd.complaintDocId), no: cd.complaintId || "", at: Date.now(), byName: u.name || "" }) });
      return { done: 1 };
    } else if (a === "close" || a === "open") {
      await ref.update({ status: a === "close" ? "CLOSED" : "ACTIVE", updatedAt: now });
      return { ok: true };
    } else {
      throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    }
    await refreshCounts(ref);
    return res;
  });

  // The name typed back to delete an open cycle: spaces, dashes, diacritics,
  // Arabic letter forms and digits don't count (same as the page).
  const titleKey = (x) => String(x || "").normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\s\-\u2010-\u2015_.،,«»"'()]+/g, "").toLowerCase();
  // Deleting a cycle: its students, groups, supervisors and attendance, the
  // parent / supervisor / teachers' links (they then show «not found»), and
  // its calls still waiting (its call campaign is closed; calls made stay).
  // An active one needs its title typed back, so it isn't removed by mistake.
  out.supportDeleteCycle = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const { ref, c } = await loadCycle(request.data?.id, u, { manage: true });
    if (c.status !== "CLOSED" && titleKey(request.data?.confirmTitle) !== titleKey(c.title)) throw new HttpsError("failed-precondition", "اكتب اسم الدورة كما هو لتأكيد الحذف.");
    const campRef = db.collection("callCampaigns").doc(`support_${ref.id}`);
    const [camp, waitingCalls] = await Promise.all([campRef.get(), db.collection("callTasks").where("campaignId", "==", campRef.id).where("status", "==", "PENDING").get()]);
    for (let i = 0; i < waitingCalls.docs.length; i += 400) {
      const batch = db.batch();
      waitingCalls.docs.slice(i, i + 400).forEach((x) => batch.delete(x.ref));
      await batch.commit();
    }
    if (camp.exists) await campRef.update({ status: "CLOSED", closedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    const subs = await Promise.all(["students", "groups", "supervisors", "sessions", "teachers", "lessons"].map((n) => ref.collection(n).get()));
    const tokens = [...subs[0].docs, ...subs[2].docs].map((x) => x.data().token).concat(c.teacherLink?.token || [], c.classLink?.token || []).filter((tk) => typeof tk === "string" && tk);
    const refs = [...tokens.map((tk) => db.collection("supportLinks").doc(tk)), ...subs.flatMap((sn) => sn.docs.map((x) => x.ref))];
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await ref.delete();
    return { ok: true, students: subs[0].size, calls: waitingCalls.size };
  });

  // --- groups and supervisors ----------------------------------------------------
  out.supportSaveGroup = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const g = dd.group || {};
    const data = {
      name: str(g.name, 80), type: TYPES.includes(g.type) ? g.type : "REMEDIAL", branch: str(g.branch, 40), curriculum: curriculumOf(g.curriculum), subject: str(g.subject, 120),
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
  // Groups made by themselves: the consented students with no group, by
  // branch, programme, curriculum, stage and (first) subject (`curriculum`
  // takes only that curriculum's students; none = each apart). Matching groups that still
  // have room are filled first; the rest go into new groups of at most
  // `capacity` students (0 = one group each), split by grade then class.
  // `merges` joins chosen groups of the plan into one (each a list of the
  // plan's own names, as the unmerged preview gave them): same programme and
  // branch only, at most one of them an existing group.
  // `apply` false only returns the plan.
  const STAGE_AR = { KG: "رياض الأطفال", PRIMARY: "الابتدائي", MIDDLE: "المتوسط", SECONDARY: "الثانوي", "": "أخرى" };
  const ORD_AR = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
  // «G7» → «الصف السابع»; KG / SEN as they are.
  const gradeAr = (g) => { const m = /^G(\d{1,2})$/i.exec(String(g || "")); return m && ORD_AR[Number(m[1])] ? `الصف ${ORD_AR[Number(m[1])]}` : String(g || "") || "أخرى"; };
  const gradeSort = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });
  // A subject as typed («الرياضيات», «رياضيات», «Math») → one key; its
  // family also joins related ones (physics, chemistry, biology → science;
  // Quran → Islamic studies). Mirrored in src/utils/supportSubjects.js.
  const SUBJECT_KEYS = [
    ["حاسب", /حاسب|حاسوب|كمبيوتر|\bict\b|comput/], ["رياضيات", /رياض|math/], ["انجليزي", /انجليز|انكليز|english|phonics/], ["فرنسي", /فرنس|french/],
    ["عربي", /عربي|لغتي|نحو|املاء|arabic/], ["فيزياء", /فيزي|physic/], ["كيمياء", /كيمي|chemi/], ["احياء", /احيا|biolog/], ["علوم", /علوم|science/],
    ["قران", /قران|تجويد|quran/], ["اسلامي", /اسلامي|توحيد|فقه|حديث|تفسير|islam/], ["اجتماعيات", /اجتماع|social|تاريخ|جغراف/],
  ];
  const SUBJECT_FAMILY = { فيزياء: "علوم", كيمياء: "علوم", احياء: "علوم", قران: "اسلامي" };
  const subjectKey = (x) => {
    const t = String(x || "").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
    const hit = SUBJECT_KEYS.find(([, re]) => re.test(t));
    return hit ? hit[0] : t.split(/\s+/).map((w) => w.replace(/^ال/, "")).join("");
  };
  const subjectFamily = (x) => { const k = subjectKey(String(x || "").split("/")[0]); return SUBJECT_FAMILY[k] || k; };
  out.supportAutoGroups = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const onlyType = TYPES.includes(dd.type) ? dd.type : "";
    const onlyCurriculum = curriculumOf(dd.curriculum);
    const capacity = Math.max(0, Math.min(200, Math.floor(Number(dd.capacity) || 0)));
    const [st, gr, br] = await Promise.all([ref.collection("students").get(), ref.collection("groups").get(), db.collection("branches").get()]);
    const branchName = Object.fromEntries(br.docs.map((x) => [x.id, String(x.data().name || x.id).replace(/^فرع\s+/, "")]));
    const groups = gr.docs.map((x) => ({ id: x.id, ...x.data() }));
    const size = new Map();
    st.docs.forEach((x) => { const e = x.data(); if (e.groupId && e.status === "CONSENTED") size.set(e.groupId, (size.get(e.groupId) || 0) + 1); });
    const size0 = new Map(size);
    const todo = st.docs.map((x) => ({ id: x.id, ...x.data() })).filter((e) => e.status === "CONSENTED" && !e.groupId && (!onlyType || e.type === onlyType) && (!onlyCurriculum || enrollCurriculum(e) === onlyCurriculum));
    // By grade (the default — each grade apart with its subject) or by stage.
    const byGradeOnly = dd.by !== "stage";
    // Related subjects (the sciences…) together, or each subject apart.
    const related = dd.related === true;
    const subjKey = related ? subjectFamily : subjectKey;
    // Same branch, programme, curriculum, grade (or stage) and subject → one bucket.
    const buckets = new Map();
    todo.forEach((e) => {
      const subject = String((e.subjects || [])[0] || "").trim();
      const stage = stageOfGrade(e.grade);
      const grade = byGradeOnly ? String(e.grade || "") : "";
      const curriculum = enrollCurriculum(e);
      const key = [e.branch || "", e.type, curriculum, stage, grade, subjKey(subject)].join("|");
      if (!buckets.has(key)) buckets.set(key, { branch: e.branch || "", type: e.type, curriculum, stage, grade, subjects: new Map(), list: [] });
      const b = buckets.get(key);
      if (subject) b.subjects.set(subject, (b.subjects.get(subject) || 0) + 1);
      b.list.push(e);
    });
    const multiBranch = new Set(todo.map((e) => e.branch || "")).size > 1 || (c.branches || []).length > 1;
    // A group's curriculum: its own, or — an older group without one — its
    // members' when they all share it.
    const allEnrolled = st.docs.map((x) => x.data());
    const groupCurriculum = (g) => {
      if (g.curriculum) return g.curriculum;
      const set = new Set(allEnrolled.filter((e) => e.groupId === g.id && e.status === "CONSENTED").map(enrollCurriculum));
      return set.size === 1 ? [...set][0] : set.size ? "MIXED" : "";
    };
    const names = new Set(groups.map((g) => g.name));
    const byGrade = (a, b) => String(a.grade).localeCompare(String(b.grade), "en", { numeric: true }) || String(a.className).localeCompare(String(b.className), "en", { numeric: true }) || String(a.name).localeCompare(String(b.name), "ar");
    const plan = [];
    [...buckets.values()].sort((a, b) => a.type.localeCompare(b.type) || a.branch.localeCompare(b.branch) || a.curriculum.localeCompare(b.curriculum) || TEACHER_STAGES.indexOf(a.stage) - TEACHER_STAGES.indexOf(b.stage) || gradeSort(a.grade, b.grade)).forEach((b) => {
      // The most common spelling of each subject; related ones joined.
      const spelled = new Map();
      const ar = (x) => Number(/[\u0600-\u06FF]/.test(x));
      [...b.subjects.entries()].sort((x, y) => y[1] - x[1] || ar(y[0]) - ar(x[0])).forEach(([name]) => { if (!spelled.has(subjectKey(name))) spelled.set(subjectKey(name), name); });
      const subject = related ? [...spelled.values()].join(" / ") : [...spelled.values()][0] || "";
      const list = b.list.sort(byGrade);
      // Existing groups of the same kind with room.
      groups.filter((g) => g.type === b.type && (g.branch || "") === b.branch && subjKey(g.subject) === subjKey(subject) && [b.curriculum, ""].includes(groupCurriculum(g)) && (!g.curriculum || g.curriculum === b.curriculum)
        && (g.grades || []).length && g.grades.every((x) => (byGradeOnly ? x === b.grade : stageOfGrade(x) === b.stage))).forEach((g) => {
        const room = g.capacity ? g.capacity - (size.get(g.id) || 0) : Infinity;
        if (room <= 0 || !list.length) return;
        const take = list.splice(0, room === Infinity ? list.length : room);
        size.set(g.id, (size.get(g.id) || 0) + take.length);
        plan.push({ id: g.id, name: g.name, type: g.type, branch: b.branch, curriculum: b.curriculum, subject, stage: b.stage, students: take, existing: true });
      });
      if (!list.length) return;
      const parts = capacity ? Math.ceil(list.length / capacity) : 1;
      const per = Math.ceil(list.length / parts);
      const base = [`${b.type === "ENRICHMENT" ? "إثراء" : "تقوية"}${subject ? ` ${subject}` : ""}`, byGradeOnly ? gradeAr(b.grade) : STAGE_AR[b.stage], CURRICULUM_AR[b.curriculum] || "", multiBranch && b.branch ? branchName[b.branch] || b.branch : ""].filter(Boolean).join(" — ");
      for (let i = 0; i < parts; i++) {
        let name = parts > 1 ? `${base} (${i + 1})` : base;
        for (let n = 2; names.has(name); n++) name = `${base} (${parts > 1 ? `${i + 1}-` : ""}${n})`;
        names.add(name);
        plan.push({ name, type: b.type, branch: b.branch, curriculum: b.curriculum, subject, stage: b.stage, students: list.slice(i * per, (i + 1) * per), existing: false });
      }
    });
    plan.forEach((p) => { p.members = [p.name]; p.stages = [p.stage]; });
    const merges = (Array.isArray(dd.merges) ? dd.merges : []).slice(0, 100).filter(Array.isArray).map((m) => [...new Set(m.map((x) => String(x)))]).filter((m) => m.length > 1);
    merges.forEach((m) => {
      const parts = plan.filter((p) => p.members.some((x) => m.includes(x)));
      if (parts.length < 2) return;
      if (new Set(parts.map((p) => p.type)).size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من برنامجين مختلفين.");
      if (new Set(parts.map((p) => p.branch)).size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من فرعين مختلفين.");
      const curricula = new Set(parts.map((p) => p.curriculum).filter(Boolean));
      if (curricula.size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من منهجين مختلفين (أمريكي وبريطاني).");
      const old = parts.filter((p) => p.existing);
      if (old.length > 1) throw new HttpsError("invalid-argument", "لدمج مجموعتين قائمتين استخدم «دمج المجموعات» في صفحة البرنامج.");
      const subjects = [...new Map(parts.filter((p) => p.subject).map((p) => [subjectKey(p.subject), p.subject])).values()];
      const stages = TEACHER_STAGES.concat("").filter((x) => parts.some((p) => p.stages.includes(x)));
      let name = old[0]?.name;
      if (!name) {
        parts.forEach((p) => names.delete(p.name));
        const grades = [...new Set(parts.flatMap((p) => p.students.map((e) => String(e.grade || ""))))].sort(gradeSort);
        const where = byGradeOnly ? (grades.length > 1 && grades.every((x) => /^G\d+$/i.test(x)) ? `الصفوف ${grades.map((x) => ORD_AR[Number(x.slice(1))] || x).join(" و")}` : grades.map(gradeAr).join(" و")) : stages.map((x) => STAGE_AR[x]).join(" و");
        const base = [`${parts[0].type === "ENRICHMENT" ? "إثراء" : "تقوية"}${subjects.length ? ` ${subjects.join(" / ")}` : ""}`, where, CURRICULUM_AR[[...curricula][0]] || "",
          multiBranch && parts[0].branch ? branchName[parts[0].branch] || parts[0].branch : ""].filter(Boolean).join(" — ");
        name = base;
        for (let n = 2; names.has(name); n++) name = `${base} (${n})`;
        names.add(name);
      }
      const merged = {
        ...(old[0] ? { id: old[0].id } : {}), name, type: parts[0].type, branch: parts[0].branch, curriculum: [...curricula][0] || "", subject: subjects.join(" / "), stage: stages.length === 1 ? stages[0] : "",
        stages, members: parts.flatMap((p) => p.members), students: parts.flatMap((p) => p.students).sort(byGrade), existing: !!old[0], merged: true,
      };
      plan.splice(plan.indexOf(parts[0]), 1, merged);
      parts.slice(1).forEach((p) => plan.splice(plan.indexOf(p), 1));
    });
    const rows = plan.map((p) => ({
      name: p.name, type: p.type, branch: p.branch, curriculum: p.curriculum || "", subject: p.subject, stage: p.stage, stages: p.stages, members: p.members, merged: !!p.merged, existing: p.existing, count: p.students.length,
      grades: [...new Set(p.students.map((e) => e.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    }));
    if (!dd.apply) return { plan: rows, students: todo.length, by: byGradeOnly ? "grade" : "stage", curricula: Object.fromEntries(["AMERICAN", "BRITISH", ""].map((k) => [k || "NONE", todo.filter((e) => enrollCurriculum(e) === k).length])) };
    const now = Timestamp.now();
    const writes = [];
    plan.forEach((p, i) => {
      let gid = p.id;
      if (!gid) {
        const gRef = ref.collection("groups").doc();
        gid = gRef.id;
        writes.push((batch) => batch.set(gRef, {
          name: p.name, type: p.type, branch: p.branch, curriculum: p.curriculum || "", subject: p.subject, grades: rows[i].grades, teacher: "", room: "", capacity: capacity ? Math.max(capacity, p.students.length) : 0, supervisorId: "",
          auto: true, createdAt: now, updatedAt: now,
        }));
      } else if (p.merged) {
        // An existing group that took a merged part: its grades widen and its
        // capacity grows to hold them.
        const g = groups.find((x) => x.id === gid);
        const total = (size0.get(gid) || 0) + p.students.length;
        writes.push((batch) => batch.update(ref.collection("groups").doc(gid), {
          grades: [...new Set([...(g.grades || []), ...rows[i].grades])].sort((a, b) => a.localeCompare(b, "en", { numeric: true })), ...(!g.curriculum && p.curriculum ? { curriculum: p.curriculum } : {}),
          ...(g.capacity && total > g.capacity ? { capacity: Math.min(200, total) } : {}), updatedAt: now,
        }));
      }
      p.students.forEach((e) => writes.push((batch) => batch.update(ref.collection("students").doc(e.id), { groupId: gid })));
    });
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }
    return { plan: rows, students: todo.length, created: plan.filter((p) => !p.existing).length, placed: plan.reduce((n, p) => n + p.students.length, 0) };
  });
  // Merging chosen groups of one programme and branch into one: the first
  // (or `targetId`) keeps its id, teacher, room and supervisor (or takes the
  // first another has); the others' students move into it and they are
  // deleted. Their past attendance stays counted on each student.
  out.supportMergeGroups = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref } = await loadCycle(dd.id, u, { manage: true });
    const ids = [...new Set((Array.isArray(dd.groupIds) ? dd.groupIds : []).map(String))].filter((x) => /^[A-Za-z0-9]{6,40}$/.test(x)).slice(0, 20);
    if (ids.length < 2) throw new HttpsError("invalid-argument", "اختر مجموعتين على الأقل.");
    const snaps = await db.getAll(...ids.map((x) => ref.collection("groups").doc(x)));
    if (snaps.some((x) => !x.exists)) throw new HttpsError("not-found", "المجموعة غير موجودة.");
    const gs = snaps.map((x) => ({ id: x.id, ...x.data() }));
    if (new Set(gs.map((g) => g.type)).size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من برنامجين مختلفين.");
    if (new Set(gs.map((g) => g.branch || "")).size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من فرعين مختلفين.");
    const curricula = new Set(gs.map((g) => g.curriculum).filter(Boolean));
    if (curricula.size > 1) throw new HttpsError("invalid-argument", "لا يمكن دمج مجموعتين من منهجين مختلفين (أمريكي وبريطاني).");
    const target = gs.find((g) => g.id === dd.targetId) || gs[0];
    const others = gs.filter((g) => g !== target);
    const inside = await ref.collection("students").where("groupId", "in", ids).get();
    const count = inside.docs.filter((x) => x.data().status === "CONSENTED").length;
    const subjects = [...new Map(gs.filter((g) => g.subject).map((g) => [subjectKey(g.subject), g.subject])).values()];
    const pick = (k) => target[k] || others.find((g) => g[k])?.[k] || "";
    const caps = gs.map((g) => g.capacity || 0);
    const patch = {
      name: str(dd.name, 80) || target.name, subject: str(subjects.join(" / "), 120), curriculum: [...curricula][0] || "",
      grades: [...new Set(gs.flatMap((g) => g.grades || []))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })).slice(0, 20),
      teacher: pick("teacher"), room: pick("room"), supervisorId: pick("supervisorId"),
      capacity: caps.some((x) => !x) ? 0 : Math.min(200, Math.max(count, ...caps)),
      mergedFrom: FieldValue.arrayUnion(...others.map((g) => g.name)), updatedAt: Timestamp.now(),
    };
    const writes = [(batch) => batch.update(ref.collection("groups").doc(target.id), patch)];
    inside.docs.filter((x) => x.data().groupId !== target.id).forEach((x) => writes.push((batch) => batch.update(x.ref, { groupId: target.id })));
    others.forEach((g) => writes.push((batch) => batch.delete(ref.collection("groups").doc(g.id))));
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }
    return { id: target.id, name: patch.name, moved: writes.length - 1 - others.length, count };
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
    const { ref, c } = await loadCycle(request.data?.id, u);
    const [snap, calls, ls] = await Promise.all([ref.collection("sessions").get(), db.collection("callTasks").where("campaignId", "==", `support_${ref.id}`).get(), ref.collection("lessons").get()]);
    return {
      sessions: snap.docs.map((x) => {
        const s = x.data();
        return { id: x.id, day: s.day, groupId: s.groupId, marks: s.marks || {}, byName: s.byName || "", at: ms(s.at),
          notified: Object.fromEntries(Object.entries(s.notified || {}).map(([sid, n]) => [sid, { wa: n.wa || "", call: n.call || "", at: ms(n.at) }])) };
      }),
      calls: calls.docs.map((x) => callOut(x)),
      notTaken: c.notTaken || {},
      // What the class teachers wrote (the class teachers' link).
      lessons: ls.docs.map((x) => { const l = x.data(); return { id: x.id, day: l.day, groupId: l.groupId, subject: l.subject || "", topic: l.topic || "", note: l.note || "", ratings: l.ratings || {}, byName: l.byName || "", at: ms(l.at) }; }),
    };
  });
  // A «برامج الدعم» call, as the cycle and the student record show it.
  const callOut = (x) => {
    const k = x.data();
    const last = (k.history || []).slice(-1)[0];
    return {
      id: x.id, studentId: k.support?.studentId || k.studentId, kind: k.support?.kind || "", day: k.support?.day || "", status: k.status, result: k.result || "",
      outcome: k.outcome || "", note: k.note || "", attempts: k.attempts || 0, assignedName: k.assignedName || "", dueDay: k.dueDay || "",
      lastAt: ms(last?.at), lastBy: last?.byName || "", createdAt: ms(k.createdAt),
    };
  };

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
    await db.runTransaction(async (tx) => {
      const prevDoc = (await tx.get(sRef)).data() || {};
      const prev = prevDoc.marks || {};
      // The absences already notified stay so (a re-save doesn't message again).
      tx.set(sRef, { day, groupId: gRef.id, marks, by: supervisorId, byName: s.name, at: now, ...(prevDoc.notified ? { notified: prevDoc.notified } : {}) }, { merge: false });
      // The enrollment's counters follow the change of each mark.
      // ...and each class's mark is kept on the enrollment (the student record).
      members.forEach((e) => {
        const m = marks[e.studentId];
        const was = prev[e.studentId];
        const before = was?.s;
        const after = m?.s;
        const patch = {};
        if (before !== after) {
          if (before) patch[`att.${before}`] = FieldValue.increment(-1);
          if (after) patch[`att.${after}`] = FieldValue.increment(1);
          if (after === "A") patch["att.lastAbsent"] = day;
        }
        if (before !== after || (m?.note || "") !== (was?.note || "")) patch[`hist.${day}`] = m ? { s: m.s, note: m.note, g: gRef.id } : FieldValue.delete();
        if (Object.keys(patch).length) tx.update(cRef.collection("students").doc(e.studentId), patch);
      });
    });
    // Absence messages and calls go out once attendance closes (the sweep);
    // a class marked after that is handled now.
    let notified = 0;
    let pendingNotice = "";
    if (day === today && Object.values(marks).some((m) => m.s === "A")) {
      if (riyadhTime() >= closeTimeOf(c)) notified = (await processAbsences(cRef, c, day, [sRef.id])).sent;
      else if (c.absentWa !== false || c.absentCall !== false) pendingNotice = closeTimeOf(c);
    }
    return { ok: true, saved: Object.keys(marks).length, notified, pendingNotice, state: await supervisorState(cRef, c, s, supervisorId, day) };
  });

  // --- the class teachers' link ------------------------------------------------
  // /support-class/<token> + PIN, one per cycle, for whoever teaches a class
  // (the teacher of a group changes from class to class): the teacher enters
  // their name, then picks the class day, the group and the subject they
  // teach that day, writes what was taught and rates each student (excellent
  // / good / needs follow-up, with a note); and gives a group's students a
  // final evaluation (clear / partial / no improvement, with a
  // recommendation). No accounts, no national IDs on the page (students go
  // by teacherKey). Open while the cycle runs, and two weeks after its end.
  //   supportCycles/{id}/lessons/{day_gid}   one class: teacher, subject, topic, note, ratings
  //   enrollment.perf.{day}                  the student's rating that day
  //   enrollment.final                       the final evaluation
  const RATINGS = ["EXCELLENT", "GOOD", "WEAK"];
  const FINALS = ["CLEAR", "PARTIAL", "NONE"];
  const plusDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
  const classLinkOut = (c) => (c.classLink?.token ? { link: `${PUBLIC_APP_URL}/support-class/${c.classLink.token}`, pin: c.classLink.pin, enabled: c.classLink.enabled !== false } : null);
  const personName = (x) => str(x, 80).replace(/\s+/g, " ");
  // For the coordinator: who taught (from the classes written: groups,
  // subjects, classes, final evaluations, last entry) and each group's
  // classes written of those due.
  async function classTeachersOut(ref, c) {
    const [gr, ls, st] = await Promise.all([ref.collection("groups").get(), ref.collection("lessons").get(), ref.collection("students").where("status", "==", "CONSENTED").get()]);
    const groupName = Object.fromEntries(gr.docs.map((x) => [x.id, x.data().name || ""]));
    const due = sessionDays(c).filter((x) => x <= riyadhDay()).length;
    const lessons = ls.docs.map((x) => x.data());
    const kids = st.docs.map((x) => x.data());
    const by = new Map();
    const one = (name) => {
      const k = titleKey(name);
      if (!k) return null;
      if (!by.has(k)) by.set(k, { name: personName(name), lessons: 0, groups: new Set(), subjects: new Set(), finals: 0, lastAt: 0 });
      return by.get(k);
    };
    lessons.forEach((l) => {
      const t = one(l.byName);
      if (!t) return;
      t.lessons++;
      t.groups.add(groupName[l.groupId] || "—");
      if (l.subject) t.subjects.add(l.subject);
      t.lastAt = Math.max(t.lastAt, ms(l.at));
    });
    kids.forEach((e) => { const t = FINALS.includes(e.final?.r) ? one(e.final.byName) : null; if (t) { t.finals++; t.lastAt = Math.max(t.lastAt, ms(e.final.at)); } });
    const size = {};
    kids.forEach((e) => { if (e.groupId) size[e.groupId] = (size[e.groupId] || 0) + 1; });
    return {
      teachers: [...by.values()].map((t) => ({ ...t, groups: [...t.groups], subjects: [...t.subjects] })).sort((a, b) => b.lastAt - a.lastAt),
      groups: gr.docs.filter((x) => size[x.id]).map((x) => ({ name: x.data().name || "", written: lessons.filter((l) => l.groupId === x.id).length, due, students: size[x.id] }))
        .sort((a, b) => (b.due - b.written) - (a.due - a.written) || a.name.localeCompare(b.name, "ar")),
    };
  }
  out.supportClassLink = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const { ref, c } = await loadCycle(dd.id, u, { manage: true });
    const old = c.classLink || {};
    let cur = c;
    if (dd.action === "renew" || (dd.action === "create" && !old.token)) {
      const tk = token();
      if (old.token) await db.collection("supportLinks").doc(old.token).delete().catch(() => {});
      await db.collection("supportLinks").doc(tk).set({ kind: "class", cycleId: ref.id, fails: 0 });
      await ref.update({ classLink: { token: tk, pin: pin(), enabled: true } });
      cur = (await ref.get()).data();
    } else if ((dd.action === "disable" || dd.action === "enable") && old.token) {
      await ref.update({ "classLink.enabled": dd.action === "enable" });
      cur = (await ref.get()).data();
    }
    if (!cur.classLink?.token) return null;
    return { ...classLinkOut(cur), ...(await classTeachersOut(ref, cur)) };
  });
  async function classTeacherOf(request) {
    const dd = request.data || {};
    const { lRef, l } = await linkOf(dd.token, "class");
    const cRef = cycles().doc(l.cycleId);
    const c = (await cRef.get()).data();
    if (!c || c.classLink?.token !== dd.token) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (String(dd.pin || "") !== String(c.classLink.pin)) await wrong(lRef, l, "الرمز");
    if (l.fails) await lRef.update({ fails: 0 });
    if (c.classLink.enabled === false) throw new HttpsError("failed-precondition", "أُوقف رابط معلمي الحصص، يرجى التواصل مع منسق البرنامج.");
    if (c.status !== "ACTIVE" && riyadhDay() > plusDays(c.endDay, 14)) throw new HttpsError("failed-precondition", "انتهت هذه الدورة.");
    const teacher = personName(dd.teacher);
    if (!teacher) throw new HttpsError("invalid-argument", "اكتب اسم المعلم.");
    return { cRef, c, tk: dd.token, teacher };
  }
  // The cycle's groups (with students) and which class days each has
  // written; with `groupId`, that group's students, that day's class and
  // the supervisor's marks.
  async function classState(cRef, c, tk, teacher, groupId, day) {
    const days = sessionDays(c);
    const today = riyadhDay();
    const past = days.filter((x) => x <= today);
    const theDay = past.includes(day) ? day : past[past.length - 1] || "";
    const [gr, ls, st, br] = await Promise.all([
      cRef.collection("groups").get(), cRef.collection("lessons").get(), cRef.collection("students").where("status", "==", "CONSENTED").get(), db.collection("branches").get(),
    ]);
    const lessons = new Map(ls.docs.map((x) => [x.id, x.data()]));
    const kids = st.docs.map((x) => x.data());
    const size = {};
    kids.forEach((e) => { if (e.groupId) size[e.groupId] = (size[e.groupId] || 0) + 1; });
    const groups = gr.docs.filter((x) => size[x.id]).map((x) => ({ id: x.id, ...x.data() }));
    const branchName = Object.fromEntries(br.docs.map((x) => [x.id, x.data().name || x.id]));
    const g = groupId ? groups.find((x) => x.id === groupId) : null;
    let group = null;
    if (g) {
      const lesson = theDay ? lessons.get(`${theDay}_${g.id}`) : null;
      const sess = theDay ? await cRef.collection("sessions").doc(`${theDay}_${g.id}`).get() : null;
      const marks = sess?.exists ? sess.data().marks || {} : {};
      const perfCount = (e) => { const n = {}; Object.values(e.perf || {}).forEach((p) => { if (RATINGS.includes(p?.r)) n[p.r] = (n[p.r] || 0) + 1; }); return n; };
      group = {
        id: g.id,
        lesson: lesson ? { subject: lesson.subject || "", topic: lesson.topic || "", note: lesson.note || "", byName: lesson.byName || "", at: ms(lesson.at) } : null,
        students: kids.filter((e) => e.groupId === g.id).map((e) => ({
          k: teacherKey(tk, e.studentId), name: e.name, grade: e.grade || "", className: e.className || "", subjects: e.subjects || [], reason: e.reason || "",
          mark: marks[e.studentId]?.s || "", rating: lesson?.ratings?.[e.studentId] || null, att: e.att || {}, perf: perfCount(e),
          final: e.final ? { r: e.final.r, note: e.final.note || "", byName: e.final.byName || "", at: ms(e.final.at) } : null,
        })).sort((a, b) => a.name.localeCompare(b.name, "ar")),
      };
    }
    return {
      cycle: c.title, when: whenText(c), from: c.startDay, to: c.endDay, school: SCHOOL_NAME, teacher,
      day: theDay, today, days: past, isClassDay: days.includes(today), total: days.length,
      groups: groups.map((x) => {
        const l = theDay ? lessons.get(`${theDay}_${x.id}`) : null;
        return {
          id: x.id, name: x.name || "", type: x.type, subject: x.subject || "", room: x.room || "", curriculum: curriculumOf(x.curriculum), branch: x.branch || "",
          branchName: branchName[x.branch] || x.branch || "", grades: x.grades || [], students: size[x.id], written: past.filter((d) => lessons.has(`${d}_${x.id}`)),
          dayBy: l ? l.byName || "" : "", daySubject: l ? l.subject || "" : "", dayMine: !!l && titleKey(l.byName) === titleKey(teacher),
        };
      }).sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.branchName.localeCompare(b.branchName, "ar") || a.name.localeCompare(b.name, "ar")),
      group,
    };
  }
  out.supportClass = onCall({ timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
    const { cRef, c, tk, teacher } = await classTeacherOf(request);
    return classState(cRef, c, tk, teacher, String(request.data?.groupId || ""), request.data?.day);
  });
  out.supportClassSave = onCall({ timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
    const { cRef, c, tk, teacher } = await classTeacherOf(request);
    const dd = request.data || {};
    const gRef = cRef.collection("groups").doc(String(dd.groupId || "-"));
    const g = (await gRef.get()).data();
    if (!g) throw new HttpsError("not-found", "المجموعة غير موجودة.");
    const members = (await cRef.collection("students").where("groupId", "==", gRef.id).get()).docs.map((x) => x.data()).filter((e) => e.status === "CONSENTED");
    const byKey = new Map(members.map((e) => [teacherKey(tk, e.studentId), e]));
    const now = Timestamp.now();
    if (dd.what === "final") {
      const batch = db.batch();
      let saved = 0;
      Object.entries(dd.finals && typeof dd.finals === "object" ? dd.finals : {}).forEach(([k, f]) => {
        const e = byKey.get(k);
        if (!e) return;
        const eRef = cRef.collection("students").doc(e.studentId);
        if (FINALS.includes(f?.r)) {
          const same = e.final?.r === f.r && (e.final?.note || "") === str(f.note, 500);
          if (!same) batch.update(eRef, { final: { r: f.r, note: str(f.note, 500), byName: teacher, groupId: gRef.id, at: now } });
          saved++;
        } else if (e.final) batch.update(eRef, { final: FieldValue.delete() });
      });
      await batch.commit();
      return { ok: true, saved, state: await classState(cRef, c, tk, teacher, gRef.id, dd.day) };
    }
    const day = String(dd.day || "");
    if (!sessionDays(c).includes(day) || day > riyadhDay()) throw new HttpsError("failed-precondition", "ليس يوم حصة.");
    const subject = str(dd.subject, 120);
    if (!subject) throw new HttpsError("invalid-argument", "اختر المادة التي درّستها.");
    const topic = str(dd.topic, 300);
    if (!topic) throw new HttpsError("invalid-argument", "اكتب موضوع الحصة.");
    const ratings = {};
    Object.entries(dd.ratings && typeof dd.ratings === "object" ? dd.ratings : {}).forEach(([k, r]) => {
      const e = byKey.get(k);
      if (e && RATINGS.includes(r?.r)) ratings[e.studentId] = { r: r.r, note: str(r.note, 300) };
    });
    const lRef = cRef.collection("lessons").doc(`${day}_${gRef.id}`);
    await db.runTransaction(async (tx) => {
      const prevDoc = (await tx.get(lRef)).data() || {};
      const prev = prevDoc.ratings || {};
      const changed = prevDoc.subject !== subject || prevDoc.byName !== teacher;
      tx.set(lRef, { day, groupId: gRef.id, subject, topic, note: str(dd.note, 1000), ratings, byName: teacher, at: now });
      // Each rating is kept on the enrollment too (the student record).
      members.forEach((e) => {
        const a = ratings[e.studentId];
        const b = prev[e.studentId];
        if (changed || (a?.r || "") !== (b?.r || "") || (a?.note || "") !== (b?.note || "")) {
          tx.update(cRef.collection("students").doc(e.studentId), { [`perf.${day}`]: a ? { r: a.r, note: a.note, g: gRef.id, subj: subject, by: teacher } : FieldValue.delete() });
        }
      });
    });
    return { ok: true, rated: Object.keys(ratings).length, state: await classState(cRef, c, tk, teacher, gRef.id, day) };
  });

  // --- absence: WhatsApp, call, repeated-absence alert ----------------------------
  // Who follows a cycle's student: the cycle's creator, the branch's
  // principals and those given supportManage in the branch.
  async function followersOf(c, branch) {
    const users = await loadActiveUsers();
    return [...new Set([c.createdBy, ...users.filter((u) => (u.isPrincipal === true || u.perms?.supportManage === true) && callerHasBranch(u, branch)).map((u) => u.id)])].filter(Boolean);
  }
  // Calls for a cycle's students (absence / no answer / pledge); the ids are
  // fixed so each is added once. Kept on the enrollment (calls[]).
  async function addCalls(cRef, c, rows) {
    if (!rows.length) return [];
    const program = (e) => `${typeName(e.type)} — ${c.title}`;
    const items = rows.map(({ e, kind, day, detail }) => ({
      id: `sup_${cRef.id}_${e.studentId}_${kind}${day ? `_${day}` : ""}`, kind, day: day || "", phone: e.phone, branch: e.branch, studentId: e.studentId,
      name: e.name, grade: e.grade, className: e.className, program: program(e), detail: detail || "",
      reason: { ABSENT: "غياب عن الحصة", NO_REPLY: "لم يرد على طلب الموافقة", PLEDGE: "لم يوقّع التعهد" }[kind],
    }));
    const added = await addSupportCallTasks({ cycleId: cRef.id, cycleTitle: c.title, endDay: c.endDay, createdBy: c.createdBy, createdByName: c.createdByName, agentIds: c.callAgents || [], items });
    if (!added.length) return [];
    const now = Timestamp.now();
    const batch = db.batch();
    items.filter((x) => added.includes(x.id)).forEach((x) => batch.update(cRef.collection("students").doc(x.studentId), { calls: FieldValue.arrayUnion({ id: x.id, kind: x.kind, day: x.day, at: now }) }));
    if (!c.callCampaign) batch.update(cRef, { callCampaign: true });
    await batch.commit();
    return added;
  }
  // One class day's absences not handled yet (or only the given classes):
  // the parent's WhatsApp, a call for the call team, and — when a student's
  // absences reach the cycle's limit (3 by default, again at each multiple) —
  // a notice to those who follow the student. Each absence is handled once
  // (sessions/{id}.notified.{studentId}).
  async function processAbsences(cRef, c, day, only = null) {
    const refs = only ? only.map((id) => cRef.collection("sessions").doc(id))
      : (await cRef.collection("sessions").where("day", "==", day).get()).docs.map((x) => x.ref);
    // Claimed in a transaction, so the sweep and a late save don't both send.
    const todo = [];
    for (const sRef of refs) {
      const claimed = await db.runTransaction(async (tx) => {
        const x = (await tx.get(sRef)).data();
        if (!x) return [];
        const ids = Object.entries(x.marks || {}).filter(([sid, m]) => m.s === "A" && !x.notified?.[sid]).map(([sid]) => sid);
        if (ids.length) tx.update(sRef, Object.fromEntries(ids.map((sid) => [`notified.${sid}`, { at: Timestamp.now(), wa: "pending", call: "" }])));
        return ids.map((sid) => ({ sRef, sid, groupId: x.groupId }));
      });
      todo.push(...claimed);
    }
    const res = { sent: 0, calls: 0, alerts: 0 };
    if (!todo.length) return res;
    const [enr, groups] = await Promise.all([
      db.getAll(...todo.map((x) => cRef.collection("students").doc(x.sid))),
      db.getAll(...[...new Set(todo.map((x) => x.groupId))].map((g) => cRef.collection("groups").doc(g))),
    ]);
    const gName = Object.fromEntries(groups.filter((g) => g.exists).map((g) => [g.id, g.data().name]));
    const rows = todo.map((x, i) => (enr[i].exists ? { ...x, e: enr[i].data() } : null)).filter((x) => x && x.e.status === "CONSENTED");
    const waOk = {};
    if (c.absentWa !== false) {
      const settings = await waSettings();
      if (settings) res.sent = (await sendMany(settings, cRef, c, rows.map((x) => x.e), "absent", () => ({ day: dayLabel(day) }), (e, ok) => { waOk[e.studentId] = ok ? "sent" : "failed"; })).sent;
    }
    let callIds = [];
    if (c.absentCall !== false) {
      callIds = await addCalls(cRef, c, rows.map((x) => ({ e: x.e, kind: "ABSENT", day, detail: `${dayLabel(day)}${gName[x.groupId] ? ` — ${gName[x.groupId]}` : ""}${x.e.att?.A ? ` — مرات الغياب: ${x.e.att.A}` : ""}` }))).catch((err) => { console.error("support absence calls", err); return []; });
      res.calls = callIds.length;
    }
    const now = Timestamp.now();
    const batch = db.batch();
    rows.forEach((x) => {
      const callId = `sup_${cRef.id}_${x.sid}_ABSENT_${day}`;
      batch.update(x.sRef, { [`notified.${x.sid}`]: { at: now, wa: waOk[x.sid] || (c.absentWa === false ? "off" : "none"), call: callIds.includes(callId) ? callId : "" } });
    });
    // Repeated absence.
    const limit = Number.isInteger(c.absentAlertAt) ? c.absentAlertAt : 3;
    const alerts = [];
    if (limit > 0) {
      rows.forEach((x) => {
        const n = x.e.att?.A || 0;
        const level = Math.floor(n / limit);
        if (level >= 1 && level > (x.e.absenceAlert?.level || 0)) {
          alerts.push(x.e);
          batch.update(cRef.collection("students").doc(x.sid), { absenceAlert: { level, count: n, at: now } });
        }
      });
    }
    await batch.commit();
    for (const e of alerts) {
      const to = await followersOf(c, e.branch);
      await notifyUsers(to, { title: "تكرار غياب في برامج الدعم", body: `${e.name} (${e.grade || ""}) غاب ${e.att.A} مرات عن ${typeName(e.type)} — ${c.title}.`, complaintId: cRef.id, type: "SUPPORT_ABSENCE" }).catch(() => {});
    }
    res.alerts = alerts.length;
    return res;
  }

  // Every quarter of an hour in the afternoon of a class day: once a cycle's
  // attendance has closed, the day's absences are handled, and its followers
  // hear (once) of groups whose attendance wasn't taken.
  out.supportAbsenceSweep = onSchedule({ schedule: "*/15 12-19 * * 0-4", timeZone: "Asia/Riyadh", timeoutSeconds: 300, memory: "512MiB" }, async () => {
    const today = riyadhDay();
    const now = riyadhTime();
    const active = await cycles().where("status", "==", "ACTIVE").get();
    for (const x of active.docs) {
      const c = x.data();
      if (!sessionDays(c).includes(today) || now < closeTimeOf(c)) continue;
      try {
        await processAbsences(x.ref, c, today);
        // Groups not taken: checked half an hour after attendance closes.
        if ((c.notTaken || {})[today] == null && now >= addMin(closeTimeOf(c), 30)) {
          const [groups, taken] = await Promise.all([x.ref.collection("groups").get(), x.ref.collection("sessions").where("day", "==", today).get()]);
          const done = new Set(taken.docs.map((y) => y.data().groupId));
          const members = await Promise.all(groups.docs.map((g) => x.ref.collection("students").where("groupId", "==", g.id).where("status", "==", "CONSENTED").limit(1).get()));
          const missing = groups.docs.filter((g, i) => !done.has(g.id) && !members[i].empty).map((g) => g.data());
          await x.ref.update({ [`notTaken.${today}`]: missing.length });
          const byBranch = {};
          missing.forEach((g) => { (byBranch[g.branch || ""] ||= []).push(g.name); });
          for (const [branch, names] of Object.entries(byBranch)) {
            const to = branch ? await followersOf(c, branch) : [c.createdBy];
            await notifyUsers(to, { title: "لم يُسجَّل حضور برامج الدعم", body: `${c.title}: لم يُسجَّل حضور اليوم في ${names.join("، ")}.`, complaintId: x.id, type: "SUPPORT_NOT_TAKEN" }).catch(() => {});
          }
        }
      } catch (err) { console.error("support sweep", x.id, err); }
    }
  });

  // A «برامج الدعم» call's result (from the call team's screen): an answer to
  // the consent request taken on the call becomes the parent's answer.
  const hooks = {
    async onCallResult(k, entry, agent) {
      const cRef = cycles().doc(k.support.cycleId);
      const eRef = cRef.collection("students").doc(k.support.studentId);
      const e = (await eRef.get()).data();
      if (!e || entry.result !== "ANSWERED") return;
      const by = { by: agent.uid, byName: agent.name || "" };
      const now = Timestamp.now();
      if (entry.outcome === "موافق على الالتحاق" && ["APPROVED", "PENDING_CONSENT", "DECLINED", "PLEDGE_SENT"].includes(e.status)) {
        await eRef.update({ status: "CONSENTED", consent: { name: "ولي الأمر (اتصال)", relation: "", via: "CALL", note: entry.note || "", at: now, ...by }, decline: FieldValue.delete() });
      } else if (entry.outcome === "غير موافق" && ["APPROVED", "PENDING_CONSENT"].includes(e.status)) {
        await eRef.update({ status: "DECLINED", decline: { name: "ولي الأمر (اتصال)", relation: "", reason: entry.note || "", via: "CALL", at: now, ...by } });
      } else return;
      await refreshCounts(cRef);
    },
  };

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
      const cRef = all[i].ref;
      const c = all[i].data();
      const perf = Object.entries(e.perf || {}).filter(([, p]) => p && p.g);
      const [groupsSnap, callSnaps, legacy, lessonSnaps] = await Promise.all([
        cRef.collection("groups").get(),
        (e.calls || []).length ? db.getAll(...e.calls.map((x) => db.collection("callTasks").doc(x.id))) : Promise.resolve([]),
        // Classes marked before the marks were kept on the enrollment.
        MARKS.reduce((n, k) => n + (e.att?.[k] || 0), 0) > Object.keys(e.hist || {}).length ? cRef.collection("sessions").get() : Promise.resolve(null),
        perf.length ? db.getAll(...perf.map(([day, p]) => cRef.collection("lessons").doc(`${day}_${p.g}`))) : Promise.resolve([]),
      ]);
      const topics = Object.fromEntries(lessonSnaps.filter((x) => x.exists).map((x) => [x.id, x.data().topic || ""]));
      const groups = Object.fromEntries(groupsSnap.docs.map((x) => [x.id, x.data()]));
      const g = e.groupId ? groups[e.groupId] : null;
      const hist = e.hist || {};
      const notified = {};
      if (legacy) legacy.docs.forEach((x) => { const m = x.data().marks?.[sid]; if (m && !hist[x.data().day]) hist[x.data().day] = { s: m.s, note: m.note || "", g: x.data().groupId }; });
      // The absence messages of those classes.
      const absentDays = Object.entries(hist).filter(([, m]) => m.s === "A");
      if (absentDays.length) {
        const ss = await db.getAll(...absentDays.map(([day, m]) => cRef.collection("sessions").doc(`${day}_${m.g}`)));
        ss.forEach((x) => { const n = x.exists ? x.data().notified?.[sid] : null; if (n) notified[x.data().day] = { wa: n.wa || "", call: n.call || "", at: ms(n.at) }; });
      }
      const days = sessionDays(c);
      items.push({
        cycleId: cRef.id, cycle: c.title, when: whenText(c), from: c.startDay, to: c.endDay, ...enrollOut(found[i], e, false),
        group: g ? { name: g.name, teacher: g.teacher || "", room: g.room || "", subject: g.subject || "" } : null,
        pledgeText: e.pledge?.text || "",
        sessions: Object.entries(hist).sort(([a], [b]) => b.localeCompare(a)).map(([day, m]) => ({ day, s: m.s, note: m.note || "", group: groups[m.g]?.name || "", notified: notified[day] || null })),
        remaining: e.status === "CONSENTED" ? days.filter((x) => x > riyadhDay()).length : 0,
        callList: callSnaps.filter((x) => x.exists).map(callOut),
        ratings: perf.sort(([a], [b]) => b.localeCompare(a)).map(([day, p]) => ({ day, r: p.r, note: p.note || "", topic: topics[`${day}_${p.g}`] || "", subject: p.subj || "", by: p.by || "", group: groups[p.g]?.name || "" })),
      });
    }
    return { items };
  });

  // Every morning: a reminder to parents who haven't answered the consent
  // request in two days, or signed the pledge in two days (once each); after
  // three days, a call for the call team (when on for the cycle).
  out.supportReminders = onSchedule({ schedule: "0 10 * * 0-4", timeZone: "Asia/Riyadh", timeoutSeconds: 300, memory: "512MiB" }, async () => {
    const settings = await waSettings();
    const active = await cycles().where("status", "==", "ACTIVE").get();
    const older = (t, h) => ms(t) && Date.now() - ms(t) > h * 3600e3;
    const hasCall = (e, kind) => (e.calls || []).some((x) => x.kind === kind);
    for (const x of active.docs) {
      const c = x.data();
      try {
        const [waiting, pledges] = await Promise.all(["PENDING_CONSENT", "PLEDGE_SENT"].map((st) => x.ref.collection("students").where("status", "==", st).get().then((q) => q.docs.map((y) => y.data()))));
        if (settings) {
          const remind = waiting.filter((e) => older(e.sentAt, 48) && !e.wa?.remind);
          if (remind.length) await sendMany(settings, x.ref, c, remind, "remind");
          const remindPledge = pledges.filter((e) => older(e.pledgeSentAt, 48) && !e.wa?.pledgeRemind);
          if (remindPledge.length) await sendMany(settings, x.ref, c, remindPledge, "pledgeRemind");
        }
        if (c.noReplyCall !== false) {
          await addCalls(x.ref, c, [
            ...waiting.filter((e) => older(e.sentAt, 72) && !hasCall(e, "NO_REPLY")).map((e) => ({ e, kind: "NO_REPLY", detail: `أُرسل طلب الموافقة ${new Date(ms(e.sentAt) + 3 * 3600e3).toISOString().slice(0, 10)}` })),
            ...pledges.filter((e) => older(e.pledgeSentAt, 72) && !hasCall(e, "PLEDGE")).map((e) => ({ e, kind: "PLEDGE", detail: `أُرسل التعهد ${new Date(ms(e.pledgeSentAt) + 3 * 3600e3).toISOString().slice(0, 10)}` })),
          ]);
        }
      } catch (err) { console.error("support reminders", x.id, err); }
    }
  });

  return { ...out, hooks };
};

module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
