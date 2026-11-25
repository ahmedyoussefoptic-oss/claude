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
//   mntTickets/{id}    a work order: place, asset, category, priority, status, photos, checklist, cost, log (append-only)
//   mntAssets/{id}     equipment (AC, lift, generator, extinguisher…): place, serial, warranty and contract end, QR token
//   mntPlans/{id}      preventive maintenance: what, how often, next due day, assets, checklist, technician
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
const ASSET_TYPES = ["AC", "ELEVATOR", "GENERATOR", "EXTINGUISHER", "FIRE_ALARM", "PUMP", "WATER_TANK", "LIGHTING", "OTHER"];
const ASSET_CAT = { AC: "AC", ELEVATOR: "ELECTRIC", GENERATOR: "ELECTRIC", EXTINGUISHER: "SAFETY", FIRE_ALARM: "SAFETY", PUMP: "PLUMBING", WATER_TANK: "PLUMBING", LIGHTING: "ELECTRIC", OTHER: "OTHER" };
// Preventive maintenance: every week, or every n months.
const FREQS = { WEEKLY: { days: 7 }, MONTHLY: { months: 1 }, QUARTERLY: { months: 3 }, SEMIANNUAL: { months: 6 }, YEARLY: { months: 12 } };
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
  const assets = () => db.collection("mntAssets");
  const plans = () => db.collection("mntPlans");
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  // The next due day after `day` for a frequency.
  const addFreq = (day, freq) => {
    const f = FREQS[freq] || FREQS.MONTHLY;
    const x = new Date(`${day}T12:00:00Z`);
    if (f.days) x.setUTCDate(x.getUTCDate() + f.days);
    else { const d0 = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + f.months); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(d0, last)); }
    return x.toISOString().slice(0, 10);
  };
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
    escalatedAt: ms(t.escalatedAt), procRequests: t.procRequests || [],
    assetId: t.assetId || "", assetName: t.assetName || "", planId: t.planId || "", checklist: t.checklist || [], cost: t.cost || null, log: (t.log || []).slice(-80),
    ...(u ? { canManage: manages(u, t.branch), canApprove: t.reporterUid === u.uid || manages(u, t.branch) } : {}),
  });
  const placeOut = (id, p) => ({ id, branch: p.branch, building: p.building || "", floor: p.floor || "", room: p.room || "", kind: p.kind || "OTHER", label: placeLabel(p), active: p.active !== false, qr: `${PUBLIC_APP_URL}/fix/${p.qrToken}` });
  const techOut = (id, x) => ({ id, name: x.name, phone: x.phone || "", kind: x.kind || "TECH", company: x.company || "", branches: x.branches || [], categories: x.categories || [], active: x.active !== false, pin: x.pin, link: `${PUBLIC_APP_URL}/tech/${x.token}` });
  const assetOut = (id, a, withQr) => ({
    id, branch: a.branch, placeId: a.placeId || "", place: a.place || "", name: a.name, type: a.type || "OTHER", brand: a.brand || "", model: a.model || "", serial: a.serial || "",
    installDate: a.installDate || "", warrantyEnd: a.warrantyEnd || "", contractEnd: a.contractEnd || "", contractor: a.contractor || "", supplier: a.supplier || "", notes: a.notes || "",
    active: a.active !== false, qr: withQr && a.qrToken ? `${PUBLIC_APP_URL}/fix/${a.qrToken}` : "",
  });
  const planOut = (id, x) => ({
    id, branch: x.branch, title: x.title, category: x.category, priority: x.priority || "NORMAL", freq: x.freq, nextDue: x.nextDue, assetIds: x.assetIds || [], placeId: x.placeId || "",
    techId: x.techId || "", checklist: x.checklist || [], active: x.active !== false, lastRun: x.lastRun || "", lastTicket: x.lastTicket || "",
  });
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
  async function createTicket({ by, branch, place, category, priority, title, description, photos, source, complaint, placeText, extra = {}, quiet = false }) {
    const cfg = await loadSettings();
    const ref = tickets().doc();
    const number = await nextRecordNumber("MT");
    const uploaded = await uploadPhotos(photos, `maintenance/${number}/report`);
    const now = Date.now();
    const t = {
      number, branch, placeId: place?.id || "", place: place ? placeLabel(place) : str(placeText, 120), category, priority, title, description,
      photos: uploaded, status: "NEW", source, reporterUid: by.uid || "", reporterName: by.name || "",
      ...(complaint ? { complaintId: complaint.id, complaintNumber: complaint.number || "" } : {}),
      ...extra, ...(extra.techId ? { status: "ASSIGNED", assignedAt: Timestamp.fromMillis(now) } : {}),
      createdAt: Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now), dueAt: Timestamp.fromMillis(dueAt(priority, now, cfg)),
      log: [logEntry(by, "CREATED", { note: source === "QR" ? "بلاغ عبر رمز QR" : source === "COMPLAINT" ? `محوّل من الملاحظة ${complaint?.number || ""}` : source === "PM" ? "صيانة وقائية مجدولة" : "" }),
        ...(extra.techId ? [logEntry(by, "ASSIGNED", { to: extra.techName })] : [])],
    };
    await ref.set(t);
    if (quiet) return { id: ref.id, number };
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
      let asset = null;
      if (dd.assetId) {
        if (!idRe.test(String(dd.assetId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const a = (await assets().doc(dd.assetId).get()).data();
        if (!a || a.active === false) throw new HttpsError("not-found", "الجهاز غير موجود.");
        asset = { id: dd.assetId, ...a };
        branch = a.branch;
        if (!place && a.placeId) { const p = (await places().doc(a.placeId).get()).data(); if (p) place = { id: a.placeId, ...p }; }
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
      const out = await createTicket({ by: u, branch, place, ...r, priority, photos: dd.photos, source: complaint ? "COMPLAINT" : "APP", complaint, placeText: dd.placeText,
        extra: asset ? { assetId: asset.id, assetName: asset.name } : {} });
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
      const allTicked = (t.checklist || []).length > 0 && Array.isArray(dd.checklist) && t.checklist.every((_, i) => dd.checklist[i] === true);
      if (to === "DONE" && !str(dd.note, 1000) && !allTicked) throw new HttpsError("invalid-argument", "اكتب ما تم إنجازه.");
      await setWorkStatus(ref, t, to, { by: u, note: str(dd.note, 1000), parts: str(dd.parts, 1000), photos: dd.photos, checklist: dd.checklist });
      return handlers.get(u, { id: ref.id });
    },
    // The cost of a work order: labour, parts, contractor's invoice.
    async cost(u, dd) {
      const { ref, t } = await loadTicket(u, dd.id, { manage: true });
      const n = (v) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);
      const c = { labor: n(dd.labor), parts: n(dd.parts), contractor: n(dd.contractor), note: str(dd.note, 500), by: u.uid, byName: u.name || "", at: Date.now() };
      c.total = Math.round((c.labor + c.parts + c.contractor) * 100) / 100;
      await ref.update({ cost: c, updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "COST", { note: `${c.total.toFixed(2)} ر.س${c.note ? ` — ${c.note}` : ""}` })) });
      void t;
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

    // --- equipment --------------------------------------------------------
    async assets(u) {
      const all = u.role === "ADMIN" || u.isOwner === true || callerAll(u);
      const docs = all ? (await assets().get()).docs : (await Promise.all(userBranchList(u).map((b) => assets().where("branch", "==", b).get()))).flatMap((q) => q.docs);
      return { assets: docs.map((x) => assetOut(x.id, x.data(), manages(u, x.data().branch))).filter((a) => a.active).sort((a, b) => a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name, "ar")) };
    },
    async saveAsset(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !manages(u, branch)) throw new HttpsError("permission-denied", "سجل الأجهزة لمدير الصيانة في الفرع.");
      const name = str(dd.name, 120);
      if (!name) throw new HttpsError("invalid-argument", "اكتب اسم الجهاز.");
      let place = null;
      if (dd.placeId) {
        if (!idRe.test(String(dd.placeId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const p = (await places().doc(dd.placeId).get()).data();
        if (!p || p.branch !== branch) throw new HttpsError("invalid-argument", "الموقع ليس في هذا الفرع.");
        place = p;
      }
      const day = (v) => (dayRe.test(v || "") ? v : "");
      const a = {
        branch, name, type: oneOf(ASSET_TYPES, dd.type, "OTHER"), placeId: place ? dd.placeId : "", place: place ? placeLabel(place) : "", brand: str(dd.brand, 60), model: str(dd.model, 60), serial: str(dd.serial, 80),
        installDate: day(dd.installDate), warrantyEnd: day(dd.warrantyEnd), contractEnd: day(dd.contractEnd), contractor: str(dd.contractor, 120), supplier: str(dd.supplier, 120), notes: str(dd.notes, 1000),
        active: true, updatedAt: Timestamp.now(),
      };
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = assets().doc(dd.id);
        const old = (await ref.get()).data();
        if (!old || !manages(u, old.branch)) throw new HttpsError("not-found", "الجهاز غير موجود.");
        await ref.update({ ...a, ...(old.warrantyEnd !== a.warrantyEnd ? { warrantyNotified: "" } : {}), ...(old.contractEnd !== a.contractEnd ? { contractNotified: "" } : {}) });
        return { asset: assetOut(dd.id, { ...old, ...a }, true) };
      }
      const ref = assets().doc();
      const tk = token();
      await Promise.all([ref.set({ ...a, qrToken: tk, createdAt: Timestamp.now(), createdBy: u.uid }), links().doc(tk).set({ kind: "asset", assetId: ref.id, fails: 0, createdAt: Timestamp.now() })]);
      return { asset: assetOut(ref.id, { ...a, qrToken: tk }, true) };
    },
    async deleteAsset(u, dd) {
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const ref = assets().doc(dd.id);
      const a = (await ref.get()).data();
      if (!a || !manages(u, a.branch)) throw new HttpsError("not-found", "الجهاز غير موجود.");
      await Promise.all([ref.update({ active: false, updatedAt: Timestamp.now() }), a.qrToken ? links().doc(a.qrToken).delete() : null]);
      return { ok: true };
    },

    // --- preventive maintenance ------------------------------------------
    async plans(u) {
      if (!isManager(u)) throw new HttpsError("permission-denied", "للمدير فقط.");
      const all = u.role === "ADMIN" || u.isOwner === true || callerAll(u);
      return { plans: (await plans().get()).docs.map((x) => planOut(x.id, x.data())).filter((x) => x.active && (all || manages(u, x.branch))).sort((a, b) => a.nextDue.localeCompare(b.nextDue)) };
    },
    async savePlan(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !manages(u, branch)) throw new HttpsError("permission-denied", "الصيانة الوقائية لمدير الصيانة في الفرع.");
      const title = str(dd.title, 140);
      if (!title) throw new HttpsError("invalid-argument", "اكتب اسم الصيانة الدورية.");
      if (!dayRe.test(dd.nextDue || "")) throw new HttpsError("invalid-argument", "حدد تاريخ أول موعد.");
      const assetIds = [...new Set((Array.isArray(dd.assetIds) ? dd.assetIds : []).filter((x) => idRe.test(String(x))))].slice(0, 100);
      if (assetIds.length) {
        const snaps = await Promise.all(assetIds.map((id) => assets().doc(id).get()));
        if (snaps.some((x) => !x.exists || x.data().branch !== branch)) throw new HttpsError("invalid-argument", "اختر أجهزة من نفس الفرع.");
      }
      let techId = "";
      if (dd.techId) {
        if (!idRe.test(String(dd.techId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const x = (await techs().doc(dd.techId).get()).data();
        if (!x || x.active === false || ((x.branches || []).length && !x.branches.includes(branch))) throw new HttpsError("invalid-argument", "الفني لا يغطي هذا الفرع.");
        techId = dd.techId;
      }
      const p = {
        branch, title, category: oneOf(CATEGORIES, dd.category, "OTHER"), priority: oneOf(PRIORITIES, dd.priority, "NORMAL"), freq: Object.prototype.hasOwnProperty.call(FREQS, dd.freq) ? dd.freq : "MONTHLY",
        nextDue: dd.nextDue, assetIds, placeId: idRe.test(String(dd.placeId || "")) ? dd.placeId : "", techId,
        checklist: (Array.isArray(dd.checklist) ? dd.checklist : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 40), active: true, updatedAt: Timestamp.now(),
      };
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = plans().doc(dd.id);
        const old = (await ref.get()).data();
        if (!old || !manages(u, old.branch)) throw new HttpsError("not-found", "الخطة غير موجودة.");
        await ref.update(p);
        return { plan: planOut(dd.id, { ...old, ...p }) };
      }
      const ref = plans().doc();
      await ref.set({ ...p, createdAt: Timestamp.now(), createdBy: u.uid });
      return { plan: planOut(ref.id, p) };
    },
    async deletePlan(u, dd) {
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const ref = plans().doc(dd.id);
      const x = (await ref.get()).data();
      if (!x || !manages(u, x.branch)) throw new HttpsError("not-found", "الخطة غير موجودة.");
      await ref.update({ active: false, updatedAt: Timestamp.now() });
      return { ok: true };
    },
    // Make this round's work order now (instead of waiting for its day).
    async runPlan(u, dd) {
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const ref = plans().doc(dd.id);
      const x = (await ref.get()).data();
      if (!x || x.active === false || !manages(u, x.branch)) throw new HttpsError("not-found", "الخطة غير موجودة.");
      return runPlanTicket(ref, x, u);
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
  // A preventive plan's work order for this round: its assets, checklist and
  // technician; the plan moves to its next day (past today).
  async function runPlanTicket(ref, x, by) {
    const assetDocs = x.assetIds?.length ? (await Promise.all(x.assetIds.map((id) => assets().doc(id).get()))).filter((d) => d.exists && d.data().active !== false) : [];
    const placeDoc = x.placeId ? await places().doc(x.placeId).get() : null;
    const tech = x.techId ? (await techs().doc(x.techId).get()).data() : null;
    const names = assetDocs.map((d) => `${d.data().name}${d.data().place ? ` (${d.data().place})` : ""}`);
    const out = await createTicket({
      by: { uid: by.uid || "", name: by.name || "النظام" }, branch: x.branch, place: placeDoc?.exists ? { id: x.placeId, ...placeDoc.data() } : null, category: x.category, priority: x.priority || "NORMAL",
      title: x.title, description: names.length ? `الأجهزة: ${names.join("، ")}` : "", photos: [], source: "PM", quiet: true,
      extra: {
        planId: ref.id, checklist: (x.checklist || []).map((text) => ({ text, done: false })),
        ...(assetDocs.length === 1 ? { assetId: assetDocs[0].id, assetName: assetDocs[0].data().name } : {}),
        ...(tech && tech.active !== false ? { techId: x.techId, techName: tech.kind === "CONTRACTOR" && tech.company ? `${tech.name} (${tech.company})` : tech.name, techKind: tech.kind || "TECH" } : {}),
      },
    });
    const today = riyadhDay();
    let next = x.nextDue;
    for (let i = 0; i < 400 && next <= today; i++) next = addFreq(next, x.freq);
    await ref.update({ nextDue: next, lastRun: today, lastTicket: out.number });
    return { ...out, nextDue: next };
  }
  async function setWorkStatus(ref, t, to, { by, note, parts, photos, checklist }) {
    const uploaded = await uploadPhotos(photos, `maintenance/${t.number}/work`);
    const now = Timestamp.now();
    // The checklist as ticked (preventive work); unticked items go in the log.
    const list = (t.checklist || []).map((it, i) => ({ text: it.text, done: Array.isArray(checklist) ? checklist[i] === true : it.done === true }));
    const missed = to === "DONE" ? list.filter((it) => !it.done).map((it) => it.text) : [];
    const patch = {
      ...(list.length && Array.isArray(checklist) ? { checklist: list } : {}),
      status: to, updatedAt: now, ...(to === "IN_PROGRESS" && !t.startedAt ? { startedAt: now } : {}), ...(to === "DONE" ? { doneAt: now, workNote: note } : {}),
      ...(parts ? { parts } : {}), ...(uploaded.length ? { workPhotos: FieldValue.arrayUnion(...uploaded) } : {}),
      log: FieldValue.arrayUnion(logEntry(by, to, { note: [note, parts ? `القطع: ${parts}` : "", missed.length ? `لم يُنجز: ${missed.join("، ")}` : ""].filter(Boolean).join(" — ") })),
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
    if (!l || !(Array.isArray(kind) ? kind.includes(l.kind) : l.kind === kind)) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    if (ms(l.lockedUntil) > Date.now()) throw new HttpsError("resource-exhausted", "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة.");
    return { lRef, l };
  }
  async function wrong(lRef, l, what) {
    const fails = (l.fails || 0) + 1;
    await lRef.update(fails >= LOCK.fails ? { fails: 0, lockedUntil: Timestamp.fromMillis(Date.now() + LOCK.ms) } : { fails });
    throw new HttpsError("permission-denied", fails >= LOCK.fails ? "تم إيقاف الرابط مؤقتاً بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة." : `${what} غير صحيح. المحاولات المتبقية: ${LOCK.fails - fails}.`);
  }
  // A room's QR label, or a device's (the device and its room).
  async function placeOf(tk) {
    const { lRef, l } = await linkOf(tk, ["place", "asset"]);
    let p = null; let asset = null;
    if (l.kind === "asset") {
      const a = (await assets().doc(l.assetId).get()).data();
      if (!a || a.active === false) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
      asset = { id: l.assetId, ...a };
      const pd = a.placeId ? (await places().doc(a.placeId).get()).data() : null;
      p = pd ? { id: a.placeId, ...pd } : { id: "", branch: a.branch };
    } else {
      const pd = (await places().doc(l.placeId).get()).data();
      if (!pd || pd.active === false) throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
      p = { id: l.placeId, ...pd };
    }
    const b = (await db.collection("branches").doc(p.branch).get()).data();
    return { lRef, l, p, asset, branchName: b?.name || p.branch };
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
    checklist: t.checklist || [], assetName: t.assetName || "", source: t.source || "APP",
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
      const { p, asset, branchName } = await placeOf(dd.token);
      return { place: asset ? [asset.name, placeLabel(p)].filter(Boolean).join(" — ") : placeLabel(p), branchName, categories: CATEGORIES, category: asset ? ASSET_CAT[asset.type] || "OTHER" : "" };
    },
    async placeReport(dd) {
      const { lRef, l, p, asset } = await placeOf(dd.token);
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
      const out = await createTicket({ by: { uid: staff.id, name: staff.name || "" }, branch: p.branch, place: p.id ? p : null, ...r, priority: r.priority === "URGENT" && r.category !== "SAFETY" ? "HIGH" : r.priority, photos: dd.photos, source: "QR",
        extra: asset ? { assetId: asset.id, assetName: asset.name } : {} });
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
      const allTicked = (t.checklist || []).length > 0 && Array.isArray(dd.checklist) && t.checklist.every((_, i) => dd.checklist[i] === true);
      if (to === "DONE" && !note && !allTicked) throw new HttpsError("invalid-argument", "اكتب ما تم إنجازه.");
      const by = { uid: "", name: `${x.name} (فني)` };
      if (to === "PHOTOS") {
        const uploaded = await uploadPhotos(dd.photos, `maintenance/${t.number}/work`);
        if (uploaded.length || note) await ref.update({ updatedAt: Timestamp.now(), ...(uploaded.length ? { workPhotos: FieldValue.arrayUnion(...uploaded) } : {}), log: FieldValue.arrayUnion(logEntry(by, "COMMENT", { note: note || `أُضيفت ${uploaded.length} صورة` })) });
      } else await setWorkStatus(ref, t, to, { by, note, parts: str(dd.parts, 1000), photos: dd.photos, checklist: dd.checklist });
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
    // Preventive maintenance due today (or missed): its work order.
    for (const x of (await plans().where("nextDue", "<=", today).get()).docs) {
      if (x.data().active === false) continue;
      try { open.push({ ...(await runPlanTicket(x.ref, x.data(), { uid: "", name: "النظام" })), branch: x.data().branch, status: "NEW", priority: x.data().priority || "NORMAL" }); } catch (err) { console.error("mnt plan", x.id, err); }
    }
    // Warranties and maintenance contracts ending within 30 days (once per date).
    const soon = new Date(Date.now() + 33 * 86400e3).toISOString().slice(0, 10);
    for (const x of (await assets().get()).docs) {
      const a = x.data();
      if (a.active === false) continue;
      for (const [field, flag, word] of [["warrantyEnd", "warrantyNotified", "الضمان"], ["contractEnd", "contractNotified", "عقد الصيانة"]]) {
        if (!a[field] || a[field] > soon || a[flag] === a[field]) continue;
        await notify(mgrs(a.branch, false), `${a[field] < today ? "انتهى" : "ينتهي قريباً"} ${word}: ${a.name}`, `${a.place || ""} — ${a[field]}`, "", "MNT_STATUS");
        await x.ref.update({ [flag]: a[field] });
      }
    }
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
module.exports.ASSET_TYPES = ASSET_TYPES;
module.exports.FREQS = Object.keys(FREQS);
