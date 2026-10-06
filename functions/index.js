const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();

// Tokens FCM reports as gone (browser data cleared, notifications revoked,
// device unregistered) — safe to drop from a user's fcmTokens right away.
const STALE_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const EMAIL_SECRETS = [GMAIL_USER, GMAIL_APP_PASSWORD];
// Bearer token of the school's Taqnyat WhatsApp Business API application
// (Taqnyat portal > Developers > Application). Set once with:
//   npx firebase-tools functions:secrets:set TAQNYAT_WA_TOKEN
// Declared only when ENABLE_WA_API=true (functions/.env): the CLI refuses to
// deploy *any* function while a declared secret has no value, so the WhatsApp
// API function stays out until the token has been stored.
const WA_API_ENABLED = process.env.ENABLE_WA_API === "true";
const TAQNYAT_WA_TOKEN = WA_API_ENABLED ? defineSecret("TAQNYAT_WA_TOKEN") : null;
const WA_SECRETS = WA_API_ENABLED ? [TAQNYAT_WA_TOKEN] : [];

async function sendEmail(to, subject, text) {
  if (!to) return;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });
    await transporter.sendMail({
      from: `"مدارس مكتشف العالمية" <${GMAIL_USER.value()}>`,
      to,
      subject,
      text,
    });
  } catch (err) {
    console.error("Failed to send email to", to, err.message);
  }
}

const OPEN_STATUSES = ["RECEIVED", "IN_PROGRESS", "WAITING_PARENT_RESPONSE", "ESCALATED"];
const OPEN_TICKET_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "SOLVED", "REOPENED"];
const OPEN_LOST_FOUND_STATUSES = ["UNCLAIMED", "MATCHED"];

// Removes a staff account (Firebase Auth + Firestore profile) via the Admin
// SDK. Only callers who are ADMIN or hold the `users` permission may call
// this. Refuses to delete: yourself, or a staff member with open complaints
// still assigned to them (those must be reassigned first).
exports.deleteStaffUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  const isAdminCaller = callerDoc.exists && caller.role === "ADMIN";
  if (!callerDoc.exists || !(isAdminCaller || caller.perms?.users)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { uid } = request.data || {};
  if (!uid) {
    throw new HttpsError("invalid-argument", "معرّف الموظف مطلوب.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "لا يمكن حذف المستخدم الذي تعمل باسمه حالياً.");
  }
  // A "manage users" holder (non-admin) may never delete an admin account —
  // only a real admin can remove another admin.
  if (!isAdminCaller) {
    const targetDoc = await db.collection("users").doc(uid).get();
    if (targetDoc.exists && targetDoc.data().role === "ADMIN") {
      throw new HttpsError("permission-denied", "لا يمكن حذف حساب مدير النظام.");
    }
  }

  const openComplaints = (
    await db.collection("complaints")
      .where("assignedTo", "array-contains", uid)
      .where("status", "in", OPEN_STATUSES)
      .get()
  ).size;
  if (openComplaints > 0) {
    throw new HttpsError("failed-precondition", `لا يمكن الحذف: لدى هذا الموظف ${openComplaints} ملاحظة مفتوحة — أعد إسنادها أولاً.`);
  }

  const openTickets = (
    await db.collection("techSupportTickets")
      .where("assignedTo", "array-contains", uid)
      .where("status", "in", OPEN_TICKET_STATUSES)
      .get()
  ).size;
  if (openTickets > 0) {
    throw new HttpsError("failed-precondition", `لا يمكن الحذف: لدى هذا الموظف ${openTickets} بلاغ تقني مفتوح — أعد إسناده أولاً.`);
  }

  const openLostFound = (
    await db.collection("lostFoundItems")
      .where("assignedTo", "array-contains", uid)
      .where("status", "in", OPEN_LOST_FOUND_STATUSES)
      .get()
  ).size;
  if (openLostFound > 0) {
    throw new HttpsError("failed-precondition", `لا يمكن الحذف: لدى هذا الموظف ${openLostFound} بلاغ مفقودات مفتوح — أعد إسناده أولاً.`);
  }

  await db.collection("users").doc(uid).delete();
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    // Auth user may already be gone; the Firestore profile removal above is what matters most.
    console.error("Auth deleteUser failed for", uid, err.message);
  }

  return { ok: true };
});

// Creates a staff account (Firebase Auth user + Firestore profile + role
// custom claim) using the Admin SDK, so the caller's own session is not
// affected — the previous client-side createUserWithEmailAndPassword flow
// signed the calling admin out every time a new employee account was added.
// Only callers whose own Firestore user doc has role == 'ADMIN' may call this.
exports.createStaffUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  const isAdminCaller = callerDoc.exists && caller.role === "ADMIN";
  if (!callerDoc.exists || !(isAdminCaller || caller.perms?.users)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { name, email, password, role, branches, access, perms, phone, jobTitle, department, active, isPrincipal, isQuality, stages, curricula, notificationPrefs, notificationChannels } = request.data || {};
  if (!name || !email || !password || !role) {
    throw new HttpsError("invalid-argument", "الاسم والبريد الإلكتروني وكلمة المرور والصلاحية مطلوبة.");
  }
  // A "manage users" holder (non-admin) may create staff accounts, but can
  // never grant admin-equivalent power — otherwise perms.users is a full
  // privilege-escalation path to ADMIN.
  const grantsAdminPower = role === "ADMIN" || access === "all" || !!perms?.users;
  if (!isAdminCaller && grantsAdminPower) {
    throw new HttpsError(
      "permission-denied",
      "لا يمكنك منح صلاحية مدير النظام أو الوصول الكامل لكل الفروع أو صلاحية إدارة المستخدمين."
    );
  }

  let userRecord;
  try {
    userRecord = await auth.createUser({ email, password, displayName: name });
  } catch (err) {
    throw new HttpsError("already-exists", err.message);
  }

  await auth.setCustomUserClaims(userRecord.uid, { role });

  await db.collection("users").doc(userRecord.uid).set({
    name,
    email,
    role,
    branches: access === "all" ? [] : (Array.isArray(branches) ? branches : []),
    access: access === "all" ? "all" : "branch",
    perms: {
      edit: !!perms?.edit,
      delete: !!perms?.delete,
      users: !!perms?.users,
    },
    phone: phone || null,
    jobTitle: jobTitle || null,
    department: department || null,
    isPrincipal: isPrincipal === true,
    isQuality: isQuality === true,
    notificationPrefs: notificationPrefs && typeof notificationPrefs === "object" ? notificationPrefs : {},
    notificationChannels: notificationChannels && typeof notificationChannels === "object" ? notificationChannels : {},
    stages: Array.isArray(stages) ? stages.filter((st) => typeof st === "string") : [],
    curricula: Array.isArray(curricula) ? curricula.filter((c) => typeof c === "string") : [],
    active: active !== false,
    createdAt: Timestamp.now(),
    createdBy: request.auth.uid,
  });

  return { uid: userRecord.uid };
});

// Sets a new password for an existing staff account via the Admin SDK.
// Only callers who are ADMIN or hold the "users" permission may call this.
exports.resetStaffPassword = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  const isAdminCaller = callerDoc.exists && caller.role === "ADMIN";
  if (!callerDoc.exists || !(isAdminCaller || caller.perms?.users)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { uid, newPassword } = request.data || {};
  if (!uid || !newPassword) {
    throw new HttpsError("invalid-argument", "معرّف الموظف وكلمة المرور الجديدة مطلوبان.");
  }
  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "يجب ألا تقل كلمة المرور عن 6 أحرف.");
  }
  // A "manage users" holder (non-admin) may never reset an admin's password
  // (or their own via this admin-only flow) — that's an account takeover.
  if (!isAdminCaller) {
    if (uid === request.auth.uid) {
      throw new HttpsError("permission-denied", "لا يمكنك إعادة تعيين كلمة مرورك الخاصة من هنا.");
    }
    const targetDoc = await db.collection("users").doc(uid).get();
    if (!targetDoc.exists || targetDoc.data().role === "ADMIN") {
      throw new HttpsError("permission-denied", "لا يمكن إعادة تعيين كلمة مرور مدير النظام.");
    }
  }

  await auth.updateUser(uid, { password: newPassword });
  return { ok: true };
});

// Creates in-app notification documents for a list of recipient user ids.
// Read by the NotificationBell UI (src/components/layout/NotificationBell.jsx).
// Notification categories a user (or an admin for them) can switch off —
// mirrors src/config/notificationCategories.js. notificationPrefs on the
// user doc holds { [category]: false } for the ones turned off.
const NOTIFICATION_CATEGORIES = {
  assigned: ["ASSIGNED", "IT_ASSIGNED", "LF_ASSIGNED"],
  escalation: ["ESCALATED", "IT_ESCALATED", "URGENT_CREATED"],
  slaWarning: ["SLA_WARNING"],
  internalComment: ["INTERNAL_COMMENT_ADDED", "IT_INTERNAL_COMMENT_ADDED"],
  partialSolution: ["PARTIAL_SOLUTION_ADDED"],
  solved: ["SOLVED_NOTIFY_RECEIVER"],
  reopened: ["REOPENED", "IT_REOPENED"],
  visit: ["VISIT_ARRIVED"],
  viewed: ["VIEWED", "IT_VIEWED"],
  appointment: ["APPOINTMENT_REQUESTED"],
};
const categoryOfType = (type) => Object.keys(NOTIFICATION_CATEGORIES).find((c) => NOTIFICATION_CATEGORIES[c].includes(type));

async function notifyUsers(userIds, { title, body, complaintId, type }) {
  let uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;

  // Drop recipients who switched this kind of notification off.
  const category = categoryOfType(type);
  if (category) {
    const docs = await db.getAll(...uniqueIds.map((id) => db.collection("users").doc(id)));
    const off = new Set(docs.filter((d) => d.exists && (d.data().notificationPrefs || {})[category] === false).map((d) => d.id));
    uniqueIds = uniqueIds.filter((id) => !off.has(id));
    if (uniqueIds.length === 0) return;
  }

  const now = Timestamp.now();
  const batch = db.batch();
  uniqueIds.forEach((userId) => {
    const ref = db.collection("notifications").doc();
    batch.set(ref, { userId, title, body, complaintId: complaintId || null, type, read: false, createdAt: now });
  });
  await batch.commit();
}

// Returns the uids of all users holding any of the given roles.
async function getUserIdsByRoles(roles) {
  const snapshot = await db.collection("users").where("role", "in", roles).get();
  return snapshot.docs.map((d) => d.id);
}

// Notifies the currently assigned staff whenever an internal comment/note is
// added to a complaint or tech-support ticket, so it doesn't sit unseen in a
// tab/field nobody but its author opens. Excludes the comment's own author.
async function notifyInternalComment(parentCollection, parentId, log, { titleLabel, notificationType, idField }) {
  const parentDoc = await db.collection(parentCollection).doc(parentId).get();
  if (!parentDoc.exists) return;
  const parent = parentDoc.data();

  // Flags the record so list/detail views can show an at-a-glance indicator
  // without every viewer having to open the internal-comment tab/field —
  // sticky on purpose, the fact that a discussion happened doesn't expire.
  if (!parent.hasInternalComment) {
    await parentDoc.ref.update({ hasInternalComment: true });
  }

  const recipients = (parent.assignedTo || []).filter((uid) => uid !== log.actorId);
  if (recipients.length === 0) return;
  await notifyUsers(recipients, {
    title: "تعليق داخلي جديد",
    body: `تمت إضافة تعليق داخلي على ${titleLabel} رقم ${parent[idField]}.`,
    complaintId: parentId,
    type: notificationType,
  });
}

// A reopened record (parent not satisfied, or staff reopening it) is routed
// again: the auto-assignment set is added to the existing assignees, and
// everyone already on it is told it came back.
async function handleReopen(kind, collectionName, docId, idField, label) {
  const ref = db.collection(collectionName).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const record = snap.data();
  if (record.assignedTo?.length) {
    await notifyUsers(record.assignedTo, {
      title: `تمت إعادة فتح ${label}`,
      body: `${label} رقم ${record[idField]} أُعيد فتحها وتحتاج متابعة.`,
      complaintId: docId,
      type: kind === "complaint" ? "REOPENED" : "IT_REOPENED",
    });
  }
  await reassignAutomatically(kind, ref, record, { replace: false, reason: "REOPENED" });
}

// Complaints already have a dedicated "internal comment" action, kept
// separate from the regular timeline (see ComplaintDetails.jsx's internal
// tab). Tech-support tickets only have a single NOTE_ADDED note field, which
// trackComplaint already treats as staff-only/hidden from parents — that's
// its internal-comment equivalent.
exports.notifyComplaintInternalComment = onDocumentCreated("complaints/{complaintId}/activityLog/{logId}", async (event) => {
  const log = event.data?.data();
  if (log?.action === "COMPLAINT_REOPENED") {
    await handleReopen("complaint", "complaints", event.params.complaintId, "complaintId", "الملاحظة");
    return;
  }
  // One assignee added their part of the solution: tell the others, and
  // move a still-"received" complaint into progress.
  if (log?.action === "PARTIAL_SOLUTION_ADDED") {
    const ref = db.collection("complaints").doc(event.params.complaintId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const c = snap.data();
    if (c.status === "RECEIVED") await ref.update({ status: "IN_PROGRESS", updatedAt: Timestamp.now() });
    const recipients = (c.assignedTo || []).filter((uid) => uid !== log.actorId);
    if (recipients.length) {
      await notifyUsers(recipients, {
        title: "حل جزئي جديد",
        body: `أضاف ${log.actorName || "أحد المسؤولين"} حله على الملاحظة رقم ${c.complaintId}.`,
        complaintId: event.params.complaintId,
        type: "PARTIAL_SOLUTION_ADDED",
      });
    }
    return;
  }
  if (!log || log.action !== "INTERNAL_COMMENT_ADDED") return;
  await notifyInternalComment("complaints", event.params.complaintId, log, {
    titleLabel: "الملاحظة",
    notificationType: "INTERNAL_COMMENT_ADDED",
    idField: "complaintId",
  });
});

exports.notifyTechSupportInternalComment = onDocumentCreated("techSupportTickets/{ticketId}/activityLog/{logId}", async (event) => {
  const log = event.data?.data();
  if (log?.action === "TICKET_REOPENED") {
    await handleReopen("techSupport", "techSupportTickets", event.params.ticketId, "ticketId", "البلاغ التقني");
    return;
  }
  if (!log || log.action !== "NOTE_ADDED") return;
  await notifyInternalComment("techSupportTickets", event.params.ticketId, log, {
    titleLabel: "البلاغ التقني",
    notificationType: "IT_INTERNAL_COMMENT_ADDED",
    idField: "ticketId",
  });
});

// SLA hours and working-time rules live in settings/sla (Settings page);
// due dates count only working time — see ./businessTime.js.
const { normalizeSla, businessMs, addBusinessMs } = require("./businessTime");
async function loadSla() {
  const snap = await db.collection("settings").doc("sla").get();
  return normalizeSla(snap.exists ? snap.data() : null);
}

// 1. Calculate Initial SLA when Complaint is Created + email the parent a receipt confirmation
exports.calculateInitialSLA = onDocumentCreated({ document: "complaints/{complaintId}", secrets: [...EMAIL_SECRETS, ...WA_SECRETS] }, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data();

  if (data.parentEmail) {
    await sendEmail(
      data.parentEmail,
      `تم استلام ملاحظتكم رقم ${data.complaintId}`,
      `مرحباً ${data.parentName}،\n\nشكراً لتواصلكم مع مدارس مكتشف العالمية.\nتم استلام ملاحظتكم رقم ${data.complaintId} الخاصة بالطالب/ة ${data.studentName} وسيتم التواصل معكم قريباً.\n\nيمكنكم متابعة حالة الملاحظة عبر الرابط التالي:\nhttps://mis-complaints.web.app/track?id=${data.complaintId}\n\nمدارس مكتشف العالمية`
    );
  }

  // If the complaint was created with assignees already chosen, notify them
  // immediately — later reassignments are handled in handleSlaStatusChanges.
  if (data.assignedTo?.length) {
    await notifyUsers(data.assignedTo, data.viaVisitQr ? {
      title: "ولي أمر بانتظار المقابلة في الفرع",
      body: `ولي أمر الطالب/ة ${data.studentName} وصل إلى الفرع ويرغب بمقابلة المسؤول — الملاحظة رقم ${data.complaintId}.`,
      complaintId: event.params.complaintId,
      type: "VISIT_ARRIVED",
    } : {
      title: "تم إسناد ملاحظة لك",
      body: `الملاحظة رقم ${data.complaintId} تم إسنادها إليك للمعالجة.`,
      complaintId: event.params.complaintId,
      type: "ASSIGNED",
    });
  }

  // Urgent complaints also alert system admins and upper management right
  // away, on top of whoever the complaint gets assigned to.
  if (data.priority === 'URGENT') {
    const escalationIds = await getUserIdsByRoles(["ADMIN", "UPPER_MANAGEMENT"]);
    await notifyUsers(escalationIds, {
      title: "ملاحظة عاجلة جديدة",
      body: `الملاحظة رقم ${data.complaintId} (${data.studentName}) بأولوية عاجلة وتحتاج متابعة فورية.`,
      complaintId: event.params.complaintId,
      type: "URGENT_CREATED",
    });
  }

  await ensureQualityAssigned(snap.ref, data);

  // Automatic WhatsApp receipt — not for a branch QR check-in (the parent
  // is standing at the branch; they get a thank-you after the meeting).
  if (!data.viaVisitQr) await autoSendWa("complaint", snap.ref, "receipt");

  if (data.dueDate) return; // Already has due date

  const sla = await loadSla();
  const priority = data.priority || 'NORMAL';
  const hours = Number(sla.complaintHours[priority] ?? sla.complaintHours.NORMAL) || 48;
  const dueDate = new Date(addBusinessMs(Date.now(), hours * 3600 * 1000, sla));

  return snap.ref.update({
    dueDate: Timestamp.fromDate(dueDate),
    slaStatus: 'ACTIVE'
  });
});

// Tech-support tickets: compute the 4-working-hour close SLA and notify an
// assignee chosen at creation time (the form auto-assigns an IT specialist).
exports.calculateItTicketSla = onDocumentCreated({ document: "techSupportTickets/{ticketId}", secrets: WA_SECRETS }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();

  if (data.assignedTo?.length) {
    await notifyUsers(data.assignedTo, {
      title: "بلاغ تقني جديد أُسند إليك",
      body: `البلاغ رقم ${data.ticketId} (${data.problemType}) تم إسناده إليك.`,
      complaintId: event.params.ticketId,
      type: "IT_ASSIGNED",
    });
  }

  await ensureQualityAssigned(snap.ref, data);
  await autoSendWa("techSupport", snap.ref, "receipt");

  if (data.dueDate) return;
  const sla = await loadSla();
  const dueDate = new Date(addBusinessMs(Date.now(), (Number(sla.techHours) || 4) * 3600 * 1000, sla));
  return snap.ref.update({ dueDate: Timestamp.fromDate(dueDate) });
});

// Notifies newly (re)assigned specialists on later transfers — creation-time
// assignment is handled by calculateItTicketSla above. A multi-person edit
// that keeps some existing assignees shouldn't re-notify them, same as
// complaints. Also notifies managers/executives when a staff member manually
// escalates a ticket (see TechSupportDetails.jsx's handleEscalate, which
// bumps `escalation`).
exports.handleItTicketAssignment = onDocumentUpdated({ document: "techSupportTickets/{ticketId}", secrets: WA_SECRETS }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  const beforeAssigned = new Set(before.assignedTo || []);
  const newlyAssigned = (after.assignedTo || []).filter((uid) => !beforeAssigned.has(uid));
  if (newlyAssigned.length > 0) {
    await notifyUsers(newlyAssigned, {
      title: "تم إسناد بلاغ تقني لك",
      body: `البلاغ رقم ${after.ticketId} تم إسناده إليك للمعالجة.`,
      complaintId: event.params.ticketId,
      type: "IT_ASSIGNED",
    });
  }

  if (before.branch && after.branch && before.branch !== after.branch) {
    await reassignAutomatically("techSupport", event.data.after.ref, after, { replace: true, reason: "BRANCH_CHANGED" });
  }

  // IT saved the resolution (status -> SOLVED): send it and close the ticket.
  if (before.status !== "SOLVED" && after.status === "SOLVED") {
    await autoSendWa("techSupport", event.data.after.ref, "resolution");
  }

  if ((after.escalation || 0) > (before.escalation || 0)) {
    const itManagers = await db.collection("users").where("role", "==", "DEPARTMENT_MANAGER").where("department", "==", "IT").get();
    const upperManagement = await getUserIdsByRoles(["UPPER_MANAGEMENT", "ADMIN"]);
    const userIds = [...itManagers.docs.map((d) => d.id), ...upperManagement];
    await notifyUsers(userIds, {
      title: "تصعيد بلاغ تقني",
      body: `البلاغ رقم ${after.ticketId} تم تصعيده ويحتاج متابعة.`,
      complaintId: event.params.ticketId,
      type: "IT_ESCALATED",
    });
  }
});

// Lost & found has no SLA/escalation concept (see lostFoundBreakdown in
// BranchIndicators.jsx) — these two triggers only ever notify on assignment,
// mirroring calculateItTicketSla/handleItTicketAssignment above but simpler.
exports.notifyLostFoundAssignment = onDocumentCreated({ document: "lostFoundItems/{itemId}", secrets: WA_SECRETS }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();

  if (data.assignedTo?.length) {
    await notifyUsers(data.assignedTo, {
      title: "تم إسناد بلاغ مفقودات لك",
      body: `البلاغ رقم ${data.itemCode} (${data.itemName}) تم إسناده إليك.`,
      complaintId: event.params.itemId,
      type: "LF_ASSIGNED",
    });
  }

  await autoSendWa("lostFound", snap.ref, "receipt");
});

exports.handleLostFoundAssignment = onDocumentUpdated({ document: "lostFoundItems/{itemId}", secrets: WA_SECRETS }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  const beforeAssigned = new Set(before.assignedTo || []);
  const newlyAssigned = (after.assignedTo || []).filter((uid) => !beforeAssigned.has(uid));
  if (newlyAssigned.length > 0) {
    await notifyUsers(newlyAssigned, {
      title: "تم إسناد بلاغ مفقودات لك",
      body: `البلاغ رقم ${after.itemCode} (${after.itemName}) تم إسناده إليك.`,
      complaintId: event.params.itemId,
      type: "LF_ASSIGNED",
    });
  }

  if (before.status !== "RETURNED" && after.status === "RETURNED") {
    await autoSendWa("lostFound", event.data.after.ref, "returned");
  }
});

// Emails a staff member whenever they receive an in-app notification
// (assignment, SLA reminder, escalation), so nothing depends on them having
// the app open.
exports.emailOnNotification = onDocumentCreated({ document: "notifications/{notificationId}", secrets: EMAIL_SECRETS }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const userDoc = await db.collection("users").doc(data.userId).get();
  const email = userDoc.exists ? userDoc.data().email : null;
  if (!email) return;
  if ((userDoc.data().notificationChannels || {}).email === false) return;

  await sendEmail(email, data.title, `${data.body}\n\nhttps://mis-complaints.web.app/complaints`);
});

// Pushes a Web Push notification to a staff member's registered devices so
// they're reached even with the tab closed (src/utils/push.js registers the
// tokens; public/firebase-messaging-sw.js shows the notification when the
// app isn't focused). Same trigger point as emailOnNotification above.
exports.pushOnNotification = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const userRef = db.collection("users").doc(data.userId);
  const userDoc = await userRef.get();
  const tokens = userDoc.exists ? (userDoc.data().fcmTokens || []) : [];
  if (tokens.length === 0) return;
  if ((userDoc.data().notificationChannels || {}).push === false) return;

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: data.title, body: data.body },
    data: { complaintId: data.complaintId || "", type: data.type || "" },
    webpush: { fcmOptions: { link: "https://mis-complaints.web.app/complaints" } },
  });

  const staleTokens = response.responses
    .map((r, i) => (!r.success && STALE_TOKEN_ERRORS.has(r.error?.code) ? tokens[i] : null))
    .filter(Boolean);
  if (staleTokens.length > 0) {
    await userRef.update({ fcmTokens: FieldValue.arrayRemove(...staleTokens) });
  }
});

// 2. Handle SLA Pause/Resume on Status Change, plus assignment/escalation notifications
exports.handleSlaStatusChanges = onDocumentUpdated({ document: "complaints/{complaintId}", secrets: WA_SECRETS }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const complaintId = event.params.complaintId;

  // Notify anyone newly added to the assignment — a multi-person edit that
  // keeps some existing assignees shouldn't re-notify them.
  const beforeAssigned = new Set(before.assignedTo || []);
  const newlyAssigned = (after.assignedTo || []).filter((uid) => !beforeAssigned.has(uid));
  if (newlyAssigned.length > 0) {
    await notifyUsers(newlyAssigned, {
      title: "تم إسناد ملاحظة لك",
      body: `الملاحظة رقم ${after.complaintId} تم إسنادها إليك للمعالجة.`,
      complaintId,
      type: "ASSIGNED",
    });
  }

  // Moved to another branch (edited data): the old branch's staff no longer
  // own it — route it to the new branch's staff instead.
  if (before.branch && after.branch && before.branch !== after.branch) {
    await reassignAutomatically("complaint", event.data.after.ref, after, { replace: true, reason: "BRANCH_CHANGED" });
  }

  // Automatic WhatsApp messages: the solution once it's written, and the
  // thank-you once a branch QR visit's meeting is confirmed.
  if (before.status !== "SOLVED" && after.status === "SOLVED" && after.solutionDetails) {
    await autoSendWa("complaint", event.data.after.ref, "resolution");
  }
  if (before.visitStatus !== "MET" && after.visitStatus === "MET") {
    await autoSendWa("complaint", event.data.after.ref, "visitMet");
  }

  // Notify managers/admin when a complaint is escalated (manually or via SLA breach)
  if (before.status !== 'ESCALATED' && after.status === 'ESCALATED') {
    const managerIds = await getUserIdsByRoles(["DEPARTMENT_MANAGER", "UPPER_MANAGEMENT", "ADMIN"]);
    await notifyUsers(managerIds, {
      title: "تصعيد ملاحظة",
      body: `الملاحظة رقم ${after.complaintId} تم تصعيدها وتحتاج متابعة.`,
      complaintId,
      type: "ESCALATED",
    });
    // Sticky marker so reports can still say "escalated & resolved" after
    // the status moves on to SOLVED/CLOSED.
    if (!after.wasEscalated) await event.data.after.ref.update({ wasEscalated: true });
  }

  // If status changed TO WAITING_PARENT_RESPONSE
  if (before.status !== 'WAITING_PARENT_RESPONSE' && after.status === 'WAITING_PARENT_RESPONSE') {
    return event.data.after.ref.update({
      slaPausedAt: Timestamp.now(),
      slaStatus: 'PAUSED'
    });
  }

  // If status changed FROM WAITING_PARENT_RESPONSE back to active
  if (before.status === 'WAITING_PARENT_RESPONSE' && after.status !== 'WAITING_PARENT_RESPONSE') {
    const pausedAt = after.slaPausedAt;
    const currentDueDate = after.dueDate;

    if (pausedAt && currentDueDate) {
      // Whatever working time was left when the wait started is granted
      // again from now (time outside working hours never counted anyway).
      const sla = await loadSla();
      const remaining = businessMs(pausedAt.toMillis(), currentDueDate.toMillis(), sla);
      const newDueDateMs = addBusinessMs(Date.now(), remaining, sla);

      return event.data.after.ref.update({
        dueDate: Timestamp.fromMillis(newDueDateMs),
        slaPausedAt: null,
        slaStatus: 'ACTIVE'
      });
    }
  }

  // Notify the customer-service employee who originally logged the
  // complaint once it's solved, so they can contact the parent and send
  // the WhatsApp resolution message (see ComplaintDetails.jsx).
  if (before.status !== 'SOLVED' && after.status === 'SOLVED' && after.receiver) {
    await notifyUsers([after.receiver], {
      title: "تم حل الملاحظة التي استلمتها",
      body: `الملاحظة رقم ${after.complaintId} تم حلها — يرجى التواصل مع ولي الأمر وإرسال رسالة الواتساب.`,
      complaintId,
      type: "SOLVED_NOTIFY_RECEIVER",
    });
  }

  // If closed or solved, clear slaStatus
  if (['SOLVED', 'CLOSED', 'REJECTED'].includes(after.status) && !['SOLVED', 'CLOSED', 'REJECTED'].includes(before.status)) {
    return event.data.after.ref.update({
      slaStatus: 'STOPPED'
    });
  }

  return null;
});

// 3. Hourly Cron Job to Check SLA Breaches + send a reminder ~2h before the deadline
//
// Each document is processed independently (not a single shared batch):
// - The breach/escalation write carries a `lastUpdateTime` precondition, so
//   if a staff member resolves the complaint/ticket in the window between
//   this job's read and its write, the write is rejected instead of
//   silently stomping the concurrent resolution and reopening it.
// - A reminder/flag is only persisted AFTER its notification has been sent
//   successfully — previously the "sent" flag was committed first, so any
//   failure in the notification step permanently suppressed that reminder
//   (the flag guard meant it would never be retried on a later run).
exports.scheduledSlaEngine = onSchedule("every 1 hours", async (event) => {
  const now = Timestamp.now();
  const twoHoursFromNow = Timestamp.fromMillis(now.toMillis() + 2 * 60 * 60 * 1000);

  // Only check active tickets (not paused, not stopped)
  const complaintsRef = db.collection("complaints");
  const q = complaintsRef.where("slaStatus", "==", "ACTIVE")
                         .where("isOverdue", "==", false);

  const snapshot = await q.get();

  if (snapshot.empty) {
    console.log("No active complaints found for SLA check.");
  }

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.dueDate) continue;

    try {
      if (data.dueDate.toMillis() < now.toMillis()) {
        // SLA breached! Guard against a concurrent resolution with a
        // precondition on the read's update time.
        await doc.ref.update(
          { isOverdue: true, status: "ESCALATED", updatedAt: now },
          { lastUpdateTime: doc.updateTime }
        );
        await db.collection(`complaints/${doc.id}/activityLog`).add({
          action: "SLA_BREACH",
          actorId: "SYSTEM",
          actorName: "النظام",
          metadata: { info: "تجاوز الوقت المحدد للحل (SLA Breach)" },
          createdAt: now,
        });
      } else if (!data.reminderSent && data.dueDate.toMillis() <= twoHoursFromNow.toMillis()) {
        // Due within the next 2 hours: notify first, then mark as sent —
        // if notifyUsers throws, reminderSent stays false and the next
        // hourly run retries it instead of losing the reminder forever.
        const recipients = data.assignedTo?.length ? data.assignedTo : [data.receiver].filter(Boolean);
        if (recipients.length) {
          await notifyUsers(recipients, {
            title: "تذكير: اقتراب موعد استحقاق الملاحظة",
            body: `الملاحظة رقم ${data.complaintId} تستحق الحل خلال ساعتين تقريباً.`,
            complaintId: doc.id,
            type: "SLA_WARNING",
          });
        }
        await doc.ref.update({ reminderSent: true }, { lastUpdateTime: doc.updateTime });
      }
    } catch (err) {
      console.error(`SLA check failed for complaint ${doc.id}:`, err.message);
    }
  }

  // --- Tech-support tickets: 4-hour close SLA + 1-hour start-processing check ---
  // 'NEW' (never assigned — e.g. no active IT specialist at creation time)
  // is included so an unassigned ticket doesn't sit forever with a blown
  // SLA and no escalation. SOLVED is excluded: the fix is done, so the
  // ticket mustn't be flagged late while only the WhatsApp send remains.
  const itSnapshot = await db.collection("techSupportTickets")
    .where("status", "in", ["NEW", "ASSIGNED", "IN_PROGRESS"])
    .get();

  // The "waiting for the parent to confirm" step was removed (parents
  // rarely confirm, which left solved tickets counted as late). Any ticket
  // still parked in it is closed as of when its resolution was sent.
  const waitingSnapshot = await db.collection("techSupportTickets").where("status", "==", "WAITING_CONFIRMATION").get();
  for (const doc of waitingSnapshot.docs) {
    try {
      const data = doc.data();
      await doc.ref.update(
        { status: "CLOSED", closedAt: data.resolutionMessageSentAt || now, updatedAt: now },
        { lastUpdateTime: doc.updateTime }
      );
      await db.collection(`techSupportTickets/${doc.id}/activityLog`).add({
        action: "CONFIRMED_CLOSED",
        actorId: "SYSTEM",
        actorName: "النظام",
        metadata: { info: "إغلاق تلقائي بعد إرسال رسالة الحل" },
        createdAt: now,
      });
    } catch (err) {
      console.error(`Auto-close failed for tech ticket ${doc.id}:`, err.message);
    }
  }

  for (const doc of itSnapshot.docs) {
    const data = doc.data();

    try {
      if (data.dueDate && !data.isOverdue && data.dueDate.toMillis() < now.toMillis()) {
        const level = (data.escalation || 0) >= 1 ? 2 : 1;
        await doc.ref.update(
          { isOverdue: true, escalation: level, updatedAt: now },
          { lastUpdateTime: doc.updateTime }
        );
        await db.collection(`techSupportTickets/${doc.id}/activityLog`).add({
          action: "TICKET_ESCALATED",
          actorId: "SYSTEM",
          actorName: "النظام",
          metadata: { info: `تجاوز مدة الإغلاق المعتمدة — تصعيد مستوى ${level}` },
          createdAt: now,
        });

        const userIds = level === 1
          ? (await db.collection("users").where("role", "==", "DEPARTMENT_MANAGER").where("department", "==", "IT").get()).docs.map((d) => d.id)
          : await getUserIdsByRoles(["UPPER_MANAGEMENT", "ADMIN"]);
        await notifyUsers(userIds, {
          title: "تصعيد بلاغ تقني",
          body: `البلاغ رقم ${data.ticketId} تجاوز مدة الإغلاق المعتمدة ويحتاج متابعة فورية.`,
          complaintId: doc.id,
          type: "IT_ESCALATED",
        });
      } else if (data.status === "ASSIGNED" && data.assignedAt && !data.startReminderSent) {
        const elapsed = now.toMillis() - data.assignedAt.toMillis();
        if (elapsed >= 60 * 60 * 1000 && data.assignedTo?.length) {
          await notifyUsers(data.assignedTo, {
            title: "تذكير: لم تبدأ معالجة البلاغ التقني بعد",
            body: `البلاغ رقم ${data.ticketId} أُسند إليك منذ أكثر من ساعة ولم تبدأ معالجته.`,
            complaintId: doc.id,
            type: "IT_ASSIGNED",
          });
          await doc.ref.update({ startReminderSent: true }, { lastUpdateTime: doc.updateTime });
        }
      }
    } catch (err) {
      console.error(`SLA check failed for tech ticket ${doc.id}:`, err.message);
    }
  }
});

// Which collection/ID-field a tracking number belongs to, by its prefix
// (see generateComplaintId/generateItemCode/generateTicketId in the
// frontend config files — COM-/LF-/IT- respectively).
const TRACKABLE_TYPES = [
  { prefix: "COM-", type: "complaint", collection: "complaints", idField: "complaintId" },
  { prefix: "LF-", type: "lostFound", collection: "lostFoundItems", idField: "itemCode" },
  { prefix: "IT-", type: "techSupport", collection: "techSupportTickets", idField: "ticketId" },
];

// Only a small, per-type allowlist of log metadata ever reaches the public
// portal — e.g. a tech ticket's CREDENTIALS_SENT log carries a username,
// which parents don't need surfaced back and shouldn't be re-exposed here.
function publicLogMetadata(log) {
  if (log.metadata?.solutionDetails) return { solutionDetails: log.metadata.solutionDetails };
  if (log.metadata?.returnedTo) return { returnedTo: log.metadata.returnedTo };
  return undefined;
}

// The WhatsApp number a parent should talk to about a record: its
// section's own number when it has one (e.g. the British section), else its
// branch's. Both live on the public branches/departments docs (Settings).
async function contactNumberFor(record) {
  if (record.department) {
    const deptSnap = await db.collection("departments").doc(record.department).get();
    const deptNumber = deptSnap.exists ? toIntlNumber(deptSnap.data().whatsappNumber) : "";
    if (deptNumber) return deptNumber;
  }
  if (record.branch) {
    const branchSnap = await db.collection("branches").doc(record.branch).get();
    if (branchSnap.exists) return toIntlNumber(branchSnap.data().whatsappNumber);
  }
  return "";
}

// Public parent-tracking lookup. The portal searches by a human-readable
// tracking number (not the Firestore document ID), which Firestore's
// security rules treat as a `list` operation — something an anonymous
// visitor can never be granted without also exposing the whole collection
// to enumeration. Doing the lookup here with the Admin SDK (bypasses rules)
// and returning only a parent-safe field subset solves both problems at
// once: the portal works, and no internal-only field ever reaches an
// unauthenticated client. Covers all three trackable record types.
exports.trackComplaint = onCall(async (request) => {
  const trackingId = (request.data?.complaintId || "").trim().toUpperCase();
  if (!trackingId) {
    throw new HttpsError("invalid-argument", "رقم المتابعة مطلوب.");
  }

  let match = TRACKABLE_TYPES.find((t) => trackingId.startsWith(t.prefix));
  if (!match) {
    throw new HttpsError("not-found", "عفواً، لم يتم العثور على سجل بهذا الرقم.");
  }

  let snapshot = await db.collection(match.collection).where(match.idField, "==", trackingId).limit(1).get();
  // A complaint that staff converted into a tech-support ticket (see
  // convertComplaintToTechTicket) no longer exists under its COM- number,
  // but the parent still holds that number — follow it to the ticket.
  if (snapshot.empty && match.type === "complaint") {
    const converted = await db.collection("techSupportTickets").where("convertedFromId", "==", trackingId).limit(1).get();
    if (!converted.empty) {
      match = TRACKABLE_TYPES.find((t) => t.type === "techSupport");
      snapshot = converted;
    }
  }
  if (snapshot.empty) {
    throw new HttpsError("not-found", "عفواً، لم يتم العثور على سجل بهذا الرقم.");
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  const logsSnapshot = await db.collection(`${match.collection}/${doc.id}/activityLog`).orderBy("createdAt", "desc").get();
  const history = logsSnapshot.docs
    .map((d) => d.data())
    .filter((l) => !["INTERNAL_COMMENT_ADDED", "NOTE_ADDED", "WHATSAPP_API_SENT", "WHATSAPP_API_FAILED", "PARTIAL_SOLUTION_ADDED", "APPOINTMENT_REQUESTED"].includes(l.action))
    .map((l) => ({
      action: l.action,
      createdAtMillis: l.createdAt?.toMillis?.() ?? null,
      metadata: publicLogMetadata(l),
    }));

  return {
    id: doc.id,
    type: match.type,
    complaintId: data[match.idField],
    status: data.status,
    rated: data.satisfactionRate != null,
    studentName: data.studentName || null,
    itemName: data.itemName || null,
    // Branch/section WhatsApp number for the /contact/<number> page that
    // the WhatsApp API templates' "تواصل مع الفرع" button opens.
    contactNumber: (await contactNumberFor(data)) || null,
    appointment: data.appointment && data.appointment.start ? { status: data.appointment.status, startMillis: data.appointment.start.toMillis(), rescheduled: !!data.appointment.rescheduled } : null,
    history,
  };
});

// Submits the tech-support satisfaction survey / reopen. techSupportTickets
// is deliberately never publicly writable (holds national IDs and account
// credentials) — see firestore.rules — so unlike the complaint/lost-found
// surveys (a narrow anonymous update rule), this goes through the Admin SDK
// instead, validating the exact same shape that rule would have enforced.
exports.submitTechSupportSurvey = onCall(async (request) => {
  const ticketId = (request.data?.ticketId || "").trim().toUpperCase();
  const { wantsReopen, ratings, comment } = request.data || {};
  if (!ticketId) {
    throw new HttpsError("invalid-argument", "رقم البلاغ مطلوب.");
  }

  const snapshot = await db.collection("techSupportTickets").where("ticketId", "==", ticketId).limit(1).get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "عفواً، لم يتم العثور على بلاغ بهذا الرقم.");
  }
  const ticketDoc = snapshot.docs[0];
  const ticket = ticketDoc.data();
  // Offered once the ticket is closed (sending the resolution closes it),
  // and only until the parent has rated it.
  const surveyOpen = ticket.status === "WAITING_CONFIRMATION" || (ticket.status === "CLOSED" && ticket.satisfactionRate == null);
  if (!surveyOpen) {
    throw new HttpsError("failed-precondition", "لا يمكن إرسال التقييم في هذه الحالة.");
  }

  const now = Timestamp.now();
  if (wantsReopen) {
    await ticketDoc.ref.update({
      status: "REOPENED",
      reopened: true,
      parentFeedback: comment || null,
      reopenCount: (ticket.reopenCount || 0) + 1,
      updatedAt: now,
    });
    await db.collection(`techSupportTickets/${ticketDoc.id}/activityLog`).add({
      action: "TICKET_REOPENED",
      actorId: "PARENT",
      actorName: "ولي الأمر",
      metadata: { reason: comment || null },
      createdAt: now,
    });
  } else {
    const values = Object.values(ratings || {});
    const satisfactionRate = values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
    await ticketDoc.ref.update({
      status: "CLOSED",
      satisfactionRate,
      satisfactionDetails: ratings || null,
      parentFeedback: comment || null,
      closedAt: ticket.closedAt || now,
      updatedAt: now,
    });
    await db.collection(`techSupportTickets/${ticketDoc.id}/activityLog`).add({
      action: "SURVEY_SUBMITTED",
      actorId: "PARENT",
      actorName: "ولي الأمر",
      metadata: { rating: satisfactionRate, ...ratings },
      createdAt: now,
    });
  }

  return { ok: true };
});

const MAX_PUBLIC_ATTACHMENTS = 3;
const MAX_PUBLIC_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const PUBLIC_COMPLAINT_REQUIRED_FIELDS = [
  "parentName", "parentPhone", "studentName", "studentId",
  "branch", "stage", "grade", "complaintType", "subject", "details",
];

// Shared by all three /report submission functions: uploads one attachment
// with the Admin SDK (Storage rejects anonymous writes, so this is the only
// way an unauthenticated parent's file reaches the bucket) and returns it in
// the same shape the staff-facing forms already produce via getDownloadURL,
// so existing attachment-rendering code (ComplaintDetails, LostFoundDetails)
// needs no changes.
async function uploadPublicAttachment(bucket, pathPrefix, att) {
  if (!att?.fileName || !att?.mimeType || !att?.base64Data) {
    throw new HttpsError("invalid-argument", "بيانات المرفق غير مكتملة.");
  }
  const buffer = Buffer.from(att.base64Data, "base64");
  if (buffer.length > MAX_PUBLIC_ATTACHMENT_BYTES) {
    throw new HttpsError("invalid-argument", "الحد الأقصى لحجم كل ملف هو 4 ميجابايت.");
  }
  const safeName = att.fileName.replace(/[/\\]/g, "_");
  const filePath = `${pathPrefix}/${Date.now()}_${safeName}`;
  const token = crypto.randomUUID();
  const file = bucket.file(filePath);
  await file.save(buffer, {
    metadata: {
      contentType: att.mimeType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return {
    fileName: safeName,
    fileUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`,
    mimeType: att.mimeType,
    size: buffer.length,
  };
}

// Finds the same eligible IT specialist TechSupportForm.jsx's client-side
// findItSpecialist() would (branch-specific preferred over all-branch),
// server-side — used only by submitPublicTechSupportTicket below.
async function findEligibleItSpecialist(branch, stage, curriculum) {
  const snapshot = await db.collection("users").where("role", "==", "SPECIALIST").where("department", "==", "IT").get();
  const candidates = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.active !== false && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch));
  // Whoever covers the grade and curriculum first, then branch-specific
  // over all-branch.
  const rank = (u) => (coversStage(u, stage) && coversCurriculum(u, curriculum) ? 0 : 2) + (u.access === "all" ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0] || null;
}

// Mirrors src/utils/scope.js coversStage(): a user may be limited to certain
// grades (`stages`, e.g. G1..G5); an empty/missing list means every grade.
function coversStage(u, stage) {
  const stages = Array.isArray(u.stages) ? u.stages : [];
  return !stages.length || !stage || stages.includes(stage);
}

// Mirrors src/utils/scope.js coversCurriculum(): same, per curriculum /
// section (`curricula` holds the record `department` ids — AMERICAN, ...).
function coversCurriculum(u, curriculum) {
  const list = Array.isArray(u.curricula) ? u.curricula : [];
  return !list.length || !curriculum || list.includes(curriculum);
}

// Who a submission from the public report link is routed to: every active
// specialist of the matching department (ACADEMIC / ADMINISTRATIVE /
// BEHAVIORAL / IT — the same ids as complaint types) in the student's
// branch who covers the student's grade (stage) and curriculum (the record's
// `department` — AMERICAN, BRITISH, ...) — or, failing that, the all-branch
// specialists of that department who cover them; if nobody covers them, the
// department's specialists regardless so the record is never left
// unassigned — plus every school principal over that branch, grade and
// curriculum.
async function findPublicAssignees(branch, department, stage, curriculum) {
  return findAutoAssignees({ branch, departments: [department], stage, curriculum });
}

// Same routing for several departments at once (a complaint can carry more
// than one category — see complaintTypesOf), plus the branch's quality
// officers (`isQuality`), who are auto-assigned every complaint and tech
// ticket in their branches regardless of grade/curriculum.
async function findAutoAssignees({ branch, departments, stage, curriculum, users: preloaded }) {
  const users = preloaded || await loadActiveUsers();
  const inBranch = (u) => (u.branches || []).includes(branch) || u.branch === branch;
  const covers = (u) => coversStage(u, stage) && coversCurriculum(u, curriculum);
  const specialists = [];
  for (const department of [...new Set(departments.filter(Boolean))]) {
    const deptSpecialists = users.filter((u) => u.role === "SPECIALIST" && u.department === department);
    const branchSpecialists = deptSpecialists.filter(inBranch);
    const allBranchSpecialists = deptSpecialists.filter((u) => u.access === "all");
    specialists.push(...([
      branchSpecialists.filter(covers),
      allBranchSpecialists.filter(covers),
      branchSpecialists,
      allBranchSpecialists,
    ].find((list) => list.length) || []));
  }
  const principals = users.filter((u) => u.isPrincipal === true && (u.access === "all" || inBranch(u)) && covers(u));
  const seen = new Set();
  return [...specialists, ...principals, ...qualityOfficers(users, branch)]
    .filter((u) => !seen.has(u.id) && seen.add(u.id))
    .map((u) => ({ id: u.id, name: u.name || "" }));
}

async function loadActiveUsers() {
  const snapshot = await db.collection("users").get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active !== false);
}

function qualityOfficers(users, branch) {
  return users.filter((u) => u.isQuality === true && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch));
}

// Every category a complaint carries: the primary complaintType plus any
// extra ones (`extraTypes: [{ type, subType }]`). Mirrors
// src/config/complaintTypes.js complaintTypesOf().
function complaintTypesOf(c) {
  const extra = Array.isArray(c.extraTypes) ? c.extraTypes.map((x) => x && x.type) : [];
  return [...new Set([c.complaintType, ...extra].filter(Boolean))];
}

function autoAssigneesFor(kind, record, users) {
  return findAutoAssignees({
    branch: record.branch,
    departments: kind === "complaint" ? complaintTypesOf(record) : ["IT"],
    stage: record.stage,
    curriculum: record.department,
    users,
  });
}

// Adds the branch's quality officers to a newly created record that doesn't
// already list them (staff-created records, converted tickets...). The
// update re-fires the record's onUpdate trigger, which notifies them like
// any other newly assigned person.
async function ensureQualityAssigned(ref, data) {
  const users = await loadActiveUsers();
  const current = data.assignedTo || [];
  const missing = qualityOfficers(users, data.branch).filter((u) => !current.includes(u.id));
  if (!missing.length) return;
  await ref.update({
    assignedTo: [...current, ...missing.map((u) => u.id)],
    assignedToNames: [...(data.assignedToNames || []), ...missing.map((u) => u.name || "")],
    ...(current.length ? {} : { assignedAt: Timestamp.now() }),
  });
}

// Re-runs auto-assignment for an existing record. `replace` (branch changed)
// swaps the whole assignment for the new branch's staff; otherwise (reopen)
// the auto set is added to whoever is already assigned.
async function reassignAutomatically(kind, ref, record, { replace, logCollection, reason }) {
  const auto = await autoAssigneesFor(kind, record);
  const current = record.assignedTo || [];
  const currentNames = record.assignedToNames || [];
  let ids;
  let names;
  if (replace) {
    ids = auto.map((a) => a.id);
    names = auto.map((a) => a.name);
  } else {
    const added = auto.filter((a) => !current.includes(a.id));
    ids = [...current, ...added.map((a) => a.id)];
    names = [...currentNames, ...added.map((a) => a.name)];
  }
  const changed = ids.length !== current.length || ids.some((id) => !current.includes(id));
  if (!changed) return;
  const now = Timestamp.now();
  await ref.update({ assignedTo: ids, assignedToNames: names, assignedAt: now });
  const addedNames = names.filter((_, i) => !current.includes(ids[i]));
  const removedNames = currentNames.filter((_, i) => !ids.includes(current[i]));
  await ref.collection("activityLog").add({
    action: kind === "complaint" ? "COMPLAINT_TRANSFERRED" : "TICKET_TRANSFERRED",
    actorId: null,
    actorName: "النظام (إسناد تلقائي)",
    metadata: { toUserIds: ids, toUserNames: names, addedNames, removedNames, reason },
    createdAt: now,
  });
}

// Public complaint submission (the /report link shared with parents).
// complaints already allows an anonymous client-side `create` (see
// firestore.rules), but Storage does not allow anonymous writes — rather
// than loosen Storage's security rules (a shared, harder-to-scope-safely
// surface), attachments are uploaded here with the Admin SDK, and the
// complaint doc is created in the same call so a record is never left
// without its attachments due to a partial client-side failure.
exports.submitPublicComplaint = onCall(async (request) => {
  const data = { ...(request.data || {}) };
  // `visit: true` = submitted from a branch's QR code (/visit) by a parent
  // who is physically at the branch waiting to meet someone. Only the visit
  // reason (subject) is asked for; details fall back to it.
  const isVisit = data.visit === true;
  if (isVisit && (typeof data.details !== "string" || !data.details.trim())) {
    data.details = data.subject;
  }
  for (const field of PUBLIC_COMPLAINT_REQUIRED_FIELDS) {
    if (!data[field] || typeof data[field] !== "string" || !data[field].trim()) {
      throw new HttpsError("invalid-argument", "يرجى تعبئة جميع الحقول المطلوبة.");
    }
  }

  const attachmentsInput = Array.isArray(data.attachments) ? data.attachments : [];
  if (attachmentsInput.length > MAX_PUBLIC_ATTACHMENTS) {
    throw new HttpsError("invalid-argument", `يمكن إرفاق ${MAX_PUBLIC_ATTACHMENTS} ملفات كحد أقصى.`);
  }

  const year = new Date().getFullYear();
  const complaintId = `COM-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
  const bucket = getStorage().bucket();

  const attachments = [];
  for (const att of attachmentsInput) {
    const uploaded = await uploadPublicAttachment(bucket, `complaints/${complaintId}`, att);
    attachments.push({ ...uploaded, uploadedBy: null, createdAt: new Date().toISOString() });
  }

  // Extra categories when one submission touches several areas.
  const extraTypes = (Array.isArray(data.extraTypes) ? data.extraTypes : [])
    .filter((x) => x && typeof x.type === "string" && x.type && x.type !== data.complaintType)
    .slice(0, 3)
    .map((x) => ({ type: x.type, subType: typeof x.subType === "string" ? x.subType : "" }));
  const assignees = await findAutoAssignees({
    branch: data.branch,
    departments: [data.complaintType, ...extraTypes.map((x) => x.type)],
    stage: data.stage,
    curriculum: data.department,
  });
  const now = Timestamp.now();
  // A "school visit appointment" request carries the slot the parent picked;
  // reserve it before creating the record so a slot taken meanwhile fails
  // cleanly and the parent can pick another.
  const docRef = db.collection("complaints").doc();
  let appointment = null;
  if (typeof data.appointmentSlot === "number" && !isVisit) {
    appointment = await reserveAppointment({ branch: data.branch, startMs: data.appointmentSlot, complaintDocId: docRef.id, complaintId });
  }
  await docRef.set({
    ...(appointment ? { appointment } : {}),
    parentName: data.parentName.trim(),
    parentPhone: data.parentPhone.trim(),
    parentEmail: (data.parentEmail || "").trim(),
    studentName: data.studentName.trim(),
    studentId: data.studentId.trim(),
    branch: data.branch,
    department: data.department || "",
    stage: data.stage,
    grade: data.grade.trim(),
    complaintType: data.complaintType,
    subType: data.subType || "",
    extraTypes,
    subject: data.subject.trim(),
    details: data.details.trim(),
    complaintId,
    priority: "NORMAL",
    source: isVisit ? "VISIT" : "PARENT_PORTAL",
    ...(isVisit ? { viaVisitQr: true, visitStatus: "WAITING", visitArrivedAt: now } : {}),
    receiver: null,
    status: "RECEIVED",
    attachments,
    assignedTo: assignees.map((a) => a.id),
    assignedToNames: assignees.map((a) => a.name),
    assignedAt: assignees.length ? now : null,
    reopened: false,
    isOverdue: false,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection(`complaints/${docRef.id}/activityLog`).add({
    action: isVisit ? "VISIT_CHECKED_IN" : "COMPLAINT_CREATED",
    actorId: null,
    actorName: isVisit ? "ولي الأمر (تسجيل وصول بالفرع عبر QR)" : "ولي الأمر (نموذج إلكتروني)",
    createdAt: now,
  });
  if (assignees.length) {
    await db.collection(`complaints/${docRef.id}/activityLog`).add({
      action: "COMPLAINT_ASSIGNED",
      actorId: null,
      actorName: "النظام (إسناد تلقائي)",
      metadata: { toUserIds: assignees.map((a) => a.id), toUserNames: assignees.map((a) => a.name), addedNames: assignees.map((a) => a.name) },
      createdAt: now,
    });
  }
  if (appointment) {
    await onAppointmentRequested(docRef.id, { branch: data.branch, complaintId, studentName: data.studentName.trim() }, appointment, "ولي الأمر (نموذج إلكتروني)");
  }

  return { complaintId };
});

const PUBLIC_LOST_FOUND_REQUIRED_FIELDS = ["itemName", "category", "branch"];

// Public lost & found submission. lostFoundItems already allows an
// anonymous client-side `create` (see firestore.rules), but — same reasoning
// as submitPublicComplaint above — the optional item photo still needs the
// Admin SDK, so the whole record is created here for the same atomicity.
exports.submitPublicLostFoundItem = onCall(async (request) => {
  const data = request.data || {};
  const reportType = data.reportType === "LOST" ? "LOST" : "FOUND";
  for (const field of PUBLIC_LOST_FOUND_REQUIRED_FIELDS) {
    if (!data[field] || typeof data[field] !== "string" || !data[field].trim()) {
      throw new HttpsError("invalid-argument", "يرجى تعبئة جميع الحقول المطلوبة.");
    }
  }
  if (reportType === "LOST" && (!data.reporterName?.trim() || !data.reporterPhone?.trim())) {
    throw new HttpsError("invalid-argument", "يرجى إدخال اسم ورقم جوال المُبلّغ عن الفقدان.");
  }

  const year = new Date().getFullYear();
  const itemCode = `LF-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
  const bucket = getStorage().bucket();

  let photoUrl = null;
  if (data.photo) {
    const uploaded = await uploadPublicAttachment(bucket, `lostFoundItems/${itemCode}`, data.photo);
    photoUrl = uploaded.fileUrl;
  }

  const now = Timestamp.now();
  const docRef = await db.collection("lostFoundItems").add({
    itemCode,
    reportType,
    category: data.category,
    itemName: data.itemName.trim(),
    description: (data.description || "").trim(),
    color: (data.color || "").trim(),
    branch: data.branch,
    location: (data.location || "").trim(),
    reporterName: (data.reporterName || "").trim(),
    reporterPhone: (data.reporterPhone || "").trim(),
    studentName: (data.studentName || "").trim(),
    studentId: (data.studentId || "").trim(),
    department: typeof data.department === "string" ? data.department : "",
    stage: typeof data.stage === "string" ? data.stage : "",
    grade: typeof data.grade === "string" ? data.grade.trim() : "",
    photoUrl,
    status: "UNCLAIMED",
    receiver: null,
    source: "PARENT_PORTAL",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection(`lostFoundItems/${docRef.id}/activityLog`).add({
    action: "ITEM_REGISTERED",
    actorId: null,
    actorName: "ولي الأمر (نموذج إلكتروني)",
    createdAt: now,
  });

  return { itemCode };
});

const PUBLIC_TECH_SUPPORT_REQUIRED_FIELDS = [
  "studentName", "nationalId", "branch", "stage", "grade",
  "parentName", "parentPhone", "problemType", "platform",
];

// Public tech-support ticket submission. Unlike complaints/lostFoundItems,
// techSupportTickets stays `allow create: if isAuthenticated()` in
// firestore.rules — completely unchanged — because this collection holds
// national IDs and is the entry point to an eventual account-credential
// reset.
exports.submitPublicTechSupportTicket = onCall(async (request) => {
  const data = request.data || {};
  for (const field of PUBLIC_TECH_SUPPORT_REQUIRED_FIELDS) {
    if (!data[field] || typeof data[field] !== "string" || !data[field].trim()) {
      throw new HttpsError("invalid-argument", "يرجى تعبئة جميع الحقول المطلوبة.");
    }
  }

  const attachmentsInput = Array.isArray(data.attachments) ? data.attachments : [];
  if (attachmentsInput.length > MAX_PUBLIC_ATTACHMENTS) {
    throw new HttpsError("invalid-argument", `يمكن إرفاق ${MAX_PUBLIC_ATTACHMENTS} ملفات كحد أقصى.`);
  }

  const ticketId = `IT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const bucket = getStorage().bucket();
  const attachments = [];
  for (const att of attachmentsInput) {
    const uploaded = await uploadPublicAttachment(bucket, `techSupport/${ticketId}`, att);
    attachments.push({ ...uploaded, uploadedBy: null, createdAt: new Date().toISOString() });
  }

  const assignees = await findPublicAssignees(data.branch, "IT", data.stage, data.department);
  const now = Timestamp.now();

  const docRef = await db.collection("techSupportTickets").add({
    attachments,
    studentName: data.studentName.trim(),
    nationalId: data.nationalId.trim(),
    academicId: (data.academicId || "").trim(),
    branch: data.branch,
    department: data.department || "",
    stage: data.stage,
    grade: data.grade.trim(),
    parentName: data.parentName.trim(),
    relation: data.relation || "الأب",
    parentPhone: data.parentPhone.trim(),
    parentNationalId: typeof data.parentNationalId === "string" ? data.parentNationalId.trim() : "",
    problemType: data.problemType,
    platform: data.platform,
    platformLink: (data.platformLink || "").trim(),
    details: (data.details || "").trim(),
    ticketId,
    receiver: null,
    source: "PARENT_PORTAL",
    status: assignees.length ? "ASSIGNED" : "NEW",
    assignedTo: assignees.map((a) => a.id),
    assignedToNames: assignees.map((a) => a.name),
    assignedAt: assignees.length ? now : null,
    isOverdue: false,
    reopenCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection(`techSupportTickets/${docRef.id}/activityLog`).add({
    action: "TICKET_CREATED",
    actorId: null,
    actorName: "ولي الأمر (نموذج إلكتروني)",
    createdAt: now,
  });
  if (assignees.length) {
    await db.collection(`techSupportTickets/${docRef.id}/activityLog`).add({
      action: "TICKET_ASSIGNED",
      actorId: null,
      actorName: "النظام (إسناد تلقائي)",
      metadata: { toUserNames: assignees.map((a) => a.name), addedNames: assignees.map((a) => a.name) },
      createdAt: now,
    });
  }

  return { ticketId };
});

// Moves a complaint that was filed under the wrong kind (parents often log a
// platform-login problem as a general complaint) into the tech-support
// module. Done server-side so it is all-or-nothing and doesn't require the
// caller to hold the delete permission: the ticket is created, the complaint
// is archived to deletedComplaints (same shape ComplaintDetails.jsx's
// handleDelete writes) and then removed together with its activity log.
exports.convertComplaintToTechTicket = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { complaintDocId, problemType, platform, grade, relation, parentNationalId } = request.data || {};
  for (const value of [complaintDocId, problemType, platform, grade]) {
    if (!value || typeof value !== "string" || !value.trim()) {
      throw new HttpsError("invalid-argument", "يرجى تعبئة جميع الحقول المطلوبة.");
    }
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }

  const complaintRef = db.collection("complaints").doc(complaintDocId);
  const complaintSnap = await complaintRef.get();
  if (!complaintSnap.exists) {
    throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
  }
  const complaint = complaintSnap.data();

  // Mirrors firestore.rules: canEditRecord(branch) for the complaint plus
  // canAccessTechSupport() for the module it is moving into.
  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(complaint.branch) || caller.branch === complaint.branch;
  const canEdit = isAdminCaller || (caller.perms?.edit === true && inScope);
  const canAccessTech = isAdminCaller || caller.department === "IT" || caller.role === "CUSTOMER_SERVICE" || caller.isPrincipal === true || caller.isQuality === true;
  if (!canEdit || !canAccessTech) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تحويل هذه الملاحظة.");
  }
  if (["SOLVED", "CLOSED", "REJECTED"].includes(complaint.status)) {
    throw new HttpsError("failed-precondition", "لا يمكن تحويل ملاحظة منتهية.");
  }

  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const ticketId = `IT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const assignee = await findEligibleItSpecialist(complaint.branch, complaint.stage, complaint.department);
  const logsSnapshot = await complaintRef.collection("activityLog").orderBy("createdAt", "asc").get();
  const reason = `تحويل إلى بلاغ تقني ${ticketId}`;

  const ticketRef = db.collection("techSupportTickets").doc();
  const batch = db.batch();
  batch.set(ticketRef, {
    studentName: complaint.studentName || "",
    nationalId: complaint.studentId || "",
    academicId: "",
    branch: complaint.branch || "",
    department: complaint.department || "",
    stage: complaint.stage || "",
    grade: grade.trim(),
    parentName: complaint.parentName || "",
    relation: relation || "الأب",
    parentPhone: complaint.parentPhone || "",
    parentNationalId: typeof parentNationalId === "string" ? parentNationalId.trim() : "",
    problemType,
    platform,
    platformLink: "",
    details: [complaint.subject, complaint.details].filter(Boolean).join("\n"),
    attachments: complaint.attachments || [],
    ticketId,
    convertedFromId: complaint.complaintId || null,
    receiver: complaint.receiver || request.auth.uid,
    source: complaint.source || null,
    receiptMessageSentAt: complaint.receiptMessageSentAt || null,
    status: assignee ? "ASSIGNED" : "NEW",
    assignedTo: assignee ? [assignee.id] : [],
    assignedToNames: assignee ? [assignee.name] : [],
    assignedAt: assignee ? now : null,
    isOverdue: false,
    reopenCount: 0,
    createdAt: complaint.createdAt || now,
    updatedAt: now,
  });
  batch.set(ticketRef.collection("activityLog").doc(), {
    action: "CONVERTED_FROM_COMPLAINT",
    actorId: request.auth.uid,
    actorName,
    metadata: { note: `رقم الملاحظة الأصلي: ${complaint.complaintId}` },
    createdAt: now,
  });
  if (assignee) {
    batch.set(ticketRef.collection("activityLog").doc(), {
      action: "TICKET_ASSIGNED",
      actorId: request.auth.uid,
      actorName,
      metadata: { toUserNames: [assignee.name], addedNames: [assignee.name] },
      createdAt: now,
    });
  }
  batch.set(db.collection("deletedComplaints").doc(), {
    complaint: { ...complaint, id: complaintDocId },
    activityLog: [
      ...logsSnapshot.docs.map((d) => d.data()),
      { action: "COMPLAINT_CONVERTED", actorId: request.auth.uid, actorName, metadata: { reason }, createdAt: now },
    ],
    reason,
    convertedToTicketId: ticketId,
    deletedBy: request.auth.uid,
    deletedByName: actorName,
    deletedAt: now,
  });
  await batch.commit();
  await db.recursiveDelete(complaintRef);

  return { ticketId, ticketDocId: ticketRef.id };
});

// Uploads one file for a tech-support resolution message (screenshot,
// instructions PDF, ...). Done with the Admin SDK — same helper as the
// public-link attachments — so it doesn't depend on Storage security rules;
// access is checked here against the same rules firestore.rules applies to
// the ticket (tech-support access + edit permission in its branch).
exports.uploadTechSupportResolutionFile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { ticketDocId, file } = request.data || {};
  if (!ticketDocId || typeof ticketDocId !== "string") {
    throw new HttpsError("invalid-argument", "رقم البلاغ مطلوب.");
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }
  const ticketSnap = await db.collection("techSupportTickets").doc(ticketDocId).get();
  if (!ticketSnap.exists) {
    throw new HttpsError("not-found", "لم يتم العثور على البلاغ.");
  }
  const ticket = ticketSnap.data();

  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(ticket.branch) || caller.branch === ticket.branch;
  const canAccessTech = isAdminCaller || caller.department === "IT" || caller.role === "CUSTOMER_SERVICE" || caller.isPrincipal === true || caller.isQuality === true;
  const canEdit = isAdminCaller || (caller.perms?.edit === true && inScope);
  if (!canAccessTech || !canEdit) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تعديل هذا البلاغ.");
  }

  const uploaded = await uploadPublicAttachment(getStorage().bucket(), `techSupport/${ticket.ticketId}/resolution`, file);
  return { ...uploaded, uploadedBy: request.auth.uid, createdAt: new Date().toISOString() };
});

// Confirms that a parent who checked in at a branch (QR visit, see
// submitPublicComplaint's `visit` flag) has been met. The meeting notes /
// agreed solution are stored as an internal comment (staff-only, never
// shown to the parent), and the complaint is marked solved when the
// meeting resolved it. Allowed for anyone who can edit the record in its
// branch, and also for its assignees and branch principals — the person
// meeting the parent may not hold the general edit permission.
exports.confirmBranchVisit = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { complaintDocId, notes, solved } = request.data || {};
  if (!complaintDocId || typeof complaintDocId !== "string") {
    throw new HttpsError("invalid-argument", "رقم الملاحظة مطلوب.");
  }
  if (typeof notes !== "string" || !notes.trim()) {
    throw new HttpsError("invalid-argument", "يرجى كتابة ملخص المقابلة والحل.");
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }
  const complaintRef = db.collection("complaints").doc(complaintDocId);
  const snap = await complaintRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
  }
  const complaint = snap.data();
  if (complaint.visitStatus !== "WAITING") {
    throw new HttpsError("failed-precondition", "تم تأكيد هذه المقابلة مسبقاً.");
  }

  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(complaint.branch) || caller.branch === complaint.branch;
  const isAssignee = (complaint.assignedTo || []).includes(request.auth.uid);
  const allowed = isAdminCaller || isAssignee || (inScope && (caller.perms?.edit === true || caller.isPrincipal === true || caller.isQuality === true));
  if (!allowed) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تأكيد هذه المقابلة.");
  }

  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const text = notes.trim();
  const isSolved = solved === true && !["SOLVED", "CLOSED", "REJECTED"].includes(complaint.status);

  // The person who met the parent becomes an assignee if they weren't.
  const assignedTo = complaint.assignedTo || [];
  const assignedToNames = complaint.assignedToNames || [];
  const assigneeUpdate = isAssignee ? {} : {
    assignedTo: [...assignedTo, request.auth.uid],
    assignedToNames: [...assignedToNames, actorName],
    ...(assignedTo.length ? {} : { assignedAt: now }),
  };

  const logs = complaintRef.collection("activityLog");
  const batch = db.batch();
  batch.set(logs.doc(), {
    action: "INTERNAL_COMMENT_ADDED",
    actorId: request.auth.uid,
    actorName,
    metadata: { comment: `✅ تمت مقابلة ولي الأمر في الفرع.\n${text}`, visit: true },
    createdAt: now,
  });
  batch.set(logs.doc(), {
    action: "VISIT_MET",
    actorId: request.auth.uid,
    actorName,
    metadata: { solved: isSolved },
    createdAt: now,
  });
  batch.update(complaintRef, {
    visitStatus: "MET",
    visitMetAt: now,
    visitMetBy: request.auth.uid,
    visitMetByName: actorName,
    hasInternalComment: true,
    ...assigneeUpdate,
    ...(isSolved ? { status: "SOLVED", solvedAt: now } : (complaint.status === "RECEIVED" ? { status: "IN_PROGRESS" } : {})),
    updatedAt: now,
  });
  await batch.commit();
  return { ok: true, solved: isSolved };
});

// One-time backfill of `wasEscalated` for complaints escalated before the
// flag existed (manual escalations are only recorded in the activity log;
// SLA escalations also set isOverdue). Runs on a schedule but does its work
// once — a marker doc makes every later run a single cheap read.
exports.backfillWasEscalated = onSchedule("every 30 minutes", async () => {
  const markerRef = db.collection("meta").doc("migrations");
  const marker = await markerRef.get();
  if (marker.exists && marker.data().wasEscalatedBackfill) return;

  const snapshot = await db.collection("complaints").get();
  let updated = 0;
  for (const doc of snapshot.docs) {
    const c = doc.data();
    if (c.wasEscalated) continue;
    let escalated = c.status === "ESCALATED" || c.isOverdue === true;
    if (!escalated) {
      const logs = await doc.ref.collection("activityLog").where("action", "in", ["COMPLAINT_ESCALATED", "SLA_BREACH"]).limit(1).get();
      escalated = !logs.empty;
    }
    if (escalated) {
      await doc.ref.update({ wasEscalated: true });
      updated++;
    }
  }
  await markerRef.set({ wasEscalatedBackfill: Timestamp.now(), wasEscalatedBackfillCount: updated }, { merge: true });
  console.log(`wasEscalated backfill: ${updated} complaints flagged out of ${snapshot.size}.`);
});

// ---------------------------------------------------------------------------
// WhatsApp Business API (Taqnyat) — template messages to parents.
//
// The API number is notification-only: every template carries a URL button
// "تواصل مع الفرع" whose dynamic suffix is the student's branch WhatsApp
// number (branches/{id}.whatsappNumber, set in Settings), so a parent who
// wants to talk is sent to the branch's own number instead of replying to
// the API number. Template names/language live in settings/whatsappApi.
//
// Every template has the same 5 body variables and one URL button:
//   {{1}} parent name   {{2}} record number   {{3}} student name
//   {{4}} branch name (receipt) / resolution details (resolution)
//   {{5}} tracking link
//   button 0: https://mis-complaints.web.app/contact/{{1}} -> record number
//   (the /contact page redirects to the branch/section WhatsApp chat)
// ---------------------------------------------------------------------------
const TAQNYAT_MESSAGES_URL = "https://api.taqnyat.sa/wa/v2/messages/";
const PUBLIC_APP_URL = "https://mis-complaints.web.app";
const WA_TEMPLATE_KEYS = {
  complaint: { receipt: "complaintReceipt", resolution: "complaintResolution", visitMet: "visitMet", appointmentConfirmed: "appointmentConfirmed", appointmentRescheduled: "appointmentRescheduled" },
  techSupport: { receipt: "techReceipt", resolution: "techResolution" },
  lostFound: { receipt: "lostFoundReceipt", returned: "lostFoundReturned" },
};
// Where each record type keeps its number / recipient / 3rd variable.
// Lost & found messages go to the reporter, and {{3}} is the item name.
const WA_KINDS = {
  complaint: { collection: "complaints", idField: "complaintId", phone: "parentPhone", name: "parentName", third: "studentName" },
  techSupport: { collection: "techSupportTickets", idField: "ticketId", phone: "parentPhone", name: "parentName", third: "studentName" },
  lostFound: { collection: "lostFoundItems", idField: "itemCode", phone: "reporterPhone", name: "reporterName", third: "itemName" },
};

// Same normalization as src/utils/whatsapp.js toWhatsAppNumber().
function toIntlNumber(phone) {
  const normalized = String(phone || "").replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
  let digits = normalized.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "966" + digits.slice(1);
  return digits;
}

// WhatsApp rejects template parameters containing new lines, tabs or more
// than 4 consecutive spaces, and empty values.
function waParam(value) {
  const text = String(value == null ? "" : value).replace(/[\r\n\t]+/g, " - ").replace(/ {4,}/g, "   ").trim();
  return (text || "—").slice(0, 900);
}

// Exported only when WA_API_ENABLED (see TAQNYAT_WA_TOKEN above).
// Shared sender for the manual callable and the automatic triggers below.
// Throws HttpsError with an Arabic message the UI / activity log can show.
async function sendWaTemplate({ kind, ref, record, event, actorId, actorName, settings }) {
  const kindConfig = WA_KINDS[kind];
  const templateName = (settings.templates || {})[WA_TEMPLATE_KEYS[kind][event]];
  if (!templateName) {
    throw new HttpsError("failed-precondition", "لم يُحدَّد اسم القالب لهذه الرسالة في الإعدادات.");
  }

  const branchSnap = record.branch ? await db.collection("branches").doc(record.branch).get() : null;
  const branch = branchSnap && branchSnap.exists ? branchSnap.data() : {};
  if (!(await contactNumberFor(record))) {
    throw new HttpsError("failed-precondition", "لم يُضف رقم واتساب لفرع هذا السجل (أو لقسمه) في الإعدادات.");
  }
  const to = toIntlNumber(record[kindConfig.phone]);
  if (!to) {
    throw new HttpsError("failed-precondition", "لا يوجد رقم جوال لولي الأمر.");
  }

  const recordNumber = record[kindConfig.idField];
  const attachmentLinks = (list) => (Array.isArray(list) && list.length ? ` | المرفقات: ${list.map((a) => a.fileUrl).join(" ")}` : "");
  let fourth;
  if (event === "receipt") {
    fourth = branch.name || record.branch;
  } else if (event === "appointmentConfirmed" || event === "appointmentRescheduled") {
    if (!record.appointment || !record.appointment.start) {
      throw new HttpsError("failed-precondition", "لا يوجد موعد زيارة لهذه الملاحظة.");
    }
    fourth = `${formatRiyadh(record.appointment.start.toMillis())} — ${branch.name || record.branch}`;
  } else if (event === "visitMet") {
    // Thank-you after a branch QR visit (see confirmBranchVisit).
    if (record.visitStatus !== "MET") {
      throw new HttpsError("failed-precondition", "لم يتم تأكيد المقابلة بعد.");
    }
    fourth = branch.name || record.branch;
  } else if (kind === "lostFound") {
    if (record.status !== "RETURNED") {
      throw new HttpsError("failed-precondition", "لم يتم تسليم الغرض بعد.");
    }
    fourth = record.returnedTo ? `تم التسليم إلى: ${record.returnedTo}` : "تم التسليم";
  } else if (kind === "complaint") {
    if (!["SOLVED", "CLOSED"].includes(record.status) || !record.solutionDetails) {
      throw new HttpsError("failed-precondition", "لا يوجد حل مسجّل لهذه الملاحظة بعد.");
    }
    fourth = record.solutionDetails + attachmentLinks(record.solutionAttachments);
  } else {
    const creds = record.credentials && record.credentials.username && record.credentials.tempPassword ? record.credentials : null;
    if (!creds && !record.resolutionNote && !(record.resolutionAttachments || []).length && !(record.resolutionLinks || []).length) {
      throw new HttpsError("failed-precondition", "لا يوجد حل مسجّل لهذا البلاغ بعد.");
    }
    let platformName = "";
    if (record.platform) {
      const platformSnap = await db.collection("platforms").doc(record.platform).get();
      platformName = platformSnap.exists ? platformSnap.data().name : record.platform;
    }
    fourth = [
      creds && platformName ? `المنصة: ${platformName}` : "",
      creds && record.platformLink ? `الرابط: ${record.platformLink}` : "",
      creds ? `اسم المستخدم: ${creds.username}` : "",
      creds ? `الرمز السري المؤقت: ${creds.tempPassword}` : "",
      record.resolutionNote || "",
      ...(Array.isArray(record.resolutionLinks) ? record.resolutionLinks.filter((l) => l && l.url).map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)) : []),
    ].filter(Boolean).join(" | ") + attachmentLinks(record.resolutionAttachments);
  }

  const payload = {
    to,
    type: "template",
    template: { name: templateName, language: { code: settings.language || "ar" } },
    components: [
      {
        type: "body",
        parameters: [
          record[kindConfig.name],
          recordNumber,
          record[kindConfig.third],
          fourth,
          `${PUBLIC_APP_URL}/track?id=${encodeURIComponent(recordNumber)}`,
        ].map((v) => ({ type: "text", text: waParam(v) })),
      },
      // Button URL https://mis-complaints.web.app/contact/{{1}} — Meta does
      // not allow wa.me links in template buttons, so it opens our page,
      // which redirects to the branch/section WhatsApp chat.
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: recordNumber }] },
    ],
  };

  const response = await fetch(TAQNYAT_MESSAGES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAQNYAT_WA_TOKEN.value()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* non-JSON error page */ }
  if (!response.ok) {
    console.error("Taqnyat WhatsApp send failed", response.status, bodyText.slice(0, 500));
    const providerReason = body && (body.message || (body.error && (body.error.message || body.error)) || body.detail);
    const reasonText = providerReason ? ` — ${String(typeof providerReason === "string" ? providerReason : JSON.stringify(providerReason)).slice(0, 200)}` : "";
    throw new HttpsError("internal", `تعذّر الإرسال عبر واتساب API (رمز ${response.status})${reasonText}. تحقق من اسم القالب واعتماده ورقم الفرع.`);
  }
  const messageId = (body && body.statuses && body.statuses.message_id) || null;

  // Same "sent by" fields the client's messageSentFields() writes, set here
  // so a sender without edit permission (an assignee) still records it.
  // A tech-support resolution's fields (and closing the ticket) are left to
  // the client's existing handleResolutionSent flow.
  const sentPrefix = { receipt: "receipt", resolution: "resolution", returned: "resolution", visitMet: "visit", appointmentConfirmed: "appointment", appointmentRescheduled: "appointment" }[event];
  if (!(kind === "techSupport" && event === "resolution")) {
    const sentNow = Timestamp.now();
    await ref.update({
      [`${sentPrefix}MessageSentAt`]: sentNow,
      [`${sentPrefix}MessageSentBy`]: actorId,
      [`${sentPrefix}MessageSentByName`]: actorName,
    });
  }

  await ref.collection("activityLog").add({
    action: "WHATSAPP_API_SENT",
    actorId: actorId,
    actorName: actorName,
    metadata: { event, template: templateName, messageId, to },
    createdAt: Timestamp.now(),
  });
  return messageId;
}

const sendWhatsAppApiMessage = !WA_API_ENABLED ? null : onCall({ secrets: [TAQNYAT_WA_TOKEN] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { kind, docId, event } = request.data || {};
  if (!WA_TEMPLATE_KEYS[kind] || !WA_TEMPLATE_KEYS[kind][event] || typeof docId !== "string" || !docId) {
    throw new HttpsError("invalid-argument", "طلب غير صالح.");
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }

  const kindConfig = WA_KINDS[kind];
  const ref = db.collection(kindConfig.collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "لم يتم العثور على السجل.");
  }
  const record = snap.data();

  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  const isAssignee = (record.assignedTo || []).includes(request.auth.uid);
  const canAccessTech = isAdminCaller || caller.department === "IT" || caller.role === "CUSTOMER_SERVICE" || caller.isPrincipal === true || caller.isQuality === true;
  if (!(isAdminCaller || inScope || isAssignee) || (kind === "techSupport" && !canAccessTech)) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية الإرسال لهذا السجل.");
  }

  const settingsSnap = await db.collection("settings").doc("whatsappApi").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!settings.enabled) {
    throw new HttpsError("failed-precondition", "الإرسال عبر واتساب API غير مفعّل من الإعدادات.");
  }
  const messageId = await sendWaTemplate({ kind, ref, record, event, actorId: request.auth.uid, actorName: caller.name || "مستخدم", settings });
  return { ok: true, messageId };
});

// Automatic sending — on receipt (record created) and on resolution (status
// moves to solved / returned / visit met), when the API and its auto-send
// switch are on in Settings. Never throws: a failure is written to the
// record's activity log so staff can see why and resend manually.
const AUTO_ACTOR = "النظام (إرسال تلقائي)";
async function autoSendWa(kind, ref, event) {
  if (!WA_API_ENABLED) return;
  try {
    const settingsSnap = await db.collection("settings").doc("whatsappApi").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    if (!settings.enabled || settings.autoSend === false) return;
    const snap = await ref.get();
    if (!snap.exists) return;
    const record = snap.data();
    if (!record[WA_KINDS[kind].phone]) return;
    await sendWaTemplate({ kind, ref, record, event, actorId: null, actorName: AUTO_ACTOR, settings });
    // A tech resolution sent automatically closes the ticket, exactly like
    // the manual send (TechSupportDetails' handleResolutionSent).
    if (kind === "techSupport" && event === "resolution") {
      const now = Timestamp.now();
      await ref.update({
        resolutionMessageSentAt: now,
        resolutionMessageSentBy: null,
        resolutionMessageSentByName: AUTO_ACTOR,
        ...(record.status === "CLOSED" ? {} : { status: "CLOSED", closedAt: now }),
      });
      await ref.collection("activityLog").add({
        action: "CREDENTIALS_SENT",
        actorId: null,
        actorName: AUTO_ACTOR,
        metadata: {
          sentToPhone: record.parentPhone || null,
          ...(record.credentials?.username ? { usernameSent: record.credentials.username } : {}),
          viaApi: true,
        },
        createdAt: now,
      });
    }
  } catch (err) {
    console.error(`WhatsApp auto-send failed (${kind}/${event}) for ${ref.path}:`, err.message);
    await ref.collection("activityLog").add({
      action: "WHATSAPP_API_FAILED",
      actorId: null,
      actorName: AUTO_ACTOR,
      metadata: { event, reason: err.message || "خطأ غير معروف" },
      createdAt: Timestamp.now(),
    });
  }
}
if (WA_API_ENABLED) {
  exports.sendWhatsAppApiMessage = sendWhatsAppApiMessage;
}

// "Who has seen this record": called each time a staff member opens a
// complaint or tech ticket. The first open per person creates
// {record}/views/{uid} and notifies admins, the branch's principals and
// quality officers, whoever logged the record and the other assignees;
// later opens only bump lastAt/count.
exports.markRecordViewed = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { kind, docId } = request.data || {};
  const cfg = {
    complaint: { collection: "complaints", idField: "complaintId", label: "الملاحظة", type: "VIEWED" },
    techSupport: { collection: "techSupportTickets", idField: "ticketId", label: "البلاغ التقني", type: "IT_VIEWED" },
  }[kind];
  if (!cfg || typeof docId !== "string" || !docId) {
    throw new HttpsError("invalid-argument", "طلب غير صالح.");
  }
  const uid = request.auth.uid;
  const callerDoc = await db.collection("users").doc(uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }
  const ref = db.collection(cfg.collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return { first: false };
  const record = snap.data();

  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  const isAssignee = (record.assignedTo || []).includes(uid);
  if (!(isAdminCaller || inScope || isAssignee)) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية الاطلاع على هذا السجل.");
  }

  const now = Timestamp.now();
  const viewRef = ref.collection("views").doc(uid);
  const first = await db.runTransaction(async (tx) => {
    const v = await tx.get(viewRef);
    if (v.exists) {
      tx.update(viewRef, { lastAt: now, count: FieldValue.increment(1) });
      return false;
    }
    tx.set(viewRef, { uid, name: caller.name || caller.email || "", role: caller.role || null, firstAt: now, lastAt: now, count: 1 });
    return true;
  });

  if (first) {
    const users = await loadActiveUsers();
    const inBranch = (u) => u.access === "all" || (u.branches || []).includes(record.branch) || u.branch === record.branch;
    const recipients = new Set([
      ...users.filter((u) => u.role === "ADMIN").map((u) => u.id),
      ...users.filter((u) => (u.isPrincipal === true || u.isQuality === true) && inBranch(u)).map((u) => u.id),
      ...(record.receiver ? [record.receiver] : []),
      ...(record.assignedTo || []),
    ]);
    recipients.delete(uid);
    if (recipients.size) {
      await notifyUsers([...recipients], {
        title: `اطّلاع على ${cfg.label}`,
        body: `${caller.name || "أحد الموظفين"} اطّلع على ${cfg.label} رقم ${record[cfg.idField]}.`,
        complaintId: docId,
        type: cfg.type,
      });
    }
  }
  return { first };
});

// ---------------------------------------------------------------------------
// School visit appointments. A parent asking for a visit appointment picks
// one of the free slots (settings/appointments: working days and hours,
// slot length, visitors per slot, how far ahead, minimum notice); the branch
// principal confirms it or proposes another slot, the parent is messaged,
// and on arrival they check in at the branch QR page with the feedback
// number — which turns the record into a waiting branch visit.
// Bookings live in `appointments` (one doc per reservation).
// ---------------------------------------------------------------------------
const APPT_TZ_MS = 3 * 3600 * 1000; // Asia/Riyadh, no DST
const APPT_DAY = 24 * 3600 * 1000;
const ACTIVE_APPT = ["REQUESTED", "CONFIRMED", "CHECKED_IN"];

function normalizeAppointments(d) {
  const x = d || {};
  return {
    days: Array.isArray(x.days) && x.days.length ? x.days : [0, 1, 2, 3, 4],
    start: x.start || "08:00",
    end: x.end || "13:00",
    slotMinutes: Number(x.slotMinutes) > 0 ? Number(x.slotMinutes) : 30,
    capacity: Number(x.capacity) > 0 ? Number(x.capacity) : 1,
    daysAhead: Number(x.daysAhead) > 0 ? Number(x.daysAhead) : 14,
    minNoticeHours: Number(x.minNoticeHours) >= 0 ? Number(x.minNoticeHours) : 12,
  };
}
async function loadAppointmentSettings() {
  const snap = await db.collection("settings").doc("appointments").get();
  return normalizeAppointments(snap.exists ? snap.data() : null);
}
const hhmmToMin = (v, f) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : f; };

// Every bookable slot start (UTC ms) inside the booking window.
function appointmentSlots(cfg, nowMs = Date.now()) {
  const from = nowMs + cfg.minNoticeHours * 3600 * 1000;
  const to = nowMs + cfg.daysAhead * APPT_DAY;
  const a = hhmmToMin(cfg.start, 480), b = hhmmToMin(cfg.end, 780);
  const out = [];
  for (let d = Math.floor((nowMs + APPT_TZ_MS) / APPT_DAY) * APPT_DAY; d - APPT_TZ_MS <= to; d += APPT_DAY) {
    if (!cfg.days.includes(new Date(d).getUTCDay())) continue;
    for (let m = a; m + cfg.slotMinutes <= b; m += cfg.slotMinutes) {
      const startMs = d + m * 60000 - APPT_TZ_MS;
      if (startMs >= from && startMs <= to) out.push(startMs);
    }
  }
  return out;
}

function formatRiyadh(ms) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
  }).format(new Date(ms));
}

// Reserves one slot (transaction: re-counts bookings so two parents can't
// take the last place at once). Returns the complaint's `appointment` map.
async function reserveAppointment({ branch, startMs, complaintDocId, complaintId, cancelId }) {
  if (typeof branch !== "string" || !branch) throw new HttpsError("invalid-argument", "يرجى اختيار الفرع أولاً.");
  const cfg = await loadAppointmentSettings();
  if (!appointmentSlots(cfg).includes(startMs)) {
    throw new HttpsError("failed-precondition", "هذا الموعد غير متاح، يرجى اختيار موعد آخر.");
  }
  const start = Timestamp.fromMillis(startMs);
  const apptRef = db.collection("appointments").doc();
  await db.runTransaction(async (tx) => {
    const taken = await tx.get(db.collection("appointments").where("branch", "==", branch).where("start", "==", start));
    const active = taken.docs.filter((d) => ACTIVE_APPT.includes(d.data().status) && d.id !== cancelId).length;
    if (active >= cfg.capacity) {
      throw new HttpsError("failed-precondition", "تم حجز هذا الموعد للتو، يرجى اختيار موعد آخر.");
    }
    tx.set(apptRef, { branch, start, complaintDocId, complaintId, status: "REQUESTED", createdAt: Timestamp.now() });
    if (cancelId) tx.update(db.collection("appointments").doc(cancelId), { status: "CANCELLED", cancelledAt: Timestamp.now() });
  });
  return { id: apptRef.id, start, requestedStart: start, status: "REQUESTED" };
}

async function onAppointmentRequested(complaintDocId, record, appointment, actorName) {
  const now = Timestamp.now();
  await db.collection(`complaints/${complaintDocId}/activityLog`).add({
    action: "APPOINTMENT_REQUESTED",
    actorId: null,
    actorName,
    metadata: { when: formatRiyadh(appointment.start.toMillis()) },
    createdAt: now,
  });
  const users = await loadActiveUsers();
  const principals = users.filter((u) => u.isPrincipal === true && (u.access === "all" || (u.branches || []).includes(record.branch) || u.branch === record.branch));
  await notifyUsers(principals.map((u) => u.id), {
    title: "طلب موعد زيارة",
    body: `ولي أمر الطالب/ة ${record.studentName || ""} يطلب زيارة ${formatRiyadh(appointment.start.toMillis())} — الملاحظة رقم ${record.complaintId}. يرجى التأكيد أو اقتراح موعد آخر.`,
    complaintId: complaintDocId,
    type: "APPOINTMENT_REQUESTED",
  });
}

// Free slots for a branch (public: used by the parent's form and by staff).
exports.getAvailableSlots = onCall(async (request) => {
  const { branch } = request.data || {};
  if (typeof branch !== "string" || !branch) throw new HttpsError("invalid-argument", "يرجى اختيار الفرع أولاً.");
  const cfg = await loadAppointmentSettings();
  const slots = appointmentSlots(cfg);
  const snap = await db.collection("appointments").where("branch", "==", branch).get();
  const counts = {};
  snap.docs.forEach((d) => {
    const a = d.data();
    if (ACTIVE_APPT.includes(a.status) && a.start) counts[a.start.toMillis()] = (counts[a.start.toMillis()] || 0) + 1;
  });
  return { slots: slots.filter((ms) => (counts[ms] || 0) < cfg.capacity), slotMinutes: cfg.slotMinutes };
});

function canManageAppointment(caller, record, uid) {
  if (caller.role === "ADMIN") return true;
  const inScope = caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  return inScope && (caller.isPrincipal === true || caller.perms?.edit === true || (record.assignedTo || []).includes(uid));
}

// Staff-created requests (and records without a slot yet): book a slot.
exports.requestAppointment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { complaintDocId, slot } = request.data || {};
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("complaints").doc(String(complaintDocId || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
  const record = snap.data();
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  if (!inScope) throw new HttpsError("permission-denied", "لا تملك صلاحية على هذا الفرع.");
  if (record.appointment && ACTIVE_APPT.includes(record.appointment.status)) throw new HttpsError("failed-precondition", "لهذه الملاحظة موعد قائم.");
  const appointment = await reserveAppointment({ branch: record.branch, startMs: Number(slot), complaintDocId: ref.id, complaintId: record.complaintId });
  await ref.update({ appointment, updatedAt: Timestamp.now() });
  await onAppointmentRequested(ref.id, record, appointment, caller.name || "مستخدم");
  return { ok: true };
});

// Principal (or staff with edit permission) confirms the requested slot, or
// moves it to another free slot — either way the parent is messaged.
exports.decideAppointment = onCall({ secrets: WA_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { complaintDocId, action, slot } = request.data || {};
  if (!["confirm", "reschedule"].includes(action)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("complaints").doc(String(complaintDocId || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
  const record = snap.data();
  if (!canManageAppointment(caller, record, request.auth.uid)) throw new HttpsError("permission-denied", "تأكيد المواعيد لمدير المدرسة أو من لديه صلاحية التعديل.");

  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  let appointment;
  if (action === "confirm") {
    if (!record.appointment || record.appointment.status !== "REQUESTED") throw new HttpsError("failed-precondition", "لا يوجد موعد بانتظار التأكيد.");
    appointment = { ...record.appointment, status: "CONFIRMED", decidedAt: now, decidedBy: request.auth.uid, decidedByName: actorName };
    if (record.appointment.id) await db.collection("appointments").doc(record.appointment.id).update({ status: "CONFIRMED" });
  } else {
    const reserved = await reserveAppointment({
      branch: record.branch, startMs: Number(slot), complaintDocId: ref.id, complaintId: record.complaintId,
      cancelId: record.appointment && ACTIVE_APPT.includes(record.appointment.status) ? record.appointment.id : undefined,
    });
    await db.collection("appointments").doc(reserved.id).update({ status: "CONFIRMED" });
    appointment = {
      ...reserved,
      requestedStart: (record.appointment && record.appointment.requestedStart) || reserved.start,
      status: "CONFIRMED", rescheduled: true, decidedAt: now, decidedBy: request.auth.uid, decidedByName: actorName,
    };
  }
  await ref.update({ appointment, updatedAt: now, ...(record.status === "RECEIVED" ? { status: "IN_PROGRESS" } : {}) });
  await ref.collection("activityLog").add({
    action: action === "confirm" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_RESCHEDULED",
    actorId: request.auth.uid,
    actorName,
    metadata: { when: formatRiyadh(appointment.start.toMillis()) },
    createdAt: now,
  });
  await autoSendWa("complaint", ref, action === "confirm" ? "appointmentConfirmed" : "appointmentRescheduled");
  return { ok: true, when: formatRiyadh(appointment.start.toMillis()) };
});

// Parent arrives for a confirmed appointment and checks in from the branch
// QR page with the feedback number + last 4 digits of their phone.
exports.checkInAppointment = onCall(async (request) => {
  const complaintId = String((request.data || {}).complaintId || "").trim().toUpperCase();
  const last4 = String((request.data || {}).phoneLast4 || "").replace(/\D/g, "");
  const branch = (request.data || {}).branch;
  if (!complaintId || last4.length !== 4) throw new HttpsError("invalid-argument", "يرجى إدخال رقم الملاحظة وآخر 4 أرقام من الجوال.");
  const snap = await db.collection("complaints").where("complaintId", "==", complaintId).limit(1).get();
  if (snap.empty) throw new HttpsError("not-found", "لم يتم العثور على ملاحظة بهذا الرقم.");
  const doc = snap.docs[0];
  const c = doc.data();
  if (!toIntlNumber(c.parentPhone).endsWith(last4)) throw new HttpsError("permission-denied", "آخر 4 أرقام لا تطابق رقم الجوال المسجل.");
  const appt = c.appointment;
  if (!appt || !appt.start) throw new HttpsError("failed-precondition", "لا يوجد موعد زيارة لهذه الملاحظة.");
  if (appt.status === "CHECKED_IN") return { already: true, studentName: c.studentName, when: formatRiyadh(appt.start.toMillis()) };
  if (appt.status !== "CONFIRMED") throw new HttpsError("failed-precondition", "موعدكم لم يُؤكد بعد من إدارة المدرسة.");
  if (branch && branch !== c.branch) throw new HttpsError("failed-precondition", "هذا الموعد في فرع آخر.");
  const dayOf = (ms) => Math.floor((ms + APPT_TZ_MS) / APPT_DAY);
  if (dayOf(appt.start.toMillis()) !== dayOf(Date.now())) {
    throw new HttpsError("failed-precondition", `موعدكم ${formatRiyadh(appt.start.toMillis())}، وليس اليوم.`);
  }
  const now = Timestamp.now();
  await doc.ref.update({
    appointment: { ...appt, status: "CHECKED_IN", checkedInAt: now },
    viaVisitQr: true, visitStatus: "WAITING", visitArrivedAt: now, updatedAt: now,
  });
  if (appt.id) await db.collection("appointments").doc(appt.id).update({ status: "CHECKED_IN" });
  await doc.ref.collection("activityLog").add({
    action: "VISIT_CHECKED_IN", actorId: null, actorName: "ولي الأمر (وصول لموعد عبر QR)", metadata: { appointment: true }, createdAt: now,
  });
  const users = await loadActiveUsers();
  const principals = users.filter((u) => u.isPrincipal === true && (u.access === "all" || (u.branches || []).includes(c.branch) || u.branch === c.branch)).map((u) => u.id);
  await notifyUsers([...(c.assignedTo || []), ...principals], {
    title: "ولي أمر وصل لموعده",
    body: `ولي أمر الطالب/ة ${c.studentName} وصل إلى الفرع لموعده (${formatRiyadh(appt.start.toMillis())}) — الملاحظة رقم ${c.complaintId}.`,
    complaintId: doc.id,
    type: "VISIT_ARRIVED",
  });
  return { ok: true, studentName: c.studentName, when: formatRiyadh(appt.start.toMillis()) };
});

// Staff file uploads (solution files and voice notes, attachments on a
// new complaint, lost-item photos). Done with the Admin SDK — like the
// public-link and tech-support uploads — so they don't depend on Firebase
// Storage security rules, which client-side uploads were tripping over.
const STAFF_UPLOAD_FOLDERS = ["complaints", "lostFoundItems"];
exports.uploadStaffFile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { folder, recordId, file } = request.data || {};
  if (!STAFF_UPLOAD_FOLDERS.includes(folder) || typeof recordId !== "string" || !/^[A-Za-z0-9-]{3,40}$/.test(recordId)) {
    throw new HttpsError("invalid-argument", "طلب غير صالح.");
  }
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().active === false || callerDoc.data().role === "RECEPTIONIST") {
    throw new HttpsError("permission-denied", "لا تملك صلاحية رفع الملفات.");
  }
  const uploaded = await uploadPublicAttachment(getStorage().bucket(), `${folder}/${recordId}`, file);
  return { ...uploaded, uploadedBy: request.auth.uid, createdAt: new Date().toISOString() };
});
