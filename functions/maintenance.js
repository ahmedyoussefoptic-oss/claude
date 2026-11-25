// «صيانة المرافق» — facilities maintenance (phase 1 of
// docs/plans/facilities-procurement-plan.md). Staff report a fault from the
// app or by scanning a room's QR code (staff only: the phone must match an
// active account); a maintenance manager assigns it to an in-house
// technician or a contractor, who works it on a PIN page (no account); the
// reporter or a manager approves the work. Deadlines count working time
// (settings/sla) per priority (settings/maintenance); overdue work goes up
// to the branch principal.
//   mntPlaces/{id}     a place: branch, building, floor, room, kind, QR token
//   mntTechs/{id}      a technician / contractor: name, phone, branches, categories, PIN, link token
//   mntLinks/{token}   a place's QR or a technician's link → its record (wrong phone / PIN lock)
//   mntTickets/{id}    a work order: place, category, priority, status, photos, log (append-only)
// Read and written only here (firestore.rules deny these collections).
// Three functions in all (mntAction, mntPublic, mntSweep) — many separate
// functions make deploys fail with 429.

const CATEGORIES = ["ELECTRIC", "PLUMBING", "AC", "CARPENTRY", "PAINT", "CLEANING", "SAFETY", "OTHER"];
const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"];
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS", "DONE", "CLOSED", "CANCELLED"];
const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"];
const PLACE_KINDS = ["CLASSROOM", "LAB", "OFFICE", "TOILET", "HALL", "YARD", "CORRIDOR", "KITCHEN", "STORE", "OTHER"];
const CAT_AR = { ELECTRIC: "كهرباء", PLUMBING: "سباكة", AC: "تكييف", CARPENTRY: "نجارة", PAINT: "دهان", CLEANING: "نظافة", SAFETY: "أمن وسلامة", OTHER: "أخرى" };
const PRI_AR = { URGENT: "طارئ", HIGH: "عالية", NORMAL: "عادية", LOW: "منخفضة" };
const STATUS_AR = { NEW: "جديد", ASSIGNED: "مُسند", IN_PROGRESS: "قيد التنفيذ", WAITING_PARTS: "بانتظار قطع", DONE: "منجز", CLOSED: "معتمد", CANCELLED: "ملغى" };
const DEFAULT_SETTINGS = { urgentHours: 4, highDays: 1, normalDays: 3, lowDays: 7 };
const LOCK = { fails: 10, ms: 15 * 60e3 };
const MAX_PHOTOS = 3;
const QR_DAILY_LIMIT = 30;

module.exports = function maintenanceModule(d) {
  const {
    db, Timestamp, FieldValue, HttpsError, onCall, onSchedule, crypto, str, callerHasBranch, callerAll, normalizeDigits,
    notifyUsers, loadActiveUsers, nextRecordNumber, uploadPublicAttachment, getBucket, normalizeSla, addBusinessMs, PUBLIC_APP_URL, riyadhDay,
  } = d;
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const token = (n = 24) => Array.from(crypto.randomBytes(n), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const pin = () => String(crypto.randomInt(1000, 10000));
  const idRe = /^[A-Za-z0-9]{6,40}$/;
  const branchRe = /^[A-Z0-9_]{2,40}$/;
  const tickets = () => db.collection("mntTickets");
  const places = () => db.collection("mntPlaces");
  const techs = () => db.collection("mntTechs");
  const links = () => db.collection("mntLinks");
  const phoneKey = (v) => normalizeDigits(v).replace(/\D/g, "").slice(-9);
  const oneOf = (list, v, dflt) => (list.includes(v) ? v : dflt);

  // --- who ------------------------------------------------------------------
  // Every staff member may report and follow what they reported (the
  // section is on by default; the Users page can turn it off).
  const sees = (u) => u && u.active !== false && u.role !== "RECEPTIONIST" && u.tripsAccess !== "tripsOnly" && u.modules?.maintenance !== false;
  // Running maintenance (assign, technicians, places, settings) in a branch:
  // admins, the owner, the facilities department, those given mntManage,
  // and principals of that branch.
  const isManager = (u) => u.role === "ADMIN" || u.isOwner === true || u.perms?.mntManage === true || u.department === "FACILITIES" || u.isPrincipal === true;
  const manages = (u, branch) => u.role === "ADMIN" || u.isOwner === true || (isManager(u) && (!branch || callerHasBranch(u, branch)));
  // Seeing every work order of a branch: managers, upper management and quality.
  const viewsBranch = (u, branch) => manages(u, branch) || ((u.role === "UPPER_MANAGEMENT" || u.isQuality === true) && callerHasBranch(u, branch));
  const seesTicket = (u, t) => t.reporterUid === u.uid || viewsBranch(u, t.branch);
  async function caller(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!sees(u)) throw new HttpsError("permission-denied", "لا تملك صلاحية «صيانة المرافق».");
    return { uid: request.auth.uid, ...u };
  }
  const userBranchList = (u) => [...new Set([...(Array.isArray(u.branches) ? u.branches : []), u.branch].filter(Boolean))];

  // --- deadlines ------------------------------------------------------------
  async function loadSettings() {
    const [m, s] = await Promise.all([db.collection("settings").doc("maintenance").get(), db.collection("settings").doc("sla").get()]);
    return { mnt: { ...DEFAULT_SETTINGS, ...(m.data() || {}) }, sla: normalizeSla(s.data()) };
  }
  // Urgent: hours of working time; the others: working days.
  function dueAt(priority, from, { mnt, sla }) {
    const toMin = (x, f) => { const r = /^(\d{1,2}):(\d{2})$/.exec(x || ""); return r ? Number(r[1]) * 60 + Number(r[2]) : f; };
    const dayLen = sla.businessHoursOnly ? Math.max(60, toMin(sla.workEnd, 900) - toMin(sla.workStart, 420)) * 60e3 : 24 * 3600e3;
    const span = priority === "URGENT" ? Number(mnt.urgentHours) * 3600e3
      : Number(priority === "HIGH" ? mnt.highDays : priority === "LOW" ? mnt.lowDays : mnt.normalDays) * dayLen;
    return addBusinessMs(from, Math.max(0, span || 0), sla);
  }

  // --- photos ---------------------------------------------------------------
  async function uploadPhotos(list, prefix) {
    const files = (Array.isArray(list) ? list : []).slice(0, MAX_PHOTOS);
    const out = [];
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(String(f?.mimeType || ""))) throw new HttpsError("invalid-argument", "الصور فقط (JPG أو PNG).");
      const up = await uploadPublicAttachment(getBucket(), prefix, f);
      out.push({ fileName: up.fileName, fileUrl: up.fileUrl, at: Date.now() });
    }
    return out;
  }

  // --- views ----------------------------------------------------------------
  const placeLabel = (p) => [p.building, p.floor, p.room].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
  const ticketOut = (id, t, u) => ({
    id, number: t.number, branch: t.branch, placeId: t.placeId || "", place: t.place || "", category: t.category, priority: t.priority, title: t.title,
    description: t.description || "", status: t.status, source: t.source || "APP", complaintId: t.complaintId || "", complaintNumber: t.complaintNumber || "",
    reporterUid: t.reporterUid || "", reporterName: t.reporterName || "", techId: t.techId || "", techName: t.techName || "", techKind: t.techKind || "",
    photos: t.photos || [], workPhotos: t.workPhotos || [], workNote: t.workNote || "", parts: t.parts || "", rating: t.rating || 0, ratingNote: t.ratingNote || "",
    createdAt: ms(t.createdAt), assignedAt: ms(t.assignedAt), startedAt: ms(t.startedAt), doneAt: ms(t.doneAt), closedAt: ms(t.closedAt), dueAt: ms(t.dueAt),
    escalatedAt: ms(t.escalatedAt), log: (t.log || []).slice(-80),
    ...(u ? { canManage: manages(u, t.branch), canApprove: t.reporterUid === u.uid || manages(u, t.branch) } : {}),
  });
  const placeOut = (id, p) => ({ id, branch: p.branch, building: p.building || "", floor: p.floor || "", room: p.room || "", kind: p.kind || "OTHER", label: placeLabel(p), active: p.active !== false, qr: `${PUBLIC_APP_URL}/fix/${p.qrToken}` });
  const techOut = (id, x) => ({ id, name: x.name, phone: x.phone || "", kind: x.kind || "TECH", company: x.company || "", branches: x.branches || [], categories: x.categories || [], active: x.active !== false, pin: x.pin, link: `${PUBLIC_APP_URL}/tech/${x.token}` });
  const logEntry = (by, action, extra = {}) => ({ at: Date.now(), by: by.uid || "", byName: by.name || "", action, ...extra });

  // Who hears about a work order in a branch: its managers (not the actor).
  async function branchManagers(branch, { principalsOnly = false } = {}) {
    const users = await loadActiveUsers();
    return users.filter((x) => x.role !== "RECEPTIONIST" && x.modules?.maintenance !== false
      && (principalsOnly ? x.isPrincipal === true : (x.perms?.mntManage === true || x.department === "FACILITIES" || x.isPrincipal === true))
      && (x.access === "all" || (x.branches || []).includes(branch) || x.branch === branch)).map((x) => x.id);
  }
  const notify = (ids, title, body, ticketId, type) => notifyUsers(ids, { title, body, complaintId: ticketId, type }).catch((err) => console.error("mnt notify", err));

  // --- create ---------------------------------------------------------------
  async function createTicket({ by, branch, place, category, priority, title, description, photos, source, complaint, placeText }) {
    const cfg = await loadSettings();
    const ref = tickets().doc();
    const number = await nextRecordNumber("MT");
    const uploaded = await uploadPhotos(photos, `maintenance/${number}/report`);
    const now = Date.now();
    const t = {
      number, branch, placeId: place?.id || "", place: place ? placeLabel(place) : str(placeText, 120), category, priority, title, description,
      photos: uploaded, status: "NEW", source, reporterUid: by.uid || "", reporterName: by.name || "",
      ...(complaint ? { complaintId: complaint.id, complaintNumber: complaint.number || "" } : {}),
      createdAt: Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now), dueAt: Timestamp.fromMillis(dueAt(priority, now, cfg)),
      log: [logEntry(by, "CREATED", { note: source === "QR" ? "بلاغ عبر رمز QR" : source === "COMPLAINT" ? `محوّل من الملاحظة ${complaint?.number || ""}` : "" })],
    };
    await ref.set(t);
    const managers = (await branchManagers(branch)).filter((x) => x !== by.uid);
    notify(managers, `${priority === "URGENT" ? "🚨 بلاغ صيانة طارئ" : "بلاغ صيانة جديد"} ${number}`, `${CAT_AR[category]} — ${title}${t.place ? ` (${t.place})` : ""}`, ref.id, priority === "URGENT" ? "MNT_URGENT" : "MNT_NEW");
    return { id: ref.id, number };
  }
  function cleanReport(dd) {
    const title = str(dd.title, 140);
    if (!title) throw new HttpsError("invalid-argument", "اكتب عنواناً مختصراً للعطل.");
    return {
      title, description: str(dd.description, 3000), category: oneOf(CATEGORIES, dd.category, "OTHER"), priority: oneOf(PRIORITIES, dd.priority, "NORMAL"),
    };
  }

  // --- staff actions (one function) -------------------------------------
  const handlers = {
    // The list: managers see their branches, others what they reported.
    async list(u) {
      const all = callerAll(u) || u.role === "ADMIN" || u.isOwner === true;
      const branchesSeen = all ? null : userBranchList(u).filter((b) => viewsBranch(u, b));
      const since = Timestamp.fromMillis(Date.now() - 400 * 86400e3);
      const snaps = [];
      if (all && (isManager(u) || u.role === "UPPER_MANAGEMENT" || u.isQuality === true)) snaps.push(await tickets().where("createdAt", ">=", since).get());
      else {
        for (const b of branchesSeen || []) snaps.push(await tickets().where("branch", "==", b).get());
        snaps.push(await tickets().where("reporterUid", "==", u.uid).get());
      }
      const seen = new Map();
      snaps.forEach((s) => s.docs.forEach((x) => { if (!seen.has(x.id) && ms(x.data().createdAt) >= ms(since)) seen.set(x.id, x.data()); }));
      const rows = [...seen.entries()].map(([id, t]) => ticketOut(id, t, u)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3000);
      const manageBranches = all && isManager(u) ? ["*"] : userBranchList(u).filter((b) => manages(u, b));
      return { tickets: rows, canManage: manageBranches.length > 0, manageBranches, now: Date.now() };
    },
    async get(u, dd) {
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const t = (await tickets().doc(dd.id).get()).data();
      if (!t || !seesTicket(u, t)) throw new HttpsError("not-found", "البلاغ غير موجود.");
      return { ticket: ticketOut(dd.id, t, u) };
    },
    async create(u, dd) {
      const r = cleanReport(dd);
      let branch = String(dd.branch || "");
      let place = null;
      if (dd.placeId) {
        if (!idRe.test(String(dd.placeId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const p = (await places().doc(dd.placeId).get()).data();
        if (!p) throw new HttpsError("not-found", "الموقع غير موجود.");
        place = { id: dd.placeId, ...p };
        branch = p.branch;
      }
      let complaint = null;
      if (dd.complaintId) {
        if (!/^[A-Za-z0-9_-]{6,60}$/.test(String(dd.complaintId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const c = (await db.collection("complaints").doc(dd.complaintId).get()).data();
        if (!c || !(u.role === "ADMIN" || callerAll(u) || callerHasBranch(u, c.branch))) throw new HttpsError("not-found", "الملاحظة غير موجودة.");
        complaint = { id: dd.complaintId, number: c.complaintId || c.number || "" };
        if (!branchRe.test(branch)) branch = c.branch;
      }
      if (!branchRe.test(branch)) throw new HttpsError("invalid-argument", "اختر الفرع.");
      if (!(u.role === "ADMIN" || callerAll(u) || callerHasBranch(u, branch))) throw new HttpsError("permission-denied", "اختر من فروعك فقط.");
      // Only a manager sets the priority above normal from the app, except a safety hazard.
      const priority = manages(u, branch) || r.category === "SAFETY" ? r.priority : (r.priority === "URGENT" ? "HIGH" : r.priority);
      const out = await createTicket({ by: u, branch, place, ...r, priority, photos: dd.photos, source: complaint ? "COMPLAINT" : "APP", complaint, placeText: dd.placeText });
      if (complaint) {
        await db.collection("complaints").doc(complaint.id).update({ maintenanceTicket: { id: out.id, number: out.number } }).catch(() => {});
      }
      return out;
    },
    // Manager: assign (or reassign) to a technician / contractor, change priority / category.
    async assign(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id, { manage: true });
      if (!OPEN.includes(t.status)) throw new HttpsError("failed-precondition", "البلاغ مغلق.");
      if (!idRe.test(String(dd.techId || ""))) throw new HttpsError("invalid-argument", "اختر الفني.");
      const x = (await techs().doc(dd.techId).get()).data();
      if (!x || x.active === false) throw new HttpsError("not-found", "الفني غير موجود.");
      if ((x.branches || []).length && !x.branches.includes(t.branch)) throw new HttpsError("failed-precondition", "الفني لا يغطي هذا الفرع.");
      const now = Date.now();
      await ref.update({
        techId: dd.techId, techName: x.kind === "CONTRACTOR" && x.company ? `${x.name} (${x.company})` : x.name, techKind: x.kind || "TECH",
        status: t.status === "NEW" ? "ASSIGNED" : t.status, assignedAt: Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now),
        log: FieldValue.arrayUnion(logEntry(u, "ASSIGNED", { to: x.name, note: str(dd.note, 500) })),
      });
      return handlers.get(u, { id: ref.id });
    },
    async update(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id, { manage: true });
      const patch = { updatedAt: Timestamp.now() };
      const notes = [];
      if (dd.priority && PRIORITIES.includes(dd.priority) && dd.priority !== t.priority) {
        patch.priority = dd.priority;
        const cfg = await loadSettings();
        patch.dueAt = Timestamp.fromMillis(dueAt(dd.priority, ms(t.createdAt), cfg));
        patch.escalatedAt = null;
        notes.push(`الأولوية: ${PRI_AR[t.priority]} ← ${PRI_AR[dd.priority]}`);
      }
      if (dd.category && CATEGORIES.includes(dd.category) && dd.category !== t.category) { patch.category = dd.category; notes.push(`التصنيف: ${CAT_AR[t.category]} ← ${CAT_AR[dd.category]}`); }
      if (!notes.length) return handlers.get(u, { id: ref.id });
      patch.log = FieldValue.arrayUnion(logEntry(u, "UPDATED", { note: notes.join("، ") }));
      await ref.update(patch);
      return handlers.get(u, { id: ref.id });
    },
    // Status from the office (the technician usually does it on their page).
    async status(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id, { manage: true });
      const to = String(dd.to || "");
      if (!["IN_PROGRESS", "WAITING_PARTS", "DONE"].includes(to) || !OPEN.includes(t.status)) throw new HttpsError("failed-precondition", "لا يمكن تغيير الحالة.");
      if (to === "DONE" && !str(dd.note, 1000)) throw new HttpsError("invalid-argument", "اكتب ما تم إنجازه.");
      await setWorkStatus(ref, t, to, { by: u, note: str(dd.note, 1000), parts: str(dd.parts, 1000), photos: dd.photos });
      return handlers.get(u, { id: ref.id });
    },
    async comment(u, dd) {
      const { ref } = await loadTicket(u, dd.id);
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب الملاحظة.");
      await ref.update({ updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "COMMENT", { note })) });
      return handlers.get(u, { id: ref.id });
    },
    // The reporter (or a manager) approves the finished work, with a rating.
    async approve(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id);
      if (!(t.reporterUid === u.uid || manages(u, t.branch))) throw new HttpsError("permission-denied", "الاعتماد للمبلّغ أو مدير الصيانة.");
      if (t.status !== "DONE") throw new HttpsError("failed-precondition", "البلاغ لم يُنجز بعد.");
      const rating = Math.max(0, Math.min(5, Math.floor(Number(dd.rating) || 0)));
      await ref.update({
        status: "CLOSED", closedAt: Timestamp.now(), updatedAt: Timestamp.now(), ...(rating && t.reporterUid === u.uid ? { rating, ratingNote: str(dd.note, 500) } : {}),
        log: FieldValue.arrayUnion(logEntry(u, "CLOSED", { note: [rating ? `التقييم ${rating}/5` : "", str(dd.note, 500)].filter(Boolean).join(" — ") })),
      });
      return handlers.get(u, { id: ref.id });
    },
    async reopen(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id);
      if (!(t.reporterUid === u.uid || manages(u, t.branch))) throw new HttpsError("permission-denied", "إعادة الفتح للمبلّغ أو مدير الصيانة.");
      if (!["DONE", "CLOSED"].includes(t.status)) throw new HttpsError("failed-precondition", "البلاغ مفتوح.");
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب سبب إعادة الفتح.");
      const cfg = await loadSettings();
      await ref.update({
        status: t.techId ? "ASSIGNED" : "NEW", doneAt: null, closedAt: null, escalatedAt: null, updatedAt: Timestamp.now(),
        dueAt: Timestamp.fromMillis(dueAt(t.priority, Date.now(), cfg)), log: FieldValue.arrayUnion(logEntry(u, "REOPENED", { note })),
      });
      const ids = (await branchManagers(t.branch)).filter((x) => x !== u.uid);
      notify(ids, `أُعيد فتح بلاغ الصيانة ${t.number}`, `${t.title} — ${note}`, ref.id, "MNT_REOPENED");
      return handlers.get(u, { id: ref.id });
    },
    async cancel(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id);
      const own = t.reporterUid === u.uid && t.status === "NEW";
      if (!own && !manages(u, t.branch)) throw new HttpsError("permission-denied", "الإلغاء لمدير الصيانة (أو للمبلّغ قبل الإسناد).");
      if (!OPEN.includes(t.status)) throw new HttpsError("failed-precondition", "البلاغ مغلق.");
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب سبب الإلغاء.");
      await ref.update({ status: "CANCELLED", updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "CANCELLED", { note })) });
      if (t.reporterUid && t.reporterUid !== u.uid) notify([t.reporterUid], `أُلغي بلاغ الصيانة ${t.number}`, `${t.title} — ${note}`, ref.id, "MNT_STATUS");
      return handlers.get(u, { id: ref.id });
    },

    // --- places -------------------------------------------------------------
    async places(u) {
      const all = u.role === "ADMIN" || u.isOwner === true || callerAll(u);
      const snap = all ? await places().get() : { docs: (await Promise.all(userBranchList(u).map((b) => places().where("branch", "==", b).get()))).flatMap((s) => s.docs) };
      const rows = snap.docs.map((x) => placeOut(x.id, x.data())).filter((p) => p.active);
      // Every staff member picks a place when reporting; QR links only for managers.
      return { places: rows.map((p) => (manages(u, p.branch) ? p : { ...p, qr: "" })).sort((a, b) => a.branch.localeCompare(b.branch) || a.label.localeCompare(b.label, "ar")) };
    },
    async savePlace(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !manages(u, branch)) throw new HttpsError("permission-denied", "إدارة المواقع لمدير الصيانة في الفرع.");
      const p = { branch, building: str(dd.building, 60), floor: str(dd.floor, 40), room: str(dd.room, 80), kind: oneOf(PLACE_KINDS, dd.kind, "OTHER"), active: true, updatedAt: Timestamp.now() };
      if (!p.room && !p.building) throw new HttpsError("invalid-argument", "اكتب اسم الغرفة أو المبنى.");
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = places().doc(dd.id);
        const old = (await ref.get()).data();
        if (!old || !manages(u, old.branch)) throw new HttpsError("not-found", "الموقع غير موجود.");
        await ref.update(p);
        return { place: placeOut(dd.id, { ...old, ...p }) };
      }
      const ref = places().doc();
      const tk = token();
      await Promise.all([ref.set({ ...p, qrToken: tk, createdAt: Timestamp.now(), createdBy: u.uid }), links().doc(tk).set({ kind: "place", placeId: ref.id, fails: 0, createdAt: Timestamp.now() })]);
      return { place: placeOut(ref.id, { ...p, qrToken: tk }) };
    },
    // Many rooms at once: one per line, «المبنى / الدور / الغرفة».
    async importPlaces(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !manages(u, branch)) throw new HttpsError("permission-denied", "إدارة المواقع لمدير الصيانة في الفرع.");
      const rows = (Array.isArray(dd.rows) ? dd.rows : []).slice(0, 400);
      const kind = oneOf(PLACE_KINDS, dd.kind, "OTHER");
      let batch = db.batch(); let n = 0; let count = 0;
      for (const r of rows) {
        const p = { branch, building: str(r?.building, 60), floor: str(r?.floor, 40), room: str(r?.room, 80), kind: oneOf(PLACE_KINDS, r?.kind, kind), active: true, createdAt: Timestamp.now(), createdBy: u.uid };
        if (!p.room && !p.building) continue;
        const ref = places().doc();
        const tk = token();
        batch.set(ref, { ...p, qrToken: tk });
        batch.set(links().doc(tk), { kind: "place", placeId: ref.id, fails: 0, createdAt: Timestamp.now() });
        count++; n += 2;
        if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
      }
      if (n) await batch.commit();
      return { added: count };
    },
    // Removing a place keeps its work orders (they hold the place's name).
    async deletePlace(u, dd) {
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const ref = places().doc(dd.id);
      const p = (await ref.get()).data();
      if (!p || !manages(u, p.branch)) throw new HttpsError("not-found", "الموقع غير موجود.");
      await Promise.all([ref.update({ active: false, updatedAt: Timestamp.now() }), p.qrToken ? links().doc(p.qrToken).delete() : null]);
      return { ok: true };
    },

    // --- technicians ------------------------------------------------------
    async techs(u) {
      if (!isManager(u)) throw new HttpsError("permission-denied", "للمدير فقط.");
      const snap = await techs().get();
      return { techs: snap.docs.map((x) => techOut(x.id, x.data())).filter((x) => x.active && (u.role === "ADMIN" || u.isOwner === true || callerAll(u) || !x.branches.length || x.branches.some((b) => manages(u, b)))).sort((a, b) => a.name.localeCompare(b.name, "ar")) };
    },
    async saveTech(u, dd) {
      if (!isManager(u)) throw new HttpsError("permission-denied", "للمدير فقط.");
      const name = str(dd.name, 80);
      if (!name) throw new HttpsError("invalid-argument", "اكتب اسم الفني.");
      const branches = [...new Set((Array.isArray(dd.branches) ? dd.branches : []).filter((b) => branchRe.test(String(b))))];
      const all = u.role === "ADMIN" || u.isOwner === true || callerAll(u);
      if (!all && (!branches.length || branches.some((b) => !manages(u, b)))) throw new HttpsError("permission-denied", "اختر من فروعك فقط.");
      const x = {
        name, phone: normalizeDigits(dd.phone).replace(/[^\d+]/g, "").slice(0, 16), kind: dd.kind === "CONTRACTOR" ? "CONTRACTOR" : "TECH", company: str(dd.company, 80),
        branches, categories: [...new Set((Array.isArray(dd.categories) ? dd.categories : []).filter((c) => CATEGORIES.includes(c)))], active: true, updatedAt: Timestamp.now(),
      };
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = techs().doc(dd.id);
        const old = (await ref.get()).data();
        if (!old) throw new HttpsError("not-found", "الفني غير موجود.");
        const patch = dd.newPin ? { ...x, pin: pin() } : x;
        await ref.update(patch);
        return { tech: techOut(dd.id, { ...old, ...patch }) };
      }
      const ref = techs().doc();
      const tk = token();
      const full = { ...x, token: tk, pin: pin(), createdAt: Timestamp.now(), createdBy: u.uid };
      await Promise.all([ref.set(full), links().doc(tk).set({ kind: "tech", techId: ref.id, fails: 0, createdAt: Timestamp.now() })]);
      return { tech: techOut(ref.id, full) };
    },
    async deleteTech(u, dd) {
      if (!isManager(u) || !idRe.test(String(dd.id || ""))) throw new HttpsError("permission-denied", "للمدير فقط.");
      const ref = techs().doc(dd.id);
      const x = (await ref.get()).data();
      if (!x) throw new HttpsError("not-found", "الفني غير موجود.");
      const open = (await tickets().where("techId", "==", dd.id).get()).docs.filter((y) => OPEN.includes(y.data().status)).length;
      if (open) throw new HttpsError("failed-precondition", `للفني ${open} بلاغ مفتوح — أعد إسنادها أولاً.`);
      await Promise.all([ref.update({ active: false, updatedAt: Timestamp.now() }), x.token ? links().doc(x.token).delete() : null]);
      return { ok: true };
    },

    // --- settings ---------------------------------------------------------
    async settings(u) {
      return { settings: (await loadSettings()).mnt, canEdit: u.role === "ADMIN" || u.isOwner === true };
    },
    async saveSettings(u, dd) {
      if (!(u.role === "ADMIN" || u.isOwner === true)) throw new HttpsError("permission-denied", "للمدير فقط.");
      const num = (v, lo, hi, f) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 2) / 2)) : f; };
      const s = { urgentHours: num(dd.urgentHours, 1, 48, 4), highDays: num(dd.highDays, 0.5, 30, 1), normalDays: num(dd.normalDays, 0.5, 60, 3), lowDays: num(dd.lowDays, 1, 90, 7), updatedAt: Timestamp.now(), updatedBy: u.uid };
      await db.collection("settings").doc("maintenance").set(s, { merge: true });
      return { settings: { ...DEFAULT_SETTINGS, ...s } };
    },
  };
  async function loadTicket(u, id, { manage = false } = {}) {
    if (!idRe.test(String(id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
    const ref = tickets().doc(id);
    const t = (await ref.get()).data();
    if (!t || !seesTicket(u, t)) throw new HttpsError("not-found", "البلاغ غير موجود.");
    if (manage && !manages(u, t.branch)) throw new HttpsError("permission-denied", "هذا الإجراء لمدير الصيانة في الفرع.");
    return { ref, t };
  }
  // A work status (from the office or the technician's page).
  async function setWorkStatus(ref, t, to, { by, note, parts, photos }) {
    const uploaded = await uploadPhotos(photos, `maintenance/${t.number}/work`);
    const now = Timestamp.now();
    const patch = {
      status: to, updatedAt: now, ...(to === "IN_PROGRESS" && !t.startedAt ? { startedAt: now } : {}), ...(to === "DONE" ? { doneAt: now, workNote: note } : {}),
      ...(parts ? { parts } : {}), ...(uploaded.length ? { workPhotos: FieldValue.arrayUnion(...uploaded) } : {}),
      log: FieldValue.arrayUnion(logEntry(by, to, { note: [note, parts ? `القطع: ${parts}` : ""].filter(Boolean).join(" — ") })),
    };
    await ref.update(patch);
    if (to === "DONE" && t.reporterUid && t.reporterUid !== by.uid) {
      notify([t.reporterUid], `أُنجز بلاغ الصيانة ${t.number}`, `${t.title} — راجع العمل واعتمده.`, ref.id, "MNT_DONE");
    }
    if (to === "WAITING_PARTS") {
      const ids = (await branchManagers(t.branch)).filter((x) => x !== by.uid);
      notify(ids, `بلاغ الصيانة ${t.number} بانتظار قطع`, `${t.title}${parts ? ` — ${parts}` : ""}`, ref.id, "MNT_STATUS");
    }
  }

  const out = {};
  out.mntAction = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const h = Object.prototype.hasOwnProperty.call(handlers, dd.action) ? handlers[dd.action] : null;
    if (!h) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    return h(u, dd);
  });

  // --- public pages: the room's QR and the technician's link ---------------
  async function linkOf(tk, kind) {
    if (typeof tk !== "string" || !/^[a-z0-9]{16,40}$/.test(tk)) throw new HttpsError("not-found", "الرابط غير صحيح.");
    const lRef = links().doc(tk);
    const l = (await lRef.get()).data();
    if (!l || l.kind !== kind) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (ms(l.lockedUntil) > Date.now()) throw new HttpsError("resource-exhausted", "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة.");
    return { lRef, l };
  }
  async function wrong(lRef, l, what) {
    const fails = (l.fails || 0) + 1;
    await lRef.update(fails >= LOCK.fails ? { fails: 0, lockedUntil: Timestamp.fromMillis(Date.now() + LOCK.ms) } : { fails });
    throw new HttpsError("permission-denied", fails >= LOCK.fails ? "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة." : `${what} غير صحيح. المحاولات المتبقية: ${LOCK.fails - fails}.`);
  }
  async function placeOf(tk) {
    const { lRef, l } = await linkOf(tk, "place");
    const p = (await places().doc(l.placeId).get()).data();
    if (!p || p.active === false) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    const b = (await db.collection("branches").doc(p.branch).get()).data();
    return { lRef, l, p: { id: l.placeId, ...p }, branchName: b?.name || p.branch };
  }
  async function techOf(dd) {
    const { lRef, l } = await linkOf(dd.token, "tech");
    const ref = techs().doc(l.techId);
    const x = (await ref.get()).data();
    if (!x || x.active === false) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (String(dd.pin || "") !== String(x.pin)) await wrong(lRef, l, "الرمز");
    if (l.fails) await lRef.update({ fails: 0 });
    return { id: l.techId, ...x };
  }
  const techTicket = (id, t) => ({
    id, number: t.number, place: t.place || "", category: t.category, priority: t.priority, title: t.title, description: t.description || "", status: t.status,
    photos: t.photos || [], workPhotos: t.workPhotos || [], workNote: t.workNote || "", parts: t.parts || "", createdAt: ms(t.createdAt), dueAt: ms(t.dueAt), doneAt: ms(t.doneAt),
    reporterName: t.reporterName || "", branch: t.branch,
  });
  async function techState(x) {
    const rows = (await tickets().where("techId", "==", x.id).get()).docs.map((y) => techTicket(y.id, y.data()));
    const pri = (p) => PRIORITIES.indexOf(p);
    const branchNames = Object.fromEntries((await db.collection("branches").get()).docs.map((b) => [b.id, b.data().name || b.id]));
    return {
      name: x.name, company: x.company || "", branchNames,
      open: rows.filter((t) => OPEN.includes(t.status)).sort((a, b) => pri(a.priority) - pri(b.priority) || a.dueAt - b.dueAt),
      done: rows.filter((t) => t.status === "DONE" || t.status === "CLOSED").sort((a, b) => b.doneAt - a.doneAt).slice(0, 15),
    };
  }
  const publicHandlers = {
    // Before the phone: only the place's name.
    async placePeek(dd) {
      const { p, branchName } = await placeOf(dd.token);
      return { place: placeLabel(p), branchName, categories: CATEGORIES };
    },
    async placeReport(dd) {
      const { lRef, l, p } = await placeOf(dd.token);
      const key = phoneKey(dd.phone);
      if (key.length < 9) throw new HttpsError("invalid-argument", "اكتب رقم جوالك المسجّل في النظام.");
      const users = await loadActiveUsers();
      const staff = users.find((x) => x.role !== "RECEPTIONIST" && phoneKey(x.phone) === key);
      if (!staff) await wrong(lRef, l, "رقم الجوال");
      if (staff.modules?.maintenance === false) throw new HttpsError("permission-denied", "لا تملك صلاحية الإبلاغ عن الأعطال.");
      if (l.fails) await lRef.update({ fails: 0 });
      // A place sends at most QR_DAILY_LIMIT reports a day.
      const today = riyadhDay();
      const count = l.day === today ? l.count || 0 : 0;
      if (count >= QR_DAILY_LIMIT) throw new HttpsError("resource-exhausted", "تجاوز هذا الموقع الحد اليومي للبلاغات، تواصل مع إدارة المرافق.");
      await lRef.update({ day: today, count: count + 1 });
      const r = cleanReport(dd);
      const out = await createTicket({ by: { uid: staff.id, name: staff.name || "" }, branch: p.branch, place: p, ...r, priority: r.priority === "URGENT" && r.category !== "SAFETY" ? "HIGH" : r.priority, photos: dd.photos, source: "QR" });
      return { number: out.number, name: staff.name || "" };
    },
    async techOpen(dd) {
      return techState(await techOf(dd));
    },
    async techUpdate(dd) {
      const x = await techOf(dd);
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const ref = tickets().doc(dd.id);
      const t = (await ref.get()).data();
      if (!t || t.techId !== x.id) throw new HttpsError("not-found", "البلاغ غير موجود.");
      const to = String(dd.to || "");
      if (!["IN_PROGRESS", "WAITING_PARTS", "DONE", "PHOTOS"].includes(to) || !OPEN.includes(t.status)) throw new HttpsError("failed-precondition", "لا يمكن تغيير الحالة.");
      const note = str(dd.note, 1000);
      if (to === "DONE" && !note) throw new HttpsError("invalid-argument", "اكتب ما تم إنجازه.");
      const by = { uid: "", name: `${x.name} (فني)` };
      if (to === "PHOTOS") {
        const uploaded = await uploadPhotos(dd.photos, `maintenance/${t.number}/work`);
        if (uploaded.length || note) await ref.update({ updatedAt: Timestamp.now(), ...(uploaded.length ? { workPhotos: FieldValue.arrayUnion(...uploaded) } : {}), log: FieldValue.arrayUnion(logEntry(by, "COMMENT", { note: note || `أُضيفت ${uploaded.length} صورة` })) });
      } else await setWorkStatus(ref, t, to, { by, note, parts: str(dd.parts, 1000), photos: dd.photos });
      return techState(x);
    },
  };
  out.mntPublic = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const dd = request.data || {};
    const h = Object.prototype.hasOwnProperty.call(publicHandlers, dd.action) ? publicHandlers[dd.action] : null;
    if (!h) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    return h(dd);
  });

  // --- overdue work and the daily summary ----------------------------------
  // Every half hour in working hours: work past its deadline goes to the
  // branch principal and the maintenance managers (once). At 7:00 the
  // managers get the day's summary of their branches.
  out.mntSweep = onSchedule({ schedule: "*/30 6-17 * * 0-4", timeZone: "Asia/Riyadh", timeoutSeconds: 300, memory: "512MiB" }, async () => {
    const open = (await tickets().where("status", "in", OPEN).get()).docs.map((x) => ({ ref: x.ref, id: x.id, ...x.data() }));
    const now = Date.now();
    const users = await loadActiveUsers();
    const covers = (x, b) => x.access === "all" || (x.branches || []).includes(b) || x.branch === b;
    const mgrs = (b, principalsOnly) => users.filter((x) => x.role !== "RECEPTIONIST" && x.modules?.maintenance !== false && covers(x, b)
      && (principalsOnly ? x.isPrincipal === true : (x.perms?.mntManage === true || x.department === "FACILITIES" || x.isPrincipal === true))).map((x) => x.id);
    for (const t of open.filter((x) => ms(x.dueAt) && ms(x.dueAt) < now && !ms(x.escalatedAt))) {
      try {
        await t.ref.update({ escalatedAt: Timestamp.now(), log: FieldValue.arrayUnion({ at: now, by: "", byName: "النظام", action: "ESCALATED", note: "تجاوز المهلة — أُبلغ مدير الفرع" }) });
        await notify([...mgrs(t.branch, true), ...mgrs(t.branch, false)], `⏰ تأخر بلاغ الصيانة ${t.number}`, `${PRI_AR[t.priority]} · ${CAT_AR[t.category]} — ${t.title}${t.techName ? ` (${t.techName})` : ""} — ${STATUS_AR[t.status]}`, t.id, "MNT_OVERDUE");
      } catch (err) { console.error("mnt escalate", t.id, err); }
    }
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    if (hm < "07:00" || hm >= "07:30") return;
    const sRef = db.collection("settings").doc("maintenance");
    const today = riyadhDay();
    if ((await sRef.get()).data()?.summaryDay === today) return;
    await sRef.set({ summaryDay: today }, { merge: true });
    const byUser = new Map();
    for (const x of users.filter((y) => y.role !== "RECEPTIONIST" && y.modules?.maintenance !== false && (y.perms?.mntManage === true || y.department === "FACILITIES"))) {
      const mine = open.filter((t) => covers(x, t.branch));
      if (mine.length) byUser.set(x.id, mine);
    }
    for (const [uid, mine] of byUser) {
      const late = mine.filter((t) => ms(t.dueAt) && ms(t.dueAt) < now).length;
      const fresh = mine.filter((t) => t.status === "NEW").length;
      const urgent = mine.filter((t) => t.priority === "URGENT").length;
      await notify([uid], "ملخص الصيانة اليوم", `المفتوح ${mine.length} · غير مُسند ${fresh} · متأخر ${late}${urgent ? ` · طارئ ${urgent}` : ""}`, "", "MNT_DAILY");
    }
  });

  return out;
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
