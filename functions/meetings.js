// «اجتماعات أولياء الأمور» — parent meetings, from the invitation to the
// final report (see «آلية إدارة اجتماعات أولياء الأمور»):
//   1. staff create the meeting (general session, one-to-one slots with the
//      teachers, or both) for branches / grades / classes;
//   2. each family gets its own link on WhatsApp (siblings share one);
//   3. the parent confirms, books the teachers and writes the topics;
//   4. reminders the evening before and on the morning of the meeting;
//   5. on the day: reception checks parents in (QR or search), each teacher
//      has their schedule and writes a short minute per student, and a
//      follow-up becomes a complaint for the right department;
//   6. thanks + survey to those who came, a message and follow-up calls
//      for those who didn't;
//   7. the report.
// Teachers and reception use a private link + 4-digit code (no accounts).
// Everything is read and written here; the client never touches these
// collections directly (firestore.rules deny them by default).
//
//   meetings/{id}                 the meeting (teachers, desk code, stats)
//   meetings/{id}/invites/{key}   one family (key = parent mobile, or S<id>)
//   meetings/{id}/slots/{t_HHMM}  one booked teacher slot (id = uniqueness)
//   meetings/{id}/surveys/{key}   the family's rating
//   meetings/{id}/activityLog
//   meetingTokens/{token}         link → meeting (parent / teacher / desk / checkin)
//   meetingMinutes/{m_t_student}  a teacher's minute (shown in the student record)
const { tallyPurposes } = require("./meetingPurposes");

module.exports = function meetingsModule(d) {
  const {
    db, Timestamp, FieldValue, HttpsError, onCall, onSchedule, crypto,
    WA_SECRETS, WA_API_ENABLED, toIntlNumber, waParam, taqnyatSend, PUBLIC_APP_URL, SCHOOL_NAME,
    loadActiveUsers, notifyUsers, branchResolver, studentGrade, studentSection, studentGenderOf, normalizeDigits,
    findAutoAssignees, nextRecordNumber, riyadhDay, formatTripDay, time12, str, callerHasBranch, callerAll, callPhone,
    TRIP_STAGES,
  } = d;
  const out = {};

  // REQUESTS: no appointments — the parent picks, for each child, whom to
  // meet (academic manager, administrative manager, the child's teachers)
  // and why; on the day reception checks them in, a supervisor directs them,
  // and each person starts and ends the meeting with its result.
  const TYPES = ["GENERAL", "INDIVIDUAL", "BOTH", "REQUESTS"];
  const STAFF_ROLES = ["TEACHER", "ACADEMIC", "ADMIN"];
// The managers' positions (parents choose from them) and the subjects of a
// subject supervisor — as in src/config/meetings.js.
const STAFF_POSITIONS = { ADMIN: ["PRINCIPAL", "VICE_PRINCIPAL", "COUNSELOR"], ACADEMIC: ["ACADEMIC_DIRECTOR", "ACADEMIC_DIRECTOR_AMERICAN", "ACADEMIC_DIRECTOR_BRITISH", "ACADEMIC_DEPUTY", "SUBJECT_SUPERVISOR"] };
// A position for one department only: offered to its students' families.
const POSITION_SECTION = { ACADEMIC_DIRECTOR_AMERICAN: "AMERICAN", ACADEMIC_DIRECTOR_BRITISH: "BRITISH" };
const SUBJECTS = ["ARABIC", "ENGLISH", "MATH", "SCIENCE", "ISLAMIC", "QURAN", "SOCIAL", "ICT", "FRENCH", "ART", "PE", "LIFE_SKILLS"];
const POSITION_AR = { PRINCIPAL: "مدير المدرسة", VICE_PRINCIPAL: "وكيل المدرسة", COUNSELOR: "المرشد الطلابي", ACADEMIC_DIRECTOR: "المدير الأكاديمي", ACADEMIC_DIRECTOR_AMERICAN: "مدير أكاديمي القسم الأمريكي", ACADEMIC_DIRECTOR_BRITISH: "مدير أكاديمي القسم البريطاني", ACADEMIC_DEPUTY: "نائب المدير الأكاديمي", SUBJECT_SUPERVISOR: "مشرف مادة" };
const SUBJECT_AR = { ARABIC: "اللغة العربية", ENGLISH: "اللغة الإنجليزية", MATH: "الرياضيات", SCIENCE: "العلوم", ISLAMIC: "الدراسات الإسلامية", QURAN: "القرآن الكريم", SOCIAL: "الدراسات الاجتماعية", ICT: "الحاسب وتقنية المعلومات", FRENCH: "اللغة الفرنسية", ART: "التربية الفنية", PE: "التربية البدنية", LIFE_SKILLS: "المهارات الحياتية" };
// «Interviews on request»: parents ask for a manager by position (every
// position, always); whoever holds it on the day signs in on the meeting's
// managers' link and takes those requests.
const POSITION_SLOTS = Object.entries(STAFF_POSITIONS).flatMap(([role, list]) => list.flatMap((position) => (position === "SUBJECT_SUPERVISOR" ? SUBJECTS : [""]).map((posSubject) => ({
  id: posSubject ? `P-${position}-${posSubject}` : `P-${position}`, role, position, posSubject,
  name: posSubject ? `مشرف مادة ${SUBJECT_AR[posSubject]}` : POSITION_AR[position], subject: "", room: "", classes: [], slot: true, section: POSITION_SECTION[position] || "",
}))));
const slotOf = (id) => POSITION_SLOTS.find((x) => x.id === id) || null;
// Who holds a position now (signed in on the managers' link).
const onDutyOf = (m, id) => (m?.onDuty || {})[id] || null;
const staffRoom = (m, id) => (m.teachers || []).find((t) => t.id === id)?.room || onDutyOf(m, id)?.room || "";
const holderOf = (m, r) => r.heldBy || onDutyOf(m, r.staffId)?.name || "";
  const ROLE_NAMES = { TEACHER: "معلم", ACADEMIC: "مدير أكاديمي", ADMIN: "مدير إداري" };
  const REQ_OPEN = ["REQUESTED", "DIRECTED", "IN_PROGRESS"];
  const requestsMode = (m) => m?.type === "REQUESTS";
// Who came for the family (name + relation to the student).
const RELATIONS = ["FATHER", "MOTHER", "BROTHER", "SISTER", "GRANDFATHER", "GRANDMOTHER", "UNCLE", "AUNT", "GUARDIAN", "OTHER"];
const attendeeOf = (raw) => {
  const name = String(raw?.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const relation = RELATIONS.includes(raw?.relation) ? raw.relation : "";
  return name && relation ? { name, relation } : null;
};
// Branches where only women attend parent meetings: no male relation there.
const WOMEN_ONLY_BRANCHES = ["AL_NAEEM", "AL_ZAHRA", "AL_SHATI", "AL_SALAMA_GIRLS", "DOWN_TOWN_GIRLS"];
const MALE_RELATIONS = ["FATHER", "BROTHER", "GRANDFATHER", "UNCLE"];
const womenOnly = (students) => (students || []).length > 0 && students.every((x) => WOMEN_ONLY_BRANCHES.includes(x.branch));
const checkAttendee = (attendee, students) => {
  if (attendee && womenOnly(students) && MALE_RELATIONS.includes(attendee.relation)) {
    throw new HttpsError("invalid-argument", "الحضور في هذا الفرع للسيدات فقط، اختر صلة أخرى.");
  }
};
// A meeting a teacher or manager left open, closed when they start the next one.
const MAX_TEACHERS = 200;
const AUTO_CLOSED_NOTE = "أُغلقت تلقائياً عند بدء المقابلة التالية — لم تُكتب النتيجة بعد.";
  const RESPONSES = ["ATTEND", "REMOTE", "DECLINE"];
  const FOLLOW_TYPES = ["ACADEMIC", "BEHAVIORAL", "ADMINISTRATIVE", "FINANCE"];
  const LIVE = ["OPEN", "CLOSED"];
  const MAX_SLOTS = 8;
  const individual = (m) => m.type === "INDIVIDUAL" || m.type === "BOTH";

  // --- time helpers (meetings are stored as YYYY-MM-DD + HH:MM, Riyadh) ---
  const toMin = (hhmm) => { const x = /^(\d{2}):(\d{2})$/.exec(hhmm || ""); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const riyadhNow = () => { const n = new Date(Date.now() + 3 * 3600e3); return { day: n.toISOString().slice(0, 10), min: n.getUTCHours() * 60 + n.getUTCMinutes() }; };
  const when = (m) => `${formatTripDay(m.date)}، ${time12(m.startTime)}${m.endTime ? ` – ${time12(m.endTime)}` : ""}`;
  const token = () => crypto.randomBytes(12).toString("base64url");
  const pin = () => String(crypto.randomInt(1000, 10000));
  const classKey = (s) => `${studentGrade(s)}|${String(s.className || "").trim()}`;
  const maskPhone = (p) => (p ? `•••${String(p).slice(-4)}` : "");

  // The slot start times of a meeting (same grid for every teacher).
  function slotTimes(m) {
    if (!individual(m)) return [];
    const a = toMin(m.slotsStart || m.startTime);
    const b = toMin(m.slotsEnd || m.endTime);
    const step = m.slotMinutes || 10;
    const bs = toMin(m.breakStart);
    const be = toMin(m.breakEnd);
    const list = [];
    if (a == null || b == null) return list;
    for (let t = a; t + step <= b; t += step) {
      if (bs != null && be != null && t < be && t + step > bs) continue;
      list.push(toHHMM(t));
    }
    return list;
  }

  // --- permissions ---------------------------------------------------------
  // Section «اجتماعات أولياء الأمور» (users.modules.meetings), on by default
  // for principals, upper management and customer service. Mirrors
  // src/utils/scope.js meetingsByRole().
  const meetingsByRole = (u) => u.isPrincipal === true || ["UPPER_MANAGEMENT", "CUSTOMER_SERVICE"].includes(u.role);
  const meetingsAllowed = (u) => !!u && u.active !== false && u.role !== "RECEPTIONIST" && u.tripsAccess !== "tripsOnly"
    && (u.role === "ADMIN" || (typeof u.modules?.meetings === "boolean" ? u.modules.meetings : meetingsByRole(u)));
  async function meetingCaller(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!meetingsAllowed(u)) throw new HttpsError("permission-denied", "لا تملك صلاحية «اجتماعات أولياء الأمور».");
    return { uid: request.auth.uid, ...u };
  }
  const inScope = (u, m) => callerAll(u) || (m.branches || []).some((b) => callerHasBranch(u, b)) || m.createdBy === u.uid;
  async function loadMeeting(id, caller) {
    if (typeof id !== "string" || !id) throw new HttpsError("invalid-argument", "طلب غير صالح.");
    const ref = db.collection("meetings").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الاجتماع.");
    const m = snap.data();
    if (caller && !inScope(caller, m)) throw new HttpsError("permission-denied", "هذا الاجتماع خارج فروعك.");
    return { ref, m };
  }
  const mlog = (ref, action, actor, metadata = {}) => ref.collection("activityLog").add({ action, actorId: actor?.uid || null, actorName: actor?.name || "النظام", metadata, createdAt: Timestamp.now() });
  // A request the teacher (or manager) declined stays CANCELLED — so every
  // count and the family's «all done» leave it out — but is shown to staff and
  // to the family as REJECTED with its reason.
  const isRejected = (r) => r.status === "CANCELLED" && r.rejected === true;
  const shownStatus = (r) => (isRejected(r) ? "REJECTED" : r.status);
  const visibleReq = (r) => r.status !== "CANCELLED" || isRejected(r);

  // --- validation ----------------------------------------------------------
  function cleanMeeting(input, current) {
    const x = input || {};
    const time = (v) => (/^\d{2}:\d{2}$/.test(v || "") ? v : "");
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
    const list = (v, allowed, max = 60) => (Array.isArray(v) ? [...new Set(v.map((y) => String(y)))].filter((y) => !allowed || allowed.includes(y)).slice(0, max) : []);
    const m = {
      title: str(x.title, 120),
      type: TYPES.includes(x.type) ? x.type : "BOTH",
      branches: list(x.branches, null, 30),
      stages: list(x.stages, TRIP_STAGES),
      classes: list(x.classes, null, 300).map((c) => str(c, 40)),
      sections: list(x.sections, null, 10),
      gender: ["BOYS", "GIRLS"].includes(x.gender) ? x.gender : "ALL",
      date: day(x.date),
      startTime: time(x.startTime),
      endTime: time(x.endTime),
      location: str(x.location, 200),
      teamsLink: /^https:\/\/\S+$/.test(String(x.teamsLink || "").trim()) ? String(x.teamsLink).trim().slice(0, 500) : "",
      agenda: str(x.agenda, 2000),
      slotsStart: time(x.slotsStart),
      slotsEnd: time(x.slotsEnd),
      slotMinutes: Math.min(60, Math.max(5, Math.floor(Number(x.slotMinutes) || 10))),
      breakStart: time(x.breakStart),
      breakEnd: time(x.breakEnd),
      regDeadline: day(x.regDeadline),
      autoReminders: x.autoReminders !== false,
    };
    if (!m.title || !m.date || !m.startTime || !m.endTime || !m.branches.length) throw new HttpsError("invalid-argument", "أكمل اسم الاجتماع والتاريخ والوقت والفروع.");
    if (toMin(m.endTime) <= toMin(m.startTime)) throw new HttpsError("invalid-argument", "وقت النهاية يجب أن يكون بعد وقت البداية.");
    if (!m.regDeadline || m.regDeadline > m.date) m.regDeadline = m.date;
    if (!individual(m)) Object.assign(m, { slotsStart: "", slotsEnd: "", breakStart: "", breakEnd: "" });
    else {
      if (!m.slotsStart) m.slotsStart = m.startTime;
      if (!m.slotsEnd) m.slotsEnd = m.endTime;
      if (toMin(m.slotsEnd) <= toMin(m.slotsStart)) throw new HttpsError("invalid-argument", "وقت نهاية اللقاءات الفردية يجب أن يكون بعد بدايتها.");
      if ((m.breakStart || m.breakEnd) && !(m.breakStart && m.breakEnd && toMin(m.breakEnd) > toMin(m.breakStart))) throw new HttpsError("invalid-argument", "حدد بداية الاستراحة ونهايتها بشكل صحيح.");
    }
    // Teachers keep their id, link and code across edits.
    const old = new Map((current?.teachers || []).map((t) => [t.id, t]));
    // Up to 200 (a large branch has over 100); more is refused, not cut off.
    const given = Array.isArray(x.teachers) ? x.teachers : [];
    if (given.length > MAX_TEACHERS) throw new HttpsError("invalid-argument", `الحد الأقصى ${MAX_TEACHERS} معلماً في الاجتماع الواحد.`);
    m.teachers = given.map((t) => {
      const prev = old.get(String(t?.id || ""));
      const role = STAFF_ROLES.includes(t?.role) ? t.role : "TEACHER";
      const position = (STAFF_POSITIONS[role] || []).includes(t?.position) ? t.position : "";
      return {
        id: prev ? prev.id : `t${crypto.randomBytes(4).toString("hex")}`,
        name: str(t?.name, 80),
        subject: str(t?.subject, 80),
        room: str(t?.room, 60),
        role,
        position,
        posSubject: position === "SUBJECT_SUPERVISOR" && SUBJECTS.includes(t?.posSubject) ? t.posSubject : "",
        classes: list(t?.classes, null, 100).map((c) => str(c, 40)),
        token: prev?.token || token(),
        pin: prev?.pin || pin(),
      };
    }).filter((t) => t.name);
    if (individual(m) && !m.teachers.length) throw new HttpsError("invalid-argument", "أضف معلماً واحداً على الأقل للقاءات الفردية.");
    return m;
  }

  // --- audience ------------------------------------------------------------
  function targets(m, s, branchOf) {
    if (!s.nationalId || s.active === false) return false;
    if (!(m.branches || []).includes(branchOf(s))) return false;
    const g = studentGenderOf(s);
    if (g && ((m.gender === "BOYS" && g === "F") || (m.gender === "GIRLS" && g === "M"))) return false;
    if ((m.stages || []).length && !m.stages.includes(studentGrade(s))) return false;
    const sec = studentSection(s);
    if ((m.sections || []).length && sec && !m.sections.includes(sec)) return false;
    if ((m.classes || []).length && !m.classes.includes(classKey(s))) return false;
    return true;
  }
  const kid = (s, branchOf) => ({ id: String(s.nationalId), name: s.nameAr || s.name || "", grade: studentGrade(s), className: String(s.className || "").trim(), branch: branchOf(s), section: studentSection(s) });
  const familyKey = (s) => { const p = toIntlNumber(s.mobile); return /^\d{10,15}$/.test(p) ? p : `S${s.nationalId}`; };
  // Interviews on request: a family is the parent's national ID (the parent
  // signs in with it), else the mobile as in the other meeting types.
  const parentIdOf = (s) => normalizeDigits(s.parentNationalId || "").replace(/\D/g, "");
  const familyKeyFor = (m, s) => (requestsMode(m) && /^\d{6,15}$/.test(parentIdOf(s)) ? `P${parentIdOf(s)}` : familyKey(s));

  async function audience(m) {
    const branchOf = await branchResolver();
    const snap = await db.collection("students").get();
    const all = snap.docs.map((x) => x.data());
    const byKey = new Map();
    all.filter((s) => targets(m, s, branchOf)).forEach((s) => {
      const key = familyKeyFor(m, s);
      const p = toIntlNumber(s.mobile);
      if (!byKey.has(key)) byKey.set(key, { key, phone: /^\d{10,15}$/.test(p) ? p : "", students: [] });
      byKey.get(key).students.push(kid(s, branchOf));
    });
    return { families: [...byKey.values()], all, branchOf };
  }

  // Grades + classes of the chosen branches (for the form), and the size.
  out.previewMeetingAudience = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const x = request.data?.meeting || {};
    const m = { branches: Array.isArray(x.branches) ? x.branches.filter((b) => callerHasBranch(caller, b)) : [], stages: x.stages || [], classes: x.classes || [], sections: x.sections || [], gender: x.gender || "ALL" };
    const { families, all, branchOf } = await audience(m);
    const classes = new Map();
    all.filter((s) => s.active !== false && s.nationalId && m.branches.includes(branchOf(s)) && (!m.stages.length || m.stages.includes(studentGrade(s))) && String(s.className || "").trim())
      .forEach((s) => { const k = classKey(s); classes.set(k, (classes.get(k) || 0) + 1); });
    return {
      families: families.length,
      students: families.reduce((n, f) => n + f.students.length, 0),
      noPhone: families.filter((f) => !f.phone).length,
      classes: [...classes.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })),
    };
  });

  // --- WhatsApp (one "meetingNotice" template for every meeting message) ---
  // {{1}} student(s), {{2}} meeting, {{3}} date and time, {{4}} the message,
  // {{5}} the family's link — plus the "contact the branch" button.
  async function waSettings() {
    if (!WA_API_ENABLED) return null;
    const s = (await db.collection("settings").doc("whatsappApi").get()).data() || {};
    return s.enabled && (s.templates || {}).meetingNotice ? s : null;
  }
  const autoOn = (settings, m) => !!settings && settings.autoSend !== false && m.autoReminders !== false;
  const link = (inv) => `${PUBLIC_APP_URL}/meeting/${inv.token}`;
  const names = (inv) => (inv.students || []).map((s) => s.name).join("، ");
  const teacherName = (m, id) => (m.teachers || []).find((t) => t.id === id)?.name || slotOf(id)?.name || "";
  const requestsText = (m, inv) => {
    const who = [...new Set((inv.requested || []).map((r) => teacherName(m, r.staffId)).filter(Boolean))];
    return who.length ? `مقابلاتكم: ${who.join("، ")}.` : "";
  };
  const slotsText = (m, inv) => ((inv.slots || []).length
    ? `مواعيدكم: ${[...inv.slots].sort((a, b) => a.time.localeCompare(b.time)).map((s) => `${teacherName(m, s.teacherId)} ${time12(s.time)}`).join("، ")}.`
    : requestsText(m, inv));
  const LINES = {
    invite: (m) => `يسعد ${SCHOOL_NAME} دعوتكم لحضور الاجتماع${m.location ? ` في ${m.location}` : ""}. يرجى تأكيد حضوركم${individual(m) ? " وحجز مواعيدكم مع المعلمين" : requestsMode(m) ? " وتحديد من تودّون مقابلته" : ""} قبل ${formatTripDay(m.regDeadline)} من الرابط.`,
    confirm: (m, inv) => (inv.response === "REMOTE"
      ? "تم تسجيل حضوركم عن بعد، وتجدون رابط الاجتماع في الصفحة."
      : `تم تأكيد حضوركم. ${slotsText(m, inv)} يرجى إبراز رمز الدخول من الرابط عند الاستقبال.`),
    eve: (m, inv) => `نذكّركم بموعد الاجتماع غداً${m.location ? ` في ${m.location}` : ""}. ${slotsText(m, inv)}`,
    morning: (m, inv) => `نذكّركم بموعد الاجتماع اليوم${m.location ? ` في ${m.location}` : ""}. ${slotsText(m, inv)}`,
    deadline: (m) => `نذكّركم بتأكيد حضوركم قبل إغلاق التسجيل ${formatTripDay(m.regDeadline)}.`,
    changed: () => "تم تحديث موعد الاجتماع أو مكانه، وتجدون التفاصيل المحدّثة في الرابط.",
    slotCancelled: (m, inv, extra) => `نعتذر عن إلغاء موعدكم مع ${extra.teacher} (${time12(extra.time)}). يمكنكم حجز موعد آخر من الرابط.`,
    cancelled: (m, inv, extra) => `نعتذر عن إلغاء الاجتماع${extra?.reason ? `: ${extra.reason}` : ""}.`,
    thanks: () => "شكراً لحضوركم. يسعدنا تقييمكم للقاء في أقل من دقيقة من الرابط.",
    // Interviews on request: the family's meetings are all done.
    thanksDone: () => "شكراً لحضوركم، انتهت مقابلاتكم. يسعدنا تقييمكم للقاء في أقل من دقيقة من الرابط.",
    absent: (m, inv, extra) => `افتقدنا حضوركم الاجتماع.${extra?.summary ? ` ${extra.summary}` : ""} لطلب موعد بديل يرجى التواصل مع الفرع.`,
    invitePlain: (m) => `ندعوكم لحضور الاجتماع، يرجى تأكيد الحضور من الرابط.`,
  };

  async function sendOne(settings, meetingId, m, inv, line) {
    if (!inv.phone) throw new Error("لا يوجد رقم جوال لولي الأمر.");
    const first = (inv.students || [])[0] || {};
    await taqnyatSend({
      to: inv.phone,
      type: "template",
      template: { name: settings.templates.meetingNotice, language: { code: settings.language || "ar" } },
      components: [
        { type: "body", parameters: [names(inv), m.title, when(m), line, link(inv)].map((v) => ({ type: "text", text: waParam(v) })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `BR-${first.branch || (m.branches || [])[0] || ""}${first.section ? `-${first.section}` : ""}` }] },
      ],
    }, { kind: "meeting", meetingId, inviteId: inv.id, meetingCode: m.code });
  }

  // Sends to many families a few at a time; never throws. `event` is kept on
  // the invite (wa.{event}) so automatic messages go out once.
  async function sendMany(settings, ref, m, invites, event, extra) {
    let sent = 0;
    let failed = 0;
    const queue = [...invites];
    const worker = async () => {
      for (let inv = queue.shift(); inv; inv = queue.shift()) {
        const invRef = ref.collection("invites").doc(inv.id);
        try {
          await sendOne(settings, ref.id, m, inv, LINES[event](m, inv, extra));
          sent++;
          await invRef.update({ [`waEvents.${event}`]: Timestamp.now(), "wa.status": "sent", "wa.at": Timestamp.now(), "wa.error": FieldValue.delete(), "wa.count": FieldValue.increment(1) });
        } catch (err) {
          failed++;
          await invRef.update({ "wa.status": event === "invite" ? "failed" : (inv.wa?.status || "failed"), "wa.error": String(err.message).slice(0, 300), "wa.at": Timestamp.now() }).catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { sent, failed, total: invites.length };
  }

  // --- stats (kept on the meeting for the list and the comparisons) --------
  async function refreshStats(ref) {
    const [inv, slots, surveys, reqs] = await Promise.all([ref.collection("invites").get(), ref.collection("slots").get(), ref.collection("surveys").get(), ref.collection("requests").get()]);
    const list = inv.docs.map((x) => x.data());
    const count = (f) => list.filter(f).length;
    const overall = surveys.docs.map((x) => x.data().overall).filter((v) => v >= 1);
    const stats = {
      families: list.length,
      students: list.reduce((n, i) => n + (i.students || []).length, 0),
      noPhone: count((i) => !i.phone),
      sent: count((i) => i.waEvents?.invite || i.wa?.status === "manual"),
      failed: count((i) => i.wa?.status === "failed"),
      delivered: count((i) => ["delivered", "read"].includes(i.wa?.status)),
      read: count((i) => i.wa?.status === "read"),
      responded: count((i) => !!i.response),
      attend: count((i) => i.response === "ATTEND"),
      remote: count((i) => i.response === "REMOTE"),
      decline: count((i) => i.response === "DECLINE"),
      attendees: list.filter((i) => i.response === "ATTEND").reduce((n, i) => n + (i.attendees || 1), 0),
      attended: count((i) => i.attended === true),
      attendedStudents: list.filter((i) => i.attended === true).reduce((n, i) => n + (i.students || []).length, 0),
      booked: slots.size,
      done: slots.docs.filter((x) => x.data().doneAt).length,
      surveys: surveys.size,
      avgOverall: overall.length ? Math.round((overall.reduce((a, b) => a + b, 0) / overall.length) * 100) / 100 : 0,
      low: surveys.docs.filter((x) => x.data().low).length,
      requests: reqs.docs.filter((x) => x.data().status !== "CANCELLED").length,
      requestsDone: reqs.docs.filter((x) => x.data().status === "DONE").length,
      requestsActive: reqs.docs.filter((x) => x.data().status === "IN_PROGRESS").length,
    };
    await ref.update({ stats, statsAt: Timestamp.now() });
    return stats;
  }

  const ms = (t) => t?.toMillis?.() || null;
  function meetingOut(id, m, { secrets = false } = {}) {
    return {
      id, code: m.code, title: m.title, type: m.type, status: m.status, branches: m.branches || [], stages: m.stages || [], classes: m.classes || [],
      sections: m.sections || [], gender: m.gender || "ALL", date: m.date, startTime: m.startTime, endTime: m.endTime, location: m.location || "",
      teamsLink: m.teamsLink || "", agenda: m.agenda || "", slotsStart: m.slotsStart || "", slotsEnd: m.slotsEnd || "", slotMinutes: m.slotMinutes || 10,
      breakStart: m.breakStart || "", breakEnd: m.breakEnd || "", regDeadline: m.regDeadline, autoReminders: m.autoReminders !== false,
      teachers: (m.teachers || []).map((t) => ({ id: t.id, name: t.name, subject: t.subject, room: t.room, role: t.role || "TEACHER", position: t.position || "", posSubject: t.posSubject || "", classes: t.classes || [], ...(secrets ? { link: `${PUBLIC_APP_URL}/meeting-teacher/${t.token}`, pin: t.pin } : {}) })),
      ...(secrets && m.managerToken ? { managerLink: `${PUBLIC_APP_URL}/meeting-manager/${m.managerToken}`, managerPin: m.managerPin } : {}),
      ...(secrets ? { deskLink: `${PUBLIC_APP_URL}/meeting-desk/${m.deskToken}`, deskPin: m.deskPin, publicLink: m.publicToken ? `${PUBLIC_APP_URL}/meeting/${m.publicToken}` : "" } : {}),
      stats: m.stats || {}, createdByName: m.createdByName || "", createdAt: ms(m.createdAt), invitedAt: ms(m.invitedAt), completedAt: ms(m.completedAt),
      cancelReason: m.cancelReason || "", summary: m.summary || "", callCampaignId: m.callCampaignId || null,
    };
  }

  async function newCode() {
    const year = riyadhDay().slice(0, 4);
    for (let i = 0; i < 8; i++) {
      const code = `MTG-${year}-${crypto.randomInt(10000, 100000)}`;
      if ((await db.collection("meetings").where("code", "==", code).limit(1).get()).empty) return code;
    }
    throw new HttpsError("internal", "تعذّر إنشاء رقم للاجتماع، حاول مرة أخرى.");
  }
  const setToken = (batch, tk, data) => batch.set(db.collection("meetingTokens").doc(tk), { ...data, createdAt: Timestamp.now() });

  // --- staff: list / save -------------------------------------------------
  out.listMeetings = onCall(async (request) => {
    const caller = await meetingCaller(request);
    const snap = await db.collection("meetings").orderBy("date", "desc").limit(300).get();
    return { meetings: snap.docs.filter((x) => inScope(caller, x.data())).map((x) => meetingOut(x.id, x.data())) };
  });

  // «التقارير» → اجتماعات أولياء الأمور: every meeting in the period (the
  // caller's branches) with its numbers; `include` adds optional sections
  // read from the meetings' records:
  //   staff (by teachers / branch administration / academic administration),
  //   grades, survey, attendees (relation of who attended), followUps, topStaff.
  // «دخول المعلمين»: per meeting (in the period / branch), every teacher with
  // whether they signed in to their link.
  out.meetingsAccessReport = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const d = request.data || {};
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
    const from = day(d.from);
    const to = day(d.to);
    const branch = str(d.branch, 60);
    const snap = await db.collection("meetings").orderBy("date", "desc").limit(400).get();
    const list = snap.docs.map((x) => ({ id: x.id, m: x.data() })).filter(({ m }) => inScope(caller, m) && m.status !== "DRAFT" && m.status !== "CANCELLED"
      && (!from || m.date >= from) && (!to || m.date <= to) && (!branch || (m.branches || []).includes(branch)));
    const meetings = [];
    for (let i = 0; i < list.length; i += 8) {
      meetings.push(...await Promise.all(list.slice(i, i + 8).map(async ({ id, m }) => {
        const access = await accessOf(db.collection("meetings").doc(id), m);
        return {
          id, code: m.code, title: m.title, type: m.type, status: m.status, date: m.date, branches: m.branches || [],
          teachers: (m.teachers || []).map((t) => ({ id: t.id, name: t.name, subject: t.subject || "", role: t.role || "TEACHER", ...access[t.id] })),
        };
      })));
    }
    return { meetings, accessSince: ACCESS_SINCE, generatedAt: Date.now() };
  });

  out.meetingsSummaryReport = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const d = request.data || {};
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
    const from = day(d.from);
    const to = day(d.to);
    const branch = str(d.branch, 60);
    const include = new Set((Array.isArray(d.include) ? d.include : []).map(String));
    const snap = await db.collection("meetings").orderBy("date", "desc").limit(400).get();
    const list = snap.docs.map((x) => ({ id: x.id, m: x.data() })).filter(({ m }) => inScope(caller, m)
      && (!from || m.date >= from) && (!to || m.date <= to) && (!branch || (m.branches || []).includes(branch)));
    const meetings = list.map(({ id, m }) => {
      const o = meetingOut(id, m);
      return { id, code: o.code, title: o.title, type: o.type, status: o.status, date: o.date, branches: o.branches, stages: o.stages, stats: o.stats, teachers: (m.teachers || []).length };
    });
    const extra = {};
    const live = list.filter(({ m }) => m.status !== "DRAFT" && m.status !== "CANCELLED");
    if (include.size && live.length) {
      const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
      const staff = { TEACHER: { requests: 0, done: 0 }, ADMIN: { requests: 0, done: 0 }, ACADEMIC: { requests: 0, done: 0 } };
      const positions = {};
      const grades = {};
      const survey = { count: 0, overall: 0, organization: 0, usefulness: 0, answered: {}, low: 0 };
      const attendees = {};
      const followUps = {};
      const top = {};
      const purposeItems = [];
      for (const { id, m } of live) {
        const ref = db.collection("meetings").doc(id);
        const roleOf = (staffId) => slotOf(staffId)?.role || (m.teachers || []).find((t) => t.id === staffId)?.role || "TEACHER";
        const [inv, reqs, slots, surveys, minutes] = await Promise.all([
          include.has("grades") || include.has("attendees") ? ref.collection("invites").get() : null,
          include.has("staff") || include.has("purposes") ? ref.collection("requests").get() : null,
          include.has("staff") || include.has("purposes") ? ref.collection("slots").get() : null,
          include.has("survey") ? ref.collection("surveys").get() : null,
          include.has("followUps") || include.has("topStaff") ? db.collection("meetingMinutes").where("meetingId", "==", id).get() : null,
        ]);
        if (include.has("purposes")) {
          // Teachers only: what parents wrote they want to discuss.
          const teacherOf = (id) => (m.teachers || []).find((t) => t.id === id && (t.role || "TEACHER") === "TEACHER");
          reqs.docs.map((x) => x.data()).filter((r) => !(r.status === "CANCELLED" && r.cancelledBy === "ولي الأمر")).forEach((r) => {
            const t = teacherOf(r.staffId);
            if (t && r.purpose) purposeItems.push({ purpose: r.purpose, subject: t.subject });
          });
          slots.docs.map((x) => x.data()).forEach((sl) => { const t = teacherOf(sl.teacherId); if (t && sl.topic) purposeItems.push({ purpose: sl.topic, subject: t.subject }); });
        }
        if (include.has("staff")) reqs.docs.map((x) => x.data()).filter((r) => r.status !== "CANCELLED").forEach((r) => {
          const role = roleOf(r.staffId);
          staff[role].requests++;
          if (r.status === "DONE") staff[role].done++;
          const slot = slotOf(r.staffId);
          if (slot) { positions[slot.id] = positions[slot.id] || { name: slot.name, role: slot.role, requests: 0, done: 0 }; positions[slot.id].requests++; if (r.status === "DONE") positions[slot.id].done++; }
        });
        if (include.has("staff")) slots.docs.map((x) => x.data()).forEach((s) => { const role = roleOf(s.teacherId); staff[role].requests++; if (s.doneAt) staff[role].done++; });
        inv?.docs.map((x) => x.data()).forEach((i) => {
          if (include.has("grades")) {
            new Set((i.students || []).map((s) => s.grade || "—")).forEach((g) => {
              grades[g] = grades[g] || { families: 0, attend: 0, attended: 0 };
              grades[g].families++;
              if (i.response === "ATTEND") grades[g].attend++;
              if (i.attended === true) grades[g].attended++;
            });
          }
          if (include.has("attendees") && i.attended === true) add(attendees, i.attendee?.relation || "UNKNOWN");
        });
        surveys?.docs.map((x) => x.data()).forEach((s) => {
          survey.count++;
          survey.overall += s.overall || 0;
          survey.organization += s.organization || 0;
          survey.usefulness += s.usefulness || 0;
          if (s.answered) add(survey.answered, s.answered);
          if (s.low) survey.low++;
        });
        minutes?.docs.map((x) => x.data()).forEach((x) => {
          if (x.followUp?.type) add(followUps, x.followUp.type);
          if (include.has("topStaff") && x.teacherName) {
            const k = `${x.teacherName}|${(m.branches || []).join(",")}`;
            top[k] = top[k] || { name: x.teacherName, subject: x.subject || "", role: x.role || "TEACHER", branches: m.branches || [], count: 0 };
            top[k].count++;
          }
        });
      }
      const avg = (v) => (survey.count ? Math.round((v / survey.count) * 100) / 100 : 0);
      if (include.has("staff")) extra.staff = { byRole: staff, positions: Object.values(positions).sort((a, b) => b.requests - a.requests) };
      if (include.has("grades")) extra.grades = grades;
      if (include.has("survey")) extra.survey = { count: survey.count, overall: avg(survey.overall), organization: avg(survey.organization), usefulness: avg(survey.usefulness), answered: survey.answered, low: survey.low };
      if (include.has("attendees")) extra.attendees = attendees;
      if (include.has("followUps")) extra.followUps = followUps;
      if (include.has("purposes")) extra.purposes = tallyPurposes(purposeItems);
      if (include.has("topStaff")) extra.topStaff = Object.values(top).sort((a, b) => b.count - a.count).slice(0, 15);
    }
    return { meetings, extra, generatedAt: Date.now() };
  });

  out.saveMeeting = onCall({ secrets: WA_SECRETS, timeoutSeconds: 300 }, async (request) => {
    const caller = await meetingCaller(request);
    const id = request.data?.id;
    const current = id ? (await loadMeeting(id, caller)).m : null;
    const m = cleanMeeting(request.data?.meeting, current);
    if (m.branches.some((b) => !callerHasBranch(caller, b))) throw new HttpsError("permission-denied", "لا تملك صلاحية إنشاء اجتماعات لهذه الفروع.");
    const now = Timestamp.now();
    if (!id) {
      const ref = db.collection("meetings").doc();
      const code = await newCode();
      const deskToken = token();
      const publicToken = token();
      const batch = db.batch();
      batch.set(ref, { ...m, code, status: "DRAFT", deskToken, deskPin: pin(), publicToken, stats: {}, createdBy: caller.uid, createdByName: caller.name || "", createdAt: now, updatedAt: now });
      setToken(batch, deskToken, { kind: "desk", meetingId: ref.id });
      // The meeting's general link / QR poster (parents sign in on it).
      setToken(batch, publicToken, { kind: "meeting", meetingId: ref.id });
      m.teachers.forEach((t) => setToken(batch, t.token, { kind: "teacher", meetingId: ref.id, teacherId: t.id }));
      await batch.commit();
      await mlog(ref, "MEETING_CREATED", caller);
      return { id: ref.id, code };
    }
    if (["COMPLETED", "CANCELLED"].includes(current.status)) throw new HttpsError("failed-precondition", "لا يمكن تعديل اجتماع منتهٍ أو ملغى.");
    const ref = db.collection("meetings").doc(id);
    const batch = db.batch();
    const known = new Set((current.teachers || []).map((t) => t.token));
    m.teachers.filter((t) => !known.has(t.token)).forEach((t) => setToken(batch, t.token, { kind: "teacher", meetingId: id, teacherId: t.id }));
    const kept = new Set(m.teachers.map((t) => t.token));
    (current.teachers || []).filter((t) => !kept.has(t.token)).forEach((t) => batch.delete(db.collection("meetingTokens").doc(t.token)));
    batch.update(ref, { ...m, updatedAt: now, updatedBy: caller.uid, updatedByName: caller.name || "" });
    await batch.commit();

    // Bookings that no longer fit (teacher removed, time off the grid).
    const valid = new Set(slotTimes(m));
    const teacherIds = new Set(m.teachers.map((t) => t.id));
    const slots = await ref.collection("slots").get();
    const dropped = slots.docs.filter((x) => !teacherIds.has(x.data().teacherId) || !valid.has(x.data().time)).map((x) => ({ ref: x.ref, ...x.data() }));
    const droppedBy = new Map();
    dropped.forEach((s) => droppedBy.set(s.inviteId, [...(droppedBy.get(s.inviteId) || []), s]));
    for (const [inviteId, list] of droppedBy) {
      const invRef = ref.collection("invites").doc(inviteId);
      const cur = (await invRef.get()).data();
      const gone = new Set(list.map((s) => `${s.teacherId}_${s.time}`));
      await Promise.all(list.map((s) => s.ref.delete()));
      if (cur) await invRef.update({ slots: (cur.slots || []).filter((s) => !gone.has(`${s.teacherId}_${s.time}`)) });
    }
    const changed = ["date", "startTime", "endTime", "location", "slotsStart"].some((k) => current[k] !== m[k]);
    let notified = null;
    if (request.data?.notifyChange && current.status !== "DRAFT" && (changed || dropped.length)) {
      const settings = await waSettings();
      if (settings) {
        const inv = (await ref.collection("invites").get()).docs.map((x) => ({ id: x.id, ...x.data() })).filter((i) => i.phone && i.waEvents?.invite && i.response !== "DECLINE");
        const full = { ...current, ...m };
        if (changed) notified = await sendMany(settings, ref, full, inv, "changed");
        else {
          notified = { sent: 0, failed: 0, total: 0 };
          for (const i of inv.filter((y) => droppedBy.has(y.id))) {
            const s = droppedBy.get(i.id)[0];
            const r = await sendMany(settings, ref, full, [i], "slotCancelled", { teacher: (current.teachers || []).find((t) => t.id === s.teacherId)?.name || "", time: s.time });
            notified.sent += r.sent; notified.failed += r.failed; notified.total += 1;
          }
        }
      }
    }
    await mlog(ref, "MEETING_UPDATED", caller, { dropped: dropped.length, notified });
    await refreshStats(ref);
    return { id, code: current.code, dropped: dropped.length, notified };
  });

  // Creates / tops up the family invites from the roster (existing replies
  // are kept; new siblings or students are added to their family).
  async function buildInvites(ref, m) {
    const { families } = await audience(m);
    const existing = new Map((await ref.collection("invites").get()).docs.map((x) => [x.id, x.data()]));
    const codes = new Set([...existing.values()].map((i) => i.code));
    const newCodeFor = () => { for (;;) { const c = String(crypto.randomInt(100000, 1000000)); if (!codes.has(c)) { codes.add(c); return c; } } };
    let created = 0;
    let updated = 0;
    for (let i = 0; i < families.length; i += 200) {
      const batch = db.batch();
      families.slice(i, i + 200).forEach((f) => {
        const invRef = ref.collection("invites").doc(f.key);
        const cur = existing.get(f.key);
        const studentIds = f.students.map((s) => s.id);
        if (cur) {
          const curIds = (cur.students || []).map((s) => s.id).sort().join();
          if (curIds !== [...studentIds].sort().join()) { batch.update(invRef, { students: f.students, studentIds }); updated++; }
          return;
        }
        const tk = token();
        const ck = token();
        batch.set(invRef, {
          token: tk, checkinToken: ck, code: newCodeFor(), phone: f.phone, students: f.students, studentIds,
          wa: { status: f.phone ? "pending" : "noPhone" }, waEvents: {}, response: "", slots: [], createdAt: Timestamp.now(),
        });
        setToken(batch, tk, { kind: "parent", meetingId: ref.id, inviteId: f.key });
        setToken(batch, ck, { kind: "checkin", meetingId: ref.id, inviteId: f.key });
        created++;
      });
      await batch.commit();
    }
    return { created, updated, total: families.length };
  }

  out.meetingAction = onCall({ secrets: WA_SECRETS, timeoutSeconds: 540, memory: "1GiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const { ref, m } = await loadMeeting(request.data?.id, caller);
    const action = request.data?.action;
    const now = Timestamp.now();
    const settings = await waSettings();
    const invites = async () => (await ref.collection("invites").get()).docs.map((x) => ({ id: x.id, ...x.data() }));
    let result = {};

    if (action === "invite") {
      if (!["DRAFT", "OPEN"].includes(m.status)) throw new HttpsError("failed-precondition", "إرسال الدعوات متاح قبل إغلاق التسجيل فقط.");
      if (m.date < riyadhDay()) throw new HttpsError("failed-precondition", "موعد الاجتماع مضى.");
      result.build = await buildInvites(ref, m);
      await ref.update({ status: "OPEN", invitedAt: m.invitedAt || now, updatedAt: now });
      if (settings) {
        const pending = (await invites()).filter((i) => i.phone && !i.waEvents?.invite);
        result.send = await sendMany(settings, ref, m, pending, "invite");
      } else result.manual = true;
    } else if (action === "resend") {
      if (m.status !== "OPEN") throw new HttpsError("failed-precondition", "التسجيل مغلق.");
      if (!settings) throw new HttpsError("failed-precondition", "فعّل واتساب API وأضف اسم قالب «إشعار اجتماع» في الإعدادات، أو أرسل الروابط يدوياً من قائمة المدعوين.");
      if (m.lastResendAt && Date.now() - m.lastResendAt.toMillis() < 10 * 60e3) throw new HttpsError("resource-exhausted", "أُعيد الإرسال قبل أقل من 10 دقائق.");
      const list = (await invites()).filter((i) => i.phone && !i.response);
      result.send = await sendMany(settings, ref, m, list.filter((i) => i.waEvents?.invite), "deadline");
      const fresh = await sendMany(settings, ref, m, list.filter((i) => !i.waEvents?.invite), "invite");
      result.send.sent += fresh.sent; result.send.failed += fresh.failed; result.send.total += fresh.total;
      await ref.update({ lastResendAt: now });
    } else if (action === "close" || action === "reopen") {
      if (!LIVE.includes(m.status)) throw new HttpsError("failed-precondition", "لا يمكن تنفيذ هذا الإجراء في حالة الاجتماع الحالية.");
      await ref.update({ status: action === "close" ? "CLOSED" : "OPEN", updatedAt: now });
    } else if (action === "complete") {
      if (!LIVE.includes(m.status)) throw new HttpsError("failed-precondition", "لا يمكن إنهاء هذا الاجتماع.");
      if (m.date > riyadhDay()) throw new HttpsError("failed-precondition", "يُسجَّل انتهاء الاجتماع في يومه أو بعده.");
      const summary = str(request.data?.summary, 600);
      await ref.update({ status: "COMPLETED", completedAt: now, completedByName: caller.name || "", summary, updatedAt: now });
      const list = await invites();
      const came = list.filter((i) => i.attended === true);
      const absent = list.filter((i) => i.attended !== true);
      const full = { ...m, status: "COMPLETED" };
      if (settings && request.data?.survey !== false) result.survey = await sendMany(settings, ref, full, came.filter((i) => i.phone && !i.waEvents?.thanks), "thanks");
      if (settings && request.data?.absentMessage !== false) result.absent = await sendMany(settings, ref, full, absent.filter((i) => i.phone && i.waEvents?.invite && !i.waEvents?.absent), "absent", { summary });
      if (request.data?.callAbsent !== false && !m.callCampaignId) result.calls = await absentCalls(ref, m, absent, caller);
    } else if (action === "survey") {
      if (m.status !== "COMPLETED") throw new HttpsError("failed-precondition", "يُرسل الاستبيان بعد إنهاء الاجتماع.");
      if (!settings) throw new HttpsError("failed-precondition", "فعّل واتساب API وأضف اسم قالب «إشعار اجتماع» في الإعدادات.");
      const done = new Set((await ref.collection("surveys").get()).docs.map((x) => x.id));
      result.survey = await sendMany(settings, ref, m, (await invites()).filter((i) => i.attended === true && i.phone && !done.has(i.id)), "thanks");
    } else if (action === "cancel") {
      if (["COMPLETED", "CANCELLED"].includes(m.status)) throw new HttpsError("failed-precondition", "لا يمكن إلغاء هذا الاجتماع.");
      const reason = str(request.data?.reason, 300);
      if (!reason) throw new HttpsError("invalid-argument", "اكتب سبب الإلغاء.");
      await ref.update({ status: "CANCELLED", cancelReason: reason, cancelledByName: caller.name || "", updatedAt: now });
      if (settings && request.data?.notify !== false) result.send = await sendMany(settings, ref, m, (await invites()).filter((i) => i.phone && i.waEvents?.invite), "cancelled", { reason });
    } else throw new HttpsError("invalid-argument", "إجراء غير معروف.");

    await mlog(ref, `MEETING_${String(action).toUpperCase()}`, caller, result);
    await refreshStats(ref);
    return result;
  });

  // Absentees → a call campaign in «مهام الاتصال» (distributed there by the
  // call supervisors).
  async function absentCalls(ref, m, absent, caller) {
    const list = absent.map((i) => ({ ...i, callNo: callPhone(i.phone) })).filter((i) => /^05\d{8}$/.test(i.callNo));
    if (!list.length) return { created: 0 };
    const now = Timestamp.now();
    const campRef = db.collection("callCampaigns").doc();
    const title = `متابعة الغائبين عن ${m.title}`;
    const branches = [...new Set(list.map((i) => i.students?.[0]?.branch).filter(Boolean))];
    const day = riyadhDay();
    await campRef.set({
      title, goal: `التواصل مع أولياء الأمور الذين لم يحضروا اجتماع ${m.title} (${formatTripDay(m.date)})، وإبلاغهم بملخصه وتحديد موعد بديل عند الحاجة.`,
      script: `السلام عليكم، معكم ${SCHOOL_NAME}. افتقدنا حضوركم اجتماع أولياء الأمور يوم ${formatTripDay(m.date)}.${m.summary ? ` ${m.summary}` : ""} هل تودون تحديد موعد بديل مع المعلمين؟`,
      outcomes: ["تم تحديد موعد بديل", "أُبلغ بالملخص ولا يحتاج موعداً", "سيتواصل لاحقاً", "لديه ملاحظة"],
      priority: "NORMAL", status: "ACTIVE", startDay: day, endDay: day, dailyQuota: 30, distribution: "MANUAL", agents: [], agentNames: {}, branches,
      targetLabel: `${m.code} — الغائبون`, meetingId: ref.id, createdBy: caller.uid, createdByName: caller.name || "", createdAt: now, updatedAt: now,
      counts: { total: list.length, pending: list.length, done: 0, answered: 0, noAnswer: 0, wrong: 0, failed: 0, unassigned: list.length }, outcomeCounts: {},
    });
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      list.slice(i, i + 400).forEach((inv) => batch.set(db.collection("callTasks").doc(), {
        campaignId: campRef.id, campaignTitle: title, priority: "NORMAL", phone: inv.callNo, branch: inv.students?.[0]?.branch || "",
        studentId: inv.students?.[0]?.id || "", studentIds: (inv.students || []).map((s) => s.id), studentName: names(inv),
        grade: (inv.students || []).map((s) => [s.grade, s.className].filter(Boolean).join(" ")).join("، "),
        status: "PENDING", assignedTo: null, assignedName: "", dueDay: day, dueAt: null, attempts: 0, noAnswerCount: 0, history: [], verifyPending: false,
        meetingId: ref.id, meetingInviteId: inv.id, createdAt: now,
      }));
      await batch.commit();
    }
    await ref.update({ callCampaignId: campRef.id });
    const sup = (await loadActiveUsers()).filter((u) => u.callRoles?.supervisor === true && (u.access === "all" || branches.some((b) => callerHasBranch(u, b)))).map((u) => u.id);
    await notifyUsers(sup, { title: `حملة اتصال جديدة: ${title}`, body: `${list.length} ولي أمر بانتظار التوزيع على موظفي الاتصال.`, complaintId: campRef.id, type: "CALL_ASSIGNED" });
    return { created: list.length, campaignId: campRef.id };
  }

  // --- staff: the meeting with its invites, bookings and minutes ----------
  out.getMeeting = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const { ref, m } = await loadMeeting(request.data?.id, caller);
    // «Interviews on request»: the managers' link (one per meeting, with its code).
    if (requestsMode(m) && !m.managerToken) {
      Object.assign(m, { managerToken: token(), managerPin: pin() });
      const batch = db.batch();
      batch.update(ref, { managerToken: m.managerToken, managerPin: m.managerPin });
      setToken(batch, m.managerToken, { kind: "manager", meetingId: ref.id });
      await batch.commit();
    }
    // Meetings created before the general link existed get one now.
    if (!m.publicToken) {
      m.publicToken = token();
      const batch = db.batch();
      batch.update(ref, { publicToken: m.publicToken });
      setToken(batch, m.publicToken, { kind: "meeting", meetingId: ref.id });
      await batch.commit();
    }
    const [inv, slots, minutes, surveys, settings, reqs] = await Promise.all([
      ref.collection("invites").get(), ref.collection("slots").get(),
      db.collection("meetingMinutes").where("meetingId", "==", ref.id).get(), ref.collection("surveys").get(), waSettings(),
      ref.collection("requests").get(),
    ]);
    const surveyed = new Set(surveys.docs.map((x) => x.id));
    const access = await accessOf(ref, m, { reqs, slots, minutes });
    return {
      access, accessSince: ACCESS_SINCE,
      meeting: meetingOut(ref.id, m, { secrets: true }),
      waReady: !!settings,
      slotTimes: slotTimes(m),
      invites: inv.docs.map((x) => {
        const i = x.data();
        return {
          id: x.id, students: i.students || [], phone: maskPhone(i.phone), hasPhone: !!i.phone, code: i.code, link: link(i),
          wa: { status: i.wa?.status || "", at: ms(i.wa?.at), error: i.wa?.error || "", count: i.wa?.count || 0 },
          invited: !!(i.waEvents?.invite || i.wa?.status === "manual"), response: i.response || "", attendees: i.attendees || 0, topics: i.topics || "",
          respondedAt: ms(i.respondedAt), slots: i.slots || [], attended: i.attended === true, checkedInAt: ms(i.checkedInAt), checkedInBy: i.checkedInBy || "",
          walkIn: i.walkIn === true, surveyed: surveyed.has(x.id), respondedBy: i.respondedBy || "",
          ticketNo: i.ticketNo || null, selfRegistered: i.selfRegistered === true, attendee: i.attendee || null,
        };
      }),
      requests: reqs.docs.map((x) => ({ id: x.id, ...x.data() })).filter(visibleReq).map((r) => ({
        id: r.id, inviteId: r.inviteId, studentId: r.studentId, studentName: r.studentName, staffId: r.staffId, staffName: r.staffName, staffRole: r.staffRole, holder: holderOf(m, r),
        purpose: r.purpose || "", status: shownStatus(r), directedAt: ms(r.directedAt), startedAt: ms(r.startedAt), endedAt: ms(r.endedAt), result: r.result || "",
        rejectReason: isRejected(r) ? r.rejectReason || "" : "", rejectedBy: isRejected(r) ? r.cancelledBy || "" : "",
      })),
      slots: slots.docs.map((x) => ({ id: x.id, teacherId: x.data().teacherId, time: x.data().time, inviteId: x.data().inviteId, startedAt: ms(x.data().startedAt), doneAt: ms(x.data().doneAt) })),
      minutes: minutes.docs.map((x) => ({ id: x.id, teacherId: x.data().teacherId, studentId: x.data().studentId, studentName: x.data().studentName, followUp: x.data().followUp || null, updatedAt: ms(x.data().updatedAt) })),
    };
  });

  // One family: send / resend its link (manual wa.me text without the API),
  // record a reply taken by phone, check in, or cancel one of its bookings.
  out.meetingInviteAction = onCall({ secrets: WA_SECRETS }, async (request) => {
    const caller = await meetingCaller(request);
    const { ref, m } = await loadMeeting(request.data?.id, caller);
    const invRef = ref.collection("invites").doc(String(request.data?.inviteId || "_"));
    const snap = await invRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الدعوة.");
    const inv = { id: snap.id, ...snap.data() };
    const action = request.data?.action;
    const now = Timestamp.now();
    let res = { ok: true };
    if (action === "send") {
      if (!inv.phone) throw new HttpsError("failed-precondition", "لا يوجد رقم جوال لولي الأمر.");
      if (["CANCELLED"].includes(m.status)) throw new HttpsError("failed-precondition", "الاجتماع ملغى.");
      const settings = await waSettings();
      const event = m.status === "COMPLETED" ? (inv.attended ? "thanks" : "absent") : inv.response && inv.response !== "DECLINE" ? "confirm" : "invite";
      const line = LINES[event](m, inv, { summary: m.summary });
      if (!settings) {
        await invRef.update({ "wa.status": inv.waEvents?.invite ? inv.wa?.status || "manual" : "manual", "wa.at": now, "wa.count": FieldValue.increment(1), [`waEvents.${event}`]: inv.waEvents?.[event] || now });
        res = { sent: false, phone: inv.phone, text: `ولي أمر الطالب/ة ${names(inv)}،\n${m.title} — ${when(m)}\n${line}\n${link(inv)}\n${SCHOOL_NAME}` };
      } else {
        if (inv.wa?.at && Date.now() - inv.wa.at.toMillis() < 120e3 && inv.wa?.status === "sent") throw new HttpsError("resource-exhausted", "أُرسل الرابط قبل أقل من دقيقتين.");
        const r = await sendMany(settings, ref, m, [inv], event, { summary: m.summary });
        if (!r.sent) throw new HttpsError("internal", ((await invRef.get()).data()?.wa?.error) || "تعذّر الإرسال.");
        res = { sent: true };
      }
    } else if (action === "respond") {
      const response = RESPONSES.includes(request.data?.response) ? request.data.response : "";
      await invRef.update({ response, attendees: response === "ATTEND" ? Math.min(4, Math.max(1, Number(request.data?.attendees) || 1)) : 0, respondedAt: now, respondedBy: caller.name || "" });
      if (response === "DECLINE") await releaseSlots(ref, inv);
    } else if (action === "checkin") {
      await checkIn(ref, inv.id, caller.name || "");
    } else if (action === "undoCheckin") {
      await invRef.update({ attended: false, checkedInAt: FieldValue.delete(), checkedInBy: FieldValue.delete() });
    } else if (action === "cancelSlot") {
      const slotId = String(request.data?.slotId || "");
      const s = (await ref.collection("slots").doc(slotId).get()).data();
      if (!s || s.inviteId !== inv.id) throw new HttpsError("not-found", "لم يتم العثور على الموعد.");
      await ref.collection("slots").doc(slotId).delete();
      await invRef.update({ slots: (inv.slots || []).filter((x) => !(x.teacherId === s.teacherId && x.time === s.time)) });
      const settings = await waSettings();
      if (settings && request.data?.notify !== false && inv.phone) await sendMany(settings, ref, m, [inv], "slotCancelled", { teacher: teacherName(m, s.teacherId), time: s.time });
    } else throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    await mlog(ref, `INVITE_${String(action).toUpperCase()}`, caller, { inviteId: inv.id });
    await refreshStats(ref);
    return res;
  });

  // Checks a family in and gives it a ticket number (the order of arrival,
  // shown on the parent's ticket and the waiting board). Checking in again
  // keeps the number.
  async function checkIn(ref, inviteId, by) {
    const invRef = ref.collection("invites").doc(inviteId);
    return db.runTransaction(async (tx) => {
      const [mSnap, iSnap] = await Promise.all([tx.get(ref), tx.get(invRef)]);
      const inv = iSnap.data();
      if (!inv) throw new HttpsError("not-found", "لم يتم العثور على الدعوة.");
      if (inv.attended === true && inv.ticketNo) return { ...inv, already: true };
      const now = Timestamp.now();
      let ticketNo = inv.ticketNo;
      if (!ticketNo) {
        ticketNo = (mSnap.data().ticketCounter || 0) + 1;
        tx.update(ref, { ticketCounter: ticketNo });
      }
      tx.update(invRef, { attended: true, checkedInAt: inv.attended ? inv.checkedInAt : now, checkedInBy: inv.attended ? inv.checkedInBy : by, ticketNo });
      return { ...inv, attended: true, checkedInAt: inv.attended ? inv.checkedInAt : now, ticketNo, already: inv.attended === true };
    });
  }

  async function releaseSlots(ref, inv) {
    const batch = db.batch();
    (inv.slots || []).forEach((s) => batch.delete(ref.collection("slots").doc(`${s.teacherId}_${s.time.replace(":", "")}`)));
    batch.update(ref.collection("invites").doc(inv.id), { slots: [] });
    await batch.commit();
  }

  // --- public: token links --------------------------------------------------
  async function byToken(tk, kinds) {
    const t = String(tk || "");
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(t)) throw new HttpsError("not-found", "الرابط غير صحيح.");
    const snap = await db.collection("meetingTokens").doc(t).get();
    if (!snap.exists || !kinds.includes(snap.data().kind)) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    const x = snap.data();
    const ref = db.collection("meetings").doc(x.meetingId);
    const m = (await ref.get()).data();
    if (!m) throw new HttpsError("not-found", "هذا الاجتماع غير متاح.");
    return { ...x, ref, m };
  }
  // Wrong student ID / code: 8 tries an hour per link.
  async function guard(key, ok) {
    const g = db.collection("meetingVerify").doc(key.slice(0, 60));
    const cur = (await g.get()).data() || {};
    const recent = cur.lastAt && Date.now() - cur.lastAt.toMillis() < 3600e3;
    if (recent && (cur.failures || 0) >= 8) throw new HttpsError("resource-exhausted", "محاولات كثيرة، حاول بعد ساعة أو تواصل مع الفرع.");
    if (ok) { if (cur.failures) await g.delete(); return; }
    await g.set({ failures: (recent ? cur.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
  }

  async function publicView(m) {
    const snaps = await db.getAll(...(m.branches || []).map((b) => db.collection("branches").doc(b)));
    const { day } = riyadhNow();
    return {
      code: m.code, title: m.title, type: m.type, status: m.status, date: m.date, dateLabel: formatTripDay(m.date), startTime: m.startTime, endTime: m.endTime,
      location: m.location || "", agenda: m.agenda || "", regDeadline: m.regDeadline, regDeadlineLabel: formatTripDay(m.regDeadline), remote: !!m.teamsLink,
      slotMinutes: m.slotMinutes || 10, branches: m.branches || [], branchNames: snaps.map((s, i) => (s.exists ? s.data().name : m.branches[i])),
      registrationOpen: m.status === "OPEN" && day <= m.regDeadline && day <= m.date, cancelReason: m.status === "CANCELLED" ? m.cancelReason || "" : "",
    };
  }
  // Teachers a family can book: those teaching one of its children's classes
  // (a teacher with no classes listed meets every family).
  const teachesStudent = (t, s) => !(t.classes || []).length || t.classes.includes(`${s.grade}|${s.className}`);
  const teachesFamily = (t, inv) => (inv.students || []).some((s) => teachesStudent(t, s));
  // Who a family can ask to meet for a child: their teachers, and the
  // positions — a department's own position only for that department.
  const canAsk = (t, s) => teachesStudent(t, s) && (!t.section || !["AMERICAN", "BRITISH"].includes(s.section) || t.section === s.section);

  async function parentState(ref, m, inv) {
    const out2 = {
      meeting: await publicView(m),
      invite: {
        students: (inv.students || []).map((s) => ({ id: s.id, name: s.name, grade: s.grade, className: s.className })),
        response: inv.response || "", attendees: inv.attendees || 1, topics: inv.topics || "", slots: inv.slots || [],
        attended: inv.attended === true, code: inv.code, checkinLink: `${PUBLIC_APP_URL}/meeting-in/${inv.checkinToken}`,
      },
      teamsLink: inv.response === "REMOTE" || !individual(m) ? m.teamsLink || "" : "",
      teachers: [],
      surveyOpen: m.status === "COMPLETED" && inv.attended === true,
      surveyDone: false,
      surveyTeachers: [],
    };
    if (individual(m) && LIVE.includes(m.status)) {
      const taken = new Map((await ref.collection("slots").get()).docs.map((x) => [x.id, x.data().inviteId]));
      const times = slotTimes(m);
      out2.teachers = (m.teachers || []).filter((t) => teachesFamily(t, inv)).map((t) => ({
        id: t.id, name: t.name, subject: t.subject, room: t.room,
        slots: times.map((time) => { const who = taken.get(`${t.id}_${time.replace(":", "")}`); return { time, free: !who || who === inv.id }; }),
      }));
    }
    if (out2.surveyOpen) {
      out2.surveyDone = (await ref.collection("surveys").doc(inv.id).get()).exists;
      const met = new Set((inv.slots || []).map((s) => s.teacherId));
      (await db.collection("meetingMinutes").where("meetingId", "==", ref.id).where("inviteId", "==", inv.id).get()).docs.forEach((x) => met.add(x.data().teacherId));
      out2.surveyTeachers = (m.teachers || []).filter((t) => met.has(t.id)).map((t) => ({ id: t.id, name: t.name, subject: t.subject }));
    }
    return out2;
  }

  out.meetingPublic = onCall(async (request) => {
    const { m, kind } = await byToken(request.data?.token, ["parent", "meeting"]);
    if (kind === "meeting" && !requestsMode(m)) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    return { meeting: await publicView(m) };
  });

  async function verifiedParent(request) {
    const x = await byToken(request.data?.token, ["parent"]);
    const studentId = normalizeDigits(request.data?.studentId);
    const invRef = x.ref.collection("invites").doc(x.inviteId);
    const snap = await invRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "الدعوة غير متاحة.");
    const inv = { id: snap.id, ...snap.data() };
    const ok = (inv.studentIds || []).includes(studentId);
    await guard(`p_${request.data.token}`, ok);
    if (!ok) throw new HttpsError("permission-denied", "رقم الهوية لا يطابق أحد الطلاب في هذه الدعوة.");
    return { ...x, invRef, inv };
  }

  out.meetingParentVerify = onCall(async (request) => {
    const { ref, m, inv } = await verifiedParent(request);
    return parentState(ref, m, inv);
  });

  out.meetingParentRespond = onCall({ secrets: WA_SECRETS }, async (request) => {
    const { ref, m, inv, invRef } = await verifiedParent(request);
    const { day } = riyadhNow();
    if (!(m.status === "OPEN" && day <= m.regDeadline && day <= m.date)) throw new HttpsError("failed-precondition", "انتهى موعد التسجيل في هذا الاجتماع. للاستفسار تواصل مع الفرع.");
    const response = RESPONSES.includes(request.data?.response) ? request.data.response : "";
    if (!response) throw new HttpsError("invalid-argument", "اختر الرد.");
    if (response === "REMOTE" && !m.teamsLink) throw new HttpsError("invalid-argument", "الحضور عن بعد غير متاح لهذا الاجتماع.");
    const attendees = response === "ATTEND" ? Math.min(4, Math.max(1, Math.floor(Number(request.data?.attendees) || 1))) : 0;
    const topics = str(request.data?.topics, 1000);
    const times = new Set(slotTimes(m));
    const teachers = new Map((m.teachers || []).filter((t) => teachesFamily(t, inv)).map((t) => [t.id, t]));
    const seen = new Set();
    const wanted = response !== "ATTEND" || !individual(m) ? [] : (Array.isArray(request.data?.slots) ? request.data.slots : []).map((s) => ({
      teacherId: String(s?.teacherId || ""), time: String(s?.time || ""), topic: str(s?.topic, 300),
    })).filter((s) => teachers.has(s.teacherId) && times.has(s.time) && !seen.has(s.teacherId) && seen.add(s.teacherId));
    if (wanted.length > MAX_SLOTS) throw new HttpsError("invalid-argument", `يمكن حجز ${MAX_SLOTS} مواعيد كحد أقصى.`);
    if (new Set(wanted.map((s) => s.time)).size !== wanted.length) throw new HttpsError("invalid-argument", "لا يمكن حجز موعدين في الوقت نفسه؛ اختر وقتاً مختلفاً لكل معلم.");
    const sid = (s) => `${s.teacherId}_${s.time.replace(":", "")}`;
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(invRef)).data();
      const oldIds = (fresh.slots || []).map(sid);
      const newIds = wanted.map(sid);
      const snaps = newIds.length ? await tx.getAll(...newIds.map((id) => ref.collection("slots").doc(id))) : [];
      snaps.forEach((s, i) => {
        if (s.exists && s.data().inviteId !== inv.id) {
          const w = wanted[i];
          throw new HttpsError("already-exists", `موعد ${teachers.get(w.teacherId).name} الساعة ${time12(w.time)} حُجز للتو لولي أمر آخر، اختر وقتاً آخر.`);
        }
      });
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => tx.delete(ref.collection("slots").doc(id)));
      wanted.forEach((w, i) => {
        const prev = snaps[i].exists ? snaps[i].data() : null;
        tx.set(ref.collection("slots").doc(newIds[i]), {
          teacherId: w.teacherId, time: w.time, inviteId: inv.id, topic: w.topic,
          studentNames: names(inv), classes: (inv.students || []).map((s) => s.className).filter(Boolean),
          bookedAt: prev?.bookedAt || now, ...(prev?.startedAt ? { startedAt: prev.startedAt } : {}), ...(prev?.doneAt ? { doneAt: prev.doneAt } : {}),
        });
      });
      tx.update(invRef, { response, attendees, topics, slots: wanted, respondedAt: now, respondedBy: "ولي الأمر" });
    });
    const updated = { ...inv, response, attendees, topics, slots: wanted };
    // Confirmation with the entry code (once per change of reply/bookings).
    if (response !== "DECLINE" && inv.phone) {
      const settings = await waSettings();
      if (settings && settings.autoSend !== false) await sendMany(settings, ref, m, [updated], "confirm").catch(() => {});
    }
    await mlog(ref, "PARENT_RESPONDED", { name: "ولي الأمر" }, { inviteId: inv.id, response, slots: wanted.length });
    await refreshStats(ref);
    return parentState(ref, m, updated);
  });

  out.meetingParentSurvey = onCall(async (request) => {
    const { ref, m, inv } = await verifiedParent(request);
    if (m.status !== "COMPLETED" || inv.attended !== true) throw new HttpsError("failed-precondition", "الاستبيان متاح لمن حضر الاجتماع بعد انتهائه.");
    return saveSurvey(ref, m, inv, request.data || {});
  });

  async function saveSurvey(ref, m, inv, d2) {
    const sRef = ref.collection("surveys").doc(inv.id);
    if ((await sRef.get()).exists) throw new HttpsError("already-exists", "تم استلام تقييمكم مسبقاً، شكراً لكم.");
    const r = (v) => { const n = Math.floor(Number(v)); return n >= 1 && n <= 5 ? n : 0; };
    const survey = {
      overall: r(d2.overall), organization: r(d2.organization), usefulness: r(d2.usefulness),
      teachers: Object.fromEntries(Object.entries(d2.teachers || {}).filter(([k]) => (m.teachers || []).some((t) => t.id === k) || !!slotOf(k)).map(([k, v]) => [k, r(v)]).filter(([, v]) => v)),
      answered: ["YES", "PARTLY", "NO"].includes(d2.answered) ? d2.answered : "",
      comment: str(d2.comment, 1000),
    };
    if (!survey.overall || !survey.organization || !survey.usefulness || !survey.answered) throw new HttpsError("invalid-argument", "أكمل التقييم.");
    survey.low = [survey.overall, survey.organization, survey.usefulness, ...Object.values(survey.teachers)].some((v) => v <= 2);
    await sRef.set({ ...survey, inviteId: inv.id, studentNames: names(inv), branch: inv.students?.[0]?.branch || "", createdAt: Timestamp.now() });
    if (survey.low) {
      const branch = inv.students?.[0]?.branch || "";
      const users = await loadActiveUsers();
      const ids = [m.createdBy, ...users.filter((u) => meetingsAllowed(u) && u.isPrincipal === true && callerHasBranch(u, branch)).map((u) => u.id)];
      await notifyUsers(ids, { title: "تقييم منخفض لاجتماع أولياء الأمور", body: `${m.title}: ولي أمر ${names(inv)} قيّم بـ ${survey.overall} من 5 — يُرجى التواصل معه.`, complaintId: ref.id, type: "MEETING_LOW_RATING" });
    }
    await refreshStats(ref);
    return { ok: true };
  }

  // --- interviews on request: the family's page ----------------------------
  // From the meeting's general link (or a family's own link) the parent signs
  // in with their national ID (or a child's ID); the
  // page then works with the family's link + a session key kept in the browser.
  async function familyStudents(idRaw) {
    const id = normalizeDigits(idRaw).replace(/\D/g, "");
    if (!/^\d{6,15}$/.test(id)) return { id, list: [] };
    const byParent = (await db.collection("students").where("parentNationalId", "==", id).get()).docs.map((x) => x.data());
    if (byParent.length) return { id, parentId: id, list: byParent };
    // A child's ID typed instead: that child and the siblings sharing a parent ID.
    const own = (await db.collection("students").doc(id).get()).data();
    if (!own) return { id, list: [] };
    const pid = parentIdOf(own);
    if (pid) {
      const sib = (await db.collection("students").where("parentNationalId", "==", pid).get()).docs.map((x) => x.data());
      return { id, parentId: pid, list: sib.length ? sib : [own] };
    }
    return { id, list: [own] };
  }
  const staffOut = (t) => ({ id: t.id, name: t.name, subject: t.subject || "", room: t.room || "", role: t.role || "TEACHER", position: t.position || "", posSubject: t.posSubject || "", ...(t.slot ? { slot: true } : {}) });

  async function familyState(ref, m, inv) {
    const [view, reqSnap, branchSnaps] = await Promise.all([
      publicView(m),
      ref.collection("requests").where("inviteId", "==", inv.id).get(),
      db.getAll(...[...new Set((inv.students || []).map((s) => s.branch).filter(Boolean))].map((b) => db.collection("branches").doc(b))),
    ]);
    const bName = Object.fromEntries(branchSnaps.map((x) => [x.id, x.exists ? x.data().name : x.id]));
    const reqs = reqSnap.docs.map((x) => ({ id: x.id, ...x.data() })).filter(visibleReq);
    const live = reqs.filter((r) => !isRejected(r));
    const done = live.length > 0 && live.every((r) => r.status === "DONE");
    const surveyOpen = inv.attended === true && (done || m.status === "COMPLETED");
    const met = new Set(reqs.filter((r) => r.status === "DONE").map((r) => r.staffId));
    return {
      meeting: view,
      mode: "REQUESTS",
      invite: {
        response: inv.response || "", attended: inv.attended === true, ticketNo: inv.ticketNo || null, code: inv.code,
        checkinLink: `${PUBLIC_APP_URL}/meeting-in/${inv.checkinToken}`, checkedInAt: ms(inv.checkedInAt), attendee: inv.attendee || null,
        womenOnly: womenOnly(inv.students),
      },
      students: (inv.students || []).map((s) => ({
        id: s.id, name: s.name, grade: s.grade, className: s.className, branch: s.branch, branchName: bName[s.branch] || s.branch || "",
        options: [...(m.teachers || []).filter((t) => (t.role || "TEACHER") === "TEACHER" && teachesStudent(t, s)), ...POSITION_SLOTS.filter((p) => canAsk(p, s))].map(staffOut),
      })),
      requests: reqs.map((r) => ({
        id: r.id, studentId: r.studentId, staffId: r.staffId, staffName: r.staffName, staffRole: r.staffRole, room: staffRoom(m, r.staffId), holder: holderOf(m, r), position: r.position || "", posSubject: r.posSubject || "",
        purpose: r.purpose || "", status: shownStatus(r), directedAt: ms(r.directedAt), startedAt: ms(r.startedAt), endedAt: ms(r.endedAt),
        rejectReason: isRejected(r) ? r.rejectReason || "" : "",
      })),
      allDone: done,
      surveyOpen,
      surveyDone: surveyOpen ? (await ref.collection("surveys").doc(inv.id).get()).exists : false,
      surveyTeachers: [...(m.teachers || []), ...POSITION_SLOTS].filter((t) => met.has(t.id)).map((t) => ({ ...staffOut(t), name: t.slot ? `${t.name}${onDutyOf(m, t.id)?.name ? ` — ${onDutyOf(m, t.id).name}` : ""}` : t.name })),
      teamsLink: "",
    };
  }

  async function newInviteCode(ref) {
    const codes = new Set((await ref.collection("invites").get()).docs.map((x) => x.data().code));
    for (;;) { const c = String(crypto.randomInt(100000, 1000000)); if (!codes.has(c)) return c; }
  }

  // The family's invite in one meeting (created when the parent signs in
  // there first), with the children of the family that meeting is for.
  async function ensureFamilyInvite(ref, m, active, parentId, intl, branchOf) {
    const inMeeting = active.filter((s) => targets(m, s, branchOf));
    if (!inMeeting.length) return null;
    const key = parentId ? `P${parentId}` : familyKeyFor(m, inMeeting[0]);
    const invRef = ref.collection("invites").doc(key);
    let inv = (await invRef.get()).data();
    const kids = inMeeting.map((s) => kid(s, branchOf));
    if (!inv) {
      const tk = token();
      const ck = token();
      inv = {
        token: tk, checkinToken: ck, code: await newInviteCode(ref), phone: intl, students: kids, studentIds: kids.map((k) => k.id),
        wa: { status: "self" }, waEvents: {}, response: "", slots: [], requested: [], session: token(), selfRegistered: true, createdAt: Timestamp.now(),
      };
      const batch = db.batch();
      batch.set(invRef, inv);
      setToken(batch, tk, { kind: "parent", meetingId: ref.id, inviteId: key });
      setToken(batch, ck, { kind: "checkin", meetingId: ref.id, inviteId: key });
      await batch.commit();
    } else {
      const update = {};
      if (!inv.session) update.session = token();
      const ids = kids.map((k) => k.id).sort().join();
      if (ids !== [...(inv.studentIds || [])].sort().join()) Object.assign(update, { students: kids, studentIds: kids.map((k) => k.id) });
      if (!inv.phone) update.phone = intl;
      if (Object.keys(update).length) { await invRef.update(update); inv = { ...inv, ...update }; }
    }
    return { key, inv: { id: key, ...inv }, inMeeting };
  }

  // The parent's national ID (or a child's ID). The family's WhatsApp
  // number is the one the school has for the children.
  async function verifiedFamily(request, guardKey) {
    const { id, parentId, list } = await familyStudents(request.data?.id);
    const active = list.filter((s) => s.nationalId && s.active !== false);
    const ok = active.length > 0;
    await guard(`${guardKey}_${id}`, ok);
    if (!ok) throw new HttpsError("permission-denied", "لم نجد طلاباً مسجّلين بهذا الرقم. تأكدوا من رقم هوية ولي الأمر.");
    const intl = active.map((s) => toIntlNumber(s.mobile)).find((p) => /^\d{10,15}$/.test(p)) || "";
    return { parentId, intl, active, branchOf: await branchResolver() };
  }

  out.meetingFamilyVerify = onCall(async (request) => {
    const x = await byToken(request.data?.token, ["parent", "meeting"]);
    if (!requestsMode(x.m)) throw new HttpsError("failed-precondition", "هذا الرابط لا يستخدم طلب المقابلات.");
    if (x.m.status === "CANCELLED") throw new HttpsError("failed-precondition", "تم إلغاء هذا الاجتماع.");
    const { parentId, intl, active, branchOf } = await verifiedFamily(request, `f_${x.ref.id}`);
    const fam = await ensureFamilyInvite(x.ref, x.m, active, parentId, intl, branchOf);
    if (!fam) throw new HttpsError("failed-precondition", "أبناؤكم المسجّلون غير مدعوّين لهذا الاجتماع (الفرع أو الصف). للاستفسار تواصلوا مع الفرع.");
    const others = active.filter((s) => !fam.inMeeting.includes(s)).map((s) => ({ name: s.nameAr || s.name || "", grade: studentGrade(s), branch: branchOf(s) }));
    return { session: fam.inv.session, familyToken: fam.inv.token, others, ...(await familyState(x.ref, x.m, fam.inv)) };
  });

  // «رابط أولياء الأمور العام»: one link for every branch. The parent signs
  // in once and gets, for each current «interviews on request» meeting one of
  // their children is invited to (one per branch, usually), the family's
  // session there — each with its own requests and its own ticket.
  out.meetingPortalVerify = onCall(async (request) => {
    const { parentId, intl, active, branchOf } = await verifiedFamily(request, "portal");
    const since = riyadhDay(-7);
    const snap = await db.collection("meetings").where("date", ">=", since).get();
    const meetings = snap.docs.filter((x) => requestsMode(x.data()) && ["OPEN", "CLOSED", "COMPLETED"].includes(x.data().status))
      .sort((a, b) => a.data().date.localeCompare(b.data().date));
    const sessions = [];
    const covered = new Set();
    for (const x of meetings) {
      const m = x.data();
      const kidsHere = active.filter((s) => targets(m, s, branchOf));
      if (!kidsHere.length) continue;
      // A finished meeting only for families who took part (for the survey).
      if (m.status === "COMPLETED") {
        const key = parentId ? `P${parentId}` : familyKeyFor(m, kidsHere[0]);
        const inv = (await x.ref.collection("invites").doc(key).get()).data();
        if (!inv?.response) continue;
      }
      const fam = await ensureFamilyInvite(x.ref, m, active, parentId, intl, branchOf);
      if (!fam) continue;
      fam.inMeeting.forEach((s) => covered.add(String(s.nationalId)));
      sessions.push({ familyToken: fam.inv.token, session: fam.inv.session, ...(await familyState(x.ref, m, fam.inv)) });
    }
    const branchSnaps = await db.getAll(...[...new Set(active.map((s) => branchOf(s)).filter(Boolean))].map((b) => db.collection("branches").doc(b)));
    const bName = Object.fromEntries(branchSnaps.map((b) => [b.id, b.exists ? b.data().name : b.id]));
    return {
      sessions,
      // Children with no current meeting in their branch / grade.
      others: active.filter((s) => !covered.has(String(s.nationalId))).map((s) => ({ name: s.nameAr || s.name || "", grade: studentGrade(s), branchName: bName[branchOf(s)] || "" })),
    };
  });

  async function familySession(request) {
    const x = await byToken(request.data?.token, ["parent"]);
    if (!requestsMode(x.m)) throw new HttpsError("failed-precondition", "هذا الرابط لا يستخدم طلب المقابلات.");
    const invRef = x.ref.collection("invites").doc(x.inviteId);
    const snap = await invRef.get();
    const inv = snap.exists ? { id: snap.id, ...snap.data() } : null;
    const session = String(request.data?.session || "");
    if (!inv || !inv.session || session !== inv.session) throw new HttpsError("unauthenticated", "انتهت الجلسة، أدخلوا رقم الهوية مرة أخرى.");
    return { ...x, invRef, inv };
  }

  out.meetingFamilyState = onCall(async (request) => {
    const { ref, m, inv } = await familySession(request);
    return familyState(ref, m, inv);
  });

  out.meetingFamilyRespond = onCall({ secrets: WA_SECRETS }, async (request) => {
    const { ref, m, inv, invRef } = await familySession(request);
    const { day } = riyadhNow();
    if (!(m.status === "OPEN" && day <= m.date)) throw new HttpsError("failed-precondition", "التسجيل في هذا الاجتماع مغلق. للاستفسار تواصلوا مع الفرع.");
    const response = ["ATTEND", "DECLINE"].includes(request.data?.response) ? request.data.response : "";
    if (!response) throw new HttpsError("invalid-argument", "اختر الرد.");
    const staff = new Map([...(m.teachers || []), ...POSITION_SLOTS].map((t) => [t.id, t]));
    const students = new Map((inv.students || []).map((s) => [s.id, s]));
    const seen = new Set();
    const wanted = response !== "ATTEND" ? [] : (Array.isArray(request.data?.requests) ? request.data.requests : []).slice(0, 40).map((r) => ({
      studentId: String(r?.studentId || ""), staffId: String(r?.staffId || ""), purpose: str(r?.purpose, 600),
    })).filter((r) => {
      const st = students.get(r.studentId);
      const t = staff.get(r.staffId);
      const k = `${r.studentId}_${r.staffId}`;
      if (!st || !t || !canAsk(t, st) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (response === "ATTEND" && !wanted.length) throw new HttpsError("invalid-argument", "اختاروا من تودّون مقابلته لأحد الأبناء على الأقل.");
    if (wanted.some((r) => !r.purpose)) throw new HttpsError("invalid-argument", "اكتبوا الغرض من كل مقابلة.");
    const attendee = attendeeOf(request.data?.attendee);
    if (response === "ATTEND" && !attendee) throw new HttpsError("invalid-argument", "اكتبوا اسم من سيحضر وصلته بالطالب/ة.");
    checkAttendee(attendee, inv.students);
    const now = Timestamp.now();
    const existing = new Map((await ref.collection("requests").where("inviteId", "==", inv.id).get()).docs.map((x) => [x.id, x.data()]));
    const batch = db.batch();
    const keep = new Set();
    wanted.forEach((r) => {
      const docId = `${inv.id}_${r.studentId}_${r.staffId}`;
      keep.add(docId);
      const cur = existing.get(docId);
      if (cur && (["IN_PROGRESS", "DONE"].includes(cur.status) || isRejected(cur))) return;
      const st = students.get(r.studentId);
      const t = staff.get(r.staffId);
      batch.set(ref.collection("requests").doc(docId), {
        inviteId: inv.id, studentId: st.id, studentName: st.name, grade: st.grade || "", className: st.className || "", branch: st.branch || "", section: st.section || "",
        staffId: t.id, staffName: t.name, staffRole: t.role || "TEACHER", position: t.position || "", posSubject: t.posSubject || "", purpose: r.purpose,
        status: cur && cur.status !== "CANCELLED" ? cur.status : "REQUESTED", createdAt: cur?.createdAt || now, updatedAt: now,
      }, { merge: true });
    });
    existing.forEach((r, docId) => {
      if (!keep.has(docId) && ["REQUESTED", "DIRECTED"].includes(r.status)) batch.update(ref.collection("requests").doc(docId), { status: "CANCELLED", cancelledAt: now, cancelledBy: "ولي الأمر" });
    });
    const requested = wanted.map((r) => ({ studentId: r.studentId, staffId: r.staffId }));
    batch.update(invRef, { response, respondedAt: now, respondedBy: "ولي الأمر", requested, attendees: response === "ATTEND" ? 1 : 0, ...(attendee ? { attendee } : {}) });
    await batch.commit();
    const updated = { ...inv, response, requested, ...(attendee ? { attendee } : {}) };
    if (response === "ATTEND" && inv.phone) {
      const settings = await waSettings();
      if (settings && settings.autoSend !== false) await sendMany(settings, ref, m, [updated], "confirm").catch(() => {});
    }
    await mlog(ref, "PARENT_REQUESTED", { name: "ولي الأمر" }, { inviteId: inv.id, response, requests: wanted.length });
    await refreshStats(ref);
    return familyState(ref, m, updated);
  });

  out.meetingFamilySurvey = onCall(async (request) => {
    const { ref, m, inv } = await familySession(request);
    const st = await familyState(ref, m, inv);
    if (!st.surveyOpen) throw new HttpsError("failed-precondition", "التقييم متاح بعد انتهاء مقابلاتكم.");
    return saveSurvey(ref, m, inv, request.data || {});
  });

  // When a family's last open interview ends: thanks + survey (once).
  async function familyFinished(ref, m, inviteId) {
    const reqs = (await ref.collection("requests").where("inviteId", "==", inviteId).get()).docs.map((x) => x.data()).filter((r) => r.status !== "CANCELLED");
    if (!reqs.length || !reqs.every((r) => r.status === "DONE")) return false;
    const inv = { id: inviteId, ...(await ref.collection("invites").doc(inviteId).get()).data() };
    if (inv.waEvents?.thanksDone || !inv.phone) return true;
    const settings = await waSettings();
    if (settings && settings.autoSend !== false) await sendMany(settings, ref, m, [inv], "thanksDone").catch(() => {});
    return true;
  }

  // --- teachers and reception (link + 4-digit code) -----------------------
  async function staffLink(request, kind) {
    const x = await byToken(request.data?.token, [kind]);
    const teacher = kind === "teacher" ? (x.m.teachers || []).find((t) => t.id === x.teacherId) : null;
    if (kind === "teacher" && !teacher) throw new HttpsError("not-found", "هذا الرابط لم يعد مرتبطاً بالاجتماع.");
    const ok = String(request.data?.pin || "") === (kind === "teacher" ? teacher.pin : kind === "manager" ? x.m.managerPin : x.m.deskPin);
    await guard(`${kind}_${request.data.token}`, ok);
    if (!ok) throw new HttpsError("permission-denied", "رمز الدخول غير صحيح.");
    if (x.m.status === "CANCELLED") throw new HttpsError("failed-precondition", "الاجتماع ملغى.");
    if (kind === "teacher") await noteAccess(x.ref, teacher);
    return { ...x, teacher };
  }

  // Teachers' sign-ins: the first and the last time each one opened their
  // link, written at most every 5 minutes per teacher (the page refreshes
  // itself every 30 seconds). Recorded from ACCESS_SINCE; before that a
  // teacher counts as signed in when they did something on their screen.
  const ACCESS_SINCE = "2026-11-13";
  const seenAt = new Map();
  async function noteAccess(ref, teacher) {
    const key = `${ref.id}_${teacher.id}`;
    if (Date.now() - (seenAt.get(key) || 0) < 5 * 60e3) return;
    seenAt.set(key, Date.now());
    try {
      const a = ref.collection("access").doc(teacher.id);
      const cur = (await a.get()).data();
      const now = Timestamp.now();
      await a.set({ teacherId: teacher.id, name: teacher.name, firstAt: cur?.firstAt || now, lastAt: now, sessions: (cur?.sessions || 0) + 1 });
    } catch (err) { console.error("noteAccess", err.message); }
  }

  // Who of a meeting's teachers signed in: {teacherId: {entered: "login" |
  // "activity" | "", firstAt, lastAt, asked, done}}.
  async function accessOf(ref, m, pre = {}) {
    const [acc, reqs, slots, minutes] = await Promise.all([
      ref.collection("access").get(), pre.reqs || ref.collection("requests").get(), pre.slots || ref.collection("slots").get(),
      pre.minutes || db.collection("meetingMinutes").where("meetingId", "==", ref.id).get(),
    ]);
    const access = new Map(acc.docs.map((x) => [x.id, x.data()]));
    const names = new Map((m.teachers || []).map((t) => [t.id, t.name]));
    const acted = new Set();
    const asked = {};
    const done = {};
    const add = (o, k) => { o[k] = (o[k] || 0) + 1; };
    reqs.docs.map((x) => x.data()).forEach((r) => {
      if (r.status !== "CANCELLED" || isRejected(r)) add(asked, r.staffId);
      if (r.status === "DONE") add(done, r.staffId);
      if (r.startedAt || r.status === "DONE" || (r.status === "CANCELLED" && r.cancelledBy && r.cancelledBy === names.get(r.staffId))) acted.add(r.staffId);
    });
    slots.docs.map((x) => x.data()).forEach((sl) => {
      add(asked, sl.teacherId);
      if (sl.doneAt) add(done, sl.teacherId);
      if (sl.startedAt || sl.doneAt) acted.add(sl.teacherId);
    });
    minutes.docs.forEach((x) => acted.add(x.data().teacherId));
    return Object.fromEntries((m.teachers || []).map((t) => {
      const a = access.get(t.id);
      return [t.id, { entered: a ? "login" : acted.has(t.id) ? "activity" : "", firstAt: ms(a?.firstAt), lastAt: ms(a?.lastAt), asked: asked[t.id] || 0, done: done[t.id] || 0 }];
    }));
  }

  // Interviews on request: the person's requests, the ones in the building
  // first (in the meeting, directed to them, waiting by ticket), then those
  // not arrived yet, then the finished ones.
  async function requestsState(ref, m, teacher) {
    const [reqs, inv] = await Promise.all([ref.collection("requests").where("staffId", "==", teacher.id).get(), ref.collection("invites").get()]);
    const invites = new Map(inv.docs.map((x) => [x.id, x.data()]));
    const rank = (r) => (r.status === "IN_PROGRESS" ? 0 : r.status === "DIRECTED" ? 1 : r.status === "DONE" ? 4 : r.status === "REJECTED" ? 5 : r.arrived ? 2 : 3);
    const requests = reqs.docs.map((x) => ({ id: x.id, ...x.data() })).filter(visibleReq).map((r) => {
      const i = invites.get(r.inviteId) || {};
      return {
        id: r.id, inviteId: r.inviteId, studentId: r.studentId, studentName: r.studentName, grade: r.grade, className: r.className, purpose: r.purpose || "",
        status: shownStatus(r), arrived: i.attended === true, ticketNo: i.ticketNo || null, checkedInAt: ms(i.checkedInAt), attendee: i.attendee || null,
        rejectReason: isRejected(r) ? r.rejectReason || "" : "", rejectedBy: isRejected(r) ? r.cancelledBy || "" : "", rejectedAt: isRejected(r) ? ms(r.cancelledAt) : null,
        directedAt: ms(r.directedAt), startedAt: ms(r.startedAt), endedAt: ms(r.endedAt), result: r.result || "", recommendations: r.recommendations || "",
        followUp: r.followUp || null, autoClosed: r.autoClosed === true,
        // The other people this family asked to meet (to plan together).
        others: (i.requested || []).filter((o) => o.staffId !== teacher.id && o.studentId === r.studentId).map((o) => teacherName(m, o.staffId)).filter(Boolean),
      };
    }).sort((a, b) => rank(a) - rank(b) || (a.ticketNo || 1e9) - (b.ticketNo || 1e9) || String(a.studentName).localeCompare(String(b.studentName), "ar"));
    return {
      meeting: { ...(await publicView(m)), teamsLink: m.teamsLink || "" },
      teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject, room: teacher.room, role: teacher.role || "TEACHER" },
      mode: "REQUESTS", requests, slots: [], others: [], minutes: [],
    };
  }

  async function teacherState(ref, m, teacher) {
    if (requestsMode(m)) return requestsState(ref, m, teacher);
    const [slots, inv, minutes] = await Promise.all([
      ref.collection("slots").where("teacherId", "==", teacher.id).get(),
      ref.collection("invites").get(),
      db.collection("meetingMinutes").where("meetingId", "==", ref.id).where("teacherId", "==", teacher.id).get(),
    ]);
    const invites = new Map(inv.docs.map((x) => [x.id, x.data()]));
    // Only the children this teacher teaches.
    const studentsOf = (i) => (i?.students || []).filter((s) => teachesStudent(teacher, s)).map((s) => ({ id: s.id, name: s.name, grade: s.grade, className: s.className }));
    const mine = slots.docs.map((x) => {
      const s = x.data();
      const i = invites.get(s.inviteId);
      return { id: x.id, time: s.time, inviteId: s.inviteId, topic: s.topic || "", generalTopics: i?.topics || "", students: studentsOf(i), arrived: i?.attended === true, startedAt: ms(s.startedAt), doneAt: ms(s.doneAt) };
    }).sort((a, b) => a.time.localeCompare(b.time));
    // Families who came and whose children this teacher teaches (general
    // session or a parent who stops by without a booking).
    const booked = new Set(mine.map((s) => s.inviteId));
    const others = [...invites.entries()].filter(([id, i]) => !booked.has(id) && i.attended === true && teachesFamily(teacher, i))
      .map(([id, i]) => ({ inviteId: id, students: studentsOf(i), topics: i.topics || "" }));
    return {
      meeting: { ...(await publicView(m)), teamsLink: m.teamsLink || "" },
      teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject, room: teacher.room },
      slots: mine,
      others,
      minutes: minutes.docs.map((x) => ({ id: x.id, ...x.data(), createdAt: ms(x.data().createdAt), updatedAt: ms(x.data().updatedAt) })).map(({ meetingTitle, ...rest }) => rest),
    };
  }

  out.meetingTeacher = onCall(async (request) => {
    const { ref, m, teacher } = await staffLink(request, "teacher");
    return teacherState(ref, m, teacher);
  });

  out.meetingTeacherAction = onCall({ timeoutSeconds: 120 }, async (request) => {
    const { ref, m, teacher } = await staffLink(request, "teacher");
    const action = request.data?.action;
    const now = Timestamp.now();
    if (action === "start") {
      const sRef = ref.collection("slots").doc(String(request.data?.slotId || "_"));
      const s = (await sRef.get()).data();
      if (!s || s.teacherId !== teacher.id) throw new HttpsError("not-found", "لم يتم العثور على الموعد.");
      if (!s.startedAt) await sRef.update({ startedAt: now });
    } else if (action === "saveMinute") {
      const studentId = normalizeDigits(request.data?.studentId);
      const inviteId = String(request.data?.inviteId || "");
      const invSnap = await ref.collection("invites").doc(inviteId || "_").get();
      const inv = invSnap.data();
      const student = (inv?.students || []).find((s) => s.id === studentId);
      if (!student) throw new HttpsError("not-found", "الطالب غير موجود في دعوات هذا الاجتماع.");
      const hasSlot = (inv.slots || []).some((s) => s.teacherId === teacher.id);
      if (!teachesStudent(teacher, student)) throw new HttpsError("permission-denied", "هذا الطالب ليس ضمن فصولك أو مواعيدك.");
      const mRef = db.collection("meetingMinutes").doc(`${ref.id}_${teacher.id}_${studentId}`);
      const cur = (await mRef.get()).data();
      const x = request.data?.minute || {};
      const minute = {
        meetingId: ref.id, meetingTitle: m.title, meetingCode: m.code, date: m.date, branch: student.branch || "",
        teacherId: teacher.id, teacherName: teacher.name, subject: teacher.subject || "", inviteId, studentId, studentName: student.name,
        grade: student.grade || "", className: student.className || "",
        points: str(x.points, 2000), recommendations: str(x.recommendations, 2000), agreements: str(x.agreements, 2000),
        updatedAt: now, createdAt: cur?.createdAt || now, followUp: cur?.followUp || null,
      };
      if (!minute.points && !minute.recommendations && !minute.agreements) throw new HttpsError("invalid-argument", "اكتب نقطة واحدة على الأقل في المحضر.");
      const fType = FOLLOW_TYPES.includes(x.followUpType) ? x.followUpType : "";
      const fText = str(x.followUpText, 1500);
      if (fType && fText && !cur?.followUp?.complaintId) {
        minute.followUp = await followUpComplaint(ref, m, teacher, inv, student, fType, fText);
      }
      await mRef.set(minute);
      if (hasSlot) {
        const slot = (inv.slots || []).find((s) => s.teacherId === teacher.id);
        const sRef = ref.collection("slots").doc(`${teacher.id}_${slot.time.replace(":", "")}`);
        const sd = (await sRef.get()).data();
        if (sd && !sd.doneAt) await sRef.update({ doneAt: now, ...(sd.startedAt ? {} : { startedAt: now }) });
      }
      // A parent the teacher met counts as attended even if reception missed them.
      if (inv.attended !== true) await checkIn(ref, inviteId, `${teacher.name} (المعلم)`);
      await refreshStats(ref);
    } else if (REQUEST_ACTIONS.includes(action)) {
      await requestAction(ref, m, teacher, request.data || {});
      await refreshStats(ref);
    } else throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    return teacherState(ref, (await ref.get()).data(), teacher);
  });

  async function autoClose(ref, m, teacher, d, now) {
    const r = d.data();
    await d.ref.update({ status: "DONE", startedAt: r.startedAt || now, endedAt: now, result: AUTO_CLOSED_NOTE, recommendations: "", followUp: null, closedBy: teacher.name, autoClosed: true });
    const inv = (await ref.collection("invites").doc(r.inviteId).get()).data() || {};
    const student = (inv.students || []).find((st) => st.id === r.studentId) || {};
    await db.collection("meetingMinutes").doc(`${ref.id}_${teacher.id}_${r.studentId}`).set({
      meetingId: ref.id, meetingTitle: m.title, meetingCode: m.code, date: m.date, branch: student.branch || r.branch || "",
      teacherId: teacher.id, teacherName: teacher.name, subject: teacher.subject || "", role: teacher.role || "TEACHER", inviteId: r.inviteId, requestId: d.id,
      studentId: r.studentId, studentName: r.studentName, grade: r.grade || "", className: r.className || "", purpose: r.purpose || "",
      points: AUTO_CLOSED_NOTE, recommendations: "", agreements: "", followUp: null, attendee: inv.attendee || null, createdAt: now, updatedAt: now,
    });
    await familyFinished(ref, m, r.inviteId);
  }

  const REQUEST_ACTIONS = ["startRequest", "endRequest", "skipRequest", "rejectRequest", "restoreRequest"];
  // A request's start / end (with the result) / «not held» / rejection, for a teacher or
  // for a manager signed in on the managers' link.
  async function requestAction(ref, m, teacher, data) {
    const action = data.action;
    const now = Timestamp.now();
      const rRef = ref.collection("requests").doc(String(data.requestId || "_"));
      const r = (await rRef.get()).data();
      if (!r || r.staffId !== teacher.id || (r.status === "CANCELLED" && !(action === "restoreRequest" && isRejected(r)))) throw new HttpsError("not-found", "لم يتم العثور على طلب المقابلة.");
      const invRef = ref.collection("invites").doc(r.inviteId);
      const inv = (await invRef.get()).data() || {};
      if (action === "startRequest") {
        if (r.status === "DONE") throw new HttpsError("failed-precondition", "انتهت هذه المقابلة.");
        if (inv.attended !== true) throw new HttpsError("failed-precondition", "لم يُسجَّل وصول ولي الأمر بعد في الاستقبال.");
        if (r.status !== "IN_PROGRESS") {
          // The person's meeting still open (they forgot to end it) closes now;
          // they can write its result afterwards.
          const open = (await ref.collection("requests").where("staffId", "==", teacher.id).get()).docs
            .filter((d) => d.id !== rRef.id && d.data().status === "IN_PROGRESS" && (d.data().heldBy || teacher.name) === teacher.name);
          for (const d of open) await autoClose(ref, m, teacher, d, now);
          await rRef.update({ status: "IN_PROGRESS", startedAt: now, heldBy: teacher.name });
        }
      } else if (action === "skipRequest") {
        // Not met (the parent left, or it is not needed any more).
        if (r.status === "DONE") throw new HttpsError("failed-precondition", "انتهت هذه المقابلة.");
        await rRef.update({ status: "CANCELLED", cancelledAt: now, cancelledBy: teacher.name, cancelReason: str(data.reason, 300) });
        await familyFinished(ref, m, r.inviteId);
      } else if (action === "rejectRequest") {
        // Declined before it starts, with a reason the family sees.
        if (!["REQUESTED", "DIRECTED"].includes(r.status)) throw new HttpsError("failed-precondition", "لا يمكن رفض مقابلة بدأت أو انتهت.");
        const reason = str(data.reason, 300);
        if (reason.length < 3) throw new HttpsError("invalid-argument", "اكتب سبب رفض المقابلة.");
        await rRef.update({ status: "CANCELLED", rejected: true, rejectReason: reason, cancelReason: reason, cancelledAt: now, cancelledBy: teacher.name, directedAt: FieldValue.delete() });
        await mlog(ref, "REQUEST_REJECTED", { name: teacher.name }, { requestId: rRef.id, inviteId: r.inviteId, studentName: r.studentName || "", reason });
        await familyFinished(ref, m, r.inviteId);
      } else if (action === "restoreRequest") {
        // Undo a rejection — only while the family still asks for it.
        if (!isRejected(r)) throw new HttpsError("failed-precondition", "هذا الطلب غير مرفوض.");
        if (!(inv.requested || []).some((o) => o.studentId === r.studentId && o.staffId === r.staffId)) throw new HttpsError("failed-precondition", "ألغى ولي الأمر هذا الطلب.");
        const del = FieldValue.delete();
        await rRef.update({ status: "REQUESTED", rejected: del, rejectReason: del, cancelReason: del, cancelledAt: del, cancelledBy: del, updatedAt: now });
        await mlog(ref, "REQUEST_RESTORED", { name: teacher.name }, { requestId: rRef.id, inviteId: r.inviteId, studentName: r.studentName || "" });
      } else {
        const x = data.minute || {};
        const result = str(x.result, 3000);
        if (!result) throw new HttpsError("invalid-argument", "اكتب نتيجة المقابلة قبل إغلاقها.");
        if (r.status === "DONE" && !r.autoClosed) throw new HttpsError("failed-precondition", "أُغلقت هذه المقابلة مسبقاً.");
        const student = (inv.students || []).find((st) => st.id === r.studentId) || { id: r.studentId, name: r.studentName, grade: r.grade, className: r.className, branch: r.branch, section: r.section };
        const recommendations = str(x.recommendations, 2000);
        let followUp = null;
        const fType = FOLLOW_TYPES.includes(x.followUpType) ? x.followUpType : "";
        const fText = str(x.followUpText, 1500);
        if (fType && fText) followUp = await followUpComplaint(ref, m, teacher, inv, student, fType, fText);
        await rRef.update({ status: "DONE", startedAt: r.startedAt || now, endedAt: r.autoClosed ? r.endedAt || now : now, result, recommendations, followUp, closedBy: teacher.name, autoClosed: false });
        // Kept with the student's record like the teachers' minutes.
        await db.collection("meetingMinutes").doc(`${ref.id}_${teacher.id}_${r.studentId}`).set({
          meetingId: ref.id, meetingTitle: m.title, meetingCode: m.code, date: m.date, branch: student.branch || "",
          teacherId: teacher.id, teacherName: teacher.name, subject: teacher.subject || "", role: teacher.role || "TEACHER", inviteId: r.inviteId, requestId: rRef.id,
          studentId: r.studentId, studentName: r.studentName, grade: r.grade || "", className: r.className || "", purpose: r.purpose || "",
          points: result, recommendations, agreements: "", followUp, attendee: inv.attendee || null, createdAt: now, updatedAt: now,
        });
        if (inv.attended !== true) await checkIn(ref, r.inviteId, `${teacher.name} (المقابلة)`);
        await familyFinished(ref, m, r.inviteId);
      }
    await refreshStats(ref);
  }

  async function followUpComplaint(ref, m, teacher, inv, student, type, text) {
    const complaintId = await nextRecordNumber("COM");
    const assignees = await findAutoAssignees({ branch: student.branch, departments: [type], stage: student.grade, curriculum: student.section || "" });
    const now = Timestamp.now();
    const docRef = db.collection("complaints").doc();
    await docRef.set({
      parentName: `ولي أمر ${student.name}`, parentPhone: inv.phone ? `0${String(inv.phone).slice(3)}` : "", parentEmail: "",
      studentName: student.name, studentId: student.id, branch: student.branch || "", department: student.section || "", stage: student.grade || "",
      grade: student.className || "", complaintType: type, subType: "", extraTypes: [],
      subject: `متابعة من اجتماع أولياء الأمور: ${m.title}`,
      details: `${text}\n\nمن لقاء ${teacher.name}${teacher.subject ? ` (${teacher.subject})` : ""} — ${m.title} (${m.code})، ${formatTripDay(m.date)}.`,
      complaintId, priority: "NORMAL", source: "PARENT_MEETING", meetingId: ref.id, receiver: null, status: "RECEIVED", attachments: [],
      assignedTo: assignees.map((a) => a.id), assignedToNames: assignees.map((a) => a.name), assignedAt: assignees.length ? now : null,
      reopened: false, isOverdue: false, createdAt: now, updatedAt: now,
    });
    await docRef.collection("activityLog").add({ action: "COMPLAINT_CREATED", actorId: null, actorName: `${teacher.name} (اجتماع أولياء الأمور)`, createdAt: now });
    if (assignees.length) {
      await docRef.collection("activityLog").add({ action: "COMPLAINT_ASSIGNED", actorId: null, actorName: "النظام (إسناد تلقائي)", metadata: { toUserIds: assignees.map((a) => a.id), toUserNames: assignees.map((a) => a.name), addedNames: assignees.map((a) => a.name) }, createdAt: now });
    }
    return { type, text, complaintId: docRef.id, complaintNo: complaintId };
  }

  // --- the managers' link («interviews on request») -------------------------
  // One link + code per meeting. A manager opens it, writes their name and
  // picks their position (and their office), then gets that position's
  // requests like a teacher's board.
  function managerOf(m, data) {
    const slot = slotOf(String(data?.slot || ""));
    const name = str(data?.name, 80);
    if (!slot || name.length < 2) throw new HttpsError("invalid-argument", "اكتب اسمك واختر مسماك الوظيفي.");
    const room = str(data?.room, 60);
    return { id: slot.id, name, subject: slot.name, role: slot.role, room, position: slot.position, posSubject: slot.posSubject };
  }
  out.meetingManager = onCall(async (request) => {
    const { ref, m } = await staffLink(request, "manager");
    if (!request.data?.slot) {
      return { meeting: await publicView(m), positions: POSITION_SLOTS.map(({ id, role, position, posSubject, name }) => ({ id, role, position, posSubject, name })) };
    }
    const teacher = managerOf(m, request.data);
    // On duty for that position: reception and parents see the name and office.
    const onDuty = { ...(m.onDuty || {}), [teacher.id]: { name: teacher.name, room: teacher.room, at: Timestamp.now() } };
    await ref.update({ onDuty });
    return requestsState(ref, { ...m, onDuty }, teacher);
  });
  out.meetingManagerAction = onCall({ timeoutSeconds: 120 }, async (request) => {
    const { ref, m } = await staffLink(request, "manager");
    const teacher = managerOf(m, request.data);
    if (!REQUEST_ACTIONS.includes(request.data?.action)) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    await requestAction(ref, m, teacher, request.data || {});
    return requestsState(ref, (await ref.get()).data(), teacher);
  });

  // Reception desk.
  function deskInvite(id, i) {
    return {
      id, students: (i.students || []).map((s) => ({ name: s.name, grade: s.grade, className: s.className, branch: s.branch || "" })), code: i.code, response: i.response || "", attendees: i.attendees || 0,
      slots: i.slots || [], requested: i.requested || [], attended: i.attended === true, checkedInAt: ms(i.checkedInAt), ticketNo: i.ticketNo || null,
      attendee: i.attendee || null,
    };
  }
  async function deskState(ref, m) {
    const stats = await refreshStats(ref);
    const out3 = { meeting: await publicView(m), teachers: (m.teachers || []).map((t) => ({ id: t.id, name: t.name, room: t.room, subject: t.subject, role: t.role || "TEACHER" })), stats, meetingId: ref.id };
    if (requestsMode(m)) out3.queue = await waitingBoard(ref, m);
    return out3;
  }
  // Interviews on request: the families in the building (by ticket) with each
  // of their requests — the supervisor directs them to the next free person.
  async function waitingBoard(ref, m) {
    const [inv, reqs] = await Promise.all([ref.collection("invites").where("attended", "==", true).get(), ref.collection("requests").get()]);
    const byInvite = new Map();
    reqs.docs.forEach((x) => {
      const r = x.data();
      if (!visibleReq(r)) return;
      (byInvite.get(r.inviteId) || byInvite.set(r.inviteId, []).get(r.inviteId)).push({
        id: x.id, studentName: r.studentName, staffId: r.staffId, staffName: r.staffName, staffRole: r.staffRole, room: staffRoom(m, r.staffId), holder: holderOf(m, r),
        rejectReason: isRejected(r) ? r.rejectReason || "" : "",
        purpose: r.purpose || "", status: shownStatus(r), directedAt: ms(r.directedAt), startedAt: ms(r.startedAt), endedAt: ms(r.endedAt),
      });
    });
    // Who is busy right now (one interview at a time per person).
    const busy = new Set(reqs.docs.map((x) => x.data()).filter((r) => r.status === "IN_PROGRESS").map((r) => r.staffId));
    return inv.docs.map((x) => ({ id: x.id, ...x.data() })).map((i) => ({
      inviteId: i.id, ticketNo: i.ticketNo || null, checkedInAt: ms(i.checkedInAt), attendee: i.attendee || null, students: (i.students || []).map((s) => ({ name: s.name, grade: s.grade, className: s.className })),
      requests: (byInvite.get(i.id) || []).map((r) => ({ ...r, staffBusy: busy.has(r.staffId) && r.status !== "IN_PROGRESS" })),
    })).sort((a, b) => (a.ticketNo || 1e9) - (b.ticketNo || 1e9));
  }
  out.meetingDesk = onCall(async (request) => {
    const { ref, m } = await staffLink(request, "desk");
    return deskState(ref, m);
  });

  out.meetingDeskAction = onCall(async (request) => {
    const { ref, m } = await staffLink(request, "desk");
    const action = request.data?.action;
    if (action === "direct" || action === "undirect") {
      const rRef = ref.collection("requests").doc(String(request.data?.requestId || "_"));
      const r = (await rRef.get()).data();
      if (!r) throw new HttpsError("not-found", "لم يتم العثور على طلب المقابلة.");
      if (action === "direct") {
        if (r.status !== "REQUESTED") throw new HttpsError("failed-precondition", "هذه المقابلة وُجّهت أو بدأت مسبقاً.");
        await rRef.update({ status: "DIRECTED", directedAt: Timestamp.now() });
      } else if (r.status === "DIRECTED") await rRef.update({ status: "REQUESTED", directedAt: FieldValue.delete() });
      return deskState(ref, m);
    }
    if (action === "search") {
      const q = normalizeDigits(String(request.data?.q || "")).trim().toLowerCase();
      if (q.length < 2) return { results: [] };
      const inv = await ref.collection("invites").get();
      const results = inv.docs.filter((x) => {
        const i = x.data();
        return i.code === q || (i.studentIds || []).includes(q) || (q.length >= 4 && /^\d+$/.test(q) && String(i.phone || "").endsWith(q))
          || (i.students || []).some((s) => String(s.name || "").toLowerCase().includes(q));
      }).slice(0, 20).map((x) => deskInvite(x.id, x.data()));
      return { results };
    }
    if (action === "checkin" || action === "undo") {
      const invRef = ref.collection("invites").doc(String(request.data?.inviteId || "_"));
      const i = (await invRef.get()).data();
      if (!i) throw new HttpsError("not-found", "لم يتم العثور على الدعوة.");
      if (action === "checkin") {
        const attendee = attendeeOf(request.data?.attendee);
        checkAttendee(attendee, i.students);
        if (attendee) await invRef.update({ attendee });
        await checkIn(ref, invRef.id, "الاستقبال");
      } else await invRef.update({ attended: false, checkedInAt: FieldValue.delete(), checkedInBy: FieldValue.delete() });
      return { invite: deskInvite(invRef.id, (await invRef.get()).data()), ...(await deskState(ref, m)) };
    }
    if (action === "attendee") {
      const invRef = ref.collection("invites").doc(String(request.data?.inviteId || "_"));
      const cur = (await invRef.get()).data();
      if (!cur) throw new HttpsError("not-found", "لم يتم العثور على الدعوة.");
      const attendee = attendeeOf(request.data?.attendee);
      if (!attendee) throw new HttpsError("invalid-argument", "اكتب اسم الحاضر وصلته بالطالب/ة.");
      checkAttendee(attendee, cur.students);
      await invRef.update({ attendee });
      return { invite: deskInvite(invRef.id, (await invRef.get()).data()), ...(await deskState(ref, m)) };
    }
    if (action === "walkIn") {
      // A parent of a student outside the invited list.
      const studentId = normalizeDigits(request.data?.studentId);
      const s = (await db.collection("students").doc(studentId || "_").get()).data();
      if (!s || s.active === false) throw new HttpsError("not-found", "لم يتم العثور على الطالب/ة.");
      const branchOf = await branchResolver();
      if (!(m.branches || []).includes(branchOf(s))) throw new HttpsError("failed-precondition", "الطالب/ة من فرع غير مشمول بهذا الاجتماع.");
      checkAttendee(attendeeOf(request.data?.attendee), [{ branch: branchOf(s) }]);
      const key = familyKeyFor(m, s);
      const invRef = ref.collection("invites").doc(key);
      const cur = (await invRef.get()).data();
      const now = Timestamp.now();
      if (cur) {
        const students = (cur.students || []).some((k) => k.id === studentId) ? cur.students : [...cur.students, kid(s, branchOf)];
        await invRef.update({ students, studentIds: students.map((k) => k.id) });
      } else {
        const codes = new Set((await ref.collection("invites").get()).docs.map((x) => x.data().code));
        let code;
        do { code = String(crypto.randomInt(100000, 1000000)); } while (codes.has(code));
        const tk = token();
        const ck = token();
        const batch = db.batch();
        const ph = toIntlNumber(s.mobile);
        batch.set(invRef, { token: tk, checkinToken: ck, code, phone: /^\d{10,15}$/.test(ph) ? ph : "", students: [kid(s, branchOf)], studentIds: [studentId], wa: { status: "walkIn" }, waEvents: {}, response: "", slots: [], walkIn: true, createdAt: now });
        setToken(batch, tk, { kind: "parent", meetingId: ref.id, inviteId: key });
        setToken(batch, ck, { kind: "checkin", meetingId: ref.id, inviteId: key });
        await batch.commit();
      }
      const attendee = attendeeOf(request.data?.attendee);
      if (attendee) await invRef.update({ attendee });
      await checkIn(ref, key, "الاستقبال");
      return { invite: deskInvite(key, (await invRef.get()).data()), ...(await deskState(ref, m)) };
    }
    throw new HttpsError("invalid-argument", "إجراء غير معروف.");
  });

  // The parent's QR (/meeting-in/<token>): on a reception phone that opened
  // the desk link (its code is kept in that browser) it checks the family
  // in; anywhere else it shows the entry code.
  out.meetingCheckinScan = onCall(async (request) => {
    const x = await byToken(request.data?.token, ["checkin"]);
    const invRef = x.ref.collection("invites").doc(x.inviteId);
    const i = (await invRef.get()).data();
    if (!i) throw new HttpsError("not-found", "الدعوة غير متاحة.");
    const desks = (Array.isArray(request.data?.desks) ? request.data.desks : []).slice(0, 6);
    const desk = desks.find((dk) => dk && dk.token === x.m.deskToken && String(dk.pin) === x.m.deskPin);
    const first = (i.students || []).map((s) => String(s.name || "").split(/\s+/)[0]).join("، ");
    if (!desk) return { desk: false, title: x.m.title, code: i.code, names: first };
    if (x.m.status === "CANCELLED") throw new HttpsError("failed-precondition", "الاجتماع ملغى.");
    const r = await checkIn(x.ref, x.inviteId, "الاستقبال (QR)");
    await refreshStats(x.ref);
    return { desk: true, already: r.already, title: x.m.title, invite: deskInvite(invRef.id, (await invRef.get()).data()), teachers: (x.m.teachers || []).map((t) => ({ id: t.id, name: t.name, room: t.room, role: t.role || "TEACHER" })) };
  });

  // --- reminders ------------------------------------------------------------
  async function runReminders(when2) {
    const settings = await waSettings();
    if (!settings || settings.autoSend === false) return;
    const today = riyadhDay();
    const tomorrow = riyadhDay(1);
    const day = when2 === "eve" ? tomorrow : today;
    const event = when2 === "eve" ? "eve" : "morning";
    const [onDay, deadline] = await Promise.all([
      db.collection("meetings").where("date", "==", day).get(),
      when2 === "eve" ? db.collection("meetings").where("regDeadline", "==", tomorrow).get() : Promise.resolve({ docs: [] }),
    ]);
    for (const x of onDay.docs) {
      const m = x.data();
      if (!LIVE.includes(m.status) || m.autoReminders === false) continue;
      const list = (await x.ref.collection("invites").get()).docs.map((y) => ({ id: y.id, ...y.data() }))
        .filter((i) => i.phone && ["ATTEND", "REMOTE"].includes(i.response) && !i.waEvents?.[event]);
      const r = await sendMany(settings, x.ref, m, list, event);
      await mlog(x.ref, `MEETING_REMINDER_${event.toUpperCase()}`, null, r);
    }
    for (const x of deadline.docs) {
      const m = x.data();
      if (m.status !== "OPEN" || m.autoReminders === false || m.date <= tomorrow) continue;
      const list = (await x.ref.collection("invites").get()).docs.map((y) => ({ id: y.id, ...y.data() }))
        .filter((i) => i.phone && !i.response && i.waEvents?.invite && !i.waEvents?.deadline);
      const r = await sendMany(settings, x.ref, m, list, "deadline");
      await mlog(x.ref, "MEETING_REMINDER_DEADLINE", null, r);
    }
  }
  out.meetingRemindersEvening = onSchedule({ schedule: "30 17 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 540 }, () => runReminders("eve"));
  out.meetingRemindersMorning = onSchedule({ schedule: "0 7 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 540 }, () => runReminders("morning"));

  // --- report ---------------------------------------------------------------
  // Interviews on request, per person: asked, done, not met, the wait from
  // check-in to the start and the length of the interview (minutes).
  async function requestsReport(ref, m, invites) {
    if (!requestsMode(m)) return null;
    const reqs = (await ref.collection("requests").get()).docs.map((x) => x.data());
    const inv = new Map(invites.map((i) => [i.id, i]));
    const avg = (l) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0);
    const perStaff = (m.teachers || []).map((t) => {
      const mine = reqs.filter((r) => r.staffId === t.id && !(r.status === "CANCELLED" && r.cancelledBy === "ولي الأمر"));
      const done = mine.filter((r) => r.status === "DONE");
      const waits = done.map((r) => { const c = inv.get(r.inviteId)?.checkedInAt; return c && r.startedAt ? Math.max(0, (r.startedAt.toMillis() - c.toMillis()) / 60e3) : null; }).filter((v) => v != null);
      const lengths = done.map((r) => (r.startedAt && r.endedAt ? (r.endedAt.toMillis() - r.startedAt.toMillis()) / 60e3 : null)).filter((v) => v != null);
      return { id: t.id, name: t.name, role: t.role || "TEACHER", subject: t.subject || "", asked: mine.length, done: done.length, notMet: mine.filter((r) => r.status === "CANCELLED" && !isRejected(r)).length, rejected: mine.filter(isRejected).length, avgWait: avg(waits), avgLength: avg(lengths) };
    });
    const active = reqs.filter((r) => !(r.status === "CANCELLED" && r.cancelledBy === "ولي الأمر"));
    return {
      perStaff,
      byRole: STAFF_ROLES.map((role) => ({ role, asked: active.filter((r) => r.staffRole === role).length, done: active.filter((r) => r.staffRole === role && r.status === "DONE").length })),
      purposes: active.filter((r) => r.purpose).map((r) => ({ staff: r.staffName, role: r.staffRole, student: r.studentName, purpose: r.purpose, status: shownStatus(r), rejectReason: isRejected(r) ? r.rejectReason || "" : "" })),
    };
  }
  out.getMeetingReport = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const caller = await meetingCaller(request);
    const { ref, m } = await loadMeeting(request.data?.id, caller);
    const [inv, slots, surveys, minutes, complaints, calls] = await Promise.all([
      ref.collection("invites").get(), ref.collection("slots").get(), ref.collection("surveys").get(),
      db.collection("meetingMinutes").where("meetingId", "==", ref.id).get(),
      db.collection("complaints").where("meetingId", "==", ref.id).get(),
      m.callCampaignId ? db.collection("callTasks").where("campaignId", "==", m.callCampaignId).get() : Promise.resolve({ docs: [] }),
    ]);
    const invites = inv.docs.map((x) => ({ id: x.id, ...x.data() }));
    const tName = (id) => (m.teachers || []).find((t) => t.id === id);
    const callByInvite = new Map(calls.docs.map((x) => [x.data().meetingInviteId, x.data()]));
    const delays = slots.docs.map((x) => x.data()).filter((s) => s.startedAt).map((s) => {
      const start = new Date(`${m.date}T${s.time}:00+03:00`).getTime();
      return Math.round((s.startedAt.toMillis() - start) / 60e3);
    });
    return {
      meeting: meetingOut(ref.id, m),
      stats: await refreshStats(ref),
      students: invites.flatMap((i) => (i.students || []).map((s) => ({
        id: s.id, name: s.name, branch: s.branch, grade: s.grade, className: s.className,
        invited: !!(i.waEvents?.invite || i.wa?.status === "manual" || i.walkIn), wa: i.wa?.status || "", response: i.response || "", attended: i.attended === true, walkIn: i.walkIn === true,
      }))),
      surveys: surveys.docs.map((x) => ({ ...x.data(), createdAt: ms(x.data().createdAt) })),
      teachers: (m.teachers || []).map((t) => {
        const mine = slots.docs.map((x) => x.data()).filter((s) => s.teacherId === t.id);
        const rates = surveys.docs.map((x) => x.data().teachers?.[t.id]).filter((v) => v >= 1);
        return {
          id: t.id, name: t.name, subject: t.subject, booked: mine.length, done: mine.filter((s) => s.doneAt).length,
          minutes: minutes.docs.filter((x) => x.data().teacherId === t.id).length,
          rating: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100 : 0, ratings: rates.length,
        };
      }),
      topics: [
        ...slots.docs.map((x) => x.data()).filter((s) => s.topic).map((s) => ({ topic: s.topic, teacher: tName(s.teacherId)?.name || "", subject: tName(s.teacherId)?.subject || "", students: s.studentNames || "" })),
        ...invites.filter((i) => i.topics).map((i) => ({ topic: i.topics, teacher: "", subject: "", students: names(i) })),
      ],
      punctuality: { count: delays.length, avgDelay: delays.length ? Math.round(delays.reduce((a, b) => a + Math.max(0, b), 0) / delays.length) : 0 },
      followUps: complaints.docs.map((x) => ({ id: x.id, number: x.data().complaintId, status: x.data().status, type: x.data().complaintType, studentName: x.data().studentName, details: x.data().details })),
      absent: invites.filter((i) => i.attended !== true).map((i) => {
        const c = callByInvite.get(i.id);
        return { id: i.id, names: names(i), classes: (i.students || []).map((s) => [s.grade, s.className].filter(Boolean).join(" ")).join("، "), phone: maskPhone(i.phone), response: i.response || "", callStatus: c?.status || "", callResult: c?.outcome || c?.result || "" };
      }),
      minutesCount: minutes.size,
      requests: await requestsReport(ref, m, invites),
    };
  });

  // --- «دليل المعلمين»: one Excel file for every branch ---------------------
  // meetingTeacherDirectory/{branch} = { teachers: [{name, subject, room,
  // phone, classes (as written, e.g. "4-1، 4-2")}] }. Uploading replaces the
  // lists of the branches in the file; a meeting picks its teachers from the
  // lists of its branches (MeetingForm → «إضافة من دليل المعلمين»).
  out.getMeetingTeacherDirectory = onCall(async (request) => {
    const caller = await meetingCaller(request);
    const want = Array.isArray(request.data?.branches) ? request.data.branches.map(String) : null;
    const snap = await db.collection("meetingTeacherDirectory").get();
    return {
      branches: snap.docs.filter((x) => callerHasBranch(caller, x.id) && (!want || want.includes(x.id))).map((x) => ({
        branch: x.id, teachers: x.data().teachers || [], updatedAt: ms(x.data().updatedAt), updatedByName: x.data().updatedByName || "",
      })),
    };
  });

  out.saveMeetingTeacherDirectory = onCall(async (request) => {
    const caller = await meetingCaller(request);
    const input = request.data?.branches && typeof request.data.branches === "object" ? request.data.branches : {};
    const known = new Set((await db.collection("branches").get()).docs.map((x) => x.id));
    const entries = Object.entries(input).slice(0, 40);
    if (!entries.length) throw new HttpsError("invalid-argument", "لا توجد بيانات معلمين.");
    const outside = entries.map(([b]) => b).filter((b) => !known.has(b) || !callerHasBranch(caller, b));
    if (outside.length) throw new HttpsError("permission-denied", "الملف فيه فروع خارج صلاحيتك أو غير معروفة.");
    const now = Timestamp.now();
    const stamp = { updatedAt: now, updatedBy: caller.uid, updatedByName: caller.name || "" };
    const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 400).map((t) => ({
      name: str(t?.name, 80), subject: str(t?.subject, 80), classes: str(t?.classes, 300), role: STAFF_ROLES.includes(t?.role) ? t.role : "TEACHER", roleText: str(t?.roleText, 60),
    })).filter((t) => t.name);
    const saved = {};
    // mode "merge": the file's teachers are added to the branch's list; a
    // name already there is kept as it is (counted in `skipped`).
    if (request.data?.mode === "merge") {
      const key = (x) => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
      const skipped = {};
      await db.runTransaction(async (tx) => {
        const refs = entries.map(([b]) => db.collection("meetingTeacherDirectory").doc(b));
        const docs = await Promise.all(refs.map((r) => tx.get(r)));
        entries.forEach(([branch, list], i) => {
          const current = (docs[i].data() || {}).teachers || [];
          const seen = new Set(current.map((t) => key(t.name)));
          const added = clean(list).filter((t) => (seen.has(key(t.name)) ? false : seen.add(key(t.name))));
          if (current.length + added.length > 400) throw new HttpsError("resource-exhausted", "الحد الأقصى 400 معلم في الفرع.");
          saved[branch] = added.length;
          skipped[branch] = clean(list).length - added.length;
          if (added.length) tx.set(refs[i], { teachers: [...current, ...added], ...stamp });
        });
      });
      return { saved, skipped };
    }
    const batch = db.batch();
    entries.forEach(([branch, list]) => {
      const teachers = clean(list);
      saved[branch] = teachers.length;
      batch.set(db.collection("meetingTeacherDirectory").doc(branch), { teachers, ...stamp });
    });
    await batch.commit();
    return { saved };
  });

  // One teacher added / edited / deleted in the directory (from its window).
  // The teacher is found by name in its branch, so edits by two people do not
  // overwrite each other; an edit may move the teacher to another branch.
  out.editMeetingTeacherDirectory = onCall(async (request) => {
    const caller = await meetingCaller(request);
    const d = request.data || {};
    const action = ["add", "update", "delete"].includes(d.action) ? d.action : "";
    if (!action) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    const key = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const from = str(d.branch, 60);
    const to = action === "update" ? str(d.toBranch || d.branch, 60) : from;
    const known = new Set((await db.collection("branches").get()).docs.map((x) => x.id));
    for (const b of new Set([from, to])) {
      if (!known.has(b) || !callerHasBranch(caller, b)) throw new HttpsError("permission-denied", "الفرع خارج صلاحيتك أو غير معروف.");
    }
    const t = d.teacher || {};
    const teacher = { name: str(t.name, 80), subject: str(t.subject, 80), classes: str(t.classes, 300) };
    if (action !== "delete" && !teacher.name) throw new HttpsError("invalid-argument", "اكتب اسم المعلم.");
    const original = key(d.originalName);
    if (action !== "add" && !original) throw new HttpsError("invalid-argument", "المعلم غير محدد.");
    const now = Timestamp.now();
    const stamp = { updatedAt: now, updatedBy: caller.uid, updatedByName: caller.name || "" };
    await db.runTransaction(async (tx) => {
      const fromRef = db.collection("meetingTeacherDirectory").doc(from);
      const toRef = db.collection("meetingTeacherDirectory").doc(to);
      const fromList = [...(((await tx.get(fromRef)).data() || {}).teachers || [])];
      const toList = to === from ? fromList : [...(((await tx.get(toRef)).data() || {}).teachers || [])];
      const at = action === "add" ? -1 : fromList.findIndex((x) => key(x.name) === original);
      if (action !== "add" && at < 0) throw new HttpsError("not-found", "لم يُعثر على المعلم — ربما عدّله أو حذفه شخص آخر. حدّث الصفحة.");
      if (action === "delete") {
        fromList.splice(at, 1);
        tx.set(fromRef, { teachers: fromList, ...stamp });
        return;
      }
      const clash = toList.findIndex((x) => key(x.name) === key(teacher.name));
      if (clash >= 0 && !(to === from && clash === at)) throw new HttpsError("already-exists", "يوجد معلم بهذا الاسم في هذا الفرع.");
      if (action === "add") {
        if (toList.length >= 400) throw new HttpsError("resource-exhausted", "الحد الأقصى 400 معلم في الفرع.");
        toList.push({ ...teacher, role: "TEACHER", roleText: "" });
        tx.set(toRef, { teachers: toList, ...stamp });
        return;
      }
      const updated = { ...fromList[at], ...teacher };
      if (to === from) {
        fromList[at] = updated;
        tx.set(fromRef, { teachers: fromList, ...stamp });
        return;
      }
      if (toList.length >= 400) throw new HttpsError("resource-exhausted", "الحد الأقصى 400 معلم في الفرع.");
      fromList.splice(at, 1);
      toList.push(updated);
      tx.set(fromRef, { teachers: fromList, ...stamp });
      tx.set(toRef, { teachers: toList, ...stamp });
    });
    return { ok: true };
  });

  // --- student record: the meetings a student was invited to + minutes ----
  out.getStudentMeetings = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = { uid: request.auth.uid, ...(await db.collection("users").doc(request.auth.uid).get()).data() };
    if (u.active === false || u.role === "RECEPTIONIST" || !(meetingsAllowed(u) || u.modules?.students !== false)) throw new HttpsError("permission-denied", "لا تملك صلاحية.");
    const studentId = normalizeDigits(request.data?.studentId);
    const s = (await db.collection("students").doc(studentId || "_").get()).data();
    if (!s) return { meetings: [] };
    const since = riyadhDay(-400);
    const [meets, minutes] = await Promise.all([
      db.collection("meetings").where("date", ">=", since).get(),
      db.collection("meetingMinutes").where("studentId", "==", studentId).get(),
    ]);
    const list = meets.docs.filter((x) => inScope(u, x.data()) && x.data().status !== "DRAFT");
    const invSnaps = list.length ? await db.getAll(...list.map((x) => x.ref.collection("invites").doc(familyKeyFor(x.data(), s)))) : [];
    const mins = minutes.docs.map((x) => x.data()).filter((x) => list.some((y) => y.id === x.meetingId));
    // Interviews on request asked for this student (with their result).
    const reqLists = await Promise.all(list.map((x) => (requestsMode(x.data()) ? x.ref.collection("requests").where("studentId", "==", studentId).get().then((q) => q.docs.map((d2) => d2.data())) : Promise.resolve([]))));
    return {
      meetings: list.map((x, i) => {
        const inv = invSnaps[i].exists ? invSnaps[i].data() : null;
        if (!inv || !(inv.studentIds || []).includes(studentId)) return null;
        return {
          id: x.id, title: x.data().title, code: x.data().code, date: x.data().date, status: x.data().status, response: inv.response || "", attended: inv.attended === true,
          type: x.data().type, attendee: inv.attendee || null,
          minutes: mins.filter((y) => y.meetingId === x.id && !y.requestId).map((y) => ({ teacherName: y.teacherName, subject: y.subject, points: y.points, recommendations: y.recommendations, agreements: y.agreements, followUp: y.followUp || null })),
          requests: reqLists[i].filter((r) => r.status !== "CANCELLED" || r.cancelledBy !== "ولي الأمر").map((r) => ({
            staffName: r.staffName, staffRole: r.staffRole, purpose: r.purpose || "", status: shownStatus(r), result: r.result || "", recommendations: r.recommendations || "", rejectReason: isRejected(r) ? r.rejectReason || "" : "",
            startedAt: ms(r.startedAt), endedAt: ms(r.endedAt), followUp: r.followUp || null,
          })),
        };
      }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)),
    };
  });

  return out;
};

// Delivery reports for meeting messages (called from waDeliveryReport).
module.exports.meetingDeliveryUpdate = async (db, m, state) => {
  if (m.kind !== "meeting" || !m.meetingId || !m.inviteId) return;
  const rank = { sent: 1, delivered: 2, read: 3 };
  const ref = db.collection("meetings").doc(m.meetingId).collection("invites").doc(m.inviteId);
  const cur = (await ref.get()).data();
  if (!cur) return;
  const failed = ["failed", "no_opt_in", "no_capability", "deleted"].includes(state);
  if (failed) await ref.update({ "wa.status": "failed", "wa.error": `لم تصل الرسالة (${state})` });
  else if (rank[state] && (rank[state] || 0) > (rank[cur.wa?.status] || 0)) await ref.update({ "wa.status": state });
};
