// «المشتريات» — purchasing (phase 2 of docs/plans/facilities-procurement-plan.md).
// A staff member raises a purchase request (items, quantities, estimated
// prices; on its own or for a maintenance work order). It is approved by
// amount: the branch principal; from the finance limit also finance; above
// the upper limit also upper management (settings/procurement). Nobody
// approves their own request. Central procurement then issues a numbered
// purchase order to a supplier; the storekeeper (never the one who issued the
// order) records what arrived, in full or in part; finance attaches the
// invoice (three-way match: order / receipt / invoice) and records the
// payment status only — no money moves through the system.
//   procRequests/{id}    the request: items, approval steps, purchase order, receipts, invoice, payment, log (append-only)
//   procSuppliers/{id}   a supplier: CR / VAT numbers, contacts, categories, documents' expiry, rating
//   invItems/{id}        the consumables catalogue (name, unit, category, default reorder level, last price)
//   invStock/{item_branch} an item's balance in one branch's store, and its reorder level there
//   invMoves/{id}        every stock movement (in from a receipt, out to a work order or department, count, transfer) — append-only
//   procLinks/{token}    a purchase order's read-only link for the supplier (/po/<token>)
//   procBudgets/{fy_branch_category}  a yearly budget line of a branch (all categories, or one); its use is counted from the requests
// Read and written only here (firestore.rules deny these collections).
// Three functions in all (procAction, procSweep, procPublic) — many separate functions
// make deploys fail with 429.

const CATEGORIES = ["MAINTENANCE", "STATIONERY", "CLEANING", "IT", "FURNITURE", "EDUCATIONAL", "SERVICES", "OTHER"];
const STATUSES = ["PENDING_APPROVAL", "RETURNED", "REJECTED", "APPROVED", "ORDERED", "PARTIAL", "RECEIVED", "INVOICED", "PAID", "CANCELLED"];
const STEP_AR = { BRANCH: "مدير الفرع", FINANCE: "المالية", EXEC: "الإدارة العليا" };
const DEFAULT_SETTINGS = { financeFrom: 2000, execAbove: 10000, vatRate: 15, overrunPct: 10, quoteFrom: 5000, quoteCount: 3, fiscalStartMonth: 1, terms: "التوريد خلال المدة المحددة في أمر الشراء، والأسعار شاملة التوصيل والتركيب ما لم يُذكر غير ذلك. الدفع بعد الاستلام ومطابقة الفاتورة." };
const MAX_FILES = 3;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = function procurementModule(d) {
  const {
    db, Timestamp, FieldValue, HttpsError, onCall, onSchedule, str, callerHasBranch, callerAll, normalizeDigits,
    notifyUsers, loadActiveUsers, nextRecordNumber, uploadPublicAttachment, getBucket, riyadhDay,
    taqnyatSend, waParam, toIntlNumber, WA_API_ENABLED, WA_SECRETS = [], PUBLIC_APP_URL = "", SCHOOL_NAME = "", crypto,
  } = d;
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const idRe = /^[A-Za-z0-9]{6,40}$/;
  const branchRe = /^[A-Z0-9_]{2,40}$/;
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const requests = () => db.collection("procRequests");
  const suppliers = () => db.collection("procSuppliers");
  const budgets = () => db.collection("procBudgets");
  const invItems = () => db.collection("invItems");
  const invStock = () => db.collection("invStock");
  const invMoves = () => db.collection("invMoves");
  const procLinks = () => db.collection("procLinks");
  const linkToken = () => Array.from(crypto.randomBytes(24), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  // The financial year a moment falls in (named by the year it starts), and its span.
  const fyOf = (msv, s) => { const d = new Date(msv + 3 * 3600e3); const m = d.getUTCMonth() + 1; return m >= Number(s.fiscalStartMonth || 1) ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
  const fySpan = (fy, s) => { const m = Number(s.fiscalStartMonth || 1); return [Date.UTC(fy, m - 1, 1) - 3 * 3600e3, Date.UTC(fy + 1, m - 1, 1) - 3 * 3600e3]; };
  // What a request weighs on its budget: committed once approved, spent once received.
  const budgetUse = (r) => {
    if (["APPROVED", "ORDERED", "PARTIAL"].includes(r.status)) return { committed: r.po?.total ?? r.approvedTotal ?? r.estTotal, spent: 0 };
    if (["RECEIVED", "INVOICED", "PAID"].includes(r.status)) return { committed: 0, spent: r.invoice?.amount ?? r.po?.total ?? 0 };
    return { committed: 0, spent: 0 };
  };
  // Every budget line of a year with what is committed and spent against it.
  async function budgetLines(fy, s, branchFilter = null) {
    const [b0, b1] = fySpan(fy, s);
    const lines = (await budgets().where("fy", "==", fy).get()).docs.map((x) => ({ id: x.id, ...x.data() })).filter((x) => !branchFilter || branchFilter(x.branch));
    const reqs = (await requests().where("approvedAt", ">=", Timestamp.fromMillis(b0)).get()).docs.map((x) => x.data()).filter((r) => ms(r.approvedAt) < b1);
    return lines.map((l) => {
      const mine = reqs.filter((r) => r.branch === l.branch && (l.category === "ALL" || r.category === l.category));
      const committed = round2(mine.reduce((n, r) => n + budgetUse(r).committed, 0));
      const spent = round2(mine.reduce((n, r) => n + budgetUse(r).spent, 0));
      return { id: l.id, fy, branch: l.branch, category: l.category, amount: l.amount, committed, spent, remaining: round2(l.amount - committed - spent), pct: l.amount > 0 ? Math.round(((committed + spent) / l.amount) * 100) : 0, alerted: l.alerted || 0 };
    });
  }
  const fmt = (n) => round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // --- who ------------------------------------------------------------------
  const isAdmin = (u) => u.role === "ADMIN" || u.isOwner === true;
  const isOfficer = (u) => isAdmin(u) || u.perms?.procOfficer === true || u.department === "PROCUREMENT";
  const isFinance = (u) => isAdmin(u) || u.perms?.procFinance === true || u.department === "FINANCE";
  const isExec = (u) => isAdmin(u) || u.role === "UPPER_MANAGEMENT";
  // The section: those roles by default, or as given on the Users page (modules.procurement).
  const sees = (u) => u && u.active !== false && u.role !== "RECEPTIONIST" && u.tripsAccess !== "tripsOnly" && (isAdmin(u) || (u.modules?.procurement === false ? false
    : u.modules?.procurement === true || u.isPrincipal === true || isOfficer(u) || isFinance(u) || isExec(u) || u.department === "FACILITIES" || u.perms?.procReceive === true || u.perms?.mntManage === true));
  // Seeing every request: admins, procurement, finance, all-branch upper management.
  const seesAll = (u) => isOfficer(u) || isFinance(u) || (u.role === "UPPER_MANAGEMENT" && callerAll(u));
  const seesBranch = (u, b) => seesAll(u) || ((u.isPrincipal === true || u.role === "UPPER_MANAGEMENT" || u.perms?.procReceive === true) && callerHasBranch(u, b));
  const seesReq = (u, r) => r.requesterUid === u.uid || seesBranch(u, r.branch);
  // An approval step: the branch principal / finance / upper management (admins stand in for anyone absent).
  const actsStep = (u, role, branch) => (role === "BRANCH" ? (u.isPrincipal === true && callerHasBranch(u, branch)) || isAdmin(u) || (u.role === "UPPER_MANAGEMENT" && callerHasBranch(u, branch))
    : role === "FINANCE" ? isFinance(u) : isExec(u));
  const receives = (u, r) => (u.perms?.procReceive === true && callerHasBranch(u, r.branch)) || (u.isPrincipal === true && callerHasBranch(u, r.branch)) || r.requesterUid === u.uid || isAdmin(u);
  async function caller(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!sees(u)) throw new HttpsError("permission-denied", "لا تملك صلاحية «المشتريات».");
    return { uid: request.auth.uid, ...u };
  }

  async function loadSettings() {
    const s = (await db.collection("settings").doc("procurement").get()).data() || {};
    return { ...DEFAULT_SETTINGS, ...s };
  }
  // The steps a total needs.
  const chainFor = (total, s) => ["BRANCH", ...(total >= Number(s.financeFrom) ? ["FINANCE"] : []), ...(total > Number(s.execAbove) ? ["EXEC"] : [])];
  const withVat = (sub, s) => round2(sub * (1 + Number(s.vatRate) / 100));

  // --- files ----------------------------------------------------------------
  async function uploadFiles(list, prefix, { pdf = false } = {}) {
    const out = [];
    for (const f of (Array.isArray(list) ? list : []).slice(0, MAX_FILES)) {
      const okType = /^image\/(jpeg|png|webp|heic|heif)$/.test(String(f?.mimeType || "")) || (pdf && f?.mimeType === "application/pdf");
      if (!okType) throw new HttpsError("invalid-argument", pdf ? "صورة أو PDF فقط." : "الصور فقط.");
      const up = await uploadPublicAttachment(getBucket(), prefix, f);
      out.push({ fileName: up.fileName, fileUrl: up.fileUrl, mimeType: up.mimeType, at: Date.now() });
    }
    return out;
  }

  // --- views ----------------------------------------------------------------
  const logEntry = (by, action, extra = {}) => ({ at: Date.now(), by: by.uid || "", byName: by.name || "", action, ...extra });
  function canOf(u, r) {
    const step = r.steps?.[r.stepIdx];
    const mine = r.requesterUid === u.uid;
    return {
      approve: r.status === "PENDING_APPROVAL" && !!step && !mine && actsStep(u, step.role, r.branch),
      edit: r.status === "RETURNED" && mine,
      cancel: (["PENDING_APPROVAL", "RETURNED"].includes(r.status) && (mine || isOfficer(u))) || (["APPROVED", "ORDERED"].includes(r.status) && isOfficer(u)),
      order: r.status === "APPROVED" && isOfficer(u),
      quote: r.status === "APPROVED" && isOfficer(u),
      share: !!r.po && r.status !== "CANCELLED" && isOfficer(u),
      returnBack: r.status === "APPROVED" && isOfficer(u),
      receive: ["ORDERED", "PARTIAL"].includes(r.status) && receives(u, r) && r.po?.issuedBy !== u.uid,
      closeReceipt: r.status === "PARTIAL" && isOfficer(u),
      invoice: r.status === "RECEIVED" && (isFinance(u) || isOfficer(u)),
      pay: r.status === "INVOICED" && isFinance(u),
      rate: ["RECEIVED", "INVOICED", "PAID"].includes(r.status) && !r.supplierRating && (isOfficer(u) || receives(u, r)),
      seeSupplier: isOfficer(u) || isFinance(u) || isExec(u),
    };
  }
  const receivedValue = (r, s) => withVat((r.items || []).reduce((n, it) => n + (Number(it.received) || 0) * (Number(it.price) || 0), 0), { vatRate: r.po?.vatRate ?? s.vatRate });
  function reqOut(id, r, u, s) {
    const can = u ? canOf(u, r) : {};
    const recv = r.po ? receivedValue(r, s) : 0;
    return {
      id, number: r.number, branch: r.branch, category: r.category, title: r.title, justification: r.justification || "", urgent: r.urgent === true, status: r.status,
      items: (r.items || []).map((it) => ({ name: it.name, qty: it.qty, unit: it.unit || "", estPrice: it.estPrice, price: it.price ?? null, received: it.received || 0, itemId: it.itemId || "" })),
      estSubtotal: r.estSubtotal, estTotal: r.estTotal, steps: (r.steps || []).map((x) => ({ ...x })), stepIdx: r.stepIdx ?? 0,
      requesterUid: r.requesterUid, requesterName: r.requesterName || "", attachments: r.attachments || [], mntTicketId: r.mntTicketId || "", mntTicketNumber: r.mntTicketNumber || "",
      po: r.po ? { ...r.po, ...(can.seeSupplier || r.requesterUid === u?.uid || seesBranch(u, r.branch) ? {} : { supplierVat: "" }) } : null,
      quotes: can.seeSupplier ? (r.quotes || []) : [], quoteChoice: can.seeSupplier ? (r.quoteChoice || null) : null,
      receipts: r.receipts || [], invoice: r.invoice || null, payment: r.payment || null, supplierRating: r.supplierRating || 0,
      receivedValue: recv, match: r.invoice && r.po ? { po: r.po.total, received: recv, invoice: r.invoice.amount, ok: Math.abs(r.invoice.amount - recv) <= 1 && Math.abs(recv - r.po.total) <= 1 } : null,
      createdAt: ms(r.createdAt), submittedAt: ms(r.submittedAt), approvedAt: ms(r.approvedAt), orderedAt: ms(r.orderedAt), receivedAt: ms(r.receivedAt), paidAt: ms(r.paidAt),
      log: (r.log || []).slice(-80), can,
    };
  }
  const supplierOut = (id, x) => ({
    id, name: x.name, crNumber: x.crNumber || "", vatNumber: x.vatNumber || "", contactName: x.contactName || "", phone: x.phone || "", email: x.email || "",
    categories: x.categories || [], crExpiry: x.crExpiry || "", notes: x.notes || "", active: x.active !== false,
    rating: x.ratingCount ? round2(x.ratingSum / x.ratingCount) : 0, ratingCount: x.ratingCount || 0, orders: x.orders || 0, spent: round2(x.spent || 0),
  });

  // --- notifications --------------------------------------------------------
  const notify = (ids, title, body, id, type) => notifyUsers(ids, { title, body, complaintId: id, type }).catch((err) => console.error("proc notify", err));
  // Who is told: those holding the role themselves; admins only when nobody does.
  const primary = {
    BRANCH: (x, b) => x.isPrincipal === true && callerHasBranch(x, b),
    FINANCE: (x) => x.perms?.procFinance === true || x.department === "FINANCE",
    EXEC: (x) => x.role === "UPPER_MANAGEMENT",
    OFFICER: (x) => x.perms?.procOfficer === true || x.department === "PROCUREMENT",
    RECEIVE: (x, b) => x.perms?.procReceive === true && callerHasBranch(x, b),
  };
  async function recipients(role, branch, { except = [], fallback = true, users = null } = {}) {
    const list = (users || await loadActiveUsers()).filter((x) => x.active !== false && x.role !== "RECEPTIONIST" && x.modules?.procurement !== false && !except.includes(x.id));
    const ids = list.filter((x) => primary[role](x, branch)).map((x) => x.id);
    return ids.length || !fallback ? ids : list.filter(isAdmin).map((x) => x.id);
  }
  const notifyStep = async (id, r) => {
    const step = r.steps[r.stepIdx];
    notify(await recipients(step.role, r.branch, { except: [r.requesterUid] }), `طلب شراء ينتظر اعتمادك ${r.number}`, `${r.title} — ${fmt(r.estTotal)} ر.س (${STEP_AR[step.role]})`, id, "PROC_APPROVAL");
  };

  // --- requests -------------------------------------------------------------
  function cleanItems(list) {
    const items = (Array.isArray(list) ? list : []).slice(0, 60).map((it) => ({
      name: str(it?.name, 160), qty: Math.max(0, round2(it?.qty)), unit: str(it?.unit, 20), estPrice: Math.max(0, round2(it?.estPrice)),
      ...(idRe.test(String(it?.itemId || "")) ? { itemId: it.itemId } : {}),
    })).filter((it) => it.name && it.qty > 0);
    if (!items.length) throw new HttpsError("invalid-argument", "أضف صنفاً واحداً على الأقل بكميته.");
    return items;
  }
  async function submitRequest(ref, base, by, s, isNew) {
    const estSubtotal = round2(base.items.reduce((n, it) => n + it.qty * it.estPrice, 0));
    const estTotal = withVat(estSubtotal, s);
    const steps = chainFor(estTotal, s).map((role) => ({ role, status: "PENDING", by: "", byName: "", at: 0, note: "" }));
    const now = Timestamp.now();
    const r = { ...base, estSubtotal, estTotal, steps, stepIdx: 0, status: "PENDING_APPROVAL", submittedAt: now, updatedAt: now };
    if (isNew) await ref.set({ ...r, createdAt: now, log: [logEntry(by, "SUBMITTED", { note: `${fmt(estTotal)} ر.س` })] });
    else await ref.update({ ...r, log: FieldValue.arrayUnion(logEntry(by, "RESUBMITTED", { note: `${fmt(estTotal)} ر.س` })) });
    await notifyStep(ref.id, { ...base, ...r });
    return r;
  }
  async function loadReq(u, id) {
    if (!idRe.test(String(id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
    const ref = requests().doc(id);
    const r = (await ref.get()).data();
    if (!r || !seesReq(u, r)) throw new HttpsError("not-found", "الطلب غير موجود.");
    return { ref, r };
  }
  const need = (cond, msg) => { if (!cond) throw new HttpsError("permission-denied", msg); };

  const handlers = {
    async list(u) {
      const since = Timestamp.fromMillis(Date.now() - 400 * 86400e3);
      const s = await loadSettings();
      const snaps = [];
      if (seesAll(u)) snaps.push(await requests().where("createdAt", ">=", since).get());
      else {
        const bs = [...new Set([...(u.branches || []), u.branch].filter(Boolean))].filter((b) => seesBranch(u, b));
        for (const b of bs) snaps.push(await requests().where("branch", "==", b).get());
        snaps.push(await requests().where("requesterUid", "==", u.uid).get());
      }
      const seen = new Map();
      snaps.forEach((q) => q.docs.forEach((x) => { if (!seen.has(x.id) && ms(x.data().createdAt) >= ms(since)) seen.set(x.id, x.data()); }));
      const rows = [...seen.entries()].map(([id, r]) => reqOut(id, r, u, s)).sort((a, b) => b.createdAt - a.createdAt);
      return {
        requests: rows, settings: s, now: Date.now(),
        roles: { officer: isOfficer(u), finance: isFinance(u), exec: isExec(u), admin: isAdmin(u), viewer: seesAll(u) || u.isPrincipal === true || u.role === "UPPER_MANAGEMENT", inventory: invSees(u), store: u.perms?.procReceive === true },
      };
    },
    async get(u, dd) {
      const { r } = await loadReq(u, dd.id);
      const s = await loadSettings();
      const out = reqOut(dd.id, r, u, s);
      // The budget lines this request draws on (for approvers, procurement, finance).
      if (seesBranch(u, r.branch) && !["CANCELLED", "REJECTED"].includes(r.status)) {
        const fy = fyOf(ms(r.approvedAt) || Date.now(), s);
        const counted = ["APPROVED", "ORDERED", "PARTIAL", "RECEIVED", "INVOICED", "PAID"].includes(r.status);
        out.budget = (await budgetLines(fy, s, (b) => b === r.branch)).filter((l) => l.category === "ALL" || l.category === r.category)
          .map((l) => ({ ...l, thisRequest: counted ? 0 : r.estTotal }));
      }
      return { request: out };
    },
    async create(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !(isAdmin(u) || callerAll(u) || callerHasBranch(u, branch))) throw new HttpsError("invalid-argument", "اختر الفرع (من فروعك).");
      const title = str(dd.title, 160);
      if (!title) throw new HttpsError("invalid-argument", "اكتب عنوان الطلب.");
      const s = await loadSettings();
      const base = {
        branch, title, justification: str(dd.justification, 2000), category: CATEGORIES.includes(dd.category) ? dd.category : "OTHER", urgent: dd.urgent === true,
        items: cleanItems(dd.items), requesterUid: u.uid, requesterName: u.name || "",
      };
      // From a maintenance work order: the parts for it.
      let ticket = null;
      if (dd.mntTicketId) {
        if (!idRe.test(String(dd.mntTicketId))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const tRef = db.collection("mntTickets").doc(dd.mntTicketId);
        const t = (await tRef.get()).data();
        if (!t || t.branch !== branch) throw new HttpsError("not-found", "بلاغ الصيانة غير موجود في هذا الفرع.");
        ticket = { ref: tRef, t };
        Object.assign(base, { mntTicketId: dd.mntTicketId, mntTicketNumber: t.number, category: "MAINTENANCE" });
      }
      const ref = requests().doc();
      base.number = await nextRecordNumber("PR");
      base.attachments = await uploadFiles(dd.files, `procurement/${base.number}/request`, { pdf: true });
      await submitRequest(ref, base, u, s, true);
      if (ticket) {
        const open = ["ASSIGNED", "IN_PROGRESS"].includes(ticket.t.status);
        await ticket.ref.update({
          procRequests: FieldValue.arrayUnion({ id: ref.id, number: base.number }), updatedAt: Timestamp.now(), ...(open ? { status: "WAITING_PARTS" } : {}),
          log: FieldValue.arrayUnion(logEntry(u, open ? "WAITING_PARTS" : "COMMENT", { note: `طلب شراء ${base.number}` })),
        });
      }
      return { id: ref.id, number: base.number };
    },
    // The requester edits a returned request and sends it again (the approvals start over).
    async resubmit(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).edit, "التعديل لصاحب الطلب بعد إعادته.");
      const title = str(dd.title, 160) || r.title;
      const s = await loadSettings();
      const extra = await uploadFiles(dd.files, `procurement/${r.number}/request`, { pdf: true });
      await submitRequest(ref, { ...r, title, justification: str(dd.justification, 2000), category: CATEGORIES.includes(dd.category) ? dd.category : r.category, urgent: dd.urgent === true, items: cleanItems(dd.items), attachments: [...(r.attachments || []), ...extra].slice(-10) }, u, s, false);
      return handlers.get(u, { id: ref.id });
    },
    async decide(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).approve, "لا يمكنك اعتماد هذا الطلب (أو هو طلبك).");
      const decision = String(dd.decision || "");
      const note = str(dd.note, 1000);
      if (!["APPROVE", "REJECT", "RETURN"].includes(decision)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      if (decision !== "APPROVE" && !note) throw new HttpsError("invalid-argument", "اكتب السبب.");
      const steps = r.steps.map((x, i) => (i === r.stepIdx ? { ...x, status: decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED", by: u.uid, byName: u.name || "", at: Date.now(), note } : x));
      const last = r.stepIdx >= r.steps.length - 1;
      const now = Timestamp.now();
      const patch = { steps, updatedAt: now, log: FieldValue.arrayUnion(logEntry(u, `STEP_${decision}`, { to: STEP_AR[r.steps[r.stepIdx].role], note })) };
      if (decision === "APPROVE" && !last) patch.stepIdx = r.stepIdx + 1;
      else if (decision === "APPROVE") Object.assign(patch, { status: "APPROVED", approvedAt: now, approvedTotal: r.estTotal, approvedChain: r.steps.map((x) => x.role) });
      else patch.status = decision === "REJECT" ? "REJECTED" : "RETURNED";
      await ref.update(patch);
      const next = { ...r, ...patch };
      if (decision === "APPROVE" && !last) await notifyStep(ref.id, next);
      else {
        const word = { APPROVE: "اعتُمد", REJECT: "رُفض", RETURN: "أُعيد للتعديل" }[decision];
        notify([r.requesterUid], `${word} طلب الشراء ${r.number}`, `${r.title}${note ? ` — ${note}` : ""}`, ref.id, "PROC_DECIDED");
        if (decision === "APPROVE") {
          notify(await recipients("OFFICER", r.branch), `طلب شراء معتمد للتنفيذ ${r.number}`, `${r.title} — ${fmt(r.estTotal)} ر.س`, ref.id, "PROC_ORDER");
          await budgetAlerts(r.branch, r.category, ref.id);
        }
      }
      return handlers.get(u, { id: ref.id });
    },
    async cancel(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).cancel, "لا يمكنك إلغاء هذا الطلب.");
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب سبب الإلغاء.");
      await ref.update({ status: "CANCELLED", updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "CANCELLED", { note })) });
      if (r.requesterUid !== u.uid) notify([r.requesterUid], `أُلغي طلب الشراء ${r.number}`, `${r.title} — ${note}`, ref.id, "PROC_DECIDED");
      return handlers.get(u, { id: ref.id });
    },
    // Procurement sends an approved request back (e.g. the real price is higher).
    async returnBack(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).returnBack, "للمشتريات فقط.");
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب السبب.");
      await ref.update({ status: "RETURNED", updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "STEP_RETURN", { to: "المشتريات", note })) });
      notify([r.requesterUid], `أُعيد طلب الشراء ${r.number} للتعديل`, `${r.title} — ${note}`, ref.id, "PROC_DECIDED");
      return handlers.get(u, { id: ref.id });
    },
    // The purchase order: supplier, final unit prices, terms, delivery date.
    async order(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).order, "إصدار أوامر الشراء للمشتريات.");
      if (!idRe.test(String(dd.supplierId || ""))) throw new HttpsError("invalid-argument", "اختر المورد.");
      const sp = (await suppliers().doc(dd.supplierId).get()).data();
      if (!sp || sp.active === false) throw new HttpsError("not-found", "المورد غير موجود.");
      const prices = Array.isArray(dd.prices) ? dd.prices : [];
      if (prices.length !== r.items.length || prices.some((p) => !(Number(p) >= 0))) throw new HttpsError("invalid-argument", "اكتب سعر كل صنف.");
      const s = await loadSettings();
      const items = r.items.map((it, i) => ({ ...it, price: round2(prices[i]), received: 0 }));
      const subtotal = round2(items.reduce((n, it) => n + it.qty * it.price, 0));
      const vat = round2(subtotal * Number(s.vatRate) / 100);
      const total = round2(subtotal + vat);
      // Above what was approved (beyond the allowed overrun, or into a higher approval level): back for approval.
      const approved = r.approvedTotal ?? r.estTotal;
      const chain = chainFor(total, s);
      if (total > approved * (1 + Number(s.overrunPct) / 100) + 0.01 || chain.some((x) => !(r.approvedChain || []).includes(x))) {
        throw new HttpsError("failed-precondition", `إجمالي أمر الشراء ${fmt(total)} يتجاوز المبلغ المعتمد ${fmt(approved)} — أعد الطلب لصاحبه ليعدّله ويُعاد اعتماده.`);
      }
      // Price quotes: from quoteFrom, quoteCount of them (or a sole supplier, with the reason); the
      // order goes to one of the quoted suppliers, and not the cheapest only with a reason.
      const quotes = r.quotes || [];
      const needQuotes = approved >= Number(s.quoteFrom) && Number(s.quoteCount) > 0;
      const soleReason = str(dd.soleSource, 500);
      let quoteChoice = null;
      if (needQuotes && quotes.length < Number(s.quoteCount) && !soleReason) throw new HttpsError("failed-precondition", `هذا الطلب يحتاج ${s.quoteCount} عروض أسعار (لديه ${quotes.length}) — أو اذكر سبب التعامل مع مورد وحيد.`);
      if (quotes.length && !soleReason) {
        const chosen = quotes.filter((q) => q.supplierId === dd.supplierId).sort((a, b) => a.total - b.total)[0];
        if (!chosen) throw new HttpsError("failed-precondition", "اختر أحد الموردين الذين قدّموا عروض أسعار.");
        const cheapest = Math.min(...quotes.map((q) => q.total));
        const reason = str(dd.choiceReason, 500);
        if (chosen.total > cheapest + 0.01 && !reason) throw new HttpsError("invalid-argument", "المورد المختار ليس الأقل سعراً — اكتب سبب الاختيار.");
        quoteChoice = { quoteId: chosen.id, supplierName: chosen.supplierName, total: chosen.total, cheapest, reason };
      } else if (soleReason) quoteChoice = { soleSource: true, reason: soleReason };
      const number = await nextRecordNumber("PO");
      const deliveryDate = dayRe.test(dd.deliveryDate || "") ? dd.deliveryDate : "";
      const po = {
        number, supplierId: dd.supplierId, supplierName: sp.name, supplierVat: sp.vatNumber || "", supplierCr: sp.crNumber || "", supplierContact: [sp.contactName, sp.phone].filter(Boolean).join(" · "),
        subtotal, vatRate: Number(s.vatRate), vat, total, terms: str(dd.terms, 3000) || s.terms, deliveryDate, issuedBy: u.uid, issuedByName: u.name || "", issuedAt: Date.now(),
      };
      const now = Timestamp.now();
      await ref.update({ items, po, ...(quoteChoice ? { quoteChoice } : {}), status: "ORDERED", orderedAt: now, updatedAt: now, log: FieldValue.arrayUnion(logEntry(u, "ORDERED", { note: `${number} — ${sp.name} — ${fmt(total)} ر.س` })) });
      await suppliers().doc(dd.supplierId).update({ orders: (sp.orders || 0) + 1, spent: round2((sp.spent || 0) + total) });
      await sendPo(ref, { ...r, items, po }, sp, u);
      notify([r.requesterUid], `صدر أمر الشراء ${number}`, `${r.title} — ${sp.name}${deliveryDate ? ` — التوريد ${deliveryDate}` : ""}`, ref.id, "PROC_ORDER");
      notify(await recipients("RECEIVE", r.branch, { except: [u.uid], fallback: false }), `توريد قادم ${number}`, `${r.title} — ${sp.name}${deliveryDate ? ` — ${deliveryDate}` : ""}`, ref.id, "PROC_ORDER");
      return handlers.get(u, { id: ref.id });
    },
    // What arrived: quantities per item (partial or full), photos, a note.
    async receive(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).receive, r.po?.issuedBy === u.uid ? "من أصدر أمر الشراء لا يسجّل استلامه." : "تسجيل الاستلام لأمين المستودع أو مدير الفرع أو صاحب الطلب.");
      const qty = Array.isArray(dd.qty) ? dd.qty : [];
      const add = r.items.map((it, i) => Math.max(0, Math.min(round2(qty[i]), round2(it.qty - (it.received || 0)))));
      if (!add.some((x) => x > 0)) throw new HttpsError("invalid-argument", "اكتب الكميات المستلمة.");
      const photos = await uploadFiles(dd.photos, `procurement/${r.number}/receipt`);
      const items = r.items.map((it, i) => ({ ...it, received: round2((it.received || 0) + add[i]) }));
      const full = items.every((it) => it.received >= it.qty);
      const now = Timestamp.now();
      const receipt = { at: Date.now(), by: u.uid, byName: u.name || "", qty: add, note: str(dd.note, 1000), photos };
      await ref.update({
        items, status: full ? "RECEIVED" : "PARTIAL", ...(full ? { receivedAt: now } : {}), updatedAt: now, receipts: FieldValue.arrayUnion(receipt),
        log: FieldValue.arrayUnion(logEntry(u, full ? "RECEIVED" : "PARTIAL", { note: receipt.note })),
      });
      await stockIn(r, add, u);
      if (full) await afterReceived(ref.id, r, u);
      return handlers.get(u, { id: ref.id });
    },
    // A partial delivery taken as final (the rest will not come).
    async closeReceipt(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).closeReceipt, "للمشتريات فقط.");
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب السبب.");
      await ref.update({ status: "RECEIVED", receivedAt: Timestamp.now(), updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "RECEIPT_CLOSED", { note })) });
      await afterReceived(ref.id, r, u);
      return handlers.get(u, { id: ref.id });
    },
    async invoice(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).invoice, "إرفاق الفاتورة للمالية أو المشتريات.");
      const amount = round2(dd.amount);
      const number = str(dd.number, 60);
      if (!number || !(amount > 0)) throw new HttpsError("invalid-argument", "اكتب رقم الفاتورة ومبلغها.");
      const files = await uploadFiles(dd.files, `procurement/${r.number}/invoice`, { pdf: true });
      if (!files.length) throw new HttpsError("invalid-argument", "أرفق صورة الفاتورة أو ملفها.");
      const s = await loadSettings();
      const recv = receivedValue(r, s);
      const ok = Math.abs(amount - recv) <= 1 && Math.abs(recv - r.po.total) <= 1;
      await ref.update({
        status: "INVOICED", updatedAt: Timestamp.now(), invoice: { number, amount, date: dayRe.test(dd.date || "") ? dd.date : riyadhDay(), files, by: u.uid, byName: u.name || "", at: Date.now() },
        log: FieldValue.arrayUnion(logEntry(u, "INVOICED", { note: `${number} — ${fmt(amount)} ر.س${ok ? "" : ` (لا تطابق: أمر الشراء ${fmt(r.po.total)}، المستلم ${fmt(recv)})`}` })),
      });
      if (!isFinance(u)) notify(await recipients("FINANCE", r.branch, { fallback: false }), `فاتورة بانتظار الدفع ${r.po.number}`, `${r.po.supplierName} — ${fmt(amount)} ر.س`, ref.id, "PROC_INVOICE");
      return handlers.get(u, { id: ref.id });
    },
    // Finance records the payment status only (the payment is made outside the system).
    async pay(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).pay, "تسجيل الدفع للمالية.");
      const s = await loadSettings();
      const recv = receivedValue(r, s);
      const ok = Math.abs(r.invoice.amount - recv) <= 1 && Math.abs(recv - r.po.total) <= 1;
      const note = str(dd.note, 1000);
      if (!ok && !note) throw new HttpsError("invalid-argument", "الفاتورة لا تطابق أمر الشراء أو المستلم — اكتب سبب اعتماد الدفع.");
      await ref.update({
        status: "PAID", paidAt: Timestamp.now(), updatedAt: Timestamp.now(), payment: { ref: str(dd.ref, 80), date: dayRe.test(dd.date || "") ? dd.date : riyadhDay(), note, by: u.uid, byName: u.name || "", at: Date.now() },
        log: FieldValue.arrayUnion(logEntry(u, "PAID", { note: [str(dd.ref, 80), note].filter(Boolean).join(" — ") })),
      });
      return handlers.get(u, { id: ref.id });
    },
    async rate(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).rate, "لا يمكن التقييم.");
      const rating = Math.max(1, Math.min(5, Math.floor(Number(dd.rating) || 0)));
      const spRef = suppliers().doc(r.po.supplierId);
      const sp = (await spRef.get()).data();
      await ref.update({ supplierRating: rating, updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "RATED", { note: `${rating}/5${str(dd.note, 500) ? ` — ${str(dd.note, 500)}` : ""}` })) });
      if (sp) await spRef.update({ ratingSum: (sp.ratingSum || 0) + rating, ratingCount: (sp.ratingCount || 0) + 1 });
      return handlers.get(u, { id: ref.id });
    },
    async comment(u, dd) {
      const { ref } = await loadReq(u, dd.id);
      const note = str(dd.note, 1000);
      if (!note) throw new HttpsError("invalid-argument", "اكتب الملاحظة.");
      await ref.update({ updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "COMMENT", { note })) });
      return handlers.get(u, { id: ref.id });
    },

    // The purchase order's link for the supplier (made once), and its WhatsApp text.
    async poLink(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(isOfficer(u) && r.po, "للمشتريات بعد إصدار أمر الشراء.");
      const token = await poToken(ref, r);
      const sp = (await suppliers().doc(r.po.supplierId).get()).data() || {};
      if (dd.send) await sendPo(ref, r, sp, u, { force: true });
      return { link: `${PUBLIC_APP_URL}/po/${token}`, phone: sp.phone || "", supplier: r.po.supplierName, request: dd.send ? (await handlers.get(u, { id: ref.id })).request : undefined };
    },

    // --- stock (consumables, one store per branch) -----------------------
    async invList(u) {
      need(invSees(u), "المخزون لأمناء المستودعات والمشتريات ومديري الفروع والصيانة.");
      const all = invAll(u);
      const [items, stock] = await Promise.all([invItems().get(), invStock().get()]);
      const branchesSeen = all ? null : [...new Set([...(u.branches || []), u.branch].filter(Boolean))];
      return {
        items: items.docs.map((x) => ({ id: x.id, ...invItemOut(x.data()) })).filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name, "ar")),
        stock: stock.docs.map((x) => x.data()).filter((x) => !branchesSeen || branchesSeen.includes(x.branch)).map((x) => ({ itemId: x.itemId, branch: x.branch, qty: x.qty || 0, min: x.min ?? null })),
        canCatalog: isOfficer(u) || u.perms?.procReceive === true, moveBranches: all && invMovesAny(u) ? ["*"] : (branchesSeen || []).filter((b) => invMovesIn(u, b)),
      };
    },
    async invSaveItem(u, dd) {
      need(isOfficer(u) || u.perms?.procReceive === true, "دليل الأصناف للمشتريات وأمناء المستودعات.");
      const name = str(dd.name, 120);
      if (!name) throw new HttpsError("invalid-argument", "اكتب اسم الصنف.");
      const x = { name, unit: str(dd.unit, 20), code: str(dd.code, 40), category: CATEGORIES.includes(dd.category) ? dd.category : "OTHER", minQty: Math.max(0, round2(dd.minQty)), active: true, updatedAt: Timestamp.now() };
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = invItems().doc(dd.id);
        if (!(await ref.get()).exists) throw new HttpsError("not-found", "الصنف غير موجود.");
        await ref.update(x);
        return { id: dd.id };
      }
      const dup = (await invItems().where("name", "==", name).get()).docs.find((y) => y.data().active !== false);
      if (dup) throw new HttpsError("already-exists", "الصنف موجود في الدليل.");
      const ref = invItems().doc();
      await ref.set({ ...x, lastPrice: Math.max(0, round2(dd.lastPrice)), createdAt: Timestamp.now(), createdBy: u.uid });
      return { id: ref.id };
    },
    async invDeleteItem(u, dd) {
      need(isOfficer(u), "دليل الأصناف للمشتريات.");
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      await invItems().doc(dd.id).update({ active: false, updatedAt: Timestamp.now() });
      return { ok: true };
    },
    // A movement: OUT (to a work order or a department), IN (outside a purchase order), COUNT (stocktaking), TRANSFER (to another branch).
    async invMove(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !invMovesIn(u, branch)) throw new HttpsError("permission-denied", "حركات المخزون لأمين مستودع الفرع أو المشتريات.");
      if (!idRe.test(String(dd.itemId || ""))) throw new HttpsError("invalid-argument", "اختر الصنف.");
      const item = (await invItems().doc(dd.itemId).get()).data();
      if (!item || item.active === false) throw new HttpsError("not-found", "الصنف غير موجود.");
      const type = String(dd.type || "");
      const qty = round2(dd.qty);
      const note = str(dd.note, 500);
      if (!["OUT", "IN", "COUNT", "TRANSFER"].includes(type) || !(qty >= 0) || (type !== "COUNT" && !(qty > 0))) throw new HttpsError("invalid-argument", "اكتب الكمية.");
      if (type === "COUNT" && !note) throw new HttpsError("invalid-argument", "اكتب ملاحظة الجرد.");
      let ticket = null;
      if (type === "OUT" && dd.ticketNumber) {
        const tn = str(dd.ticketNumber, 30).toUpperCase();
        const t = (await db.collection("mntTickets").where("number", "==", tn).get()).docs[0];
        if (!t || t.data().branch !== branch) throw new HttpsError("not-found", "بلاغ الصيانة غير موجود في هذا الفرع.");
        ticket = t;
      }
      const toBranch = String(dd.toBranch || "");
      if (type === "TRANSFER" && (!branchRe.test(toBranch) || toBranch === branch)) throw new HttpsError("invalid-argument", "اختر الفرع المنقول إليه.");
      const by = { uid: u.uid, name: u.name || "" };
      const base = { itemId: dd.itemId, itemName: item.name, unit: item.unit || "", note, by: u.uid, byName: u.name || "", at: Date.now() };
      if (type === "COUNT") {
        const cur = await stockOf(dd.itemId, branch);
        await applyMove(dd.itemId, branch, qty - cur.qty, { ...base, type: "COUNT", counted: qty }, item, by);
      } else if (type === "TRANSFER") {
        await applyMove(dd.itemId, branch, -qty, { ...base, type: "TRANSFER_OUT", toBranch }, item, by, { mustHave: true });
        await applyMove(dd.itemId, toBranch, qty, { ...base, type: "TRANSFER_IN", fromBranch: branch }, item, by);
      } else if (type === "OUT") {
        const to = str(dd.to, 120);
        if (!ticket && !to) throw new HttpsError("invalid-argument", "اكتب الجهة المصروف لها أو رقم بلاغ الصيانة.");
        await applyMove(dd.itemId, branch, -qty, { ...base, type: "OUT", to, ...(ticket ? { ticketId: ticket.id, ticketNumber: ticket.data().number } : {}) }, item, by, { mustHave: true });
        // A work order gets the parts in its history and their value in its cost.
        if (ticket) {
          const t = ticket.data();
          const value = round2(qty * (item.lastPrice || 0));
          const c = t.cost || { labor: 0, parts: 0, contractor: 0 };
          const cost = { ...c, parts: round2((c.parts || 0) + value), total: round2((c.labor || 0) + (c.parts || 0) + value + (c.contractor || 0)), at: Date.now(), by: u.uid, byName: u.name || "" };
          await ticket.ref.update({ ...(value ? { cost } : {}), updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(by, "COMMENT", { note: `صُرف من المخزون: ${item.name} × ${qty}${value ? ` (${fmt(value)} ر.س)` : ""}` })) });
        }
      } else await applyMove(dd.itemId, branch, qty, { ...base, type: "IN" }, item, by);
      return handlers.invList(u);
    },
    async invSetMin(u, dd) {
      const branch = String(dd.branch || "");
      if (!branchRe.test(branch) || !invMovesIn(u, branch) || !idRe.test(String(dd.itemId || ""))) throw new HttpsError("permission-denied", "لأمين مستودع الفرع أو المشتريات.");
      const min = dd.min === "" || dd.min == null ? null : Math.max(0, round2(dd.min));
      await invStock().doc(`${dd.itemId}_${branch}`).set({ itemId: dd.itemId, branch, min, updatedAt: Timestamp.now() }, { merge: true });
      return handlers.invList(u);
    },
    async invMoves(u, dd) {
      need(invSees(u), "المخزون لأمناء المستودعات والمشتريات ومديري الفروع والصيانة.");
      let q = invMoves();
      if (idRe.test(String(dd.itemId || ""))) q = q.where("itemId", "==", dd.itemId);
      else if (branchRe.test(String(dd.branch || ""))) q = q.where("branch", "==", dd.branch);
      const all = invAll(u);
      const rows = (await q.get()).docs.map((x) => x.data()).filter((m) => all || callerHasBranch(u, m.branch)).filter((m) => !dd.branch || m.branch === dd.branch)
        .sort((a, b) => b.at - a.at).slice(0, 300);
      return { moves: rows };
    },

    // --- price quotes -----------------------------------------------------
    async addQuote(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).quote, "عروض الأسعار للمشتريات قبل أمر الشراء.");
      if (!idRe.test(String(dd.supplierId || ""))) throw new HttpsError("invalid-argument", "اختر المورد.");
      const sp = (await suppliers().doc(dd.supplierId).get()).data();
      if (!sp || sp.active === false) throw new HttpsError("not-found", "المورد غير موجود.");
      const total = round2(dd.total);
      if (!(total > 0)) throw new HttpsError("invalid-argument", "اكتب إجمالي العرض شاملاً الضريبة.");
      if ((r.quotes || []).length >= 8) throw new HttpsError("failed-precondition", "ثمانية عروض كحد أقصى.");
      const files = await uploadFiles(dd.files, `procurement/${r.number}/quotes`, { pdf: true });
      const q = { id: `q${Date.now().toString(36)}`, supplierId: dd.supplierId, supplierName: sp.name, total, validUntil: dayRe.test(dd.validUntil || "") ? dd.validUntil : "", note: str(dd.note, 500), files, by: u.uid, byName: u.name || "", at: Date.now() };
      await ref.update({ quotes: FieldValue.arrayUnion(q), updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "QUOTE", { note: `${sp.name} — ${fmt(total)} ر.س` })) });
      return handlers.get(u, { id: ref.id });
    },
    async removeQuote(u, dd) {
      const { ref, r } = await loadReq(u, dd.id);
      need(canOf(u, r).quote, "عروض الأسعار للمشتريات قبل أمر الشراء.");
      const q = (r.quotes || []).find((x) => x.id === dd.quoteId);
      if (!q) throw new HttpsError("not-found", "العرض غير موجود.");
      await ref.update({ quotes: (r.quotes || []).filter((x) => x.id !== dd.quoteId), updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry(u, "QUOTE_REMOVED", { note: `${q.supplierName} — ${fmt(q.total)} ر.س` })) });
      return handlers.get(u, { id: ref.id });
    },

    // --- budgets ----------------------------------------------------------
    async budgets(u, dd) {
      const s = await loadSettings();
      const fy = Number.isInteger(dd.fy) ? dd.fy : fyOf(Date.now(), s);
      const all = seesAll(u) || isExec(u);
      need(all || u.isPrincipal === true, "الميزانيات للمالية والمشتريات والإدارة ومديري الفروع.");
      return { fy, current: fyOf(Date.now(), s), fiscalStartMonth: Number(s.fiscalStartMonth || 1), lines: await budgetLines(fy, s, all ? null : (b) => callerHasBranch(u, b)), canEdit: isFinance(u) };
    },
    async saveBudget(u, dd) {
      need(isFinance(u), "تحديد الميزانيات للمالية.");
      const fy = Math.floor(Number(dd.fy));
      const branch = String(dd.branch || "");
      const category = dd.category === "ALL" || CATEGORIES.includes(dd.category) ? dd.category : "";
      const amount = round2(dd.amount);
      if (!(fy >= 2020 && fy <= 2100) || !branchRe.test(branch) || !category || !(amount >= 0)) throw new HttpsError("invalid-argument", "حدد السنة والفرع والبند والمبلغ.");
      await budgets().doc(`${fy}_${branch}_${category}`).set({ fy, branch, category, amount, alerted: 0, updatedAt: Timestamp.now(), updatedBy: u.uid }, { merge: true });
      return handlers.budgets(u, { fy });
    },
    async deleteBudget(u, dd) {
      need(isFinance(u), "تحديد الميزانيات للمالية.");
      if (!/^\d{4}_[A-Z0-9_]+$/.test(String(dd.lineId || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      await budgets().doc(dd.lineId).delete();
      return handlers.budgets(u, { fy: Number(String(dd.lineId).slice(0, 4)) });
    },

    // --- suppliers --------------------------------------------------------
    async suppliers(u) {
      need(isOfficer(u) || isFinance(u) || isExec(u), "سجل الموردين للمشتريات والمالية والإدارة.");
      return { suppliers: (await suppliers().get()).docs.map((x) => supplierOut(x.id, x.data())).filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name, "ar")), canEdit: isOfficer(u) };
    },
    async saveSupplier(u, dd) {
      need(isOfficer(u), "إدارة الموردين للمشتريات.");
      const name = str(dd.name, 120);
      if (!name) throw new HttpsError("invalid-argument", "اكتب اسم المورد.");
      const vatNumber = normalizeDigits(dd.vatNumber).replace(/\D/g, "");
      if (vatNumber && !/^3\d{13}3$/.test(vatNumber)) throw new HttpsError("invalid-argument", "الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3.");
      const x = {
        name, crNumber: normalizeDigits(dd.crNumber).replace(/\D/g, "").slice(0, 12), vatNumber, contactName: str(dd.contactName, 80),
        phone: normalizeDigits(dd.phone).replace(/[^\d+]/g, "").slice(0, 16), email: str(dd.email, 120), categories: [...new Set((Array.isArray(dd.categories) ? dd.categories : []).filter((c) => CATEGORIES.includes(c)))],
        crExpiry: dayRe.test(dd.crExpiry || "") ? dd.crExpiry : "", notes: str(dd.notes, 1000), active: true, updatedAt: Timestamp.now(),
      };
      if (dd.id) {
        if (!idRe.test(String(dd.id))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
        const ref = suppliers().doc(dd.id);
        const old = (await ref.get()).data();
        if (!old) throw new HttpsError("not-found", "المورد غير موجود.");
        await ref.update({ ...x, ...(old.crExpiry !== x.crExpiry ? { expiryNotified: "" } : {}) });
        return { supplier: supplierOut(dd.id, { ...old, ...x }) };
      }
      const ref = suppliers().doc();
      await ref.set({ ...x, createdAt: Timestamp.now(), createdBy: u.uid, ratingSum: 0, ratingCount: 0, orders: 0, spent: 0 });
      return { supplier: supplierOut(ref.id, x) };
    },
    async deleteSupplier(u, dd) {
      need(isOfficer(u), "إدارة الموردين للمشتريات.");
      if (!idRe.test(String(dd.id || ""))) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      await suppliers().doc(dd.id).update({ active: false, updatedAt: Timestamp.now() });
      return { ok: true };
    },

    // --- settings ---------------------------------------------------------
    async saveSettings(u, dd) {
      need(isAdmin(u), "للمدير فقط.");
      const num = (v, lo, hi, f) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, round2(n))) : f; };
      const s = {
        financeFrom: num(dd.financeFrom, 0, 1e7, 2000), execAbove: num(dd.execAbove, 0, 1e8, 10000), vatRate: num(dd.vatRate, 0, 50, 15), overrunPct: num(dd.overrunPct, 0, 50, 10),
        quoteFrom: num(dd.quoteFrom, 0, 1e8, 5000), quoteCount: Math.floor(num(dd.quoteCount, 0, 5, 3)), fiscalStartMonth: Math.floor(num(dd.fiscalStartMonth, 1, 12, 1)),
        terms: str(dd.terms, 3000) || DEFAULT_SETTINGS.terms, updatedAt: Timestamp.now(), updatedBy: u.uid,
      };
      if (s.execAbove < s.financeFrom) throw new HttpsError("invalid-argument", "حد الإدارة العليا يجب أن يكون أكبر من حد المالية.");
      await db.collection("settings").doc("procurement").set(s, { merge: true });
      return { settings: { ...DEFAULT_SETTINGS, ...s } };
    },
  };

  // --- stock helpers --------------------------------------------------------
  const invAll = (u) => isOfficer(u) || isFinance(u) || isExec(u) || callerAll(u);
  const invSees = (u) => invAll(u) || u.perms?.procReceive === true || u.isPrincipal === true || u.department === "FACILITIES" || u.perms?.mntManage === true;
  const invMovesAny = (u) => isOfficer(u);
  const invMovesIn = (u, b) => isOfficer(u) || (u.perms?.procReceive === true && callerHasBranch(u, b));
  const invItemOut = (x) => ({ name: x.name, unit: x.unit || "", code: x.code || "", category: x.category || "OTHER", minQty: x.minQty || 0, lastPrice: x.lastPrice || 0, active: x.active !== false });
  async function stockOf(itemId, branch) {
    const snap = await invStock().doc(`${itemId}_${branch}`).get();
    return { ref: invStock().doc(`${itemId}_${branch}`), qty: snap.exists ? snap.data().qty || 0 : 0, data: snap.data() || {} };
  }
  // One movement: the balance changes, the movement is kept, and a balance at
  // or under its reorder level tells the storekeepers and procurement (once).
  async function applyMove(itemId, branch, delta, move, item, by, { mustHave = false } = {}) {
    const ref = invStock().doc(`${itemId}_${branch}`);
    const after = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data().qty || 0 : 0;
      if (mustHave && cur + delta < -0.0001) throw new HttpsError("failed-precondition", `الرصيد غير كافٍ (المتوفر ${cur}).`);
      const next = round2(cur + delta);
      tx.set(ref, { itemId, branch, qty: next, updatedAt: Timestamp.now() }, { merge: true });
      return { next, data: snap.data() || {} };
    });
    await invMoves().doc().set({ ...move, branch, qty: round2(delta), after: after.next });
    const min = after.data.min ?? item.minQty ?? 0;
    if (min > 0 && after.next <= min && !after.data.lowAlerted) {
      await ref.set({ lowAlerted: true }, { merge: true });
      const users = await loadActiveUsers();
      const ids = [...await recipients("RECEIVE", branch, { users, fallback: false }), ...await recipients("OFFICER", branch, { users })].filter((x) => x !== by.uid);
      notify(ids, `مخزون منخفض: ${item.name}`, `الرصيد ${after.next} ${item.unit || ""} — حد إعادة الطلب ${min}`, "", "PROC_REMINDER");
    } else if (after.next > min && after.data.lowAlerted) await ref.set({ lowAlerted: false }, { merge: true });
    return after.next;
  }
  // What arrived for catalogue items goes into the branch's store at its price.
  async function stockIn(r, add, u) {
    for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i];
      if (!it.itemId || !(add[i] > 0)) continue;
      const item = (await invItems().doc(it.itemId).get()).data();
      if (!item) continue;
      await applyMove(it.itemId, r.branch, add[i], { itemId: it.itemId, itemName: item.name, unit: item.unit || "", type: "IN", ref: r.number, po: r.po?.number || "", note: "", by: u.uid, byName: u.name || "", at: Date.now() }, item, { uid: u.uid });
      if (it.price > 0) await invItems().doc(it.itemId).update({ lastPrice: it.price });
    }
  }

  // --- the purchase order to the supplier (link + WhatsApp «procPurchaseOrder») ---
  // {{1}} supplier, {{2}} PO number, {{3}} total, {{4}} branch and delivery
  // date, {{5}} the order's read-only link — and the "contact the branch" button.
  async function poToken(ref, r) {
    if (r.poToken) return r.poToken;
    const token = linkToken();
    await Promise.all([procLinks().doc(token).set({ requestId: ref.id, createdAt: Timestamp.now() }), ref.update({ poToken: token })]);
    return token;
  }
  async function sendPo(ref, r, sp, u, { force = false } = {}) {
    if (!WA_API_ENABLED || !taqnyatSend || !sp?.phone) return;
    const ws = (await db.collection("settings").doc("whatsappApi").get()).data() || {};
    const name = (ws.templates || {}).procPurchaseOrder;
    if (!ws.enabled || !name || (!force && ws.procAutoSend === false)) return;
    const token = await poToken(ref, r);
    const b = (await db.collection("branches").doc(r.branch).get()).data();
    const vars = [sp.name, r.po.number, `${fmt(r.po.total)} ر.س`, `${b?.name || r.branch}${r.po.deliveryDate ? ` — التوريد \u2066${r.po.deliveryDate}\u2069` : ""}`, `${PUBLIC_APP_URL}/po/${token}`];
    let note;
    try {
      await taqnyatSend({
        to: toIntlNumber(sp.phone), type: "template", template: { name, language: { code: ws.language || "ar" } },
        components: [
          { type: "body", parameters: vars.map((v) => ({ type: "text", text: waParam(v) })) },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `BR-${r.branch}` }] },
        ],
      }, { kind: "procurement", requestId: ref.id });
      note = `أُرسل أمر الشراء للمورد واتساب`;
    } catch (err) { note = `تعذّر إرسال واتساب للمورد: ${String(err.message || err).slice(0, 200)}`; }
    await ref.update({ log: FieldValue.arrayUnion(logEntry(u, "WHATSAPP", { note })) }).catch(() => {});
  }

  // Everything arrived: the requester, finance, and the work order waiting for these parts.
  async function afterReceived(id, r, u) {
    notify([r.requesterUid].filter((x) => x !== u.uid), `استُلم طلب الشراء ${r.number}`, `${r.title} — ${r.po?.supplierName || ""}`, id, "PROC_RECEIVED");
    notify(await recipients("FINANCE", r.branch, { fallback: false }), `استلام مكتمل ${r.po?.number || r.number}`, `${r.po?.supplierName || ""} — بانتظار الفاتورة`, id, "PROC_RECEIVED");
    if (!r.mntTicketId) return;
    const tRef = db.collection("mntTickets").doc(r.mntTicketId);
    const t = (await tRef.get()).data();
    if (t && t.status === "WAITING_PARTS") {
      await tRef.update({ status: "IN_PROGRESS", updatedAt: Timestamp.now(), log: FieldValue.arrayUnion(logEntry({ uid: "", name: "النظام" }, "IN_PROGRESS", { note: `وصلت القطع — طلب الشراء ${r.number}` })) });
    }
  }

  // A branch's budget lines crossing 80% or 100% (each once): finance, procurement and the principal.
  async function budgetAlerts(branch, category, id) {
    const s = await loadSettings();
    const fy = fyOf(Date.now(), s);
    for (const l of (await budgetLines(fy, s, (b) => b === branch)).filter((x) => x.category === "ALL" || x.category === category)) {
      const level = l.pct >= 100 ? 100 : l.pct >= 80 ? 80 : 0;
      if (!level || l.alerted >= level) continue;
      await budgets().doc(l.id).update({ alerted: level });
      const users = await loadActiveUsers();
      const ids = [...await recipients("FINANCE", branch, { users, fallback: false }), ...await recipients("OFFICER", branch, { users, fallback: false }), ...await recipients("BRANCH", branch, { users, fallback: false })];
      notify(ids, level === 100 ? `⚠️ تجاوزت ميزانية ${l.category === "ALL" ? "الفرع" : "البند"} 100%` : `بلغت ميزانية ${l.category === "ALL" ? "الفرع" : "البند"} ${l.pct}%`, `الميزانية ${fmt(l.amount)} — الملتزم ${fmt(l.committed)} والمصروف ${fmt(l.spent)} ر.س`, id, "PROC_REMINDER");
    }
  }

  const out = {};
  out.procAction = onCall({ timeoutSeconds: 120, memory: "512MiB", secrets: WA_SECRETS }, async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const h = Object.prototype.hasOwnProperty.call(handlers, dd.action) ? handlers[dd.action] : null;
    if (!h) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
    return h(u, dd);
  });

  // /po/<token>: the purchase order, read-only, for the supplier.
  out.procPublic = onCall({ timeoutSeconds: 60 }, async (request) => {
    const tk = request.data?.token;
    if (typeof tk !== "string" || !/^[a-z0-9]{16,40}$/.test(tk)) throw new HttpsError("not-found", "الرابط غير صحيح.");
    const l = (await procLinks().doc(tk).get()).data();
    const r = l ? (await requests().doc(l.requestId).get()).data() : null;
    if (!r || !r.po || r.poToken !== tk || r.status === "CANCELLED") throw new HttpsError("not-found", "الرابط غير صحيح أو انتهت صلاحيته.");
    const b = (await db.collection("branches").doc(r.branch).get()).data();
    const { issuedBy, ...po } = r.po;
    void issuedBy;
    return {
      school: SCHOOL_NAME, branch: r.branch, branchName: b?.name || r.branch, number: r.number, status: r.status,
      items: r.items.map((it) => ({ name: it.name, qty: it.qty, unit: it.unit || "", price: it.price ?? 0, received: it.received || 0 })), po,
    };
  });

  // Each working morning: approvals waiting more than two days (a reminder to
  // the approvers, once a day), orders past their delivery date (procurement,
  // once), and suppliers' commercial registrations expiring within 30 days.
  out.procSweep = onSchedule({ schedule: "30 7 * * 0-4", timeZone: "Asia/Riyadh", timeoutSeconds: 300, memory: "512MiB" }, async () => {
    const today = riyadhDay();
    const users = await loadActiveUsers();
    const officers = await recipients("OFFICER", "", { users });
    const pending = (await requests().where("status", "==", "PENDING_APPROVAL").get()).docs;
    for (const x of pending) {
      const r = x.data();
      const step = r.steps?.[r.stepIdx];
      const since = Math.max(ms(r.submittedAt), ...(r.steps || []).map((s) => s.at || 0));
      if (!step || Date.now() - since < 2 * 86400e3 || r.remindedDay === today) continue;
      await notify(await recipients(step.role, r.branch, { except: [r.requesterUid], users }), `تذكير: طلب شراء ينتظر اعتمادك ${r.number}`, `${r.title} — ${fmt(r.estTotal)} ر.س (${STEP_AR[step.role]})`, x.id, "PROC_REMINDER");
      await x.ref.update({ remindedDay: today });
    }
    const late = (await requests().where("status", "in", ["ORDERED", "PARTIAL"]).get()).docs.filter((x) => x.data().po?.deliveryDate && x.data().po.deliveryDate < today && !x.data().lateNotified);
    for (const x of late) {
      const r = x.data();
      await notify(officers, `تأخر توريد ${r.po.number}`, `${r.po.supplierName} — كان التوريد ${r.po.deliveryDate}`, x.id, "PROC_REMINDER");
      await x.ref.update({ lateNotified: true });
    }
    const soon = new Date(Date.now() + 30 * 86400e3 + 3 * 3600e3).toISOString().slice(0, 10);
    for (const x of (await suppliers().get()).docs) {
      const sp = x.data();
      if (sp.active === false || !sp.crExpiry || sp.crExpiry > soon || sp.expiryNotified === sp.crExpiry) continue;
      await notify(officers, sp.crExpiry < today ? `انتهى السجل التجاري للمورد ${sp.name}` : `السجل التجاري للمورد ${sp.name} ينتهي قريباً`, `تاريخ الانتهاء ${sp.crExpiry}`, "", "PROC_REMINDER");
      await x.ref.update({ expiryNotified: sp.crExpiry });
    }
  });

  return out;
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
