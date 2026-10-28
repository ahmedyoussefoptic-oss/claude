const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated, onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue, FieldPath } = require("firebase-admin/firestore");
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
// The school name in parent emails (another school's copy sets SCHOOL_NAME in functions/.env).
const SCHOOL_NAME = process.env.SCHOOL_NAME || "مدارس المكتشف العالمية";

// Record numbers (COM- / IT- / LF-) are sequential per prefix and year from
// a counter (counters/{PREFIX}-{year}) inside a transaction, so two records
// can never share a number. They start at 10001: the older random 4-digit
// numbers (1000–9999) stay unique against the new ones.
async function nextRecordNumber(prefix) {
  const year = new Date().getFullYear();
  const ref = db.collection("counters").doc(`${prefix}-${year}`);
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data().last || 10000 : 10000) + 1;
    tx.set(ref, { last: next, updatedAt: Timestamp.now() }, { merge: true });
    return next;
  });
  return `${prefix}-${year}-${n}`;
}
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
      from: `"${SCHOOL_NAME}" <${GMAIL_USER.value()}>`,
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
const OPEN_LOST_FOUND_STATUSES = ["UNCLAIMED", "SEARCHING", "MATCHED"];

// ---------------------------------------------------------------------------
// System owner ("منشئ النظام") and system-admin capabilities.
// The owner is the one account whose sign-in email matches
// SYSTEM_OWNER_EMAIL (functions/.env); claimSystemOwner marks it isOwner.
// The owner always has every power; what other ADMIN accounts may do is set
// by the owner in settings/adminPermissions (missing key = allowed).
// Mirrored in firestore.rules (isOwner / adminPerm) and
// src/config/adminPermissions.js.
// ---------------------------------------------------------------------------
const ADMIN_CAPS = ["settings", "users", "manageAdmins", "archive", "delete"];
async function loadAdminCaps() {
  const snap = await db.collection("settings").doc("adminPermissions").get();
  const data = snap.exists ? snap.data() : {};
  return Object.fromEntries(ADMIN_CAPS.map((c) => [c, data[c] !== false]));
}
function callerCan(caller, cap, caps) {
  if (!caller) return false;
  if (caller.isOwner === true) return true;
  return caller.role === "ADMIN" && caps[cap] !== false;
}
// May this caller manage staff accounts at all (ADMIN by capability, others
// by their perms.users)?
function canManageUsers(caller, caps) {
  return caller.role === "ADMIN" ? callerCan(caller, "users", caps) : caller.perms?.users === true;
}

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
  const caps = await loadAdminCaps();
  if (!callerDoc.exists || !canManageUsers(caller, caps)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { uid } = request.data || {};
  if (!uid) {
    throw new HttpsError("invalid-argument", "معرّف الموظف مطلوب.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "لا يمكن حذف المستخدم الذي تعمل باسمه حالياً.");
  }
  // The owner's account can't be deleted; an admin account only by the
  // owner or an admin allowed to manage admins.
  const targetDoc = await db.collection("users").doc(uid).get();
  if (targetDoc.exists && targetDoc.data().isOwner === true) {
    throw new HttpsError("permission-denied", "لا يمكن حذف حساب منشئ النظام.");
  }
  if (targetDoc.exists && targetDoc.data().role === "ADMIN" && !callerCan(caller, "manageAdmins", caps)) {
    throw new HttpsError("permission-denied", "لا يمكن حذف حساب مدير النظام.");
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
  const caps = await loadAdminCaps();
  const isAdminCaller = callerDoc.exists && caller.role === "ADMIN" && callerCan(caller, "users", caps);
  if (!callerDoc.exists || !canManageUsers(caller, caps)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { name, email, password, role, branches, access, perms, phone, jobTitle, department, active, isPrincipal, isQuality, isCounselor, stages, curricula, notificationPrefs, notificationChannels, tripsAccess, modules, recordScope, platformAccess, activityAccess, leaveRoles, callRoles } = request.data || {};
  if (!name || !email || !password || !role) {
    throw new HttpsError("invalid-argument", "الاسم والبريد الإلكتروني وكلمة المرور والصلاحية مطلوبة.");
  }
  if (role === "ADMIN" && !callerCan(caller, "manageAdmins", caps)) {
    throw new HttpsError("permission-denied", "إضافة حساب بصلاحية مدير النظام متاحة لمنشئ النظام فقط.");
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
      trips: !!perms?.trips,
      tripFinance: !!perms?.tripFinance,
      // Trip edit / delete / students / payments (unset = role-based default).
      ...Object.fromEntries(["tripEdit", "tripDelete", "tripStudents", "tripPayments", "tripAccounts"].filter((k) => typeof perms?.[k] === "boolean").map((k) => [k, perms[k]])),
    },
    phone: phone || null,
    jobTitle: jobTitle || null,
    department: department || null,
    isPrincipal: isPrincipal === true,
    isQuality: isQuality === true,
    isCounselor: isCounselor === true,
    notificationPrefs: notificationPrefs && typeof notificationPrefs === "object" ? notificationPrefs : {},
    notificationChannels: notificationChannels && typeof notificationChannels === "object" ? notificationChannels : {},
    stages: Array.isArray(stages) ? stages.filter((st) => typeof st === "string") : [],
    curricula: Array.isArray(curricula) ? curricula.filter((c) => typeof c === "string") : [],
    tripsAccess: ["tripsOnly", "none"].includes(tripsAccess) && role !== "ADMIN" ? tripsAccess : "all",
    // Only the owner shares منصة المكتشف.
    platformAccess: caller.isOwner === true && platformAccess === true,
    activityAccess: caller.isOwner === true && activityAccess === true,
    // Leave requests: approve / call the student / hand over at the exit.
    leaveRoles: Object.fromEntries(["approve", "call", "exit"].map((k) => [k, leaveRoles?.[k] === true])),
    // «مهام الاتصال»: calling agent / call supervisor.
    callRoles: { agent: callRoles?.agent === true, supervisor: callRoles?.supervisor === true },
    ...(role !== "ADMIN" ? cleanUserModules(modules, recordScope) : {}),
    active: active !== false,
    createdAt: Timestamp.now(),
    createdBy: request.auth.uid,
  });

  return { uid: userRecord.uid };
});

// Per-employee visibility (Users page): which sections they see
// (`modules`, missing key = the role's default) and whether they see every
// record of their branches or only the ones assigned to them
// (`recordScope`). Mirrored in src/utils/scope.js and firestore.rules.
const USER_MODULE_KEYS = ["dashboard", "complaints", "techSupport", "lostFound", "visits", "trips", "students", "search", "flowMap", "reports"];
function cleanUserModules(modules, recordScope) {
  const out = {};
  if (modules && typeof modules === "object") {
    const m = Object.fromEntries(USER_MODULE_KEYS.filter((k) => typeof modules[k] === "boolean").map((k) => [k, modules[k]]));
    if (Object.keys(m).length) out.modules = m;
  }
  if (recordScope === "assigned") out.recordScope = "assigned";
  return out;
}
const moduleOff = (u, key) => !!u.modules && u.modules[key] === false;

// Sets a new password for an existing staff account via the Admin SDK.
// Only callers who are ADMIN or hold the "users" permission may call this.
// Corrects a staff member's login email (Firebase Auth + users doc), with the
// same permission rules as resetStaffPassword.
exports.updateStaffEmail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  const caps = await loadAdminCaps();
  if (!callerDoc.exists || !canManageUsers(caller, caps)) throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  const uid = String(request.data?.uid || "");
  const email = String(request.data?.email || "").trim().toLowerCase();
  if (!uid || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpsError("invalid-argument", "أدخل بريداً إلكترونياً صحيحاً.");
  const targetRef = db.collection("users").doc(uid);
  const target = (await targetRef.get()).data();
  if (!target) throw new HttpsError("not-found", "لم يتم العثور على الموظف.");
  if (target.isOwner === true && uid !== request.auth.uid) throw new HttpsError("permission-denied", "لا يمكن تغيير بريد منشئ النظام.");
  const isAdminCaller = caller.role === "ADMIN" && callerCan(caller, "users", caps);
  if (target.role === "ADMIN" && uid !== request.auth.uid && !(isAdminCaller && callerCan(caller, "manageAdmins", caps))) {
    throw new HttpsError("permission-denied", "لا يمكن تغيير بريد مدير النظام.");
  }
  try {
    await auth.updateUser(uid, { email });
  } catch (err) {
    if (err.code === "auth/email-already-exists") throw new HttpsError("already-exists", "هذا البريد مستخدم لحساب آخر.");
    throw new HttpsError("internal", err.message);
  }
  await targetRef.update({ email, updatedAt: Timestamp.now() });
  console.log("staff email changed", uid, "by", request.auth.uid);
  return { ok: true, email };
});

exports.resetStaffPassword = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  const caps = await loadAdminCaps();
  const isAdminCaller = callerDoc.exists && caller.role === "ADMIN" && callerCan(caller, "users", caps);
  if (!callerDoc.exists || !canManageUsers(caller, caps)) {
    throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  }

  const { uid, newPassword } = request.data || {};
  {
    const target = (await db.collection("users").doc(uid || "-").get()).data();
    if (target?.isOwner === true && uid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "لا يمكن تغيير كلمة مرور منشئ النظام.");
    }
    if (target?.role === "ADMIN" && uid !== request.auth.uid && !callerCan(caller, "manageAdmins", caps)) {
      throw new HttpsError("permission-denied", "لا يمكن إعادة تعيين كلمة مرور مدير النظام.");
    }
  }
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
  appointment: ["APPOINTMENT_REQUESTED", "APPOINTMENT_REMINDER", "VISIT_REQUESTED"],
  trips: ["TRIP_APPROVAL_REQUESTED", "TRIP_DECIDED", "TRIP_RECEIPT"],
  reminder: ["REMINDER", "IT_REMINDER", "LF_REMINDER"],
  platform: ["LEAVE_REQUESTED", "LEAD_NEW"],
  callTasks: ["CALL_ASSIGNED", "CALL_DAILY", "CALL_SUMMARY", "CALL_WRONG_NUMBER"],
  leaves: ["LEAVE_APPROVED", "LEAVE_CALLED", "LEAVE_PREPARE", "LEAVE_ARRIVED", "LEAVE_CANCELLED", "LEAVE_RESCHEDULED"],
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
      `مرحباً ${data.parentName}،\n\nشكراً لتواصلكم مع ${SCHOOL_NAME}.\nتم استلام ملاحظتكم رقم ${data.complaintId} الخاصة بالطالب/ة ${data.studentName} وسيتم التواصل معكم قريباً.\n\nيمكنكم متابعة حالة الملاحظة عبر الرابط التالي:\n${PUBLIC_APP_URL}/track?id=${data.complaintId}\n\n${SCHOOL_NAME}`
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

  await ensureQualityAssigned(snap.ref, data, { counselors: true });

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
  // Account-data sends (sendStudentAccounts) are created already solved
  // and send their own message — no receipt, assignment or SLA.
  if (data.source === "ACCOUNTS_TOOL") return;

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
// Every lost & found report (new ones here, old ones via
// assignLostFoundBacklog) goes to its branch's quality officers and student
// counselors (users flagged isQuality / isCounselor).
function lostFoundOfficers(users, branch) {
  return users.filter((u) => (u.isQuality === true || u.isCounselor === true) && u.active !== false && u.tripsAccess !== "tripsOnly" && !moduleOff(u, "lostFound")
    && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch));
}
// Adds the given officers to an item; `silent` marks the write so the
// update trigger doesn't send "assigned to you" for old records.
async function addLostFoundAssignees(ref, item, officers, silent) {
  const current = item.assignedTo || [];
  const missing = officers.filter((u) => !current.includes(u.id));
  if (!missing.length) return 0;
  await ref.update({
    assignedTo: [...current, ...missing.map((u) => u.id)],
    assignedToNames: [...(item.assignedToNames || []), ...missing.map((u) => u.name || "")],
    ...(current.length ? {} : { assignedAt: Timestamp.now() }),
    ...(silent ? { silentAssignAt: Timestamp.now() } : {}),
  });
  return missing.length;
}

exports.notifyLostFoundAssignment = onDocumentCreated({ document: "lostFoundItems/{itemId}", secrets: WA_SECRETS }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();
  await addLostFoundAssignees(snap.ref, data, lostFoundOfficers(await loadActiveUsers(), data.branch), false);

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

  // Moved to another branch: that branch's officers join too.
  if (after.branch && after.branch !== before.branch) {
    await addLostFoundAssignees(event.data.after.ref, after, lostFoundOfficers(await loadActiveUsers(), after.branch), false);
  }

  const beforeAssigned = new Set(before.assignedTo || []);
  const newlyAssigned = (after.assignedTo || []).filter((uid) => !beforeAssigned.has(uid));
  const silent = after.silentAssignAt && !(before.silentAssignAt && before.silentAssignAt.isEqual(after.silentAssignAt));
  if (newlyAssigned.length > 0 && !silent) {
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

  await sendEmail(email, data.title, `${data.body}\n\n${PUBLIC_APP_URL}/complaints`);
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
    webpush: { fcmOptions: { link: `${PUBLIC_APP_URL}/complaints` } },
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
  // Old records assigned in bulk (counselor backfill) are added silently.
  const silentAssign = after.silentAssignAt && !(before.silentAssignAt && before.silentAssignAt.isEqual(after.silentAssignAt));
  if (newlyAssigned.length > 0 && !silentAssign) {
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
  // …and the other way: a ticket converted into a complaint
  // (convertTechTicketToComplaint).
  if (snapshot.empty && match.type === "techSupport") {
    const converted = await db.collection("complaints").where("convertedFromId", "==", trackingId).limit(1).get();
    if (!converted.empty) {
      match = TRACKABLE_TYPES.find((t) => t.type === "complaint");
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
  // Staff limited to the trips section (tripsAccess "tripsOnly") never get
  // complaints or tickets.
  // Nor do staff whose complaints / tech-support section is turned off.
  const section = departments.includes("IT") ? "techSupport" : "complaints";
  const users = (preloaded || await loadActiveUsers()).filter((u) => u.tripsAccess !== "tripsOnly" && !moduleOff(u, section));
  // Categories flagged «للإداريين والجودة» route to the administrative
  // specialists; when every category is such, principals and counselors
  // are left out.
  const aq = section === "complaints" ? await adminQualityTypes() : new Set();
  const types = departments.filter(Boolean);
  const adminQualityOnly = types.length > 0 && types.every((d) => aq.has(d));
  departments = types.map((d) => (aq.has(d) ? "ADMINISTRATIVE" : d));
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
  const principals = adminQualityOnly ? [] : users.filter((u) => u.isPrincipal === true && (u.access === "all" || inBranch(u)) && covers(u));
  const seen = new Set();
  // Complaints (not IT tickets) also go to the branch's student counselors.
  const counselors = departments.includes("IT") || adminQualityOnly ? [] : complaintCounselors(users, branch, stage, curriculum);
  return [...specialists, ...principals, ...qualityOfficers(users, branch), ...counselors]
    .filter((u) => !seen.has(u.id) && seen.add(u.id))
    .map((u) => ({ id: u.id, name: u.name || "" }));
}

// Complaint categories set «للإداريين والجودة» in Settings (adminQuality).
async function adminQualityTypes() {
  const snap = await db.collection("complaintTypes").where("adminQuality", "==", true).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function loadActiveUsers() {
  const snapshot = await db.collection("users").get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active !== false);
}

// Student counselors (isCounselor) get every complaint in their branches,
// within their grade / section limits when they have any.
function complaintCounselors(users, branch, stage, curriculum) {
  return users.filter((u) => u.isCounselor === true && u.active !== false && u.tripsAccess !== "tripsOnly" && !moduleOff(u, "complaints")
    && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch)
    && coversStage(u, stage) && coversCurriculum(u, curriculum));
}

function qualityOfficers(users, branch) {
  return users.filter((u) => u.isQuality === true && u.tripsAccess !== "tripsOnly" && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch));
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
async function ensureQualityAssigned(ref, data, { counselors = false } = {}) {
  const users = await loadActiveUsers();
  const current = data.assignedTo || [];
  // A complaint whose categories are all «للإداريين والجودة» gets that
  // routing (administrative specialists + quality) instead of the counselors.
  const types = counselors ? complaintTypesOf(data) : [];
  const aq = types.length ? await adminQualityTypes() : new Set();
  const adminQualityOnly = types.length > 0 && types.every((d) => aq.has(d));
  const auto = adminQualityOnly
    ? await autoAssigneesFor("complaint", data, users)
    : [...qualityOfficers(users, data.branch), ...(counselors ? complaintCounselors(users, data.branch, data.stage, data.department) : [])];
  const missing = auto.filter((u, i) => !current.includes(u.id) && auto.findIndex((x) => x.id === u.id) === i);
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
  const complaintId = await nextRecordNumber("COM");
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
  const itemCode = await nextRecordNumber("LF");
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

  const ticketId = await nextRecordNumber("IT");
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
  const ticketId = await nextRecordNumber("IT");
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

// The reverse move: a tech-support ticket that is really a general
// complaint (a parent writing about grades or transport through the tech
// form). Same all-or-nothing shape as above: the complaint is created with
// the ticket's data and routed like any new complaint, the ticket is
// archived to deletedTechSupportTickets and removed with its activity log.
// The parent's IT- number keeps working (trackComplaint follows
// convertedFromId).
exports.convertTechTicketToComplaint = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  }
  const { ticketDocId, complaintType, subType, subject, priority } = request.data || {};
  for (const value of [ticketDocId, complaintType, subType, subject]) {
    if (!value || typeof value !== "string" || !value.trim()) {
      throw new HttpsError("invalid-argument", "يرجى تعبئة جميع الحقول المطلوبة.");
    }
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }
  const ticketRef = db.collection("techSupportTickets").doc(ticketDocId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    throw new HttpsError("not-found", "لم يتم العثور على البلاغ.");
  }
  const ticket = ticketSnap.data();

  // Mirrors firestore.rules: canEditRecord(branch) on the ticket plus
  // canAccessTechSupport(), and the complaints section must be open to them.
  const isAdminCaller = caller.role === "ADMIN";
  const inScope = caller.access === "all" || (caller.branches || []).includes(ticket.branch) || caller.branch === ticket.branch;
  const canEdit = isAdminCaller || (caller.perms?.edit === true && inScope);
  const techMod = caller.modules ? caller.modules.techSupport : undefined;
  const canAccessTech = isAdminCaller || (caller.tripsAccess !== "tripsOnly" && (techMod === true || (techMod === undefined && (caller.department === "IT" || caller.role === "CUSTOMER_SERVICE" || caller.isPrincipal === true || caller.isQuality === true))));
  if (!canEdit || !canAccessTech || moduleOff(caller, "complaints")) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تحويل هذا البلاغ.");
  }
  if (["SOLVED", "WAITING_CONFIRMATION", "CLOSED"].includes(ticket.status)) {
    throw new HttpsError("failed-precondition", "لا يمكن تحويل بلاغ منتهٍ.");
  }
  const typeSnap = await db.collection("complaintTypes").doc(complaintType).get();
  if (!typeSnap.exists) {
    throw new HttpsError("invalid-argument", "نوع الملاحظة غير صحيح.");
  }

  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const complaintId = await nextRecordNumber("COM");
  const assignees = await findAutoAssignees({ branch: ticket.branch, departments: [complaintType], stage: ticket.stage, curriculum: ticket.department });
  const logsSnapshot = await ticketRef.collection("activityLog").orderBy("createdAt", "asc").get();
  const reason = `تحويل إلى ملاحظة ${complaintId}`;

  const complaintRef = db.collection("complaints").doc();
  const batch = db.batch();
  batch.set(complaintRef, {
    parentName: ticket.parentName || "",
    parentPhone: ticket.parentPhone || "",
    parentEmail: "",
    studentName: ticket.studentName || "",
    studentId: ticket.nationalId || "",
    branch: ticket.branch || "",
    department: ticket.department || "",
    stage: ticket.stage || "",
    grade: ticket.grade || "",
    complaintType,
    subType: subType.trim(),
    extraTypes: [],
    subject: subject.trim().slice(0, 200),
    details: ticket.details || subject.trim(),
    complaintId,
    convertedFromId: ticket.ticketId || null,
    priority: ["NORMAL", "HIGH", "URGENT"].includes(priority) ? priority : "NORMAL",
    source: ticket.source || null,
    receiver: ticket.receiver || request.auth.uid,
    status: "RECEIVED",
    attachments: ticket.attachments || [],
    assignedTo: assignees.map((a) => a.id),
    assignedToNames: assignees.map((a) => a.name),
    assignedAt: assignees.length ? now : null,
    reopened: false,
    isOverdue: false,
    createdAt: ticket.createdAt || now,
    updatedAt: now,
  });
  batch.set(complaintRef.collection("activityLog").doc(), {
    action: "CONVERTED_FROM_TICKET",
    actorId: request.auth.uid,
    actorName,
    metadata: { note: `رقم البلاغ التقني الأصلي: ${ticket.ticketId}` },
    createdAt: now,
  });
  if (assignees.length) {
    batch.set(complaintRef.collection("activityLog").doc(), {
      action: "COMPLAINT_ASSIGNED",
      actorId: null,
      actorName: "النظام (إسناد تلقائي)",
      metadata: { toUserIds: assignees.map((a) => a.id), toUserNames: assignees.map((a) => a.name), addedNames: assignees.map((a) => a.name) },
      createdAt: now,
    });
  }
  batch.set(db.collection("deletedTechSupportTickets").doc(), {
    ticket: { ...ticket, id: ticketDocId },
    activityLog: [
      ...logsSnapshot.docs.map((d) => d.data()),
      { action: "TICKET_CONVERTED", actorId: request.auth.uid, actorName, metadata: { reason }, createdAt: now },
    ],
    reason,
    convertedToComplaintId: complaintId,
    deletedBy: request.auth.uid,
    deletedByName: actorName,
    deletedAt: now,
  });
  await batch.commit();
  await db.recursiveDelete(ticketRef);

  return { complaintId, complaintDocId: complaintRef.id };
});

// --- Student platform accounts (Classera + MIS student portal) -------------
// studentAccounts/{nationalId} holds both logins (imported by an admin from
// the "Student Logins by Campus" workbook). Clients can never read it
// (firestore.rules): IT / tech-support staff see one student's logins only
// through getStudentAccounts, and send them only to the parent mobile
// registered in the student roster through sendStudentAccounts. Every view
// and send is written to accountAccessLog.
// The MIS student portal's login page, included with its account.
const STUDENT_PORTAL_URL = process.env.STUDENT_PORTAL_URL || "https://misedu.net";
async function accountsCaller(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  const c = snap.data();
  if (!snap.exists || c.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const techMod = c.modules ? c.modules.techSupport : undefined;
  const canTech = c.role === "ADMIN" || (c.tripsAccess !== "tripsOnly" && (techMod === true || (techMod === undefined && (c.department === "IT" || c.role === "CUSTOMER_SERVICE" || c.isPrincipal === true || c.isQuality === true))));
  if (!canTech) throw new HttpsError("permission-denied", "حسابات الطلاب متاحة لفريق الدعم التقني فقط.");
  return { uid: request.auth.uid, ...c };
}
async function loadStudentAccounts(caller, rawId) {
  const nationalId = normalizeDigits(rawId).replace(/\D/g, "");
  if (!/^\d{6,15}$/.test(nationalId)) throw new HttpsError("invalid-argument", "أدخل رقم هوية الطالب/ة.");
  const [accSnap, stuSnap] = await Promise.all([db.collection("studentAccounts").doc(nationalId).get(), db.collection("students").doc(nationalId).get()]);
  if (!accSnap.exists && !stuSnap.exists) throw new HttpsError("not-found", "لا يوجد طالب بهذا الرقم في السجل.");
  const acc = accSnap.exists ? accSnap.data() : {};
  const student = stuSnap.exists ? stuSnap.data() : {};
  const branch = student.branch || acc.branch || "";
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(branch) || caller.branch === branch;
  if (!inScope) throw new HttpsError("permission-denied", "هذا الطالب في فرع خارج نطاق صلاحيتك.");
  return { nationalId, acc, student, branch, hasAccounts: accSnap.exists };
}
const accountLog = (caller, studentId, action, extra = {}) => db.collection("accountAccessLog").add({
  studentId, action, byId: caller.uid, byName: caller.name || "", at: Timestamp.now(), ...extra,
});

exports.getStudentAccounts = onCall(async (request) => {
  const caller = await accountsCaller(request);
  const { nationalId, acc, student, branch, hasAccounts } = await loadStudentAccounts(caller, request.data?.nationalId);
  await accountLog(caller, nationalId, "VIEW");
  const mobile = student.mobile || acc.mobile || "";
  return {
    student: {
      nationalId, name: student.nameAr || student.name || acc.name || "", nameEn: student.name || "",
      branch, branchName: student.branchName || acc.sheet || "", stageName: student.stageName || "", gradeName: student.gradeName || acc.grade || "",
      className: student.className || acc.className || "", mobile, parentNationalId: student.parentNationalId || "",
      inRoster: Object.keys(student).length > 0,
    },
    hasAccounts,
    classera: acc.classera || null,
    portal: acc.portal || null,
    lastSentAt: acc.lastSentAt ? acc.lastSentAt.toMillis() : null,
    lastSentByName: acc.lastSentByName || "",
  };
});

// Sends both logins to the parent's registered mobile through the existing
// "tech resolution" WhatsApp template, recorded as a solved tech-support
// ticket (problem type ACCOUNT_CREDENTIALS) so it shows in reports and the
// parent's tracking link.
exports.sendStudentAccounts = onCall({ secrets: WA_SECRETS }, async (request) => {
  const caller = await accountsCaller(request);
  const { nationalId, acc, student, branch, hasAccounts } = await loadStudentAccounts(caller, request.data?.nationalId);
  if (!hasAccounts) throw new HttpsError("not-found", "لا توجد حسابات مسجّلة لهذا الطالب.");
  const systems = Array.isArray(request.data?.systems) && request.data.systems.length ? request.data.systems : ["classera", "portal"];
  const parts = [];
  if (systems.includes("classera") && acc.classera && acc.classera.username) parts.push(`كلاسيرا: اسم المستخدم ${acc.classera.username} — كلمة المرور ${acc.classera.password || "(غير مسجلة)"}`);
  if (systems.includes("portal") && acc.portal && acc.portal.username) parts.push(`بوابة الطالب (الرابط: ${STUDENT_PORTAL_URL}): اسم المستخدم ${acc.portal.username} — كلمة المرور ${acc.portal.password || "(غير مسجلة)"}`);
  if (!parts.length) throw new HttpsError("failed-precondition", "لا توجد بيانات دخول للنظام المختار.");
  // Another mobile of the parent (e.g. the mother's): Saudi mobile only,
  // with a reason, and both are logged on the ticket and the access log.
  const registeredPhone = student.mobile || acc.mobile || "";
  const altRaw = String(request.data?.altPhone || "").trim();
  const altReason = String(request.data?.altReason || "").trim().slice(0, 120);
  let phone = registeredPhone;
  if (altRaw) {
    const intl = toIntlNumber(altRaw);
    if (!/^9665\d{8}$/.test(intl)) throw new HttpsError("invalid-argument", "أدخل رقم جوال سعودي صحيح (05xxxxxxxx).");
    if (altReason.length < 2) throw new HttpsError("invalid-argument", "اكتب صلة هذا الرقم بولي الأمر (مثال: جوال الأم).");
    phone = `0${intl.slice(3)}`;
  }
  if (!toIntlNumber(phone)) throw new HttpsError("failed-precondition", "لا يوجد جوال مسجل لولي الأمر في سجل الطلاب — أدخل رقماً آخر لولي الأمر.");

  const problemRef = db.collection("problemTypes").doc("ACCOUNT_CREDENTIALS");
  if (!(await problemRef.get()).exists) await problemRef.set({ name: "طلب بيانات الدخول (كلاسيرا وبوابة الطالب)", order: 99, active: true });

  const now = Timestamp.now();
  const studentName = student.nameAr || student.name || acc.name || "";
  const ticketId = await nextRecordNumber("IT");
  const ref = db.collection("techSupportTickets").doc();
  const record = {
    studentName, nationalId, academicId: "", branch, department: student.department || "", stage: student.stage || "", grade: student.grade || student.className || "",
    parentName: `ولي أمر الطالب/ة ${studentName}`, relation: "", parentPhone: normalizeDigits(phone), parentNationalId: student.parentNationalId || "",
    problemType: "ACCOUNT_CREDENTIALS", platform: "OTHER", platformLink: "",
    details: "طلب بيانات الدخول — أُرسلت من أداة حسابات الطلاب", resolutionNote: parts.join(" | "),
    ...(altRaw ? { sentToAlternate: true, alternateReason: altReason, registeredPhone: normalizeDigits(registeredPhone) } : {}),
    ticketId, receiver: caller.uid, source: "ACCOUNTS_TOOL", status: "SOLVED", solvedAt: now,
    assignedTo: [caller.uid], assignedToNames: [caller.name || ""], assignedAt: now, isOverdue: false, reopenCount: 0, createdAt: now, updatedAt: now,
  };
  await ref.set(record);
  await ref.collection("activityLog").add({ action: "TICKET_CREATED", actorId: caller.uid, actorName: caller.name || "", metadata: { note: altRaw ? `إرسال بيانات الدخول إلى رقم آخر لولي الأمر (${altReason}) بدلاً من الرقم المسجل` : "إرسال بيانات الدخول من أداة حسابات الطلاب" }, createdAt: now });

  const settingsSnap = await db.collection("settings").doc("whatsappApi").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  let sent = false;
  let error = null;
  if (WA_API_ENABLED && settings.enabled) {
    try {
      await sendWaTemplate({ kind: "techSupport", ref, record, event: "resolution", actorId: caller.uid, actorName: caller.name || "", settings });
      sent = true;
    } catch (err) {
      error = err.message;
      await ref.collection("activityLog").add({ action: "WHATSAPP_API_FAILED", actorId: caller.uid, actorName: caller.name || "", metadata: { event: "resolution", reason: err.message }, createdAt: Timestamp.now() });
    }
  } else {
    error = "الإرسال عبر واتساب API غير مفعّل.";
  }
  if (sent) {
    const t2 = Timestamp.now();
    await ref.update({ status: "CLOSED", closedAt: t2, resolutionMessageSentAt: t2, resolutionMessageSentBy: caller.uid, resolutionMessageSentByName: caller.name || "" });
    await ref.collection("activityLog").add({ action: "CREDENTIALS_SENT", actorId: caller.uid, actorName: caller.name || "", metadata: { sentToPhone: record.parentPhone, viaApi: true, systems }, createdAt: t2 });
    await db.collection("studentAccounts").doc(nationalId).set({ lastSentAt: t2, lastSentByName: caller.name || "", sendCount: FieldValue.increment(1) }, { merge: true });
  }
  await accountLog(caller, nationalId, "SEND", { ok: sent, ticketId, systems, ...(altRaw ? { toAlternate: record.parentPhone, alternateReason: altReason } : {}), ...(error ? { error: String(error).slice(0, 200) } : {}) });
  return { ok: sent, error, ticketId, ticketDocId: ref.id, phone: record.parentPhone, message: `${record.parentName}،\nبيانات الدخول للطالب/ة ${studentName}:\n${parts.join("\n")}\n${SCHOOL_NAME}` };
});

// Staff forms (complaint / tech ticket / lost & found) get their number here.
exports.reserveRecordNumber = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const prefix = { complaint: "COM", techSupport: "IT", lostFound: "LF" }[request.data?.kind];
  if (!prefix) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  return { number: await nextRecordNumber(prefix) };
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
  const { complaintDocId, notes, solved, metById, metByIds } = request.data || {};
  if (!complaintDocId || typeof complaintDocId !== "string") {
    throw new HttpsError("invalid-argument", "رقم الملاحظة مطلوب.");
  }

  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  }
  // The reception desk confirms that the meeting took place and with whom;
  // the summary and solution stay with the staff member who met the parent.
  const byReception = caller.role === "RECEPTIONIST";
  if (!byReception && (typeof notes !== "string" || !notes.trim())) {
    throw new HttpsError("invalid-argument", "يرجى كتابة ملخص المقابلة والحل.");
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
  const allowed = byReception ? inScope : isAdminCaller || isAssignee || (inScope && (caller.perms?.edit === true || caller.isPrincipal === true || caller.isQuality === true));
  if (!allowed) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تأكيد هذه المقابلة.");
  }

  // Who met the parent — one or several staff members. From reception: the
  // people picked; from staff: the caller plus any colleagues they add.
  // Each must be an active, non-reception account covering the branch (or
  // already assigned).
  const picked = [...new Set([...(Array.isArray(metByIds) ? metByIds : []), ...(typeof metById === "string" && metById ? [metById] : [])].filter((x) => typeof x === "string" && x))];
  const ids = byReception ? picked : [request.auth.uid, ...picked.filter((x) => x !== request.auth.uid)];
  if (!ids.length) throw new HttpsError("invalid-argument", "اختر الموظف الذي قابل ولي الأمر.");
  if (ids.length > 8) throw new HttpsError("invalid-argument", "الحد الأقصى 8 أشخاص.");
  const metSnaps = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  const metList = metSnaps.map((snapU) => {
    const m = snapU.data();
    if (snapU.id === request.auth.uid && !byReception) return { id: snapU.id, name: caller.name || "مستخدم" };
    const coversBranch = m && (m.access === "all" || m.role === "ADMIN" || (m.branches || []).includes(complaint.branch) || m.branch === complaint.branch);
    if (!snapU.exists || m.active === false || m.role === "RECEPTIONIST" || !(coversBranch || (complaint.assignedTo || []).includes(snapU.id))) {
      throw new HttpsError("invalid-argument", "أحد الموظفين المختارين غير متاح لهذا الفرع.");
    }
    return { id: snapU.id, name: m.name || "مستخدم" };
  });
  const metBy = { id: metList[0].id, name: metList.map((m) => m.name).join("، ") };

  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const text = typeof notes === "string" ? notes.trim() : "";
  const isSolved = !byReception && solved === true && !["SOLVED", "CLOSED", "REJECTED"].includes(complaint.status);

  // Everyone who met the parent becomes an assignee if they weren't.
  const assignedTo = complaint.assignedTo || [];
  const assignedToNames = complaint.assignedToNames || [];
  const newcomers = metList.filter((m) => !assignedTo.includes(m.id));
  const assigneeUpdate = !newcomers.length ? {} : {
    assignedTo: [...assignedTo, ...newcomers.map((m) => m.id)],
    assignedToNames: [...assignedToNames, ...newcomers.map((m) => m.name)],
    ...(assignedTo.length ? {} : { assignedAt: now }),
  };

  const logs = complaintRef.collection("activityLog");
  const batch = db.batch();
  batch.set(logs.doc(), {
    action: "INTERNAL_COMMENT_ADDED",
    actorId: request.auth.uid,
    actorName,
    metadata: {
      comment: byReception
        ? `✅ أكّد موظف الاستقبال (${actorName}) مقابلة ولي الأمر في الفرع مع ${metBy.name}.${text ? `\n${text}` : ""}\nيُرجى من ${metBy.name} كتابة ملخص المقابلة والحل.`
        : `✅ تمت مقابلة ولي الأمر في الفرع${metList.length > 1 ? ` (${metBy.name})` : ""}.\n${text}`,
      visit: true,
    },
    createdAt: now,
  });
  batch.set(logs.doc(), {
    action: "VISIT_MET",
    actorId: request.auth.uid,
    actorName,
    metadata: { solved: isSolved, metById: metBy.id, metByIds: metList.map((m) => m.id), metByName: metBy.name, byReception },
    createdAt: now,
  });
  batch.update(complaintRef, {
    visitStatus: "MET",
    visitMetAt: now,
    visitMetBy: metBy.id,
    visitMetByIds: metList.map((m) => m.id),
    visitMetByName: metBy.name,
    ...(byReception ? { visitConfirmedByName: actorName } : {}),
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
// Another school's copy sets PUBLIC_APP_URL / SCHOOL_NAME in functions/.env.
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://mis-complaints.web.app").replace(/\/+$/, "");
const WA_TEMPLATE_KEYS = {
  complaint: { receipt: "complaintReceipt", resolution: "complaintResolution", visitMet: "visitMet", appointmentConfirmed: "appointmentConfirmed", appointmentRescheduled: "appointmentRescheduled", appointmentReminder: "appointmentReminder" },
  techSupport: { receipt: "techReceipt", resolution: "techResolution" },
  lostFound: { receipt: "lostFoundReceipt", returned: "lostFoundReturned", found: "lostFoundFound" },
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
  // Saudi mobiles typed without the leading 0 (5xxxxxxxx) or as 9660 5...
  if (/^5\d{8}$/.test(digits)) digits = "966" + digits;
  if (/^9660\d{9}$/.test(digits)) digits = "966" + digits.slice(4);
  return digits;
}

// WhatsApp rejects template parameters containing new lines, tabs or more
// than 4 consecutive spaces, and empty values.
function waParam(value) {
  const text = String(value == null ? "" : value).replace(/[\r\n\t]+/g, " - ").replace(/ {4,}/g, "   ").trim();
  return (text || "—").slice(0, 900);
}

// Every Taqnyat send goes through here. A message counts as accepted only
// when the reply carries its WhatsApp message id — Taqnyat returns it as
// statuses[0].message_id for text templates and statuses.message_id for
// media ones; anything else (even with HTTP 200) is an error, and the raw
// reply is kept so the reason is visible. Accepted messages are recorded
// in waMessages (keyed by a hash of the id) so the delivery reports Taqnyat
// posts to waDeliveryReport can be matched back to the record.
const waMessageKey = (messageId) => crypto.createHash("sha1").update(String(messageId)).digest("hex");
async function taqnyatSend(payload, meta = {}) {
  const response = await fetch(TAQNYAT_MESSAGES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAQNYAT_WA_TOKEN.value()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* non-JSON error page */ }
  const st = body && (Array.isArray(body.statuses) ? body.statuses[0] : body.statuses);
  const messageId = (st && (st.message_id || st.id)) ||
    (body && Array.isArray(body.messages) && body.messages[0] && body.messages[0].id) ||
    (body && body.message_id) || null;
  if (!response.ok || !messageId) {
    console.error("Taqnyat WhatsApp send failed", response.status, payload.template && payload.template.name, bodyText.slice(0, 500));
    const providerReason = body && (body.reason || body.message || (body.error && (body.error.message || body.error)) || body.detail || (body.errors && JSON.stringify(body.errors)));
    const reasonText = providerReason ? String(typeof providerReason === "string" ? providerReason : JSON.stringify(providerReason)).slice(0, 200) : bodyText.slice(0, 200);
    // Taqnyat can answer HTTP 200 with its own code in `message` (e.g. 402).
    const code = body && /^\d{3}$/.test(String(body.message || "")) ? body.message : response.status;
    const known = /limit for sending utility/i.test(reasonText)
      ? "انتهى حد/رصيد رسائل الخدمات (Utility) في حساب تقنيات — يلزم شحن الباقة أو رفع الحد"
      : /number blocked|blocked/i.test(reasonText) ? "رقم ولي الأمر محظور: قام بحظر رقم واتساب المدرسة أو أوقف استقبال رسائلها، أو الرقم في قائمة الحظر لدى تقنيات — تواصل معه هاتفياً أو عبر واتساب الفرع"
      : /invalid recipient|not allow to send/i.test(reasonText) ? "رقم المستلم غير صالح أو غير مسموح الإرسال له"
        : /object not found|does not exist|132001/i.test(reasonText) ? "اسم القالب أو لغته غير موجودة في الحساب"
          : /bearer|no such bot/i.test(reasonText) ? "رمز الربط (Token) غير صحيح" : "";
    const err = new HttpsError("internal", known
      ? `لم يقبل مزوّد واتساب الرسالة (رمز ${code}): ${known}.`
      : `لم يقبل مزوّد واتساب الرسالة (رمز ${code})${reasonText ? ` — ${reasonText}` : ""}. تحقق من اسم القالب واعتماده ولغته وعدد متغيراته.`);
    err.providerStatus = response.status;
    err.providerBody = bodyText.slice(0, 500);
    throw err;
  }
  await db.collection("waMessages").doc(waMessageKey(messageId)).set({
    messageId: String(messageId),
    to: payload.to,
    template: payload.template ? payload.template.name : null,
    language: payload.template && payload.template.language ? payload.template.language.code : null,
    status: "accepted",
    sentAt: Timestamp.now(),
    ...meta,
  });
  return { messageId: String(messageId), raw: bodyText.slice(0, 500) };
}

// Delivery reports (Taqnyat "callback"): set this function's URL as the
// callback / webhook in the Taqnyat portal. Each report updates the matching
// waMessages entry; a failed one is also written to the record's activity
// log with the reason, so staff see that the parent did not get it.
// Only messages this system sent (their id hash exists) are touched.
const WA_FAILED_STATES = ["failed", "no_opt_in", "no_capability", "deleted"];
exports.waDeliveryReport = onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(200).send("ok"); return; }
  try {
    const body = req.body || {};
    const list = [].concat(body.statuses || [], (body.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => (c.value && c.value.statuses) || [])));
    for (const st of list) {
      const id = st && (st.id || st.message_id);
      if (!id) continue;
      const ref = db.collection("waMessages").doc(waMessageKey(id));
      const snap = await ref.get();
      if (!snap.exists) continue;
      // Taqnyat: state = queued|sent|delivered|read|failed|…, status = success|failure.
      const rawState = String(st.state || "").toLowerCase();
      const state = rawState || (String(st.status || "").toLowerCase() === "failure" ? "failed" : String(st.status || "").toLowerCase());
      const errors = st.errors || st.error || null;
      const details = st.details || (Array.isArray(errors) && errors[0] && (errors[0].title || errors[0].message)) || (errors && errors.message) || "";
      const now = Timestamp.now();
      await ref.update({
        status: state || "unknown",
        ...(details ? { details: String(details).slice(0, 300) } : {}),
        ...(errors ? { errors: JSON.stringify(errors).slice(0, 500) } : {}),
        updatedAt: now,
        history: FieldValue.arrayUnion({ status: state, at: Number(st.timestamp) || now.toMillis() }),
      });
      const m = snap.data();
      if (WA_FAILED_STATES.includes(state) && m.collection && m.docId && !m.failureLogged) {
        await ref.update({ failureLogged: true });
        await db.collection(m.collection).doc(m.docId).collection("activityLog").add({
          action: "WHATSAPP_API_FAILED",
          actorId: null,
          actorName: "واتساب API (تقرير التوصيل)",
          metadata: { event: m.event || null, template: m.template || null, reason: `لم تصل الرسالة لولي الأمر (${state})${details ? ` — ${String(details).slice(0, 200)}` : ""}` },
          createdAt: now,
        });
      }
    }
  } catch (err) {
    console.error("waDeliveryReport", err);
  }
  res.status(200).send("ok");
});

// Admin tool (WhatsApp API settings → اختبار الإرسال): sends one template to
// a number the admin enters, with sample values, and returns Taqnyat's raw
// reply so template / language / variable problems show immediately.
exports.testWhatsAppTemplate = onCall({ secrets: WA_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const callerSnap = await db.collection("users").doc(request.auth.uid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "ADMIN") throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  if (!WA_API_ENABLED) throw new HttpsError("failed-precondition", "واتساب API غير مفعّل في الخادم.");
  const { phone, template, language, button } = request.data || {};
  const to = toIntlNumber(phone);
  if (!/^\d{10,15}$/.test(to)) throw new HttpsError("invalid-argument", "أدخل رقم جوال صحيحاً.");
  if (typeof template !== "string" || !template.trim()) throw new HttpsError("invalid-argument", "اختر القالب.");
  const settingsSnap = await db.collection("settings").doc("whatsappApi").get();
  const lang = (typeof language === "string" && language.trim()) || (settingsSnap.exists && settingsSnap.data().language) || "ar";
  const sample = ["ولي الأمر (اختبار)", "TEST-0000", "طالب تجريبي", "رسالة اختبار من نظام علاقات العملاء", `${PUBLIC_APP_URL}/track`];
  const payload = {
    to,
    type: "template",
    template: { name: template.trim(), language: { code: lang } },
    components: [
      { type: "body", parameters: sample.map((v) => ({ type: "text", text: v })) },
      ...(button === false ? [] : [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "TEST-0000" }] }]),
    ],
  };
  try {
    const { messageId, raw } = await taqnyatSend(payload, { kind: "test", event: "test", by: request.auth.uid });
    return { ok: true, messageId, raw, to };
  } catch (err) {
    return { ok: false, status: err.providerStatus || null, raw: err.providerBody || err.message, message: err.message, to };
  }
});

// Exported only when WA_API_ENABLED (see TAQNYAT_WA_TOKEN above).
// Shared sender for the manual callable and the automatic triggers below.
// Throws HttpsError with an Arabic message the UI / activity log can show.
async function sendWaTemplate({ kind, ref, record, event, actorId, actorName, settings }) {
  const kindConfig = WA_KINDS[kind];
  // A visit reminder falls back to the confirmation template until its own
  // template is approved and named in Settings.
  const templates = settings.templates || {};
  const templateName = templates[WA_TEMPLATE_KEYS[kind][event]] || (event === "appointmentReminder" ? templates.appointmentConfirmed : "");
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
  } else if (event === "appointmentConfirmed" || event === "appointmentRescheduled" || event === "appointmentReminder") {
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
  } else if (kind === "lostFound" && event === "found") {
    if (record.status !== "MATCHED") throw new HttpsError("failed-precondition", "لم يُسجَّل العثور على الغرض بعد.");
    fourth = `تم العثور على الغرض${record.foundPlace ? ` (${record.foundPlace})` : ""}، ويمكن استلامه من ${branch.name || record.branch}`;
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

  const { messageId } = await taqnyatSend(payload, { kind, collection: kindConfig.collection, docId: ref.id, event, recordNumber });

  // Same "sent by" fields the client's messageSentFields() writes, set here
  // so a sender without edit permission (an assignee) still records it.
  // A tech-support resolution's fields (and closing the ticket) are left to
  // the client's existing handleResolutionSent flow.
  const sentPrefix = { receipt: "receipt", resolution: "resolution", returned: "resolution", visitMet: "visit", appointmentConfirmed: "appointment", appointmentRescheduled: "appointment", appointmentReminder: "appointmentReminder", found: "found" }[event];
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
async function reserveAppointment({ branch, startMs, complaintDocId, complaintId, cancelId, extra = {} }) {
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
    tx.set(apptRef, { branch, start, complaintDocId: complaintDocId || null, complaintId: complaintId || null, status: "REQUESTED", createdAt: Timestamp.now(), ...extra });
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

// The person handling a record invites the parent to a school visit: a free
// slot from Settings › مواعيد الزيارات, or any other time they choose
// (customAt, which skips the slot capacity). The visit is confirmed at once,
// any earlier booking of the record is cancelled, and the parent is
// messaged (WhatsApp API, else the manual button in AppointmentPanel).
exports.inviteParentVisit = onCall({ secrets: WA_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { complaintDocId, slot, customAt } = request.data || {};
  const note = str(request.data?.note, 300);
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("complaints").doc(String(complaintDocId || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الملاحظة.");
  const record = snap.data();
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  if (!canManageAppointment(caller, record, request.auth.uid) && !(inScope && caller.isQuality === true)) {
    throw new HttpsError("permission-denied", "دعوة ولي الأمر للزيارة للمسؤول عن الملاحظة أو مدير المدرسة.");
  }
  if (["CLOSED", "REJECTED"].includes(record.status)) throw new HttpsError("failed-precondition", "الملاحظة مغلقة.");
  const cancelId = record.appointment && ACTIVE_APPT.includes(record.appointment.status) ? record.appointment.id : undefined;
  let reserved;
  if (customAt) {
    const ms = Number(customAt);
    if (!Number.isFinite(ms) || ms < Date.now() + 15 * 60000 || ms > Date.now() + 90 * APPT_DAY) {
      throw new HttpsError("invalid-argument", "اختر موعداً قادماً خلال 90 يوماً.");
    }
    const apptRef = db.collection("appointments").doc();
    const start = Timestamp.fromMillis(ms);
    await apptRef.set({ branch: record.branch, start, complaintDocId: ref.id, complaintId: record.complaintId, status: "CONFIRMED", custom: true, createdAt: Timestamp.now() });
    if (cancelId) await db.collection("appointments").doc(cancelId).update({ status: "CANCELLED", cancelledAt: Timestamp.now() });
    reserved = { id: apptRef.id, start, requestedStart: start };
  } else {
    reserved = await reserveAppointment({ branch: record.branch, startMs: Number(slot), complaintDocId: ref.id, complaintId: record.complaintId, cancelId });
    await db.collection("appointments").doc(reserved.id).update({ status: "CONFIRMED" });
  }
  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const when = formatRiyadh(reserved.start.toMillis());
  const appointment = {
    ...reserved, status: "CONFIRMED", invitedByStaff: true, ...(note ? { note } : {}),
    decidedAt: now, decidedBy: request.auth.uid, decidedByName: actorName,
  };
  await ref.update({
    appointment, updatedAt: now, appointmentMessageSentAt: FieldValue.delete(),
    ...(record.status === "RECEIVED" || record.status === "ASSIGNED" ? { status: "IN_PROGRESS" } : {}),
  });
  await ref.collection("activityLog").add({ action: "APPOINTMENT_INVITED", actorId: request.auth.uid, actorName, metadata: { when, ...(note ? { note } : {}) }, createdAt: now });
  await autoSendWa("complaint", ref, "appointmentConfirmed");
  const after = (await ref.get()).data();
  return { ok: true, when, sent: Boolean(after.appointmentMessageSentAt) };
});

// Visit reminders: at 17:00 for tomorrow's confirmed visits, and at 07:00
// for today's visits that got no reminder (booked after yesterday's run).
// The parent gets the reminder on WhatsApp (when the API and auto-send are
// on) and the staff handling the record get an in-app reminder.
async function sendAppointmentReminders(day) {
  const from = Timestamp.fromMillis(Date.parse(`${day}T00:00:00+03:00`));
  const to = Timestamp.fromMillis(Date.parse(`${day}T23:59:59+03:00`));
  const snap = await db.collection("appointments").where("start", ">=", from).where("start", "<=", to).get();
  let reminded = 0;
  for (const a of snap.docs) {
    const appt = a.data();
    if (appt.status !== "CONFIRMED" || !appt.complaintDocId) continue;
    const ref = db.collection("complaints").doc(appt.complaintDocId);
    const c = (await ref.get()).data();
    if (!c || c.appointment?.id !== a.id || c.appointment?.status !== "CONFIRMED" || c.appointment?.reminderSentFor === day) continue;
    if (["CLOSED", "REJECTED"].includes(c.status)) continue;
    await ref.update({ "appointment.reminderSentFor": day, "appointment.reminderAt": Timestamp.now() });
    await autoSendWa("complaint", ref, "appointmentReminder");
    const when = formatRiyadh(appt.start.toMillis());
    await ref.collection("activityLog").add({ action: "APPOINTMENT_REMINDER", actorId: null, actorName: AUTO_ACTOR, metadata: { when }, createdAt: Timestamp.now() });
    const staff = [...new Set([...(c.assignedTo || []), c.appointment?.decidedBy].filter(Boolean))];
    if (staff.length) {
      await notifyUsers(staff, { title: "تذكير بموعد زيارة ولي أمر", body: `${c.parentName || "ولي الأمر"} — الطالب/ة ${c.studentName || ""} — ${when} (الملاحظة ${c.complaintId})`, complaintId: ref.id, type: "APPOINTMENT_REMINDER" });
    }
    reminded++;
  }
  return reminded;
}
exports.appointmentRemindersEvening = onSchedule({ schedule: "0 17 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 300 }, async () => {
  console.log("appointment reminders (tomorrow)", await sendAppointmentReminders(riyadhDay(1)));
});
exports.appointmentRemindersMorning = onSchedule({ schedule: "0 7 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 300 }, async () => {
  console.log("appointment reminders (today)", await sendAppointmentReminders(riyadhDay()));
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
const STAFF_UPLOAD_FOLDERS = ["complaints", "lostFoundItems", "leads"];
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

// ---------------------------------------------------------------------------
// School trips — staff tab /trips, public consent page /trip/<tripCode>.
// Everything is read/written here with the Admin SDK; firestore.rules only
// lets staff read trips in their branches (and the enrollments when they
// manage, approve, finance or supervise the trip).
//
// Who does what (perms are set per user on the Users page):
//   manage   — admin, perms.trips (activities coordinator), branch principal
//   approve  — admin, principal of every branch the trip covers
//   finance  — admin, perms.tripFinance (receipts, cash payments)
//   supervise — the above + the trip's supervisors (boarding list)
// ---------------------------------------------------------------------------
const TRIP_STAGES = ["KG1", "KG2", "KG3", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "SEN"];
const TRIP_PAY_METHODS = ["BANK", "RECEPTION"];
const TRIP_EDITABLE = ["DRAFT", "PENDING_APPROVAL", "OPEN", "CLOSED"];
const TRIP_PUBLIC = ["OPEN", "CLOSED", "COMPLETED"];
const TRIP_DECLINE_REASONS = ["COST", "TIMING", "FAMILY", "HEALTH", "OTHER"];
const TRIP_RATINGS = ["organization", "safety", "benefit", "cost"];
// Roster "stage_name" (curriculum) → section id used on trips/complaints.
// Kindergarten has no section of its own, so it matches any section.
const STUDENT_SECTIONS = { "أمريكي": "AMERICAN", "بريطاني": "BRITISH", "تربية خاصة": "SPECIAL_EDUCATION" };

// Roster grade_name ("Grade 5", "KG 2", "SEN") → STAGES id (G5, KG2, SEN).
function studentGrade(s) {
  const g = String(s.gradeName || "").trim();
  let m = /^grade\s*(\d{1,2})$/i.exec(g);
  if (m) return `G${Number(m[1])}`;
  m = /^kg\s*([1-3])$/i.exec(g);
  if (m) return `KG${m[1]}`;
  if (/^sen$/i.test(g)) return "SEN";
  return TRIP_STAGES.includes(g.toUpperCase()) ? g.toUpperCase() : "";
}
const studentSection = (s) => STUDENT_SECTIONS[String(s.stageName || "").trim()] || "";
const normalizeDigits = (v) => String(v || "").replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf)).replace(/\s+/g, "");

// Branch code of a roster row. Rows imported before their branch name
// matched a branch exactly have an empty `branch`, so fall back to the name
// with or without the "فرع " prefix.
async function branchResolver() {
  const snap = await db.collection("branches").get();
  const byName = new Map();
  snap.docs.forEach((d) => {
    const name = String(d.data().name || "").trim();
    byName.set(name, d.id);
    byName.set(name.replace(/^فرع\s+/, ""), d.id);
  });
  // This school's roster file spells some branches differently.
  Object.entries(ROSTER_BRANCH_ALIASES).forEach(([name, id]) => { if (!byName.has(name)) byName.set(name, id); });
  return (s) => s.branch || byName.get(String(s.branchName || "").trim().replace(/^فرع\s+/, "").replace(/\s+/g, " ")) || "";
}
const ROSTER_BRANCH_ALIASES = {
  "السلامة بنات": "AL_SALAMA_GIRLS",
  "التربية الخاصة - السلامة 2": "AL_SALAMA_BOYS",
  "السلامة 2 - التربيه الخاصة": "AL_SALAMA_BOYS",
};

// Student gender from the roster ("gender" column, imported as M / F) —
// the current roster file has none, so it is often unknown ("").
const studentGenderOf = (s) => (s.gender === "M" || s.gender === "F" ? s.gender : "");
function tripTargets(trip, s, branchOf) {
  if (!(trip.branches || []).includes(branchOf(s))) return false;
  // Boys-only / girls-only trip: exclude students known to be the other
  // gender (unknown gender stays included).
  const g = studentGenderOf(s);
  if (g && ((trip.gender === "BOYS" && g === "F") || (trip.gender === "GIRLS" && g === "M"))) return false;
  if ((trip.stages || []).length && !trip.stages.includes(studentGrade(s))) return false;
  const section = studentSection(s);
  if ((trip.departments || []).length && section && !trip.departments.includes(section)) return false;
  return true;
}

// All roster students a trip is aimed at (branch, grade and section).
async function tripRoster(trip) {
  const branchOf = await branchResolver();
  const snap = await db.collection("students").get();
  return snap.docs.map((d) => d.data()).filter((s) => s.nationalId && s.active !== false && tripTargets(trip, s, branchOf)).map((s) => ({
    id: String(s.nationalId),
    name: s.nameAr || s.name || "",
    grade: studentGrade(s),
    className: s.className || "",
    branch: branchOf(s),
    section: studentSection(s),
    mobile: s.mobile || "",
  }));
}

// The status a parent / finance sees for one student.
function enrollmentStatus(e, fee) {
  if (!e) return "NO_RESPONSE";
  if (e.decision === "DECLINED") return "DECLINED";
  if (!(fee > 0) || e.payStatus === "PAID") return "CONFIRMED";
  if (e.payStatus === "REVIEW") return "RECEIPT_REVIEW";
  if (e.payStatus === "REJECTED") return "RECEIPT_REJECTED";
  return "AWAITING_PAYMENT";
}

async function tripCaller(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  const u = snap.data();
  if (!snap.exists || u.active === false || u.role === "RECEPTIONIST" || (u.role !== "ADMIN" && u.tripsAccess === "none")) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية الوصول إلى الرحلات.");
  }
  return { uid: request.auth.uid, ...u };
}
const callerAll = (u) => u.role === "ADMIN" || u.access === "all";
const callerHasBranch = (u, b) => callerAll(u) || (u.branches || []).includes(b) || u.branch === b;
const tripPerm = {
  manage: (u, branches) => u.role === "ADMIN" || ((u.perms?.trips || u.isPrincipal) && branches.some((b) => callerHasBranch(u, b))),
  approve: (u, branches) => u.role === "ADMIN" || (u.isPrincipal === true && branches.every((b) => callerHasBranch(u, b))),
  finance: (u, branches) => u.role === "ADMIN" || (u.perms?.tripFinance === true && branches.some((b) => callerHasBranch(u, b))),
};
// Per-user trip permissions set by the owner on the Users page; a key that
// was never set keeps the older role-based behaviour (`legacy`).
const tripCan = (u, key, legacy) => u.role === "ADMIN" || (typeof u.perms?.[key] === "boolean" ? u.perms[key] : legacy);
tripPerm.supervise = (u, branches, trip) => tripPerm.manage(u, branches) || tripPerm.finance(u, branches) || (trip.supervisors || []).includes(u.uid);
tripPerm.view = (u, branches, trip) => tripPerm.supervise(u, branches, trip) || tripPerm.approve(u, branches) || (u.isPrincipal === true && branches.some((b) => callerHasBranch(u, b)));

async function loadTrip(id, caller, perm) {
  if (typeof id !== "string" || !id) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const ref = db.collection("trips").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الرحلة.");
  const trip = snap.data();
  if (caller && perm && !tripPerm[perm](caller, trip.branches || [], trip)) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء على هذه الرحلة.");
  }
  return { ref, trip };
}

function tripLog(ref, action, actor, metadata = {}) {
  return ref.collection("activityLog").add({ action, actorId: actor?.uid || null, actorName: actor?.name || AUTO_ACTOR, metadata, createdAt: Timestamp.now() });
}

// "الثلاثاء 3 نوفمبر 2026" from a "YYYY-MM-DD" day.
function formatTripDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  if (!m) return day || "";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
}
// "13:00" → "1:00 م" — trip times are stored 24-hour, shown 12-hour.
function time12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return hhmm || "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "م" : "ص"}`;
}
const tripWhen = (trip) => `${formatTripDay(trip.date)}${trip.departTime ? `، ${time12(trip.departTime)}${trip.returnTime ? ` – ${time12(trip.returnTime)}` : ""}` : ""}`;
const riyadhDay = (offsetDays = 0) => new Date(Date.now() + APPT_TZ_MS + offsetDays * APPT_DAY).toISOString().slice(0, 10);

const str = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
function cleanTrip(input) {
  const d = input || {};
  const time = (v) => (/^\d{2}:\d{2}$/.test(v || "") ? v : "");
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const list = (v, allowed) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x)))].filter((x) => !allowed || allowed.includes(x)) : []);
  const trip = {
    title: str(d.title, 120),
    destination: str(d.destination, 200),
    objective: str(d.objective, 1000),
    date: day(d.date),
    departTime: time(d.departTime),
    returnTime: time(d.returnTime),
    meetingPoint: str(d.meetingPoint, 200),
    branches: list(d.branches).slice(0, 30),
    departments: list(d.departments),
    stages: list(d.stages, TRIP_STAGES),
    capacity: Math.max(0, Math.floor(Number(d.capacity) || 0)),
    fee: Math.max(0, Math.round((Number(d.fee) || 0) * 100) / 100),
    payDeadline: day(d.payDeadline),
    payMethods: list(d.payMethods, TRIP_PAY_METHODS),
    bankDetails: str(d.bankDetails, 600),
    refundPolicy: str(d.refundPolicy, 1000),
    requirements: str(d.requirements, 1000),
    supervisors: list(d.supervisors).slice(0, 30),
    buses: Math.max(0, Math.floor(Number(d.buses) || 0)),
    notes: str(d.notes, 1000),
    gender: ["BOYS", "GIRLS"].includes(d.gender) ? d.gender : "ALL",
    pledgeRequired: d.pledgeRequired === true,
    // Optional English wording for the parents' page in English.
    en: {
      title: str(d.en?.title, 120), destination: str(d.en?.destination, 200), objective: str(d.en?.objective, 1000),
      meetingPoint: str(d.en?.meetingPoint, 200), requirements: str(d.en?.requirements, 1000),
      bankDetails: str(d.en?.bankDetails, 600), refundPolicy: str(d.en?.refundPolicy, 1000),
    },
  };
  if (!trip.title || !trip.destination || !trip.date || !trip.branches.length) {
    throw new HttpsError("invalid-argument", "أكمل اسم الرحلة والوجهة والتاريخ والفروع.");
  }
  if (trip.payDeadline && trip.payDeadline > trip.date) {
    throw new HttpsError("invalid-argument", "آخر موعد للموافقة يجب أن يكون قبل تاريخ الرحلة أو في نفس اليوم.");
  }
  if (trip.fee > 0 && !trip.payMethods.length) {
    throw new HttpsError("invalid-argument", "اختر طريقة دفع واحدة على الأقل.");
  }
  if (!trip.payDeadline) trip.payDeadline = trip.date;
  return trip;
}

async function newTripCode() {
  const year = riyadhDay().slice(0, 4);
  for (let i = 0; i < 8; i++) {
    const code = `TRP-${year}-${crypto.randomInt(10000, 100000)}`;
    const dup = await db.collection("trips").where("tripCode", "==", code).limit(1).get();
    if (dup.empty) return code;
  }
  throw new HttpsError("internal", "تعذّر إنشاء رقم للرحلة، حاول مرة أخرى.");
}

// Trips in the caller's branches (or that they supervise), newest first.
// Done here rather than as a client query because a trip spans several
// branches, which rules can't match against the caller's branch list.
exports.listTrips = onCall(async (request) => {
  const caller = await tripCaller(request);
  const snap = await db.collection("trips").orderBy("date", "desc").limit(400).get();
  const trips = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => callerAll(caller) || (t.branches || []).some((b) => callerHasBranch(caller, b)) || (t.supervisors || []).includes(caller.uid))
    .map((t) => ({ ...t }));
  // Targeted-student counts for trips that don't have one yet (one roster
  // read for all of them; kept on the trip afterwards).
  const missing = trips.filter((t) => t.targetedCount == null && TRIP_PUBLIC.includes(t.status));
  if (missing.length) {
    const [branchOf, studentsSnap] = await Promise.all([branchResolver(), db.collection("students").get()]);
    const students = studentsSnap.docs.map((d) => d.data()).filter((s) => s.nationalId && s.active !== false);
    for (const t of missing) {
      t.targetedCount = students.filter((s) => tripTargets(t, s, branchOf)).length;
      await db.collection("trips").doc(t.id).update({ targetedCount: t.targetedCount }).catch(() => {});
    }
  }
  return {
    trips: trips.map((t) => ({
      ...t,
      createdAt: t.createdAt?.toMillis?.() || null,
      updatedAt: t.updatedAt?.toMillis?.() || null,
      approvedAt: t.approvedAt?.toMillis?.() || null,
      announcedAt: t.announcedAt?.toMillis?.() || null,
    })),
  };
});

exports.saveTrip = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { id } = request.data || {};
  const trip = cleanTrip(request.data?.trip);
  const outOfScope = trip.branches.filter((b) => !callerHasBranch(caller, b));
  if (!tripPerm.manage(caller, trip.branches) || outOfScope.length) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية إنشاء رحلات لهذه الفروع.");
  }
  const now = Timestamp.now();
  if (!id) {
    const ref = db.collection("trips").doc();
    const tripCode = await newTripCode();
    await ref.set({
      // Trips are entered after they were approved outside the system, so a
      // new trip opens straight away (no draft / approval step).
      ...trip, tripCode, status: "OPEN", stats: {}, preApproved: true, openedAt: now,
      createdBy: caller.uid, createdByName: caller.name || "", createdAt: now, updatedAt: now,
    });
    await tripLog(ref, "TRIP_CREATED", caller);
    return { id: ref.id, tripCode };
  }
  const { ref, trip: current } = await loadTrip(id, caller, "manage");
  if (!tripCan(caller, "tripEdit", true)) throw new HttpsError("permission-denied", "تعديل بيانات الرحلات غير متاح لحسابك.");
  await checkTripPassword(caller, request.data?.tripPassword);
  if (!TRIP_EDITABLE.includes(current.status)) {
    throw new HttpsError("failed-precondition", "لا يمكن تعديل رحلة منتهية أو ملغاة.");
  }
  await ref.update({ ...trip, updatedAt: now, updatedBy: caller.uid, updatedByName: caller.name || "" });
  await tripLog(ref, "TRIP_UPDATED", caller);
  return { id, tripCode: current.tripCode };
});

// Uids of the principals (or, if a branch has none, the admins) who
// approve trips for these branches.
async function tripApprovers(branches) {
  const users = (await loadActiveUsers()).filter((u) => u.tripsAccess !== "none");
  const principals = users.filter((u) => u.isPrincipal === true && branches.some((b) => callerHasBranch(u, b)));
  return (principals.length ? principals : users.filter((u) => u.role === "ADMIN")).map((u) => u.id);
}

const TRIP_TRANSITIONS = {
  // Trips older than the no-approval flow still in draft / awaiting approval.
  open: { from: ["DRAFT", "PENDING_APPROVAL"], to: "OPEN", perm: "manage" },
  submit: { from: ["DRAFT"], to: "PENDING_APPROVAL", perm: "manage" },
  approve: { from: ["PENDING_APPROVAL"], to: "OPEN", perm: "approve" },
  reject: { from: ["PENDING_APPROVAL"], to: "DRAFT", perm: "approve", reason: true },
  close: { from: ["OPEN"], to: "CLOSED", perm: "manage" },
  reopen: { from: ["CLOSED"], to: "OPEN", perm: "manage" },
  complete: { from: ["OPEN", "CLOSED"], to: "COMPLETED", perm: "manage" },
  cancel: { from: ["DRAFT", "PENDING_APPROVAL", "OPEN", "CLOSED"], to: "CANCELLED", perm: "manage", reason: true },
};

// The owner removes a cancelled trip for good: the trip, its enrollments,
// surveys and activity log, and its uploaded files (receipts, pledges, image).
exports.deleteTrip = onCall({ timeoutSeconds: 300 }, async (request) => {
  const caller = await tripCaller(request);
  if (caller.isOwner !== true && caller.perms?.tripDelete !== true) throw new HttpsError("permission-denied", "حذف الرحلات متاح لمنشئ النظام ومن يملك صلاحية حذف الرحلات.");
  const { ref, trip } = await loadTrip(request.data?.id, caller, caller.isOwner === true ? "view" : "manage");
  if (trip.status !== "CANCELLED") throw new HttpsError("failed-precondition", "يمكن حذف الرحلات الملغاة فقط.");
  await getStorage().bucket().deleteFiles({ prefix: `trips/${ref.id}/` }).catch((err) => console.error("deleteTrip files", ref.id, err.message));
  await db.recursiveDelete(ref);
  console.log("trip deleted", trip.tripCode, "by", caller.uid);
  return { ok: true };
});

exports.tripAction = onCall({ secrets: WA_SECRETS, timeoutSeconds: 300 }, async (request) => {
  const caller = await tripCaller(request);
  const { id, action } = request.data || {};
  const reason = str(request.data?.reason, 500);
  const rule = TRIP_TRANSITIONS[action];
  if (!rule) throw new HttpsError("invalid-argument", "إجراء غير معروف.");
  const { ref, trip } = await loadTrip(id, caller, rule.perm);
  if (!rule.from.includes(trip.status)) throw new HttpsError("failed-precondition", "لا يمكن تنفيذ هذا الإجراء في حالة الرحلة الحالية.");
  if (rule.reason && !reason) throw new HttpsError("invalid-argument", "اكتب السبب.");
  if (action === "cancel") {
    if (!tripCan(caller, "tripDelete", true)) throw new HttpsError("permission-denied", "إلغاء الرحلات غير متاح لحسابك.");
    await checkTripPassword(caller, request.data?.tripPassword);
  }

  const now = Timestamp.now();
  const update = { status: rule.to, updatedAt: now };
  if (action === "submit") Object.assign(update, { submittedAt: now, rejectionReason: FieldValue.delete() });
  if (action === "open") Object.assign(update, { openedAt: now, preApproved: true, rejectionReason: FieldValue.delete() });
  if (action === "approve") Object.assign(update, { approvedAt: now, approvedBy: caller.uid, approvedByName: caller.name || "" });
  if (action === "reject") Object.assign(update, { rejectionReason: reason, rejectedByName: caller.name || "" });
  if (action === "cancel") Object.assign(update, { cancelReason: reason, cancelledByName: caller.name || "" });
  await ref.update(update);
  await tripLog(ref, `TRIP_${action.toUpperCase()}`, caller, reason ? { reason } : {});

  const title = `رحلة ${trip.title}`;
  if (action === "complete") {
    const settings = await waTripSettings();
    if (settings && settings.autoSend !== false) await sendTripSurveys(ref, { ...trip, status: "COMPLETED" }, settings, null);
  }
  if (action === "submit") {
    await notifyUsers(await tripApprovers(trip.branches || []), { title: "رحلة بانتظار الاعتماد", body: `${title} — ${formatTripDay(trip.date)} (${caller.name || ""})`, complaintId: id, type: "TRIP_APPROVAL_REQUESTED" });
  } else if (action === "approve" || action === "reject") {
    await notifyUsers([trip.createdBy].filter((u) => u && u !== caller.uid), {
      title: action === "approve" ? "تم اعتماد الرحلة" : "لم تُعتمد الرحلة",
      body: action === "approve" ? `${title} — ${caller.name || ""}` : `${title}: ${reason}`,
      complaintId: id, type: "TRIP_DECIDED",
    });
  }
  return { ok: true, status: rule.to };
});

// The roster a trip targets, for the students / finance / boarding views.
exports.getTripRoster = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { trip } = await loadTrip(request.data?.id, caller, "view");
  const roster = await tripRoster(trip);
  // Kept on the trip so the trips list can show "x of y targeted".
  if (trip.targetedCount !== roster.length) await db.collection("trips").doc(request.data.id).update({ targetedCount: roster.length }).catch(() => {});
  // Phones stay server-side; staff see who has one.
  return { students: roster.map(({ mobile, ...s }) => ({ ...s, hasMobile: !!toIntlNumber(mobile) })) };
});

// --- WhatsApp (one "tripNotice" template for every trip message) ----------
// Same five body variables as the other templates: {{1}} student, {{2}}
// trip title, {{3}} date and time, {{4}} the message, {{5}} trip page link —
// plus the usual "contact the branch" button, here /contact/BR-<branch>[-<section>].
async function waTripSettings() {
  if (!WA_API_ENABLED) return null;
  const snap = await db.collection("settings").doc("whatsappApi").get();
  const settings = snap.exists ? snap.data() : {};
  if (!settings.enabled || !(settings.templates || {}).tripNotice) return null;
  return settings;
}

async function sendTripNotice({ settings, trip, phone, studentName, branch, section, line, image }) {
  const to = toIntlNumber(phone);
  if (!to) throw new Error("لا يوجد رقم جوال لولي الأمر.");
  // With an image: the "tripAnnouncementImage" template (image header, same
  // body variables and button).
  const withImage = image && (settings.templates || {}).tripAnnouncementImage;
  const payload = {
    to,
    type: "template",
    template: { name: withImage ? settings.templates.tripAnnouncementImage : settings.templates.tripNotice, language: { code: settings.language || "ar" } },
    components: [
      ...(withImage ? [{ type: "header", parameters: [{ type: "image", image: { link: image } }] }] : []),
      {
        type: "body",
        parameters: [studentName, trip.title, tripWhen(trip), line, `${PUBLIC_APP_URL}/trip/${trip.tripCode}`].map((v) => ({ type: "text", text: waParam(v) })),
      },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `BR-${branch || (trip.branches || [])[0] || ""}${section ? `-${section}` : ""}` }] },
    ],
  };
  await taqnyatSend(payload, { kind: "trip", tripId: trip.id || null, tripCode: trip.tripCode || null });
}

// Sends to many parents a few at a time; never throws.
async function sendTripNotices(settings, trip, recipients, lineFor, image) {
  let sent = 0;
  let failed = 0;
  const queue = [...recipients];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        await sendTripNotice({ settings, trip, phone: r.mobile, studentName: r.name, branch: r.branch, section: r.section, line: lineFor(r), image });
        sent++;
      } catch (err) {
        failed++;
        console.error("trip notice", trip.tripCode, err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { sent, failed };
}

const feeText = (trip) => (trip.fee > 0 ? `الرسوم ${trip.fee} ريال، وآخر موعد للموافقة والدفع ${formatTripDay(trip.payDeadline)}` : `الرحلة مجانية، وآخر موعد للموافقة ${formatTripDay(trip.payDeadline)}`);
const TRIP_LINES = {
  announce: (trip) => `ندعوكم للاطلاع على الرحلة والموافقة على مشاركة الطالب/ة. ${feeText(trip)}.`,
  remindPending: (trip) => `نذكّركم بالرد على دعوة الرحلة قبل ${formatTripDay(trip.payDeadline)}.`,
  remindPayment: (trip) => `نذكّركم بإكمال سداد رسوم الرحلة (${trip.fee} ريال) قبل ${formatTripDay(trip.payDeadline)}.`,
  eve: (trip) => [`نذكّركم بموعد الرحلة غداً`, trip.meetingPoint ? `التجمع في ${trip.meetingPoint}${trip.departTime ? ` الساعة ${time12(trip.departTime)}` : ""}` : "", trip.requirements ? `المتطلبات: ${trip.requirements}` : ""].filter(Boolean).join(". ") + ".",
  paid: () => "تم قبول سند الدفع وتأكيد مشاركة الطالب/ة في الرحلة.",
  cash: () => "تم استلام رسوم الرحلة وتأكيد مشاركة الطالب/ة.",
  rejected: (trip, reason) => `لم يتم قبول سند الدفع: ${reason}. يرجى إعادة إرفاق السند من رابط الرحلة.`,
  freeConfirmed: () => "تم تسجيل موافقتكم وتأكيد مشاركة الطالب/ة في الرحلة.",
};

// Announcement (audience "all") or a reminder to those who haven't
// answered / haven't paid (audience "pending").
exports.sendTripAnnouncement = onCall({ secrets: WA_SECRETS, timeoutSeconds: 540 }, async (request) => {
  const caller = await tripCaller(request);
  const { ref, trip } = await loadTrip(request.data?.id, caller, "manage");
  const audience = request.data?.audience === "pending" ? "pending" : "all";
  if (trip.status !== "OPEN") throw new HttpsError("failed-precondition", "الإعلان متاح للرحلات المعتمدة والمفتوح تسجيلها فقط.");
  const settings = await waTripSettings();
  if (!settings) throw new HttpsError("failed-precondition", "فعّل واتساب API وأضف اسم قالب «إشعار رحلة» في الإعدادات.");

  const roster = (await tripRoster(trip)).filter((s) => toIntlNumber(s.mobile));
  const enrollSnap = await ref.collection("enrollments").get();
  const byId = new Map(enrollSnap.docs.map((d) => [d.id, d.data()]));
  const recipients = audience === "all" ? roster : roster.filter((s) => {
    const st = enrollmentStatus(byId.get(s.id), trip.fee);
    return st === "NO_RESPONSE" || st === "AWAITING_PAYMENT" || st === "RECEIPT_REJECTED";
  });
  const result = await sendTripNotices(settings, trip, recipients, (s) => {
    if (audience === "all") return TRIP_LINES.announce(trip);
    return byId.get(s.id) ? TRIP_LINES.remindPayment(trip) : TRIP_LINES.remindPending(trip);
  }, audience === "all" && request.data?.withImage !== false ? trip.imageUrl || null : null);
  const now = Timestamp.now();
  await ref.update(audience === "all"
    ? { announcedAt: now, announcedCount: FieldValue.increment(result.sent) }
    : { lastReminderAt: now });
  await tripLog(ref, audience === "all" ? "TRIP_ANNOUNCED" : "TRIP_REMINDED", caller, { ...result, total: recipients.length });
  return { ...result, total: recipients.length };
});

// --- Public parent page ---------------------------------------------------
async function tripByCode(code) {
  const tripCode = String(code || "").trim().toUpperCase();
  if (!/^TRP-\d{4}-\d{5}$/.test(tripCode)) throw new HttpsError("not-found", "الرابط غير صحيح.");
  const snap = await db.collection("trips").where("tripCode", "==", tripCode).limit(1).get();
  if (snap.empty || !TRIP_PUBLIC.includes(snap.docs[0].data().status)) throw new HttpsError("not-found", "هذه الرحلة غير متاحة.");
  return { ref: snap.docs[0].ref, trip: snap.docs[0].data() };
}

async function publicTripView(trip) {
  const branchSnaps = await db.getAll(...(trip.branches || []).map((b) => db.collection("branches").doc(b)));
  return {
    tripCode: trip.tripCode, title: trip.title, destination: trip.destination, objective: trip.objective,
    date: trip.date, dateLabel: formatTripDay(trip.date), departTime: trip.departTime, returnTime: trip.returnTime,
    meetingPoint: trip.meetingPoint, stages: trip.stages || [], fee: trip.fee, payDeadline: trip.payDeadline,
    payDeadlineLabel: formatTripDay(trip.payDeadline), payMethods: trip.payMethods || [], bankDetails: trip.bankDetails,
    refundPolicy: trip.refundPolicy, requirements: trip.requirements, status: trip.status,
    en: trip.en || {},
    branches: trip.branches || [],
    branchNames: branchSnaps.map((s, i) => (s.exists ? s.data().name : trip.branches[i])),
    registrationOpen: trip.status === "OPEN" && riyadhDay() <= trip.payDeadline,
    surveyOpen: trip.status === "COMPLETED",
    gender: trip.gender || "ALL",
    imageUrl: trip.imageUrl || "",
    pledgeRequired: false, // the pledge sheet is optional
    pledgeTemplate: trip.pledgeTemplate ? { fileName: trip.pledgeTemplate.fileName, fileUrl: trip.pledgeTemplate.fileUrl } : null,
  };
}

exports.getPublicTrip = onCall(async (request) => {
  const { trip } = await tripByCode(request.data?.tripCode);
  return publicTripView(trip);
});

// The parent identifies the student by national ID and types their own
// mobile number (it becomes the trip's contact number). Unknown IDs are
// counted per trip+student to stop guessing. `known` = the number matches
// the roster or the one that already answered for this student.
async function verifyTripParent(tripRef, trip, studentIdRaw, parentMobileRaw) {
  const studentId = normalizeDigits(studentIdRaw);
  const intl = toIntlNumber(parentMobileRaw);
  if (!/^\d{5,15}$/.test(studentId)) throw new HttpsError("invalid-argument", "أدخل رقم هوية الطالب/ة.");
  if (!/^9665\d{8}$/.test(intl)) throw new HttpsError("invalid-argument", "أدخل رقم جوال ولي الأمر (05xxxxxxxx).");
  const parentMobile = `0${intl.slice(3)}`;
  const guardRef = db.collection("tripVerify").doc(`${tripRef.id}_${studentId}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 3600 * 1000;
  if (recent && (guard.failures || 0) >= 8) {
    throw new HttpsError("resource-exhausted", "محاولات كثيرة، حاول بعد ساعة أو تواصل مع الفرع.");
  }
  const studentSnap = await db.collection("students").doc(studentId).get();
  if (!studentSnap.exists || studentSnap.data().active === false) {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("not-found", "لم يتم العثور على الطالب/ة. تأكد من رقم الهوية.");
  }
  const s = studentSnap.data();
  const branchOf = await branchResolver();
  if (!tripTargets(trip, s, branchOf)) throw new HttpsError("failed-precondition", "هذه الرحلة غير مخصصة لصف الطالب/ة أو فرعه.");
  if (guard.failures) await guardRef.delete();
  const e = (await tripRef.collection("enrollments").doc(studentId).get()).data() || null;
  const same = (v) => toIntlNumber(v) === intl;
  const known = same(s.mobile) || (e && same(e.parentPhone));
  return { studentId, student: s, branch: branchOf(s), grade: studentGrade(s), section: studentSection(s), parentMobile, known, existing: e };
}

// A confirmed student not marked absent at boarding.
const tookPart = (e, trip) => enrollmentStatus(e, trip.fee) === "CONFIRMED" && e.boarded !== false;

// Health notes / extra number only back to the number that answered (or
// the roster's); anyone else sees the status alone.
const publicEnrollment = (e, trip, full = true) => (e ? {
  decision: e.decision, declineReason: e.declineReason || null, payMethod: e.payMethod || null, payStatus: e.payStatus || null,
  payRejectReason: e.payRejectReason || "", status: enrollmentStatus(e, trip.fee),
  healthNotes: full ? e.healthNotes || "" : "", emergencyPhone: full ? e.emergencyPhone || "" : "",
  receiptName: e.receipt?.fileName || "",
  pledgeName: e.pledge?.fileName || "",
} : null);

exports.verifyTripStudent = onCall(async (request) => {
  const { ref, trip } = await tripByCode(request.data?.tripCode);
  const v = await verifyTripParent(ref, trip, request.data?.studentId, request.data?.parentMobile);
  const [e, survey] = await Promise.all([ref.collection("enrollments").doc(v.studentId).get(), ref.collection("surveys").doc(v.studentId).get()]);
  return {
    studentName: v.student.nameAr || v.student.name || "", grade: v.grade, className: v.student.className || "",
    enrollment: publicEnrollment(e.exists ? e.data() : null, trip, v.known),
    // A reply already made from another number can't be changed from this one.
    lockedByOther: !!(e.exists && e.data().source === "parent" && !v.known),
    participated: e.exists && tookPart(e.data(), trip),
    surveyDone: survey.exists,
  };
});

// Finance staff of the branch; the trip's creator when there are none.
async function tripFinanceUsers(branch, trip) {
  const users = (await loadActiveUsers()).filter((u) => u.tripsAccess !== "none");
  const finance = users.filter((u) => u.role !== "ADMIN" && u.perms?.tripFinance === true && callerHasBranch(u, branch)).map((u) => u.id);
  return finance.length ? finance : [trip.createdBy];
}

exports.submitTripConsent = onCall(async (request) => {
  const d = request.data || {};
  const { ref, trip } = await tripByCode(d.tripCode);
  if (trip.status !== "OPEN" || riyadhDay() > trip.payDeadline) {
    throw new HttpsError("failed-precondition", "انتهى موعد التسجيل في هذه الرحلة. للاستفسار تواصل مع الفرع.");
  }
  const v = await verifyTripParent(ref, trip, d.studentId, d.parentMobile);
  if (v.existing && v.existing.source === "parent" && !v.known) {
    throw new HttpsError("permission-denied", "تم تسجيل الرد على هذه الرحلة من رقم جوال آخر. للتعديل تواصل مع الفرع.");
  }
  const decision = d.decision === "DECLINED" ? "DECLINED" : d.decision === "APPROVED" ? "APPROVED" : null;
  if (!decision) throw new HttpsError("invalid-argument", "اختر الموافقة أو الاعتذار.");
  const declineReason = decision === "DECLINED" && TRIP_DECLINE_REASONS.includes(d.declineReason) ? d.declineReason : null;
  if (decision === "APPROVED" && d.agree !== true) throw new HttpsError("invalid-argument", "يجب الإقرار بالاطلاع على تعليمات الرحلة.");
  const paid = trip.fee > 0 && decision === "APPROVED";
  const payMethod = paid ? (TRIP_PAY_METHODS.includes(d.payMethod) && (trip.payMethods || []).includes(d.payMethod) ? d.payMethod : null) : null;
  if (paid && !payMethod) throw new HttpsError("invalid-argument", "اختر طريقة الدفع.");

  const enrollRef = ref.collection("enrollments").doc(v.studentId);
  const existing = (await enrollRef.get()).data();
  if (existing && existing.payStatus === "PAID") {
    throw new HttpsError("failed-precondition", "تم تأكيد المشاركة ودفع الرسوم. لأي تعديل تواصل مع الفرع.");
  }
  // Signed pledge sheet (ورقة التعهد) — optional.
  let pledge = existing?.pledge || null;
  if (decision === "APPROVED" && d.pledge) {
    pledge = await uploadPublicAttachment(getStorage().bucket(), `trips/${ref.id}/pledges/${v.studentId}`, d.pledge);
  }
  let receipt = existing?.receipt || null;
  if (paid && payMethod === "BANK" && d.receipt) {
    receipt = await uploadPublicAttachment(getStorage().bucket(), `trips/${ref.id}/receipts/${v.studentId}`, d.receipt);
  }
  // Paying by bank transfer needs the transfer receipt.
  if (paid && payMethod === "BANK" && !receipt) {
    throw new HttpsError("invalid-argument", "يرجى إرفاق سند التحويل البنكي.");
  }
  // A new receipt goes to finance; without one, a receipt already under
  // review (or already rejected) keeps its state; otherwise awaiting payment.
  let payStatus = null;
  if (paid) {
    if (payMethod === "BANK" && d.receipt) payStatus = "REVIEW";
    else if (payMethod === "BANK" && receipt && ["REVIEW", "REJECTED"].includes(existing?.payStatus)) payStatus = existing.payStatus;
    else payStatus = "AWAITING";
  }

  const now = Timestamp.now();
  const record = {
    studentId: v.studentId, studentName: v.student.nameAr || v.student.name || "", branch: v.branch, grade: v.grade, section: v.section,
    className: v.student.className || "", parentPhone: v.parentMobile, rosterPhone: v.student.mobile || "",
    decision, declineReason, payMethod, payStatus, receipt: payMethod === "BANK" ? receipt : null,
    pledge: decision === "APPROVED" ? pledge : null,
    healthNotes: str(d.healthNotes, 500), emergencyPhone: str(d.emergencyPhone, 30),
    payRejectReason: payStatus === "REVIEW" ? "" : existing?.payRejectReason || "",
    source: "parent", updatedAt: now, ...(existing ? {} : { submittedAt: now }),
  };
  await db.runTransaction(async (tx) => {
    if (decision === "APPROVED" && trip.capacity > 0 && existing?.decision !== "APPROVED") {
      const approved = await tx.get(ref.collection("enrollments").where("decision", "==", "APPROVED"));
      if (approved.size >= trip.capacity) throw new HttpsError("resource-exhausted", "اكتمل العدد المحدد للرحلة. للاستفسار تواصل مع الفرع.");
    }
    tx.set(enrollRef, record, { merge: true });
  });
  await tripLog(ref, "TRIP_CONSENT", null, { studentId: v.studentId, studentName: record.studentName, decision, payMethod, payStatus });

  if (payStatus === "REVIEW") {
    await notifyUsers(await tripFinanceUsers(v.branch, trip), { title: "سند دفع رحلة بانتظار المراجعة", body: `${record.studentName} — ${trip.title}`, complaintId: ref.id, type: "TRIP_RECEIPT" });
  }
  const saved = { ...existing, ...record };
  return { enrollment: publicEnrollment(saved, trip, true) };
});

// --- Staff: payment review, manual consent, boarding ----------------------
// How finance collected a trip fee (collect action), shown next to the
// student with the collector and the person who confirmed it in the system.
const TRIP_COLLECT_METHODS = ["CASH", "MADA", "VISA", "MASTERCARD", "TRANSFER", "STUDENT_BALANCE"];
exports.reviewTripPayment = onCall({ secrets: WA_SECRETS }, async (request) => {
  const caller = await tripCaller(request);
  const { id, studentId } = request.data || {};
  // "cash" is the older form of collect + CASH.
  const action = request.data?.action === "cash" ? "collect" : request.data?.action;
  const method = request.data?.action === "cash" ? "CASH" : request.data?.method;
  const note = str(request.data?.note, 300);
  const { ref, trip } = await loadTrip(id, caller, "view");
  if (!["undo", "changeMethod"].includes(action) && !tripPerm.finance(caller, trip.branches || [])) throw new HttpsError("permission-denied", "مراجعة المدفوعات للمالية.");
  if (!["accept", "reject", "collect", "undo", "changeMethod"].includes(action) || typeof studentId !== "string") throw new HttpsError("invalid-argument", "طلب غير صالح.");
  // Correcting a recorded payment (its method, or cancelling it).
  if (action === "undo" || action === "changeMethod") {
    if (!tripCan(caller, "tripPayments", tripPerm.finance(caller, trip.branches || []))) throw new HttpsError("permission-denied", "تعديل وإلغاء المدفوعات غير متاح لحسابك.");
    const enrollRef = ref.collection("enrollments").doc(studentId);
    const e = (await enrollRef.get()).data();
    if (!e || e.payStatus !== "PAID") throw new HttpsError("failed-precondition", "لا يوجد دفع مسجّل لهذا الطالب.");
    const now = Timestamp.now();
    if (action === "changeMethod") {
      const newMethod = request.data?.method;
      if (!TRIP_COLLECT_METHODS.includes(newMethod)) throw new HttpsError("invalid-argument", "اختر طريقة الدفع.");
      await enrollRef.update({ collectMethod: newMethod, ...(request.data?.collectorName ? { collectorName: str(request.data.collectorName, 80) } : {}), paymentEditedByName: caller.name || "", paymentEditedAt: now, updatedAt: now });
    } else {
      await enrollRef.update({
        payStatus: e.receipt && e.payMethod === "BANK" ? "REVIEW" : "AWAITING", paidAmount: 0,
        collectMethod: FieldValue.delete(), collectorName: FieldValue.delete(), invoiceNo: FieldValue.delete(),
        paymentCancelledByName: caller.name || "", paymentCancelledAt: now, paymentCancelReason: note, updatedAt: now,
      });
    }
    await tripLog(ref, action === "undo" ? "TRIP_PAYMENT_UNDO" : "TRIP_PAYMENT_METHOD", caller, { studentId, studentName: e.studentName, note, method: request.data?.method || null });
    return { ok: true };
  }
  if (action === "collect" && !TRIP_COLLECT_METHODS.includes(method)) throw new HttpsError("invalid-argument", "اختر طريقة الدفع.");
  const collectorName = action === "collect" ? str(request.data?.collectorName, 80) || caller.name || "" : "";
  if (action === "reject" && !note) throw new HttpsError("invalid-argument", "اكتب سبب رفض السند.");
  const enrollRef = ref.collection("enrollments").doc(studentId);
  const snap = await enrollRef.get();
  if (!snap.exists || snap.data().decision !== "APPROVED") throw new HttpsError("failed-precondition", "لا توجد موافقة لهذا الطالب.");
  const e = snap.data();
  if (action === "accept" && !e.receipt) throw new HttpsError("failed-precondition", "لا يوجد سند مرفق.");

  const now = Timestamp.now();
  await enrollRef.update({
    payStatus: action === "reject" ? "REJECTED" : "PAID",
    ...(action === "collect" ? { payMethod: "RECEPTION", collectMethod: method, collectorName, cashReceiptNo: note } : {}),
    ...(action === "accept" ? { collectMethod: "TRANSFER", collectorName: "" } : {}),
    payRejectReason: action === "reject" ? note : "",
    paidAmount: action === "reject" ? 0 : trip.fee,
    reviewedBy: caller.uid, reviewedByName: caller.name || "", reviewedAt: now, updatedAt: now,
  });
  await tripLog(ref, `TRIP_PAYMENT_${action.toUpperCase()}`, caller, { studentId, studentName: e.studentName, note, ...(action === "collect" ? { method, collectorName } : {}) });

  let messageSent = false;
  const settings = await waTripSettings();
  if (settings && settings.autoSend !== false && e.parentPhone) {
    try {
      const line = action === "reject" ? TRIP_LINES.rejected(trip, note) : action === "collect" ? TRIP_LINES.cash() : TRIP_LINES.paid();
      await sendTripNotice({ settings, trip, phone: e.parentPhone, studentName: e.studentName, branch: e.branch, section: e.section, line });
      messageSent = true;
    } catch (err) {
      console.error("trip payment notice", err.message);
    }
  }
  return { ok: true, messageSent };
});

// A consent taken by phone or on paper, recorded by the coordinator / finance.
exports.staffSetTripEnrollment = onCall(async (request) => {
  const caller = await tripCaller(request);
  const d = request.data || {};
  const { ref, trip } = await loadTrip(d.id, caller, "supervise");
  if (!(tripPerm.manage(caller, trip.branches || []) || tripPerm.finance(caller, trip.branches || []))) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية تسجيل الموافقات.");
  }
  if (!tripCan(caller, "tripStudents", true)) throw new HttpsError("permission-denied", "تعديل وحذف بيانات الطلاب في الرحلات غير متاح لحسابك.");
  if (!["OPEN", "CLOSED"].includes(trip.status)) throw new HttpsError("failed-precondition", "التسجيل متاح للرحلات المعتمدة فقط.");
  const studentId = normalizeDigits(d.studentId);
  const roster = await tripRoster(trip);
  const s = roster.find((x) => x.id === studentId);
  if (!s) throw new HttpsError("not-found", "الطالب ليس ضمن الصفوف المستهدفة.");
  const enrollRef = ref.collection("enrollments").doc(studentId);
  if (d.remove === true) {
    await enrollRef.delete();
    await tripLog(ref, "TRIP_ENROLLMENT_REMOVED", caller, { studentId, studentName: s.name });
    return { ok: true };
  }
  const decision = d.decision === "DECLINED" ? "DECLINED" : "APPROVED";
  const declineReason = decision === "DECLINED" && TRIP_DECLINE_REASONS.includes(d.declineReason) ? d.declineReason : null;
  const payMethod = decision === "APPROVED" && trip.fee > 0 ? (TRIP_PAY_METHODS.includes(d.payMethod) ? d.payMethod : "RECEPTION") : null;
  const existing = (await enrollRef.get()).data();
  const now = Timestamp.now();
  const record = {
    studentId, studentName: s.name, branch: s.branch, grade: s.grade, section: s.section, className: s.className, parentPhone: s.mobile,
    decision, declineReason, payMethod,
    payStatus: !payMethod ? null
      : existing?.payStatus === "PAID" ? "PAID"
        : payMethod === "BANK" && existing?.receipt && ["REVIEW", "REJECTED"].includes(existing.payStatus) ? existing.payStatus
          : "AWAITING",
    healthNotes: str(d.healthNotes, 500), emergencyPhone: str(d.emergencyPhone, 30),
    source: "staff", recordedBy: caller.uid, recordedByName: caller.name || "", updatedAt: now, ...(existing ? {} : { submittedAt: now }),
  };
  await db.runTransaction(async (tx) => {
    if (decision === "APPROVED" && trip.capacity > 0 && existing?.decision !== "APPROVED") {
      const approved = await tx.get(ref.collection("enrollments").where("decision", "==", "APPROVED"));
      if (approved.size >= trip.capacity) throw new HttpsError("resource-exhausted", "اكتمل العدد المحدد للرحلة.");
    }
    tx.set(enrollRef, record, { merge: true });
  });
  await tripLog(ref, "TRIP_CONSENT_BY_STAFF", caller, { studentId, studentName: s.name, decision, payMethod });
  return { ok: true };
});

exports.setTripBoarding = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { id, studentId, field, value } = request.data || {};
  const { ref, trip } = await loadTrip(id, caller, "supervise");
  if (!["boarded", "returned"].includes(field) || typeof studentId !== "string" || ![true, false, null].includes(value)) {
    throw new HttpsError("invalid-argument", "طلب غير صالح.");
  }
  const enrollRef = ref.collection("enrollments").doc(studentId);
  const snap = await enrollRef.get();
  if (!snap.exists || enrollmentStatus(snap.data(), trip.fee) !== "CONFIRMED") throw new HttpsError("failed-precondition", "الطالب غير مؤكد في هذه الرحلة.");
  await enrollRef.update({ [field]: value, [`${field}At`]: Timestamp.now(), [`${field}ByName`]: caller.name || "" });
  return { ok: true };
});

// Keeps trip.stats (counts and money collected) in step with enrollments.
exports.onTripEnrollmentWritten = onDocumentWritten("trips/{tripId}/enrollments/{studentId}", async (event) => {
  const ref = db.collection("trips").doc(event.params.tripId);
  const tripSnap = await ref.get();
  if (!tripSnap.exists) return;
  const fee = tripSnap.data().fee || 0;
  const snap = await ref.collection("enrollments").get();
  const stats = { responses: 0, approved: 0, declined: 0, confirmed: 0, review: 0, awaiting: 0, rejected: 0, collected: 0, boarded: 0 };
  snap.docs.forEach((d) => {
    const e = d.data();
    stats.responses++;
    const st = enrollmentStatus(e, fee);
    if (e.decision === "APPROVED") stats.approved++;
    if (st === "DECLINED") stats.declined++;
    if (st === "CONFIRMED") stats.confirmed++;
    if (st === "RECEIPT_REVIEW") stats.review++;
    if (st === "AWAITING_PAYMENT") stats.awaiting++;
    if (st === "RECEIPT_REJECTED") stats.rejected++;
    if (e.payStatus === "PAID") stats.collected += Number(e.paidAmount ?? fee) || 0;
    if (e.boarded === true) stats.boarded++;
  });
  await ref.update({ stats });
});

// Daily reminders (when auto-send is on): two days before the deadline to
// parents who haven't answered or paid, and the evening before the trip to
// the confirmed ones.
exports.tripReminders = onSchedule({ schedule: "0 16 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 540 }, async () => {
  const settings = await waTripSettings();
  if (!settings || settings.autoSend === false) return;
  const inTwoDays = riyadhDay(2);
  const tomorrow = riyadhDay(1);
  const open = await db.collection("trips").where("status", "in", ["OPEN", "CLOSED"]).get();
  for (const doc of open.docs) {
    const trip = doc.data();
    const deadlineDue = trip.status === "OPEN" && trip.payDeadline === inTwoDays && !trip.deadlineReminderAt;
    const eveDue = trip.date === tomorrow && !trip.eveReminderAt;
    if (!deadlineDue && !eveDue) continue;
    const roster = (await tripRoster(trip)).filter((s) => toIntlNumber(s.mobile));
    const enrollSnap = await doc.ref.collection("enrollments").get();
    const byId = new Map(enrollSnap.docs.map((d) => [d.id, d.data()]));
    if (deadlineDue) {
      const pending = roster.filter((s) => ["NO_RESPONSE", "AWAITING_PAYMENT", "RECEIPT_REJECTED"].includes(enrollmentStatus(byId.get(s.id), trip.fee)));
      const result = await sendTripNotices(settings, trip, pending, (s) => (byId.get(s.id) ? TRIP_LINES.remindPayment(trip) : TRIP_LINES.remindPending(trip)));
      await doc.ref.update({ deadlineReminderAt: Timestamp.now() });
      await tripLog(doc.ref, "TRIP_REMINDED", null, { ...result, total: pending.length, kind: "deadline" });
    }
    if (eveDue) {
      const confirmed = roster.filter((s) => enrollmentStatus(byId.get(s.id), trip.fee) === "CONFIRMED");
      const result = await sendTripNotices(settings, trip, confirmed, () => TRIP_LINES.eve(trip));
      await doc.ref.update({ eveReminderAt: Timestamp.now() });
      await tripLog(doc.ref, "TRIP_REMINDED", null, { ...result, total: confirmed.length, kind: "eve" });
    }
  }
});

// --- Trip day: arrival notice and incidents --------------------------------
const riyadhClock = () => new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(new Date());

// "وصلنا": tells the parents of the students on the trip (boarded, or all
// confirmed when boarding wasn't taken) that the trip is back.
exports.announceTripArrival = onCall({ secrets: WA_SECRETS, timeoutSeconds: 300 }, async (request) => {
  const caller = await tripCaller(request);
  const { ref, trip } = await loadTrip(request.data?.id, caller, "supervise");
  if (!["OPEN", "CLOSED", "COMPLETED"].includes(trip.status)) throw new HttpsError("failed-precondition", "الرحلة غير معتمدة.");
  if (trip.date !== riyadhDay()) throw new HttpsError("failed-precondition", "إشعار الوصول متاح يوم الرحلة فقط.");
  const snap = await ref.collection("enrollments").get();
  const confirmed = snap.docs.map((d) => d.data()).filter((e) => enrollmentStatus(e, trip.fee) === "CONFIRMED");
  const anyBoarding = confirmed.some((e) => e.boarded === true);
  const onTrip = confirmed.filter((e) => (anyBoarding ? e.boarded === true : e.boarded !== false));
  const time = riyadhClock();
  const settings = await waTripSettings();
  let result = { sent: 0, failed: 0 };
  if (settings) {
    const recipients = onTrip.filter((e) => toIntlNumber(e.parentPhone)).map((e) => ({ name: e.studentName, mobile: e.parentPhone, branch: e.branch, section: e.section }));
    result = await sendTripNotices(settings, trip, recipients, () => `وصلت الرحلة إلى الفرع الساعة ${time}، ويمكنكم استلام الطالب/ة.`);
  }
  await ref.update({ arrivedAt: Timestamp.now(), arrivedByName: caller.name || "", arrivalNotified: result.sent });
  await tripLog(ref, "TRIP_ARRIVED", caller, { ...result, total: onTrip.length, time });
  return { ...result, total: onTrip.length, whatsapp: !!settings };
});

// A note about one student during the trip (health, behaviour, incident) —
// kept on the enrollment and shown in the student record.
exports.addTripIncident = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { ref } = await loadTrip(request.data?.id, caller, "supervise");
  const studentId = normalizeDigits(request.data?.studentId);
  const note = str(request.data?.note, 500);
  if (!studentId || !note) throw new HttpsError("invalid-argument", "اكتب الملاحظة.");
  const enrollRef = ref.collection("enrollments").doc(studentId);
  const snap = await enrollRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "الطالب غير مسجل في هذه الرحلة.");
  await enrollRef.update({ incidents: FieldValue.arrayUnion({ note, at: Timestamp.now(), byId: caller.uid, byName: caller.name || "" }) });
  await tripLog(ref, "TRIP_INCIDENT", caller, { studentId, studentName: snap.data().studentName, note });
  return { ok: true };
});

// --- Parent survey after the trip ------------------------------------------
// Sent (automatically on completion when auto-send is on, or manually) to
// the parents of the students who took part and haven't answered yet; the
// survey itself is on the trip page.
async function sendTripSurveys(ref, trip, settings, actor) {
  const [enrollSnap, surveySnap] = await Promise.all([ref.collection("enrollments").get(), ref.collection("surveys").get()]);
  const answered = new Set(surveySnap.docs.map((d) => d.id));
  const recipients = enrollSnap.docs.map((d) => d.data())
    .filter((e) => tookPart(e, trip) && !answered.has(e.studentId) && toIntlNumber(e.parentPhone))
    .map((e) => ({ name: e.studentName, mobile: e.parentPhone, branch: e.branch, section: e.section }));
  const result = await sendTripNotices(settings, trip, recipients, () => "نشكركم على مشاركة الطالب/ة في الرحلة، ونسعد بتقييمكم لها (أقل من دقيقة) عبر رابط الرحلة.");
  await ref.update({ surveySentAt: Timestamp.now() });
  await tripLog(ref, "TRIP_SURVEY_SENT", actor, { ...result, total: recipients.length });
  return { ...result, total: recipients.length };
}

exports.sendTripSurvey = onCall({ secrets: WA_SECRETS, timeoutSeconds: 540 }, async (request) => {
  const caller = await tripCaller(request);
  const { ref, trip } = await loadTrip(request.data?.id, caller, "manage");
  if (trip.status !== "COMPLETED") throw new HttpsError("failed-precondition", "يُرسل الاستبيان بعد تسجيل تنفيذ الرحلة.");
  const settings = await waTripSettings();
  if (!settings) throw new HttpsError("failed-precondition", "فعّل واتساب API وأضف اسم قالب «إشعار رحلة» في الإعدادات.");
  return sendTripSurveys(ref, trip, settings, caller);
});

function surveyAverage(ratings) {
  const values = TRIP_RATINGS.map((k) => ratings[k]).filter((v) => v >= 1);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Low ratings or "wouldn't recommend" become a complaint assigned to the
// trip's coordinator (the branch quality officers are added by the
// complaint triggers, which also send the parent the usual receipt).
async function openComplaintFromSurvey(ref, trip, e, survey) {
  const users = await loadActiveUsers();
  const coordinator = users.find((u) => u.id === trip.createdBy);
  const labels = { organization: "التنظيم", safety: "السلامة والإشراف", benefit: "الفائدة التعليمية", cost: "مناسبة التكلفة" };
  const complaintId = await nextRecordNumber("COM");
  const now = Timestamp.now();
  const docRef = db.collection("complaints").doc();
  await docRef.set({
    parentName: `ولي أمر ${e.studentName}`,
    parentPhone: e.parentPhone || "",
    parentEmail: "",
    studentName: e.studentName,
    studentId: e.studentId,
    branch: e.branch,
    department: e.section || "",
    stage: e.grade || "",
    grade: e.className || "",
    complaintType: "ADMINISTRATIVE",
    subType: "",
    extraTypes: [],
    subject: `تقييم سلبي لرحلة: ${trip.title}`,
    details: [
      `رحلة ${trip.title} (${trip.tripCode}) — ${formatTripDay(trip.date)}`,
      ...TRIP_RATINGS.map((k) => `${labels[k]}: ${survey.ratings[k]} من 5`),
      `هل ينصح بتكرار الرحلة: ${survey.recommend ? "نعم" : "لا"}`,
      survey.comment ? `تعليق ولي الأمر: ${survey.comment}` : "",
    ].filter(Boolean).join("\n"),
    complaintId,
    priority: "NORMAL",
    source: "TRIP_SURVEY",
    tripId: ref.id,
    receiver: null,
    status: "RECEIVED",
    attachments: [],
    assignedTo: coordinator ? [coordinator.id] : [],
    assignedToNames: coordinator ? [coordinator.name || ""] : [],
    assignedAt: coordinator ? now : null,
    reopened: false,
    isOverdue: false,
    createdAt: now,
    updatedAt: now,
  });
  await docRef.collection("activityLog").add({ action: "COMPLAINT_CREATED", actorId: null, actorName: "ولي الأمر (استبيان رحلة مدرسية)", createdAt: now });
  return complaintId;
}

exports.submitTripSurvey = onCall(async (request) => {
  const d = request.data || {};
  const { ref, trip } = await tripByCode(d.tripCode);
  if (trip.status !== "COMPLETED") throw new HttpsError("failed-precondition", "الاستبيان متاح بعد تنفيذ الرحلة.");
  const v = await verifyTripParent(ref, trip, d.studentId, d.parentMobile);
  const enrollSnap = await ref.collection("enrollments").doc(v.studentId).get();
  if (!enrollSnap.exists || !tookPart(enrollSnap.data(), trip)) throw new HttpsError("failed-precondition", "الاستبيان لأولياء أمور الطلاب المشاركين في الرحلة.");
  const surveyRef = ref.collection("surveys").doc(v.studentId);
  if ((await surveyRef.get()).exists) throw new HttpsError("already-exists", "تم استلام تقييمكم لهذه الرحلة مسبقاً، شكراً لكم.");
  const ratings = {};
  for (const k of TRIP_RATINGS) {
    const n = Math.round(Number(d.ratings?.[k]));
    if (!(n >= 1 && n <= 5)) throw new HttpsError("invalid-argument", "قيّم جميع البنود من 1 إلى 5.");
    ratings[k] = n;
  }
  if (typeof d.recommend !== "boolean") throw new HttpsError("invalid-argument", "أجب عن سؤال تكرار الرحلة.");
  const e = enrollSnap.data();
  const survey = {
    studentId: v.studentId, studentName: e.studentName, branch: e.branch, grade: e.grade, section: e.section || "",
    ratings, average: Math.round(surveyAverage(ratings) * 100) / 100, recommend: d.recommend, comment: str(d.comment, 1000),
    createdAt: Timestamp.now(),
  };
  if (survey.average <= 2.5 || !survey.recommend) {
    survey.complaintId = await openComplaintFromSurvey(ref, trip, e, survey);
  }
  await surveyRef.set(survey);

  // Trip-level averages for the trip card and reports.
  const all = (await ref.collection("surveys").get()).docs.map((x) => x.data());
  const avg = (f) => Math.round((all.reduce((sum, x) => sum + f(x), 0) / all.length) * 100) / 100;
  await ref.update({
    surveyStats: {
      count: all.length,
      average: avg((x) => x.average),
      recommend: all.filter((x) => x.recommend).length,
      ...Object.fromEntries(TRIP_RATINGS.map((k) => [k, avg((x) => x.ratings[k])])),
    },
  });
  return { ok: true };
});

// --- Reports ---------------------------------------------------------------
// Trips in the caller's branches between two days, with per-trip, per-branch
// and per-grade figures. Branch figures for a multi-branch trip use each
// student's own branch.
exports.getTripsReport = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const caller = await tripCaller(request);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const from = day(request.data?.from) || "0000-01-01";
  const to = day(request.data?.to) || "9999-12-31";
  const branchFilter = typeof request.data?.branch === "string" ? request.data.branch : "";
  const snap = await db.collection("trips").where("date", ">=", from).where("date", "<=", to).get();
  const trips = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
    .filter((tr) => !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(tr.status))
    .filter((tr) => (branchFilter ? (tr.branches || []).includes(branchFilter) : true))
    .filter((tr) => tripPerm.view(caller, tr.branches || [], tr) || tripPerm.approve(caller, tr.branches || []));

  const branchOf = await branchResolver();
  // Same roster as the trip itself: students marked inactive (no longer in
  // the imported file) are not targeted.
  const students = (await db.collection("students").get()).docs.map((d) => d.data()).filter((s) => s.nationalId && s.active !== false);
  const blank = () => ({ trips: 0, targeted: 0, responses: 0, approved: 0, declined: 0, confirmed: 0, boarded: 0, expected: 0, collected: 0, surveys: 0, ratingSum: 0, recommend: 0 });
  const byBranch = {};
  const byGrade = {};
  const declineReasons = {};
  const byMethod = {};
  const byCollector = {};
  const payments = [];
  const rows = [];
  // Branch / grade comparisons count each student once, however many trips
  // they were invited to (the branch total is its students in the roster).
  const distinct = { byBranch: {}, byGrade: {} };
  const mark = (kind, key, field, id) => {
    if (!key || !id) return;
    const d = (distinct[kind][key] = distinct[kind][key] || { students: new Set(), studentsConfirmed: new Set() });
    d[field].add(String(id));
  };
  for (const tr of trips) {
    const inBranch = (b) => !branchFilter || b === branchFilter;
    const roster = students.filter((s) => tripTargets(tr, s, branchOf) && inBranch(branchOf(s)));
    const [enrollSnap, surveySnap] = await Promise.all([tr.ref.collection("enrollments").get(), tr.ref.collection("surveys").get()]);
    const enrollments = enrollSnap.docs.map((d) => d.data()).filter((e) => inBranch(e.branch));
    const surveys = surveySnap.docs.map((d) => d.data()).filter((x) => inBranch(x.branch));
    const row = { id: tr.id, tripCode: tr.tripCode, title: tr.title, destination: tr.destination, date: tr.date, status: tr.status, branches: tr.branches || [], stages: tr.stages || [], fee: tr.fee || 0, ...blank(), trips: 1 };
    const touched = new Set();
    const add = (map, key, field, n = 1) => {
      if (!key) return;
      map[key] = map[key] || blank();
      map[key][field] += n;
    };
    roster.forEach((s) => {
      row.targeted++;
      add(byBranch, branchOf(s), "targeted");
      add(byGrade, studentGrade(s), "targeted");
      mark("byBranch", branchOf(s), "students", s.nationalId);
      mark("byGrade", studentGrade(s), "students", s.nationalId);
      touched.add(branchOf(s));
    });
    enrollments.forEach((e) => {
      const st = enrollmentStatus(e, tr.fee);
      const inc = (field, n = 1) => { row[field] += n; add(byBranch, e.branch, field, n); add(byGrade, e.grade, field, n); };
      inc("responses");
      if (e.decision === "APPROVED") { inc("approved"); inc("expected", tr.fee || 0); }
      if (st === "DECLINED") {
        inc("declined");
        const reason = e.declineReason || "UNSPECIFIED";
        declineReasons[reason] = (declineReasons[reason] || 0) + 1;
      }
      if (st === "CONFIRMED") {
        inc("confirmed");
        mark("byBranch", e.branch, "studentsConfirmed", e.studentId);
        mark("byGrade", e.grade, "studentsConfirmed", e.studentId);
      }
      if (e.boarded === true) inc("boarded");
      if (e.payStatus === "PAID") {
        const amount = Number(e.paidAmount ?? tr.fee) || 0;
        inc("collected", amount);
        const method = e.collectMethod || (e.payMethod === "BANK" ? "TRANSFER" : e.payMethod === "RECEPTION" ? "CASH" : "OTHER");
        const collector = e.collectorName || (method === "TRANSFER" ? "" : e.reviewedByName || "");
        byMethod[method] = byMethod[method] || { count: 0, amount: 0 };
        byMethod[method].count++; byMethod[method].amount += amount;
        if (collector) {
          byCollector[collector] = byCollector[collector] || { count: 0, amount: 0 };
          byCollector[collector].count++; byCollector[collector].amount += amount;
        }
        payments.push({
          tripCode: tr.tripCode, tripTitle: tr.title, tripDate: tr.date, studentId: e.studentId || "", studentName: e.studentName || "", branch: e.branch || "",
          grade: e.grade || "", amount, method, collector, confirmedBy: e.reviewedByName || "", ref: e.cashReceiptNo || "",
          at: e.reviewedAt?.toMillis?.() || null,
        });
      }
      touched.add(e.branch);
    });
    surveys.forEach((x) => {
      row.surveys++; row.ratingSum += x.average; row.recommend += x.recommend ? 1 : 0;
      add(byBranch, x.branch, "surveys"); add(byBranch, x.branch, "ratingSum", x.average); add(byBranch, x.branch, "recommend", x.recommend ? 1 : 0);
    });
    row.ratings = Object.fromEntries(TRIP_RATINGS.map((k) => [k, surveys.length ? Math.round((surveys.reduce((a, x) => a + x.ratings[k], 0) / surveys.length) * 100) / 100 : null]));
    row.pendingReceipts = enrollments.filter((e) => enrollmentStatus(e, tr.fee) === "RECEIPT_REVIEW").length;
    row.rejectedReceipts = enrollments.filter((e) => enrollmentStatus(e, tr.fee) === "RECEIPT_REJECTED").length;
    row.awaitingPayment = enrollments.filter((e) => enrollmentStatus(e, tr.fee) === "AWAITING_PAYMENT").length;
    touched.forEach((b) => add(byBranch, b, "trips"));
    rows.push(row);
  }
  for (const [kind, map] of [["byBranch", byBranch], ["byGrade", byGrade]]) {
    Object.entries(distinct[kind]).forEach(([key, d]) => {
      map[key] = map[key] || blank();
      map[key].students = d.students.size;
      map[key].studentsConfirmed = d.studentsConfirmed.size;
    });
  }
  students.forEach((s) => {
    const b = branchOf(s);
    if (byBranch[b]) byBranch[b].rosterTotal = (byBranch[b].rosterTotal || 0) + 1;
  });
  const strip = ({ ref, ...rest }) => rest;
  payments.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { trips: rows.map(strip), byBranch, byGrade, declineReasons, byMethod, byCollector, payments };
});

// --- Student record ----------------------------------------------------------
exports.getStudentTrips = onCall(async (request) => {
  const caller = await tripCaller(request);
  const studentId = normalizeDigits(request.data?.studentId);
  if (!studentId) return { trips: [] };
  const snap = await db.collectionGroup("enrollments").where("studentId", "==", studentId).get();
  const out = [];
  for (const d of snap.docs) {
    const tripRef = d.ref.parent.parent;
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) continue;
    const trip = tripSnap.data();
    if (!(callerAll(caller) || (trip.branches || []).some((b) => callerHasBranch(caller, b)))) continue;
    const e = d.data();
    const survey = await tripRef.collection("surveys").doc(studentId).get();
    out.push({
      tripId: tripRef.id, tripCode: trip.tripCode, title: trip.title, destination: trip.destination, date: trip.date, tripStatus: trip.status,
      status: enrollmentStatus(e, trip.fee), declineReason: e.declineReason || null, boarded: e.boarded ?? null, returned: e.returned ?? null,
      healthNotes: e.healthNotes || "",
      incidents: (e.incidents || []).map((x) => ({ note: x.note, byName: x.byName, at: x.at?.toMillis?.() || null })),
      surveyAverage: survey.exists ? survey.data().average : null,
      ...(request.data?.full ? {
        fee: trip.fee || 0, departTime: trip.departTime || "", returnTime: trip.returnTime || "", meetingPoint: trip.meetingPoint || "", payDeadline: trip.payDeadline || "",
        decision: e.decision || null, source: e.source || "parent", recordedByName: e.recordedByName || "", submittedAt: (e.submittedAt || e.updatedAt)?.toMillis?.() || null,
        payMethod: e.payMethod || null, payStatus: e.payStatus || null, paidAmount: e.paidAmount ?? null, collectMethod: e.collectMethod || null,
        collectorName: e.collectorName || "", confirmedBy: e.reviewedByName || "", confirmedAt: e.reviewedAt?.toMillis?.() || null, ref: e.cashReceiptNo || "",
        receiptUrl: e.receipt?.fileUrl || "", payRejectReason: e.payRejectReason || "", invoiceNo: e.invoiceNo || "",
        parentPhone: e.parentPhone || "", emergencyPhone: e.emergencyPhone || "", pledgeUrl: e.pledge?.fileUrl || "",
      } : {}),
    });
  }
  // Coming trips aimed at the student that have no reply yet.
  if (request.data?.full) {
    const st = (await db.collection("students").doc(studentId).get()).data();
    if (st) {
      const branchOf = await branchResolver();
      const upcoming = await db.collection("trips").where("date", ">=", riyadhDay()).get();
      upcoming.docs.forEach((t) => {
        const trip = t.data();
        if (!["OPEN", "CLOSED"].includes(trip.status) || out.some((o) => o.tripId === t.id)) return;
        if (!(callerAll(caller) || (trip.branches || []).some((b) => callerHasBranch(caller, b)))) return;
        if (!tripTargets(trip, st, branchOf)) return;
        out.push({ tripId: t.id, tripCode: trip.tripCode, title: trip.title, destination: trip.destination, date: trip.date, tripStatus: trip.status, status: "NO_RESPONSE",
          fee: trip.fee || 0, departTime: trip.departTime || "", returnTime: trip.returnTime || "", meetingPoint: trip.meetingPoint || "", payDeadline: trip.payDeadline || "", incidents: [] });
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { trips: out };
});

// --- System owner ------------------------------------------------------------
// Marks the caller as the system owner when their sign-in email is the one
// configured in SYSTEM_OWNER_EMAIL — the only way isOwner is ever set
// (firestore.rules never lets a client write it).
exports.claimSystemOwner = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const ownerEmail = String(process.env.SYSTEM_OWNER_EMAIL || "").trim().toLowerCase();
  const email = String(request.auth.token.email || "").trim().toLowerCase();
  if (!ownerEmail || email !== ownerEmail) throw new HttpsError("permission-denied", "غير مصرح.");
  const ref = db.collection("users").doc(request.auth.uid);
  let snap = await ref.get();
  // First run of a new installation: the owner account was created in
  // Firebase Authentication only — create its profile here.
  if (!snap.exists) {
    await ref.set({
      name: request.auth.token.name || email.split("@")[0], email, role: "ADMIN", access: "all", branches: [],
      active: true, createdAt: Timestamp.now(), createdBy: request.auth.uid,
    });
    snap = await ref.get();
  }
  const others = await db.collection("users").where("isOwner", "==", true).get();
  const batch = db.batch();
  others.docs.filter((d) => d.id !== ref.id).forEach((d) => batch.update(d.ref, { isOwner: FieldValue.delete() }));
  batch.update(ref, {
    isOwner: true,
    role: "ADMIN",
    access: "all",
    active: true,
    tripsAccess: "all",
    perms: { edit: true, delete: true, users: true, trips: true, tripFinance: true },
  });
  await batch.commit();
  await auth.setCustomUserClaims(request.auth.uid, { ...(snap.data().claims || {}), role: "ADMIN" });
  return { ok: true };
});

// --- Settings password ---------------------------------------------------------
// The owner may protect the Settings page with a password. The hash lives in
// secureConfig/settingsLock (never readable by clients); settings/security
// only says whether the lock is on. Entering the password writes
// settingsUnlocks/<uid> with an expiry, which firestore.rules checks on every
// write to the settings collections.
const SETTINGS_UNLOCK_MINUTES = 60;
const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString("hex");
async function verifySettingsPassword(password) {
  const snap = await db.collection("secureConfig").doc("settingsLock").get();
  if (!snap.exists) return true;
  const { salt, hash } = snap.data();
  const candidate = Buffer.from(hashPassword(password || "", salt), "hex");
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
async function adminCaller(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  const u = snap.data();
  if (!snap.exists || u.active === false || u.role !== "ADMIN") throw new HttpsError("permission-denied", "هذا الإجراء متاح لمدير النظام فقط.");
  return { uid: request.auth.uid, ...u };
}

exports.setSettingsPassword = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "تغيير كلمة سر الإعدادات متاح لمنشئ النظام فقط.");
  const { current, next } = request.data || {};
  const lockSnap = await db.collection("settings").doc("security").get();
  if (lockSnap.exists && lockSnap.data().lockEnabled && !(await verifySettingsPassword(current))) {
    throw new HttpsError("permission-denied", "كلمة السر الحالية غير صحيحة.");
  }
  const now = Timestamp.now();
  if (!next) {
    await db.collection("secureConfig").doc("settingsLock").delete();
    await db.collection("settings").doc("security").set({ lockEnabled: false, updatedAt: now, updatedByName: caller.name || "" }, { merge: true });
    return { lockEnabled: false };
  }
  if (typeof next !== "string" || next.length < 6) throw new HttpsError("invalid-argument", "يجب ألا تقل كلمة السر عن 6 أحرف.");
  const salt = crypto.randomBytes(16).toString("hex");
  await db.collection("secureConfig").doc("settingsLock").set({ salt, hash: hashPassword(next, salt), updatedAt: now });
  await db.collection("settings").doc("security").set({ lockEnabled: true, updatedAt: now, updatedByName: caller.name || "" }, { merge: true });
  // Changing the password ends every open unlock except the owner's own.
  const unlocks = await db.collection("settingsUnlocks").get();
  const batch = db.batch();
  unlocks.docs.filter((d) => d.id !== caller.uid).forEach((d) => batch.delete(d.ref));
  batch.set(db.collection("settingsUnlocks").doc(caller.uid), { expiresAt: Timestamp.fromMillis(Date.now() + SETTINGS_UNLOCK_MINUTES * 60000) });
  await batch.commit();
  return { lockEnabled: true };
});

exports.unlockSettings = onCall(async (request) => {
  const caller = await adminCaller(request);
  const caps = await loadAdminCaps();
  if (!callerCan(caller, "settings", caps)) throw new HttpsError("permission-denied", "لا تملك صلاحية الدخول إلى الإعدادات.");
  const guardRef = db.collection("secureConfig").doc(`unlockAttempts_${caller.uid}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 15 * 60000;
  if (recent && (guard.failures || 0) >= 5) throw new HttpsError("resource-exhausted", "محاولات كثيرة خاطئة، حاول بعد 15 دقيقة.");
  if (!(await verifySettingsPassword(request.data?.password))) {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("permission-denied", "كلمة السر غير صحيحة.");
  }
  if (guard.failures) await guardRef.delete();
  const expiresAt = Timestamp.fromMillis(Date.now() + SETTINGS_UNLOCK_MINUTES * 60000);
  await db.collection("settingsUnlocks").doc(caller.uid).set({ expiresAt });
  return { expiresAt: expiresAt.toMillis() };
});

// --- Trip password ---------------------------------------------------------
// The owner may require a password to edit or cancel a trip; everyone except
// the owner enters it. The hash lives in secureConfig/tripLock and
// settings/security.tripLockEnabled says whether it is on.
async function checkTripPassword(caller, password) {
  if (caller.isOwner === true) return;
  const flag = await db.collection("settings").doc("security").get();
  if (!flag.exists || flag.data().tripLockEnabled !== true) return;
  const guardRef = db.collection("secureConfig").doc(`tripAttempts_${caller.uid}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 15 * 60000;
  if (recent && (guard.failures || 0) >= 5) throw new HttpsError("resource-exhausted", "محاولات كثيرة خاطئة، حاول بعد 15 دقيقة.");
  const snap = await db.collection("secureConfig").doc("tripLock").get();
  let ok = !snap.exists;
  if (snap.exists) {
    const { salt, hash } = snap.data();
    const candidate = Buffer.from(hashPassword(password || "", salt), "hex");
    const stored = Buffer.from(hash, "hex");
    ok = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  }
  if (!ok) {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("permission-denied", "الرقم السري للرحلات غير صحيح.");
  }
  if (guard.failures) await guardRef.delete();
}

exports.setTripPassword = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "تغيير الرقم السري للرحلات متاح لمنشئ النظام فقط.");
  const next = request.data?.next;
  const now = Timestamp.now();
  if (!next) {
    await db.collection("secureConfig").doc("tripLock").delete();
    await db.collection("settings").doc("security").set({ tripLockEnabled: false, updatedAt: now }, { merge: true });
    return { tripLockEnabled: false };
  }
  if (typeof next !== "string" || next.length < 4) throw new HttpsError("invalid-argument", "يجب ألا يقل الرقم السري عن 4 خانات.");
  const salt = crypto.randomBytes(16).toString("hex");
  await db.collection("secureConfig").doc("tripLock").set({ salt, hash: hashPassword(next, salt), updatedAt: now });
  await db.collection("settings").doc("security").set({ tripLockEnabled: true, updatedAt: now }, { merge: true });
  return { tripLockEnabled: true };
});

// Checks the password before the trip form opens (saveTrip checks it again).
exports.verifyTripPassword = onCall(async (request) => {
  const caller = await tripCaller(request);
  await checkTripPassword(caller, request.data?.password);
  return { ok: true };
});

// --- Trip accounts ------------------------------------------------------------
// Costs, profit and margin of each trip. Open to the owner, system admins and
// staff given perms.tripAccounts, and only after the trip-accounts password
// (secureConfig/tripAccountsLock, set by the owner) is entered: that writes
// secureConfig/tripAccountsUnlock_<uid> with an expiry, checked on every call.
// Costs live in tripAccounts/<tripId>, which clients can't read.
const TRIP_ACCOUNTS_UNLOCK_MINUTES = 60;
const TRIP_COST_KINDS = ["TRIP", "STUDENT"]; // a lump sum / per participating student
const tripAccountsAllowed = (u) => u.isOwner === true || u.role === "ADMIN" || u.perms?.tripAccounts === true;
async function tripAccountsCaller(request, unlocked = true) {
  const caller = await tripCaller(request);
  if (!tripAccountsAllowed(caller)) throw new HttpsError("permission-denied", "حسابات الرحلات غير متاحة لحسابك.");
  if (unlocked) {
    const snap = await db.collection("secureConfig").doc(`tripAccountsUnlock_${caller.uid}`).get();
    if (!snap.exists || snap.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "انتهت جلسة حسابات الرحلات، أدخل الرقم السري مرة أخرى.");
    }
  }
  return caller;
}

exports.tripAccountsStatus = onCall(async (request) => {
  const caller = await tripAccountsCaller(request, false);
  const [lock, unlock] = await Promise.all([
    db.collection("secureConfig").doc("tripAccountsLock").get(),
    db.collection("secureConfig").doc(`tripAccountsUnlock_${caller.uid}`).get(),
  ]);
  const until = unlock.exists ? unlock.data().expiresAt.toMillis() : 0;
  return { passwordSet: lock.exists, unlockedUntil: until > Date.now() ? until : null, isOwner: caller.isOwner === true };
});

exports.setTripAccountsPassword = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "تغيير الرقم السري لحسابات الرحلات متاح لمنشئ النظام فقط.");
  const next = request.data?.next;
  if (typeof next !== "string" || next.length < 4) throw new HttpsError("invalid-argument", "يجب ألا يقل الرقم السري عن 4 خانات.");
  const salt = crypto.randomBytes(16).toString("hex");
  await db.collection("secureConfig").doc("tripAccountsLock").set({ salt, hash: hashPassword(next, salt), updatedAt: Timestamp.now() });
  // A new password ends every open session except the owner's own.
  const open = await db.collection("secureConfig").where(FieldPath.documentId(), ">=", "tripAccountsUnlock_").where(FieldPath.documentId(), "<", "tripAccountsUnlock`").get();
  const batch = db.batch();
  open.docs.forEach((d) => batch.delete(d.ref));
  const expiresAt = Timestamp.fromMillis(Date.now() + TRIP_ACCOUNTS_UNLOCK_MINUTES * 60000);
  batch.set(db.collection("secureConfig").doc(`tripAccountsUnlock_${caller.uid}`), { expiresAt });
  await batch.commit();
  return { unlockedUntil: expiresAt.toMillis() };
});

exports.unlockTripAccounts = onCall(async (request) => {
  const caller = await tripAccountsCaller(request, false);
  const lock = await db.collection("secureConfig").doc("tripAccountsLock").get();
  if (!lock.exists) throw new HttpsError("failed-precondition", "لم يحدد منشئ النظام الرقم السري لحسابات الرحلات بعد.");
  const guardRef = db.collection("secureConfig").doc(`tripAccountsAttempts_${caller.uid}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 15 * 60000;
  if (recent && (guard.failures || 0) >= 5) throw new HttpsError("resource-exhausted", "محاولات كثيرة خاطئة، حاول بعد 15 دقيقة.");
  const { salt, hash } = lock.data();
  const candidate = Buffer.from(hashPassword(request.data?.password || "", salt), "hex");
  const stored = Buffer.from(hash, "hex");
  if (!(candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored))) {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("permission-denied", "الرقم السري لحسابات الرحلات غير صحيح.");
  }
  if (guard.failures) await guardRef.delete();
  const expiresAt = Timestamp.fromMillis(Date.now() + TRIP_ACCOUNTS_UNLOCK_MINUTES * 60000);
  await db.collection("secureConfig").doc(`tripAccountsUnlock_${caller.uid}`).set({ expiresAt });
  return { unlockedUntil: expiresAt.toMillis() };
});

exports.lockTripAccounts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  await db.collection("secureConfig").doc(`tripAccountsUnlock_${request.auth.uid}`).delete();
  return { ok: true };
});

// Trips between two days (not drafts or cancelled) in the caller's branches,
// with their figures (trip.stats) and saved costs.
exports.getTripAccounts = onCall(async (request) => {
  const caller = await tripAccountsCaller(request);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const from = day(request.data?.from) || "0000-01-01";
  const to = day(request.data?.to) || "9999-12-31";
  const snap = await db.collection("trips").where("date", ">=", from).where("date", "<=", to).get();
  const trips = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((tr) => !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(tr.status))
    .filter((tr) => callerAll(caller) || (tr.branches || []).some((b) => callerHasBranch(caller, b)));
  const costs = trips.length ? await db.getAll(...trips.map((tr) => db.collection("tripAccounts").doc(tr.id))) : [];
  return {
    trips: trips.map((tr, i) => {
      const c = costs[i].exists ? costs[i].data() : {};
      const s = tr.stats || {};
      return {
        id: tr.id, tripCode: tr.tripCode, title: tr.title, destination: tr.destination || "", date: tr.date, status: tr.status,
        branches: tr.branches || [], stages: tr.stages || [], fee: Number(tr.fee) || 0, targeted: tr.targetedCount ?? null,
        approved: s.approved || 0, confirmed: s.confirmed || 0, boarded: s.boarded || 0, collected: s.collected || 0,
        items: c.items || [], notes: c.notes || "", costsUpdatedAt: c.updatedAt?.toMillis?.() || null, costsUpdatedBy: c.updatedByName || "",
      };
    }),
  };
});

exports.saveTripCosts = onCall(async (request) => {
  const caller = await tripAccountsCaller(request);
  const { ref, trip } = await loadTrip(request.data?.tripId, null, null);
  if (!(callerAll(caller) || (trip.branches || []).some((b) => callerHasBranch(caller, b)))) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية على هذه الرحلة.");
  }
  const raw = Array.isArray(request.data?.items) ? request.data.items : [];
  if (raw.length > 30) throw new HttpsError("invalid-argument", "عدد بنود التكلفة كبير جداً.");
  const items = raw.map((x) => ({
    label: String(x?.label || "").trim().slice(0, 80),
    kind: TRIP_COST_KINDS.includes(x?.kind) ? x.kind : "TRIP",
    amount: Math.round((Number(x?.amount) || 0) * 100) / 100,
  })).filter((x) => x.label && x.amount > 0);
  const notes = String(request.data?.notes || "").trim().slice(0, 1000);
  await db.collection("tripAccounts").doc(ref.id).set({ items, notes, updatedAt: Timestamp.now(), updatedBy: caller.uid, updatedByName: caller.name || "" });
  await tripLog(ref, "costsUpdated", caller, { items: items.length });
  return { items, notes };
});

exports.lockSettings = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  await db.collection("settingsUnlocks").doc(request.auth.uid).delete();
  return { ok: true };
});

// --- Lost & found backlog -------------------------------------------------
// Assigns every existing lost & found report to its branch's quality
// officers and counselors, without notifications. Runs once on deploy
// (marker in meta/migrations) and again for a user whenever they become a
// quality officer / counselor or their branches change.
async function assignLostFoundBacklog(onlyUser) {
  const users = await loadActiveUsers();
  const snap = await db.collection("lostFoundItems").get();
  let added = 0;
  for (const doc of snap.docs) {
    const item = doc.data();
    let officers = lostFoundOfficers(users, item.branch);
    if (onlyUser) officers = officers.filter((u) => u.id === onlyUser);
    if (officers.length) added += await addLostFoundAssignees(doc.ref, item, officers, true);
  }
  return added;
}

// Open (unresolved) complaints → their branch's counselors, silently.
async function assignComplaintCounselorBacklog(onlyUser) {
  const users = await loadActiveUsers();
  const snap = await db.collection("complaints").where("status", "in", OPEN_STATUSES).get();
  let added = 0;
  for (const doc of snap.docs) {
    const c = doc.data();
    let list = complaintCounselors(users, c.branch, c.stage, c.department);
    if (onlyUser) list = list.filter((u) => u.id === onlyUser);
    const current = c.assignedTo || [];
    const missing = list.filter((u) => !current.includes(u.id));
    if (!missing.length) continue;
    await doc.ref.update({
      assignedTo: [...current, ...missing.map((u) => u.id)],
      assignedToNames: [...(c.assignedToNames || []), ...missing.map((u) => u.name || "")],
      ...(current.length ? {} : { assignedAt: Timestamp.now() }),
      silentAssignAt: Timestamp.now(),
    });
    added += missing.length;
  }
  return added;
}

exports.lostFoundBacklogOnce = onSchedule("every 30 minutes", async () => {
  const markerRef = db.collection("meta").doc("migrations");
  const marker = await markerRef.get();
  const m = marker.exists ? marker.data() : {};
  if (!m.lostFoundOfficersBackfill) {
    const added = await assignLostFoundBacklog(null);
    await markerRef.set({ lostFoundOfficersBackfill: Timestamp.now(), lostFoundOfficersBackfillCount: added }, { merge: true });
    console.log(`lost & found officers backfill: ${added} assignments added.`);
  }
  if (!m.complaintCounselorsBackfill) {
    const added = await assignComplaintCounselorBacklog(null);
    await markerRef.set({ complaintCounselorsBackfill: Timestamp.now(), complaintCounselorsBackfillCount: added }, { merge: true });
    console.log(`complaint counselors backfill: ${added} assignments added.`);
  }
});

exports.onUserLostFoundRole = onDocumentWritten("users/{uid}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.active === false) return;
  const isOfficer = (u) => u.isQuality === true || u.isCounselor === true;
  if (!isOfficer(after)) return;
  const scope = (u) => `${u.access || ""}|${(u.branches || []).join(",")}|${u.branch || ""}`;
  const limits = (u) => `${(u.stages || []).join(",")}|${(u.curricula || []).join(",")}`;
  if (isOfficer(before) && scope(before) === scope(after) && before.isCounselor === after.isCounselor && limits(before) === limits(after)) return;
  const added = await assignLostFoundBacklog(event.params.uid);
  console.log(`lost & found: ${added} old reports assigned to ${event.params.uid}`);
  // Counselors also take over the open complaints of their branches.
  if (after.isCounselor === true && (before.isCounselor !== true || scope(before) !== scope(after) || limits(before) !== limits(after))) {
    const n = await assignComplaintCounselorBacklog(event.params.uid);
    console.log(`complaints: ${n} open complaints assigned to counselor ${event.params.uid}`);
  }
});

// --- Reminders -------------------------------------------------------------
// A staff member nudges the people assigned to an unresolved complaint, tech
// ticket or lost & found report. They get a notification naming the sender
// (plus push / email per their preferences); the record's activity log keeps
// it. One reminder per record every 10 minutes.
const REMINDER_KINDS = {
  complaint: { collection: "complaints", idField: "complaintId", open: OPEN_STATUSES, type: "REMINDER", label: "الملاحظة", title: (r) => r.subject || r.studentName || "" },
  techSupport: { collection: "techSupportTickets", idField: "ticketId", open: OPEN_TICKET_STATUSES, type: "IT_REMINDER", label: "البلاغ التقني", title: (r) => r.studentName || "" },
  lostFound: { collection: "lostFoundItems", idField: "itemCode", open: OPEN_LOST_FOUND_STATUSES, type: "LF_REMINDER", label: "بلاغ المفقودات", title: (r) => r.itemName || "" },
};
exports.sendRecordReminder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { kind, docId } = request.data || {};
  const note = String(request.data?.note || "").trim().slice(0, 300);
  const cfg = REMINDER_KINDS[kind];
  if (!cfg || typeof docId !== "string" || !docId) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const callerSnap = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerSnap.data();
  if (!callerSnap.exists || caller.active === false || caller.role === "RECEPTIONIST" || (caller.role !== "ADMIN" && caller.tripsAccess === "tripsOnly")) {
    throw new HttpsError("permission-denied", "لا تملك صلاحية إرسال التذكير.");
  }
  const ref = db.collection(cfg.collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على السجل.");
  const record = snap.data();
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch || (record.assignedTo || []).includes(request.auth.uid);
  const canTech = caller.role === "ADMIN" || caller.department === "IT" || caller.role === "CUSTOMER_SERVICE" || caller.isPrincipal === true || caller.isQuality === true;
  if (!inScope || (kind === "techSupport" && !canTech)) throw new HttpsError("permission-denied", "لا تملك صلاحية إرسال التذكير لهذا السجل.");
  if (!cfg.open.includes(record.status)) throw new HttpsError("failed-precondition", "هذا السجل مغلق أو تم حله.");
  const recipients = (record.assignedTo || []).filter((uid) => uid !== request.auth.uid);
  if (!recipients.length) throw new HttpsError("failed-precondition", "لا يوجد مسند إليهم لإرسال التذكير.");
  if (record.lastReminderAt && Date.now() - record.lastReminderAt.toMillis() < 10 * 60000) {
    throw new HttpsError("resource-exhausted", `أُرسل تذكير قبل قليل (${record.lastReminderByName || ""}). حاول بعد 10 دقائق.`);
  }

  const senderName = caller.name || "مستخدم";
  const number = record[cfg.idField] || "";
  const subject = cfg.title(record);
  await notifyUsers(recipients, {
    title: `تذكير من ${senderName}`,
    body: `${senderName} يذكّرك بـ${cfg.label} رقم ${number}${subject ? ` (${subject})` : ""}${note ? `: ${note}` : " — يرجى المتابعة والحل."}`,
    complaintId: docId,
    type: cfg.type,
  });
  const now = Timestamp.now();
  await ref.update({ lastReminderAt: now, lastReminderBy: request.auth.uid, lastReminderByName: senderName, reminderCount: FieldValue.increment(1) });
  await ref.collection("activityLog").add({
    action: "REMINDER_SENT",
    actorId: request.auth.uid,
    actorName: senderName,
    metadata: { note, toUserIds: recipients, toUserNames: (record.assignedToNames || []).filter((_, i) => recipients.includes((record.assignedTo || [])[i])) },
    createdAt: now,
  });
  return { sent: recipients.length };
});

// --- Walk-in visit not met: book a meeting appointment -----------------------
// From the branch visits page: the parent who came without an appointment
// couldn't be met, so reception (or the staff member) books a confirmed
// slot on the same record. The visit is marked NOT_MET, the slot is
// reserved like any appointment and the parent gets the usual WhatsApp
// confirmation; on the day they check in with "I have an appointment".
exports.bookMeetingFromVisit = onCall({ secrets: WA_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { complaintDocId, slot } = request.data || {};
  const note = String(request.data?.note || "").trim().slice(0, 300);
  // Set when the staff member declines the walk-in meeting and books the
  // new time themselves (VisitDeclineDialog).
  const reason = String(request.data?.reason || "").trim().slice(0, 300);
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("complaints").doc(String(complaintDocId || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الزيارة.");
  const record = snap.data();
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  const allowed = caller.role === "RECEPTIONIST" ? inScope : canManageAppointment(caller, record, request.auth.uid) || (inScope && caller.isQuality === true) || (record.assignedTo || []).includes(request.auth.uid);
  if (!allowed) throw new HttpsError("permission-denied", "لا تملك صلاحية حجز موعد لهذه الزيارة.");
  if (!record.viaVisitQr || record.visitStatus !== "WAITING") throw new HttpsError("failed-precondition", "هذه الزيارة ليست بانتظار المقابلة.");

  const reserved = await reserveAppointment({
    branch: record.branch, startMs: Number(slot), complaintDocId: ref.id, complaintId: record.complaintId,
    cancelId: record.appointment && ACTIVE_APPT.includes(record.appointment.status) ? record.appointment.id : undefined,
  });
  await db.collection("appointments").doc(reserved.id).update({ status: "CONFIRMED" });
  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const when = formatRiyadh(reserved.start.toMillis());
  const appointment = { ...reserved, status: "CONFIRMED", fromVisit: true, decidedAt: now, decidedBy: request.auth.uid, decidedByName: actorName };
  await ref.update({
    appointment,
    visitStatus: "NOT_MET", visitNotMetAt: now, visitNotMetByName: actorName, visitNotMetMode: "STAFF_BOOKED",
    ...(reason ? { visitDeclineReason: reason } : {}),
    hasInternalComment: true, updatedAt: now,
    ...(record.status === "RECEIVED" ? { status: "IN_PROGRESS" } : {}),
  });
  const logs = ref.collection("activityLog");
  await logs.add({ action: "APPOINTMENT_CONFIRMED", actorId: request.auth.uid, actorName, metadata: { when, fromVisit: true }, createdAt: now });
  await logs.add({
    action: "INTERNAL_COMMENT_ADDED", actorId: request.auth.uid, actorName,
    metadata: { comment: `${reason ? `🙏 اعتذر ${actorName} عن مقابلة ولي الأمر أثناء زيارته للفرع: ${reason}\n` : "⏳ لم تتم مقابلة ولي الأمر أثناء زيارته للفرع، و"}${reason ? "و" : ""}حُجز له موعد مقابلة: ${when}.${note ? `\n${note}` : ""}`, visit: true },
    createdAt: now,
  });
  // The internal comment above already notifies the assignees.
  await autoSendWa("complaint", ref, "appointmentConfirmed");
  return { ok: true, when };
});

// The staff member declines the walk-in meeting and asks the parent to
// pick a new meeting time themselves: the visit is marked NOT_MET
// (PARENT_BOOKS) with the reason, logged as an internal comment, and the
// booking link (the branch QR page opened on "book an appointment") is
// returned so the caller can send it to the parent on WhatsApp.
exports.declineVisitMeeting = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { complaintDocId } = request.data || {};
  const reason = String(request.data?.reason || "").trim().slice(0, 300);
  if (!reason) throw new HttpsError("invalid-argument", "يرجى كتابة سبب الاعتذار.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const caller = callerDoc.data();
  if (!callerDoc.exists || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("complaints").doc(String(complaintDocId || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الزيارة.");
  const record = snap.data();
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(record.branch) || caller.branch === record.branch;
  const allowed = caller.role === "RECEPTIONIST" ? inScope : canManageAppointment(caller, record, request.auth.uid) || (inScope && caller.isQuality === true) || (record.assignedTo || []).includes(request.auth.uid);
  if (!allowed) throw new HttpsError("permission-denied", "لا تملك صلاحية الاعتذار عن هذه الزيارة.");
  if (!record.viaVisitQr || record.visitStatus !== "WAITING") throw new HttpsError("failed-precondition", "هذه الزيارة ليست بانتظار المقابلة.");
  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const bookLink = `${PUBLIC_APP_URL}/visit?branch=${encodeURIComponent(record.branch || "")}&mode=book`;
  await ref.update({
    visitStatus: "NOT_MET", visitNotMetAt: now, visitNotMetByName: actorName, visitNotMetMode: "PARENT_BOOKS", visitDeclineReason: reason,
    hasInternalComment: true, updatedAt: now,
    ...(record.status === "RECEIVED" ? { status: "IN_PROGRESS" } : {}),
  });
  await ref.collection("activityLog").add({
    action: "INTERNAL_COMMENT_ADDED", actorId: request.auth.uid, actorName,
    metadata: { comment: `🙏 اعتذر ${actorName} عن مقابلة ولي الأمر أثناء زيارته للفرع: ${reason}\nوطُلب من ولي الأمر اختيار موعد مقابلة جديد عبر رابط الحجز.`, visit: true },
    createdAt: now,
  });
  return { ok: true, bookLink };
});

// Trip cover image (shown on the trip page, the poster and — with the
// image template — the WhatsApp announcement) and the pledge sheet template
// parents download, sign and attach. `file: null` removes it.
exports.setTripMedia = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { id, kind, file } = request.data || {};
  if (!["image", "pledgeTemplate"].includes(kind)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const { ref } = await loadTrip(id, caller, "manage");
  if (!file) {
    await ref.update({ [kind === "image" ? "imageUrl" : "pledgeTemplate"]: FieldValue.delete(), updatedAt: Timestamp.now() });
    return { ok: true };
  }
  if (kind === "image" && !/^image\//.test(file.mimeType || "")) throw new HttpsError("invalid-argument", "الصورة يجب أن تكون بصيغة صورة.");
  const uploaded = await uploadPublicAttachment(getStorage().bucket(), `trips/${ref.id}/${kind}`, file);
  await ref.update(kind === "image" ? { imageUrl: uploaded.fileUrl, updatedAt: Timestamp.now() } : { pledgeTemplate: uploaded, updatedAt: Timestamp.now() });
  await tripLog(ref, kind === "image" ? "TRIP_IMAGE_SET" : "TRIP_PLEDGE_SET", caller, { fileName: uploaded.fileName });
  return { ok: true, fileUrl: uploaded.fileUrl };
});

// ===========================================================================
// منصة المكتشف — leave permissions, new-customer (enrollment) follow-up and
// current students. Visible to the system owner and the users the owner
// shares it with (users.platformAccess, set by the owner only): firestore.rules
// restrict every platform collection to them, and the staff callables below
// check it too. The public endpoints (parent leave request, inquiry
// form) only create records; they never return platform data.
// ===========================================================================
// The owner, or a user the owner shared the platform with (users.platformAccess).
const hasPlatform = (u) => u.isOwner === true || (u.platformAccess === true && u.active !== false);
async function ownerCaller(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  if (!snap.exists || !hasPlatform(snap.data())) throw new HttpsError("permission-denied", "منصة المكتشف متاحة لمن يحددهم منشئ النظام فقط.");
  return { uid: request.auth.uid, ...snap.data() };
}
// Who is notified of platform events: the owner and the users with access.
async function platformOwners() {
  const [owners, shared] = await Promise.all([
    db.collection("users").where("isOwner", "==", true).get(),
    db.collection("users").where("platformAccess", "==", true).get(),
  ]);
  return [...new Set([...owners.docs, ...shared.docs].filter((d) => hasPlatform(d.data())).map((d) => d.id))];
}
async function loadPlatformSettings() {
  const snap = await db.collection("platformSettings").doc("main").get();
  return snap.exists ? snap.data() : {};
}
async function newCode(collection, field, prefix) {
  const year = riyadhDay().slice(0, 4);
  for (let i = 0; i < 8; i++) {
    const code = `${prefix}-${year}-${crypto.randomInt(10000, 100000)}`;
    const dup = await db.collection(collection).where(field, "==", code).limit(1).get();
    if (dup.empty) return code;
  }
  throw new HttpsError("internal", "تعذّر إنشاء رقم، حاول مرة أخرى.");
}

// Parent identity for public platform pages: student national ID + last 4
// digits of the mobile registered for that student; failures are counted
// per student to stop guessing.
async function verifyStudentParent(scope, studentIdRaw, last4Raw) {
  const studentId = normalizeDigits(studentIdRaw);
  const last4 = normalizeDigits(last4Raw);
  if (!/^\d{5,15}$/.test(studentId) || !/^\d{4}$/.test(last4)) {
    throw new HttpsError("invalid-argument", "أدخل رقم هوية الطالب وآخر 4 أرقام من الجوال.");
  }
  const guardRef = db.collection("tripVerify").doc(`${scope}_${studentId}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 3600 * 1000;
  if (recent && (guard.failures || 0) >= 8) throw new HttpsError("resource-exhausted", "محاولات كثيرة، حاول بعد ساعة أو تواصل مع الفرع.");
  const fail = async (message) => {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("not-found", message);
  };
  const snap = await db.collection("students").doc(studentId).get();
  if (!snap.exists) return fail("لم يتم العثور على الطالب/ة. تأكد من رقم الهوية.");
  const s = snap.data();
  const mobile = normalizeDigits(s.mobile).replace(/\D/g, "");
  if (!mobile || mobile.slice(-4) !== last4) return fail("البيانات غير مطابقة لسجل الطالب. تأكد من آخر 4 أرقام من جوال ولي الأمر المسجل في المدرسة.");
  if (guard.failures) await guardRef.delete();
  const branchOf = await branchResolver();
  return { studentId, student: s, branch: branchOf(s), grade: studentGrade(s), section: studentSection(s) };
}

// --- Leave permissions (الاستئذان) ------------------------------------------
// The parent asks through /leave, follows the request there (its path,
// cancel, change the time, «جهّزوا الطالب», «وصلت للاستلام») and can't
// open a second one while one is active. A new receiver comes with an ID
// photo and is saved to the student's authorized pickups. Staff act by
// role (users.leaveRoles: approve / call / exit, in their branches; the
// platform users hold every role).
const LEAVE_REASONS = ["MEDICAL", "ILLNESS", "FAMILY", "OFFICIAL", "OTHER"];
const LEAVE_ACTIVE = ["PENDING", "APPROVED", "CALLED"];
const LEAVE_ROLES = ["approve", "call", "exit"];
const PARENT_LEAVE = "ولي الأمر (رابط الاستئذان)";

function leaveCan(u, role, branch) {
  if (!u || u.active === false) return false;
  if (hasPlatform(u)) return true;
  return u.leaveRoles?.[role] === true && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch);
}
// Staff holding a leave role in a branch (platform users are told of new
// requests separately, as before).
async function leaveStaff(branch, roles) {
  const users = await loadActiveUsers();
  return users.filter((u) => !hasPlatform(u) && roles.some((r) => leaveCan(u, r, branch))).map((u) => u.id);
}
const leaveMs = (v) => v?.toMillis?.() || null;
function leaveTrack(x) {
  return {
    code: x.code, status: x.status, type: x.type, reason: x.reason, note: x.note || "", requestedAt: leaveMs(x.requestedAt), createdAt: leaveMs(x.createdAt),
    pickup: { name: x.pickup?.name || "", relation: x.pickup?.relation || "", authorized: x.pickup?.authorized === true },
    approvedAt: leaveMs(x.approvedAt), calledAt: leaveMs(x.calledAt), exitAt: leaveMs(x.exitAt), returnAt: leaveMs(x.returnAt),
    cancelledAt: leaveMs(x.cancelledAt), rejectReason: x.rejectReason || "", receiverName: x.receiver?.name || "",
    parentPrepareAt: leaveMs(x.parentPrepareAt), parentArrivedAt: leaveMs(x.parentArrivedAt), rescheduled: (x.history || []).some((h) => h.action === "RESCHEDULED"),
  };
}
async function activeLeave(studentId) {
  const snap = await db.collection("leaveRequests").where("studentId", "==", studentId).where("status", "in", LEAVE_ACTIVE).get();
  return snap.docs.sort((a, b) => leaveMs(b.data().createdAt) - leaveMs(a.data().createdAt))[0] || null;
}
function leaveTime(raw) {
  const v = Number(raw);
  if (!(v > Date.now() - 3600e3 && v < Date.now() + 14 * 86400e3)) throw new HttpsError("invalid-argument", "اختر وقت خروج صحيحاً.");
  return v;
}
async function uploadLeaveImage(studentId, att) {
  if (!att) return null;
  if (!/^image\//.test(att.mimeType || "") && att.mimeType !== "application/pdf") throw new HttpsError("invalid-argument", "أرفق صورة الهوية (صورة أو PDF).");
  return uploadPublicAttachment(getStorage().bucket(), `authorizedPickups/${studentId}`, att);
}

exports.getLeaveContext = onCall(async (request) => {
  const v = await verifyStudentParent("leave", request.data?.studentId, request.data?.last4);
  const [pickups, active, recentSnap] = await Promise.all([
    db.collection("authorizedPickups").where("studentId", "==", v.studentId).where("active", "==", true).get(),
    activeLeave(v.studentId),
    db.collection("leaveRequests").where("studentId", "==", v.studentId).where("createdAt", ">=", Timestamp.fromMillis(Date.now() - 86400e3)).get(),
  ]);
  const recent = recentSnap.docs.map((d) => d.data()).filter((x) => !LEAVE_ACTIVE.includes(x.status)).sort((a, b) => leaveMs(b.createdAt) - leaveMs(a.createdAt))[0];
  return {
    studentName: v.student.nameAr || v.student.name || "", grade: v.grade, className: v.student.className || "",
    pickups: pickups.docs.map((d) => ({ id: d.id, name: d.data().name, relation: d.data().relation, hasIdImage: !!d.data().idImage?.fileUrl })),
    active: active ? leaveTrack(active.data()) : null,
    recent: recent ? leaveTrack(recent) : null,
  };
});

exports.submitLeaveRequest = onCall(async (request) => {
  const d = request.data || {};
  const v = await verifyStudentParent("leave", d.studentId, d.last4);
  const reason = LEAVE_REASONS.includes(d.reason) ? d.reason : null;
  if (!reason) throw new HttpsError("invalid-argument", "اختر سبب الاستئذان.");
  const requestedMs = leaveTime(d.requestedAt);
  const open = await activeLeave(v.studentId);
  if (open) throw new HttpsError("already-exists", `يوجد طلب استئذان حالي للطالب/ة (${open.data().code}). يمكنكم متابعته أو تعديله أو إلغاؤه من رابط تقديم الطلب نفسه.`);
  const now = Timestamp.now();
  let pickup;
  if (typeof d.pickupId === "string" && d.pickupId) {
    const pRef = db.collection("authorizedPickups").doc(d.pickupId);
    const p = (await pRef.get()).data();
    if (!p || p.studentId !== v.studentId || p.active !== true) throw new HttpsError("invalid-argument", "المستلم غير موجود في قائمة المفوّضين.");
    let idImage = p.idImage || null;
    if (!idImage && d.idImage) {
      idImage = await uploadLeaveImage(v.studentId, d.idImage);
      await pRef.update({ idImage, updatedAt: now });
    }
    pickup = { authorizedId: pRef.id, name: p.name, relation: p.relation, nationalId: p.nationalId || "", phone: p.phone || "", authorized: true, idImageUrl: idImage?.fileUrl || "" };
  } else {
    const name = str(d.pickupName, 80);
    const nationalId = normalizeDigits(d.pickupNationalId).replace(/\D/g, "").slice(0, 15);
    if (!name) throw new HttpsError("invalid-argument", "اكتب اسم من سيستلم الطالب.");
    if (!/^\d{10}$/.test(nationalId)) throw new HttpsError("invalid-argument", "أدخل رقم هوية المستلم (10 أرقام).");
    if (!d.idImage) throw new HttpsError("invalid-argument", "أرفق صورة هوية المستلم.");
    const relation = str(d.pickupRelation, 40);
    const phone = str(normalizeDigits(d.pickupPhone), 20);
    // Same ID already on the list (perhaps hidden): reuse and re-activate it.
    const same = await db.collection("authorizedPickups").where("studentId", "==", v.studentId).where("nationalId", "==", nationalId).limit(1).get();
    const idImage = await uploadLeaveImage(v.studentId, d.idImage);
    let pRef;
    if (!same.empty) {
      pRef = same.docs[0].ref;
      await pRef.update({ name, relation, ...(phone ? { phone } : {}), idImage, active: true, updatedAt: now });
    } else {
      pRef = await db.collection("authorizedPickups").add({
        studentId: v.studentId, branch: v.branch, name, relation, nationalId, phone, idImage, active: true,
        source: "PARENT_LEAVE", createdByName: PARENT_LEAVE, createdAt: now, updatedAt: now,
      });
    }
    pickup = { authorizedId: pRef.id, name, relation, nationalId, phone, authorized: true, addedByParent: true, idImageUrl: idImage.fileUrl };
  }
  let attachment = null;
  if (d.attachment) attachment = await uploadPublicAttachment(getStorage().bucket(), `leaveRequests/${v.studentId}`, d.attachment);
  const code = await newCode("leaveRequests", "code", "LV");
  const doc = {
    code, studentId: v.studentId, studentName: v.student.nameAr || v.student.name || "", branch: v.branch, grade: v.grade, className: v.student.className || "", section: v.section,
    parentPhone: v.student.mobile || "", reason, note: str(d.note, 300), type: d.type === "TEMPORARY" ? "TEMPORARY" : "FULL",
    requestedAt: Timestamp.fromMillis(requestedMs), pickup, attachment, source: "PARENT", status: "PENDING",
    history: [{ action: "REQUESTED", at: now, byName: PARENT_LEAVE }], createdAt: now, updatedAt: now,
  };
  const ref = await db.collection("leaveRequests").add(doc);
  await notifyUsers([...(await platformOwners()), ...(await leaveStaff(v.branch, ["approve"]))], {
    title: "طلب استئذان جديد", body: `${doc.studentName} — ${formatRiyadh(requestedMs)} — المستلم: ${pickup.name}${pickup.addedByParent ? " (مفوّض جديد من ولي الأمر)" : ""}`, complaintId: ref.id, type: "LEAVE_REQUESTED",
  });
  return { code, track: leaveTrack(doc) };
});

// The parent's actions on the active request, from the same link.
const PARENT_LEAVE_ACTIONS = {
  cancel: { from: LEAVE_ACTIVE, log: "CANCELLED" },
  reschedule: { from: ["PENDING", "APPROVED"], log: "RESCHEDULED" },
  prepare: { from: ["APPROVED", "CALLED"], log: "PARENT_PREPARE" },
  arrived: { from: ["APPROVED", "CALLED"], log: "PARENT_ARRIVED" },
};
exports.parentLeaveAction = onCall(async (request) => {
  const d = request.data || {};
  const v = await verifyStudentParent("leave", d.studentId, d.last4);
  const step = PARENT_LEAVE_ACTIONS[d.action];
  if (!step) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const snap = await activeLeave(v.studentId);
  if (!snap) throw new HttpsError("not-found", "لا يوجد طلب استئذان حالي.");
  const x = snap.data();
  if (!step.from.includes(x.status)) {
    throw new HttpsError("failed-precondition", d.action === "reschedule" ? "لا يمكن تعديل الوقت بعد استدعاء الطالب، تواصلوا مع الفرع." : "يتاح هذا الإجراء بعد الموافقة على الطلب.");
  }
  const now = Timestamp.now();
  const stamp = { prepare: "parentPrepareAt", arrived: "parentArrivedAt" }[d.action];
  if (stamp && x[stamp] && Date.now() - x[stamp].toMillis() < 2 * 60e3) throw new HttpsError("resource-exhausted", "تم إرسال الإشعار قبل قليل.");
  const update = { updatedAt: now };
  const entry = { action: step.log, at: now, byName: PARENT_LEAVE };
  if (d.action === "cancel") Object.assign(update, { status: "CANCELLED", cancelledAt: now, cancelledByName: PARENT_LEAVE });
  if (d.action === "reschedule") {
    const at = leaveTime(d.requestedAt);
    // A changed time goes back for approval.
    Object.assign(update, { requestedAt: Timestamp.fromMillis(at), status: "PENDING", approvedAt: null, approvedByName: null });
    entry.note = `${formatRiyadh(x.requestedAt.toMillis())} ← ${formatRiyadh(at)}`;
  }
  if (stamp) update[stamp] = now;
  update.history = FieldValue.arrayUnion(entry);
  await snap.ref.update(update);
  const who = `${x.studentName} (${x.code})`;
  const note = {
    cancel: { roles: LEAVE_ROLES, title: "ألغى ولي الأمر طلب الاستئذان", body: who, type: "LEAVE_CANCELLED" },
    reschedule: { roles: ["approve"], title: "تعديل وقت الاستئذان — بانتظار الموافقة", body: `${who}: ${entry.note}`, type: "LEAVE_RESCHEDULED" },
    prepare: { roles: ["call"], title: "جهّزوا الطالب — ولي الأمر في الطريق", body: `${who} — المستلم: ${x.pickup?.name || ""}`, type: "LEAVE_PREPARE" },
    arrived: { roles: ["call", "exit"], title: "وصل المستلم لاستلام الطالب", body: `${who} — المستلم: ${x.pickup?.name || ""}`, type: "LEAVE_ARRIVED" },
  }[d.action];
  await notifyUsers([...(await platformOwners()), ...(await leaveStaff(x.branch, note.roles))], { title: note.title, body: note.body, complaintId: snap.id, type: note.type });
  return { track: leaveTrack({ ...x, ...update, history: [...(x.history || []), entry] }) };
});

// Staff steps, each checked against the caller's leave roles in the branch.
const STAFF_LEAVE_ACTIONS = {
  approve: { role: "approve", from: ["PENDING"], to: "APPROVED" },
  reject: { role: "approve", from: ["PENDING"], to: "REJECTED" },
  call: { role: "call", from: ["APPROVED"], to: "CALLED" },
  exit: { role: "exit", from: ["APPROVED", "CALLED"], to: "EXITED" },
  return: { role: "exit", from: ["EXITED"], to: "RETURNED" },
  cancel: { role: "approve", from: LEAVE_ACTIVE, to: "CANCELLED" },
};
exports.leaveAction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const d = request.data || {};
  const step = STAFF_LEAVE_ACTIONS[d.action];
  if (!step) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  const ref = db.collection("leaveRequests").doc(String(d.id || ""));
  const x = (await ref.get()).data();
  if (!x) throw new HttpsError("not-found", "لم يتم العثور على الطلب.");
  if (!leaveCan(caller, step.role, x.branch)) throw new HttpsError("permission-denied", "هذا الإجراء ليس من صلاحياتك في الاستئذانات.");
  if (!step.from.includes(x.status)) throw new HttpsError("failed-precondition", "حالة الطلب تغيّرت، حدّث الصفحة.");
  const now = Timestamp.now();
  const byName = caller.name || "";
  const reason = str(d.reason, 300);
  if (d.action === "reject" && !reason) throw new HttpsError("invalid-argument", "اكتب سبب الرفض.");
  const update = { status: step.to, updatedAt: now };
  if (d.action === "approve") Object.assign(update, { approvedAt: now, approvedByName: byName });
  if (d.action === "reject") update.rejectReason = reason;
  if (d.action === "call") Object.assign(update, { calledAt: now, calledByName: byName });
  if (d.action === "return") update.returnAt = now;
  if (d.action === "cancel") Object.assign(update, { cancelledAt: now, cancelledByName: byName });
  if (d.action === "exit") {
    const receiverName = str(d.receiverName, 80);
    if (!receiverName) throw new HttpsError("invalid-argument", "اكتب اسم المستلم.");
    const authorized = x.pickup?.authorized === true;
    if (!authorized && d.parentConfirmed !== true) throw new HttpsError("failed-precondition", "أكّد موافقة ولي الأمر على المستلم.");
    Object.assign(update, { exitAt: now, exitByName: byName, receiver: { name: receiverName, nationalId: str(normalizeDigits(d.receiverId), 15), authorized, parentConfirmed: !authorized } });
  }
  update.history = FieldValue.arrayUnion({ action: step.to, at: now, byName, byId: request.auth.uid, ...(reason ? { note: reason } : {}) });
  await ref.update(update);
  const who = `${x.studentName} (${x.code})`;
  if (d.action === "approve") {
    await notifyUsers(await leaveStaff(x.branch, ["call"]), { title: "استئذان معتمد — استدعاء الطالب", body: `${who} — ${formatRiyadh(x.requestedAt.toMillis())}`, complaintId: ref.id, type: "LEAVE_APPROVED" });
  }
  if (d.action === "call") {
    await notifyUsers(await leaveStaff(x.branch, ["exit"]), { title: "الطالب في الاستقبال — جاهز للتسليم", body: `${who} — المستلم: ${x.pickup?.name || ""}`, complaintId: ref.id, type: "LEAVE_CALLED" });
  }
  return { ok: true, status: step.to };
});

// Deleting a leave request (approval holders in the branch, platform users):
// it moves to deletedLeaveRequests with who, when and why.
exports.deleteLeaveRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const reason = str(request.data?.reason, 300);
  if (!reason) throw new HttpsError("invalid-argument", "اكتب سبب الحذف.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  const ref = db.collection("leaveRequests").doc(String(request.data?.id || ""));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "لم يتم العثور على الطلب.");
  if (!leaveCan(caller, "approve", snap.data().branch)) throw new HttpsError("permission-denied", "حذف الطلبات لمن لديه صلاحية الموافقة على الاستئذانات.");
  const now = Timestamp.now();
  await db.collection("deletedLeaveRequests").doc(snap.id).set({ ...snap.data(), deletedAt: now, deletedBy: request.auth.uid, deletedByName: caller.name || "", deleteReason: reason });
  await ref.delete();
  return { ok: true };
});

// --- New customers / enrollment follow-up (العملاء الجدد) --------------------
const LEAD_SOURCES = ["CALL_CENTER", "WHATSAPP", "WALK_IN", "WEBSITE", "CAMPAIGN", "REFERRAL", "OTHER"];
const normalizePhone = (p) => toIntlNumber(p);

// Public inquiry form (/join): website, campaigns, branch QR, referral link.
// One file per parent phone — a repeat inquiry is added to the existing file.
// Opens (or finds, by phone) a new-customer file from a public form.
async function upsertLeadFromPublic(d, label) {
  const parentName = str(d.parentName, 80);
  const phone = normalizePhone(d.phone);
  if (!parentName || !/^9665\d{8}$/.test(phone)) throw new HttpsError("invalid-argument", "أدخل الاسم ورقم جوال سعودي صحيحاً.");
  const students = (Array.isArray(d.students) ? d.students : []).slice(0, 6).map((s) => ({
    name: str(s.name, 80), gender: s.gender === "F" ? "F" : s.gender === "M" ? "M" : "", birthDate: /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate || "") ? s.birthDate : "",
    grade: str(s.grade, 10), curriculum: str(s.curriculum, 30), currentSchool: str(s.currentSchool, 80),
  })).filter((s) => s.name || s.grade);
  if (!students.length) throw new HttpsError("invalid-argument", "أضف بيانات طالب واحد على الأقل.");
  const source = LEAD_SOURCES.includes(d.source) ? d.source : "WEBSITE";
  const now = Timestamp.now();
  const existing = await db.collection("leads").where("phone", "==", phone).limit(1).get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.collection("activity").add({ type: "INQUIRY_AGAIN", text: `${label} (${students.map((s) => s.name || s.grade).join("، ")})`, byName: "ولي الأمر (نموذج إلكتروني)", at: now });
    await ref.update({ updatedAt: now, lastInboundAt: now });
    return { ref, code: existing.docs[0].data().code, existing: true, lead: existing.docs[0].data(), students, parentName, phone };
  }
  const code = await newCode("leads", "code", "LD");
  const ref = await db.collection("leads").add({
    code, parentName, phone, altPhone: normalizePhone(d.altPhone) || "", district: str(d.district, 60), preferredContact: str(d.preferredContact, 20),
    students, branch: str(d.branch, 40), suggestedBranch: "", source, campaign: str(d.campaign, 60), referrer: str(d.ref, 60),
    stage: "INQUIRY", sideStatus: null, sideReason: "", interest: "", assignedTo: null, assignedToName: "",
    nextFollowUp: Timestamp.fromMillis(Date.now() + 24 * 3600e3), stageEnteredAt: now, noAnswerCount: 0,
    createdAt: now, updatedAt: now, lastInboundAt: now, firstResponseAt: null,
  });
  await ref.collection("activity").add({ type: "CREATED", text: `فتح الملف — ${label}`, byName: "ولي الأمر (نموذج إلكتروني)", at: now });
  await notifyUsers(await platformOwners(), { title: "عميل محتمل جديد", body: `${parentName} — ${students.map((s) => s.grade).filter(Boolean).join("، ")}`, complaintId: ref.id, type: "LEAD_NEW" });
  return { ref, code, existing: false, lead: { stage: "INQUIRY" }, students, parentName, phone };
}

exports.submitLeadInquiry = onCall(async (request) => {
  const { code, existing } = await upsertLeadFromPublic(request.data || {}, "استفسار من النموذج الإلكتروني");
  return existing ? { code, existing: true } : { code };
});

// --- School visit request link (/school-visit) -------------------------------
// A prospective family asks to visit for a new registration: the new-customer
// file is opened (or found by phone), a visit slot is reserved in the same
// pool as the parents' visit appointments, and a pending leadVisits entry is
// created. The branch principal confirms it or moves it from «زيارات
// الفروع» (decideVisitRequest), which messages the parent.
const studentsSummary = (students) => students.map((s) => [s.name, s.grade].filter(Boolean).join(" ")).join("، ");
exports.submitNewStudentVisit = onCall({ secrets: WA_SECRETS }, async (request) => {
  const d = request.data || {};
  const branch = str(d.branch, 40);
  const branchSnap = branch ? await db.collection("branches").doc(branch).get() : null;
  if (!branchSnap?.exists) throw new HttpsError("invalid-argument", "يرجى اختيار الفرع.");
  const visitType = ["VISIT", "VISIT_TOUR"].includes(d.visitType) ? d.visitType : "VISIT_TOUR";
  const lead = await upsertLeadFromPublic({ ...d, branch, source: d.source || "WEBSITE", preferredContact: "VISIT" }, "طلب زيارة مدرسية من الرابط");
  const pending = await db.collection("leadVisits").where("leadId", "==", lead.ref.id).get();
  const active = pending.docs.map((x) => x.data()).find((v) => ["REQUESTED", "SCHEDULED", "CONFIRMED"].includes(v.status) && v.at?.toMillis() > Date.now());
  if (active) throw new HttpsError("already-exists", `لديكم طلب زيارة قائم: ${formatRiyadh(active.at.toMillis())}. للتعديل تواصلوا مع الفرع.`);
  const students = studentsSummary(lead.students);
  const reserved = await reserveAppointment({
    branch, startMs: Number(d.slot), complaintDocId: null, complaintId: null,
    extra: { kind: "NEW_STUDENT", leadId: lead.ref.id, leadCode: lead.code, parentName: lead.parentName, phone: lead.phone, students, visitType },
  });
  const now = Timestamp.now();
  const visitRef = await db.collection("leadVisits").add({
    type: visitType, at: reserved.start, dayKey: new Date(reserved.start.toMillis() + APPT_TZ_MS).toISOString().slice(0, 10), branch, host: "",
    notes: str(d.notes, 300), leadId: lead.ref.id, leadCode: lead.code, parentName: lead.parentName, phone: lead.phone, students,
    assignedToName: "", status: "REQUESTED", appointmentId: reserved.id, source: "PUBLIC_LINK", reminderCount: 0,
    createdAt: now, createdByName: "ولي الأمر (رابط طلب الزيارة)", updatedAt: now,
  });
  await db.collection("appointments").doc(reserved.id).update({ leadVisitId: visitRef.id });
  const when = formatRiyadh(reserved.start.toMillis());
  await lead.ref.update({
    visitAt: reserved.start, nextVisitId: visitRef.id, updatedAt: now,
    ...(["INQUIRY", "QUALIFIED"].includes(lead.lead?.stage) ? { stage: "VISIT_BOOKED", stageEnteredAt: now } : {}),
  });
  await lead.ref.collection("activity").add({ type: "VISIT", text: `طلب زيارة مدرسية من الرابط: ${when} (بانتظار تأكيد الفرع)`, byName: "ولي الأمر (رابط طلب الزيارة)", at: now });
  const users = await loadActiveUsers();
  const principals = users.filter((u) => u.isPrincipal === true && (u.access === "all" || (u.branches || []).includes(branch) || u.branch === branch)).map((u) => u.id);
  await notifyUsers([...new Set([...principals, ...(await platformOwners())])], {
    title: "طلب زيارة لتسجيل طالب جديد",
    body: `${lead.parentName} — ${students} — ${when}. يرجى التأكيد من «زيارات الفروع».`,
    complaintId: visitRef.id, type: "VISIT_REQUESTED",
  });
  return { code: lead.code, when };
});

// The principal (or staff with edit permission in the branch) confirms a new
// registration visit, moves it to another free slot, cancels it, or records
// whether the family came.
exports.decideVisitRequest = onCall({ secrets: WA_SECRETS }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { appointmentId, action, slot } = request.data || {};
  const reason = str(request.data?.reason, 300);
  if (!["confirm", "reschedule", "cancel", "attended", "noShow"].includes(action)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  if (!caller || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const apptRef = db.collection("appointments").doc(String(appointmentId || ""));
  const appt = (await apptRef.get()).data();
  if (!appt || appt.kind !== "NEW_STUDENT") throw new HttpsError("not-found", "لم يتم العثور على طلب الزيارة.");
  const inBranch = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(appt.branch) || caller.branch === appt.branch;
  const marking = action === "attended" || action === "noShow";
  if (!canManageAppointment(caller, { branch: appt.branch, assignedTo: [] }, request.auth.uid) && !(marking && inBranch && (caller.role === "RECEPTIONIST" || caller.isQuality === true))) {
    throw new HttpsError("permission-denied", "تأكيد الزيارات لمدير الفرع أو من لديه صلاحية التعديل.");
  }
  const visitRef = db.collection("leadVisits").doc(appt.leadVisitId || "_");
  const visit = (await visitRef.get()).data();
  if (!visit) throw new HttpsError("not-found", "لم يتم العثور على الزيارة.");
  const leadRef = db.collection("leads").doc(appt.leadId);
  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  const log = (text) => leadRef.collection("activity").add({ type: "VISIT", text, byName: actorName, byId: request.auth.uid, at: now });

  if (action === "cancel") {
    await apptRef.update({ status: "CANCELLED", cancelledAt: now });
    await visitRef.update({ status: "CANCELLED", cancelReason: reason, updatedAt: now });
    await log(`أُلغي طلب الزيارة${reason ? `: ${reason}` : ""}`);
    return { ok: true };
  }
  if (action === "attended" || action === "noShow") {
    await apptRef.update({ status: action === "attended" ? "CHECKED_IN" : "NO_SHOW" });
    await visitRef.update({ status: action === "attended" ? "ATTENDED" : "NO_SHOW", updatedAt: now });
    if (action === "attended") await leadRef.update({ stage: "VISITED", stageEnteredAt: now, updatedAt: now }).catch(() => {});
    await log(action === "attended" ? "حضرت الأسرة الزيارة" : "لم تحضر الأسرة الزيارة");
    return { ok: true };
  }
  let start = appt.start;
  let id = apptRef.id;
  if (action === "reschedule") {
    const { leadVisitId, kind, leadId, leadCode, parentName, phone, students, visitType } = appt;
    const reserved = await reserveAppointment({ branch: appt.branch, startMs: Number(slot), complaintDocId: null, complaintId: null, cancelId: apptRef.id, extra: { leadVisitId, kind, leadId, leadCode, parentName, phone, students, visitType } });
    start = reserved.start;
    id = reserved.id;
  }
  await db.collection("appointments").doc(id).update({ status: "CONFIRMED", decidedBy: request.auth.uid, decidedByName: actorName, decidedAt: now });
  await visitRef.update({
    status: "CONFIRMED", at: start, dayKey: new Date(start.toMillis() + APPT_TZ_MS).toISOString().slice(0, 10), appointmentId: id,
    confirmedByName: actorName, updatedAt: now, ...(action === "reschedule" ? { previousAt: visit.at, rescheduledCount: FieldValue.increment(1) } : {}),
  });
  await leadRef.update({ visitAt: start, updatedAt: now }).catch(() => {});
  const when = formatRiyadh(start.toMillis());
  await log(`${action === "reschedule" ? "حُدد موعد بديل للزيارة" : "تم تأكيد موعد الزيارة"}: ${when}`);
  let sent = false;
  const cfg = await leadVisitWa();
  if (cfg) {
    try {
      const branchName = (await db.collection("branches").doc(appt.branch).get()).data()?.name || "المدرسة";
      await sendLeadVisitMessage(cfg, { ...visit, at: start, id: visitRef.id }, "confirm", branchName);
      await visitRef.update({ confirmationSentAt: Timestamp.now() });
      sent = true;
    } catch (err) {
      console.error("visit request confirm", err.message);
    }
  }
  return { ok: true, when, sent, phone: appt.phone || "" };
});

// --- Platform data for the owner's student record ----------------------------
// Everything about one current student across the system (complaints, tech,
// lost & found, trips, leaves, re-enrollment) for the 360° profile.
exports.getStudent360 = onCall(async (request) => {
  await ownerCaller(request);
  const studentId = normalizeDigits(request.data?.studentId);
  if (!studentId) throw new HttpsError("invalid-argument", "رقم الطالب مطلوب.");
  const [student, complaints, tickets, lost, enroll, leaves, pickups, reenroll, calls] = await Promise.all([
    db.collection("students").doc(studentId).get(),
    db.collection("complaints").where("studentId", "==", studentId).get(),
    db.collection("techSupportTickets").where("nationalId", "==", studentId).get(),
    db.collection("lostFoundItems").where("studentId", "==", studentId).get(),
    db.collectionGroup("enrollments").where("studentId", "==", studentId).get(),
    db.collection("leaveRequests").where("studentId", "==", studentId).get(),
    db.collection("authorizedPickups").where("studentId", "==", studentId).get(),
    db.collection("reenrollments").where("studentId", "==", studentId).get(),
    db.collection("callTasks").where("studentIds", "array-contains", studentId).get(),
  ]);
  const ms = (t) => t?.toMillis?.() || null;
  const tripDocs = await Promise.all(enroll.docs.map((d) => d.ref.parent.parent.get()));
  return {
    student: student.exists ? student.data() : null,
    complaints: complaints.docs.map((d) => ({ id: d.id, number: d.data().complaintId, subject: d.data().subject, status: d.data().status, type: d.data().complaintType, at: ms(d.data().createdAt), visit: !!d.data().viaVisitQr })),
    tickets: tickets.docs.map((d) => ({ id: d.id, number: d.data().ticketId, status: d.data().status, type: d.data().problemType, at: ms(d.data().createdAt) })),
    lostFound: lost.docs.map((d) => ({ id: d.id, number: d.data().itemCode, item: d.data().itemName, status: d.data().status, at: ms(d.data().createdAt) })),
    trips: enroll.docs.map((d, i) => ({ tripId: tripDocs[i].id, title: tripDocs[i].data()?.title || "", date: tripDocs[i].data()?.date || "", decision: d.data().decision, payStatus: d.data().payStatus || null, boarded: d.data().boarded ?? null })),
    leaves: leaves.docs.map((d) => ({ id: d.id, code: d.data().code, reason: d.data().reason, status: d.data().status, at: ms(d.data().requestedAt), pickup: d.data().pickup?.name || "" })),
    pickups: pickups.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ms(d.data().createdAt) })),
    reenrollments: reenroll.docs.map((d) => ({ id: d.id, ...d.data(), updatedAt: ms(d.data().updatedAt) })),
    // «سجل التواصل»: every call-campaign attempt to this student's parent.
    calls: calls.docs.flatMap((d) => (d.data().history || []).map((h) => ({
      campaign: d.data().campaignTitle, result: h.result, outcome: h.outcome || "", note: h.note || "", at: ms(h.at), byName: h.byName || "", verified: h.verified ?? null, talkSec: h.talkSec || 0,
    }))).sort((a, b) => (b.at || 0) - (a.at || 0)),
  };
});

// --- New customers: visit / school-tour appointments (leadVisits) ---------
// Owner-only like the rest of the platform. Reminders go through the
// WhatsApp API with the template named in platformSettings/main
// (leadVisitTemplate) — same shape as the other templates: five body
// variables ({{1}} parent, {{2}} visit type, {{3}} date and time,
// {{4}} the message, {{5}} branch contact link) plus the "contact the
// branch" URL button /contact/BR-<branch>.
const LEAD_VISIT_TYPES = { VISIT: "زيارة للمدرسة", TOUR: "جولة مدرسية", VISIT_TOUR: "زيارة وجولة مدرسية" };
const LEAD_VISIT_ACTIVE = ["SCHEDULED", "CONFIRMED"];
const LEAD_VISIT_LINES = {
  confirm: (v, branchName) => `تم تأكيد موعدكم في ${branchName}، ونسعد باستقبالكم${v.host ? `، وسيكون في استقبالكم ${v.host}` : ""}.`,
  reminder: (v, branchName) => `نذكّركم بموعدكم في ${branchName}، ونسعد باستقبالكم${v.host ? `، وسيكون في استقبالكم ${v.host}` : ""}. في حال رغبتكم بتغيير الموعد يرجى التواصل مع الفرع.`,
};

async function leadVisitWa() {
  if (!WA_API_ENABLED) return null;
  const [waSnap, ps] = await Promise.all([db.collection("settings").doc("whatsappApi").get(), loadPlatformSettings()]);
  const wa = waSnap.exists ? waSnap.data() : {};
  if (!wa.enabled || !String(ps.leadVisitTemplate || "").trim()) return null;
  return { language: wa.language || "ar", template: String(ps.leadVisitTemplate).trim(), ps };
}

async function sendLeadVisitMessage(cfg, v, kind, branchName) {
  const to = toIntlNumber(v.phone);
  if (!to) throw new Error("لا يوجد رقم جوال صحيح لولي الأمر.");
  const payload = {
    to,
    type: "template",
    template: { name: cfg.template, language: { code: cfg.language } },
    components: [
      {
        type: "body",
        parameters: [v.parentName, LEAD_VISIT_TYPES[v.type] || LEAD_VISIT_TYPES.VISIT, formatRiyadh(v.at.toMillis()), LEAD_VISIT_LINES[kind](v, branchName), `${PUBLIC_APP_URL}/contact/BR-${v.branch || ""}`]
          .map((x) => ({ type: "text", text: waParam(x) })),
      },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `BR-${v.branch || ""}` }] },
    ],
  };
  await taqnyatSend(payload, { kind: "leadVisit", event: kind, collection: "leadVisits", docId: v.id || null });
}

// Sends to each visit a few at a time, logs it on the visit and the lead's
// timeline; never throws.
async function remindLeadVisits(docs, kind, actorName, actorId, cfg, extra = {}) {
  const branchSnap = await db.collection("branches").get();
  const branchNames = new Map(branchSnap.docs.map((d) => [d.id, d.data().name || d.id]));
  let sent = 0;
  const errors = [];
  const queue = [...docs];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const v = d.data();
      try {
        await sendLeadVisitMessage(cfg, v, kind, branchNames.get(v.branch) || "المدرسة");
        const now = Timestamp.now();
        await d.ref.update({
          ...(kind === "reminder" ? { reminderCount: FieldValue.increment(1), lastReminderAt: now, lastReminderByName: actorName, lastReminderVia: "API" } : { confirmationSentAt: now }),
          ...extra,
          updatedAt: now,
        });
        if (v.leadId) {
          await db.collection("leads").doc(v.leadId).collection("activity").add({
            type: "WHATSAPP",
            text: `${kind === "reminder" ? "تذكير" : "تأكيد"} موعد ${LEAD_VISIT_TYPES[v.type] || ""} — ${formatRiyadh(v.at.toMillis())} (واتساب API)`,
            byName: actorName, byId: actorId || null, at: now,
          });
        }
        sent++;
      } catch (err) {
        errors.push({ id: d.id, parentName: v.parentName, message: err.message });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { sent, failed: errors.length, errors };
}

exports.sendLeadVisitReminders = onCall({ secrets: WA_SECRETS, timeoutSeconds: 300 }, async (request) => {
  const caller = await ownerCaller(request);
  const ids = Array.isArray(request.data?.ids) ? [...new Set(request.data.ids.filter((x) => typeof x === "string" && x))].slice(0, 100) : [];
  const kind = request.data?.kind === "confirm" ? "confirm" : "reminder";
  if (!ids.length) throw new HttpsError("invalid-argument", "لا توجد مواعيد محددة.");
  const cfg = await leadVisitWa();
  if (!cfg) throw new HttpsError("failed-precondition", "فعّل واتساب API وأضف اسم قالب «تذكير موعد زيارة» في إعدادات المنصة.");
  const snaps = await db.getAll(...ids.map((id) => db.collection("leadVisits").doc(id)));
  const due = snaps.filter((s) => s.exists && LEAD_VISIT_ACTIVE.includes(s.data().status));
  return remindLeadVisits(due, kind, caller.name || "منشئ النظام", caller.uid, cfg);
});

// Optional: every day at 17:00 Riyadh, remind tomorrow's visits
// (platformSettings/main.leadVisitAutoRemind).
exports.leadVisitAutoReminders = onSchedule({ schedule: "0 17 * * *", timeZone: "Asia/Riyadh", secrets: WA_SECRETS, timeoutSeconds: 540 }, async () => {
  const cfg = await leadVisitWa();
  if (!cfg || cfg.ps.leadVisitAutoRemind !== true) return;
  const day = riyadhDay(1);
  const snap = await db.collection("leadVisits").where("dayKey", "==", day).get();
  const due = snap.docs.filter((d) => LEAD_VISIT_ACTIVE.includes(d.data().status) && d.data().autoRemindedFor !== day);
  if (!due.length) return;
  const result = await remindLeadVisits(due, "reminder", "تذكير تلقائي", null, cfg, { autoRemindedFor: day });
  console.log("lead visit auto reminders", day, result.sent, result.failed);
});

// ===========================================================================
// MCP server (Model Context Protocol) — lets Claude read the CRM.
// Read-only tools over complaints, tech-support tickets, trips and summary
// counts. Each request carries an API key the owner creates in Settings
// (apiKeys/<id> keeps only its sha256), sent as "Authorization: Bearer <key>"
// or as the last URL segment (/mcp/<key>) for clients without custom headers.
// Parent phone numbers, emails and national IDs are never returned.
// Stateless Streamable HTTP: one JSON-RPC message per POST, JSON response.
// ===========================================================================
const MCP_PROTOCOL = "2025-06-18";
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

exports.createApiKey = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "مفاتيح الربط متاحة لمنشئ النظام فقط.");
  const name = str(request.data?.name, 60) || "Claude";
  const key = `mis_${crypto.randomBytes(24).toString("base64url")}`;
  const ref = await db.collection("apiKeys").add({
    name, hash: sha256(key), hint: `${key.slice(0, 8)}…${key.slice(-4)}`,
    createdAt: Timestamp.now(), createdBy: caller.uid, createdByName: caller.name || "", revoked: false,
  });
  // The key itself is shown once and never stored.
  return { id: ref.id, key };
});

exports.listApiKeys = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "مفاتيح الربط متاحة لمنشئ النظام فقط.");
  const snap = await db.collection("apiKeys").orderBy("createdAt", "desc").get();
  return {
    keys: snap.docs.map((d) => {
      const k = d.data();
      return { id: d.id, name: k.name, hint: k.hint, revoked: k.revoked === true, createdAt: k.createdAt?.toMillis() || null, lastUsedAt: k.lastUsedAt?.toMillis() || null, calls: k.calls || 0 };
    }),
  };
});

exports.revokeApiKey = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "مفاتيح الربط متاحة لمنشئ النظام فقط.");
  const id = String(request.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  await db.collection("apiKeys").doc(id).update({ revoked: true, revokedAt: Timestamp.now() });
  return { ok: true };
});

async function mcpKeyRef(req) {
  const header = String(req.get("authorization") || "");
  const fromHeader = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const fromPath = /\/(mis_[A-Za-z0-9_-]{20,})\/?$/.exec(req.path || "")?.[1];
  const key = fromHeader || fromPath;
  if (!key) return null;
  const snap = await db.collection("apiKeys").where("hash", "==", sha256(key)).limit(1).get();
  if (snap.empty || snap.docs[0].data().revoked === true) return null;
  return snap.docs[0].ref;
}

const mcpDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const mcpTs = (day, end) => Timestamp.fromDate(new Date(`${day}T${end ? "23:59:59" : "00:00:00"}+03:00`));
const mcpIso = (t) => (t?.toDate ? t.toDate().toISOString() : null);
const mcpLimit = (v, max = 100) => Math.min(max, Math.max(1, Math.floor(Number(v) || 25)));
const COMPLAINT_DONE = ["SOLVED", "CLOSED", "REJECTED"];
const TICKET_DONE = ["SOLVED", "WAITING_CONFIRMATION", "CLOSED"];

async function mcpNames() {
  const [branches, types] = await Promise.all([db.collection("branches").get(), db.collection("complaintTypes").get()]);
  const b = Object.fromEntries(branches.docs.map((d) => [d.id, d.data().name || d.id]));
  const ty = Object.fromEntries(types.docs.map((d) => [d.id, d.data().name || d.id]));
  return { branch: (id) => b[id] || id || "", type: (id) => ty[id] || id || "", branchIds: b };
}
// Records created in [from, to] (default: the last 30 days), newest first.
async function mcpRecent(collection, args, cap = 2000) {
  const to = mcpDay(args.to) || riyadhDay();
  const from = mcpDay(args.from) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const snap = await db.collection(collection).where("createdAt", ">=", mcpTs(from)).where("createdAt", "<=", mcpTs(to, true)).orderBy("createdAt", "desc").limit(cap).get();
  return { from, to, docs: snap.docs.map((d) => ({ _id: d.id, ...d.data() })) };
}
const countBy = (list, fn) => list.reduce((m, x) => { const k = fn(x) || "—"; m[k] = (m[k] || 0) + 1; return m; }, {});
// What a staff member may read (the in-app assistant); null = everything
// (the owner's MCP keys). Mirrors the Users-page sections and branches.
function mcpScopeOf(u) {
  if (!u || u.role === "ADMIN") return null;
  const mod = (key, dflt) => (typeof u.modules?.[key] === "boolean" ? u.modules[key] : dflt);
  return {
    branches: u.access === "all" ? null : (Array.isArray(u.branches) && u.branches.length ? u.branches : u.branch ? [u.branch] : []),
    assignedUid: u.recordScope === "assigned" ? u.uid : null,
    can: {
      complaints: u.tripsAccess !== "tripsOnly" && u.role !== "RECEPTIONIST" && mod("complaints", true),
      techSupport: u.tripsAccess !== "tripsOnly" && mod("techSupport", u.role === "CUSTOMER_SERVICE" || u.department === "IT" || u.isPrincipal === true || u.isQuality === true),
      trips: u.tripsAccess !== "none" && u.role !== "RECEPTIONIST",
    },
  };
}
const inScope = (scope) => (r) => !scope || ((!scope.branches || scope.branches.includes(r.branch)) && (!scope.assignedUid || (r.assignedTo || []).includes(scope.assignedUid)));
const NO_ACCESS = { error: "ليس لديك صلاحية الاطلاع على هذا القسم." };
const mcpBranchFilter = (names, branch) => {
  if (!branch) return () => true;
  const q = String(branch).trim();
  const id = names.branchIds[q] ? q : Object.keys(names.branchIds).find((k) => names.branchIds[k] === q || names.branchIds[k].replace(/^فرع\s+/, "") === q);
  return (r) => r.branch === (id || q);
};

function complaintOut(c, names, full) {
  return {
    number: c.complaintId, createdAt: mcpIso(c.createdAt), branch: names.branch(c.branch),
    type: names.type(c.complaintType), subType: c.subType || "", status: c.status, priority: c.priority || "",
    source: c.source || "", student: c.studentName || "", grade: c.grade || c.stage || "",
    subject: c.subject || "", details: full ? c.details || "" : String(c.details || "").slice(0, 400),
    assignees: c.assignedToNames || [], overdue: c.isOverdue === true && !COMPLAINT_DONE.includes(c.status),
    escalated: Boolean(c.wasEscalated || c.isOverdue || c.status === "ESCALATED"),
    solvedAt: mcpIso(c.solvedAt), dueDate: mcpIso(c.dueDate),
    ...(full ? { solution: c.solutionDetails || "", satisfaction: typeof c.satisfactionRate === "number" ? c.satisfactionRate : null, parentFeedback: c.parentFeedback || "" } : {}),
  };
}
function ticketOut(tk, names) {
  return {
    number: tk.ticketId, createdAt: mcpIso(tk.createdAt), branch: names.branch(tk.branch), status: tk.status,
    problemType: tk.problemType || "", platform: tk.platform || "", student: tk.studentName || "",
    description: String(tk.description || tk.details || "").slice(0, 400), assignees: tk.assignedToNames || [],
    overdue: tk.isOverdue === true && !TICKET_DONE.includes(tk.status), source: tk.source || "",
  };
}

const MCP_DATE_ARGS = {
  from: { type: "string", description: "Start day YYYY-MM-DD (default: 30 days ago)" },
  to: { type: "string", description: "End day YYYY-MM-DD (default: today, Riyadh)" },
  branch: { type: "string", description: "Branch name (e.g. «السلامة 1») or id; omit for all" },
};
const MCP_TOOLS = [
  {
    name: "crm_summary",
    description: "Counts for a period: parent feedback/complaints by status, branch and type (with overdue and escalated), tech-support tickets by status and branch, lost & found reports, average parent satisfaction.",
    inputSchema: { type: "object", properties: { ...MCP_DATE_ARGS } },
    run: async (args, scope) => {
      const names = await mcpNames();
      const inBranch = mcpBranchFilter(names, args.branch);
      const ok = (r) => inBranch(r) && inScope(scope)(r);
      const [c, t, lf] = await Promise.all([mcpRecent("complaints", args), mcpRecent("techSupportTickets", args), mcpRecent("lostFoundItems", args)]);
      const complaints = !scope || scope.can.complaints ? c.docs.filter(ok) : [];
      const tickets = !scope || scope.can.techSupport ? t.docs.filter(ok) : [];
      const rated = complaints.filter((x) => typeof x.satisfactionRate === "number");
      return {
        period: { from: c.from, to: c.to }, branch: args.branch || "all",
        complaints: {
          total: complaints.length,
          byStatus: countBy(complaints, (x) => x.status),
          byBranch: countBy(complaints, (x) => names.branch(x.branch)),
          byType: countBy(complaints, (x) => names.type(x.complaintType)),
          openOverdue: complaints.filter((x) => x.isOverdue === true && !COMPLAINT_DONE.includes(x.status)).length,
          escalated: complaints.filter((x) => x.wasEscalated || x.isOverdue || x.status === "ESCALATED").length,
          averageSatisfaction: rated.length ? Math.round((rated.reduce((s, x) => s + x.satisfactionRate, 0) / rated.length) * 100) / 100 : null,
          ratedCount: rated.length,
        },
        techTickets: { total: tickets.length, byStatus: countBy(tickets, (x) => x.status), byBranch: countBy(tickets, (x) => names.branch(x.branch)), openOverdue: tickets.filter((x) => x.isOverdue === true && !TICKET_DONE.includes(x.status)).length },
        lostAndFound: { total: lf.docs.filter(ok).length },
        ...(scope ? { visibleTo: "this user's branches and sections only" } : {}),
      };
    },
  },
  {
    name: "list_complaints",
    description: "Parent feedback / complaints (newest first) with number, branch, type, status, student, subject, a short description and assignees. Filters: period, branch, status, overdue/escalated.",
    inputSchema: {
      type: "object",
      properties: {
        ...MCP_DATE_ARGS,
        status: { type: "string", description: "RECEIVED, ASSIGNED, IN_PROGRESS, WAITING_PARENT_RESPONSE, ESCALATED, SOLVED, CLOSED, REJECTED" },
        overdueOnly: { type: "boolean", description: "Only open complaints past their deadline" },
        escalatedOnly: { type: "boolean" },
        limit: { type: "number", description: "1-100, default 25" },
      },
    },
    run: async (args, scope) => {
      if (scope && !scope.can.complaints) return NO_ACCESS;
      const names = await mcpNames();
      const inBranch = mcpBranchFilter(names, args.branch);
      const { from, to, docs } = await mcpRecent("complaints", args);
      const list = docs.filter(inBranch).filter(inScope(scope))
        .filter((x) => !args.status || x.status === args.status)
        .filter((x) => !args.overdueOnly || (x.isOverdue === true && !COMPLAINT_DONE.includes(x.status)))
        .filter((x) => !args.escalatedOnly || x.wasEscalated || x.isOverdue || x.status === "ESCALATED");
      return { period: { from, to }, matched: list.length, complaints: list.slice(0, mcpLimit(args.limit)).map((x) => complaintOut(x, names, false)) };
    },
  },
  {
    name: "get_complaint",
    description: "One complaint by its number (e.g. COM-2026-10023): full description, solution, parent rating and feedback.",
    inputSchema: { type: "object", properties: { number: { type: "string" } }, required: ["number"] },
    run: async (args, scope) => {
      if (scope && !scope.can.complaints) return NO_ACCESS;
      const names = await mcpNames();
      const snap = await db.collection("complaints").where("complaintId", "==", String(args.number || "").trim()).limit(1).get();
      if (snap.empty || !inScope(scope)(snap.docs[0].data())) return { error: "Not found" };
      return complaintOut(snap.docs[0].data(), names, true);
    },
  },
  {
    name: "list_tech_tickets",
    description: "Tech-support tickets (newest first): number, branch, status, problem type, platform, student, short description, assignees.",
    inputSchema: { type: "object", properties: { ...MCP_DATE_ARGS, status: { type: "string" }, overdueOnly: { type: "boolean" }, limit: { type: "number" } } },
    run: async (args, scope) => {
      if (scope && !scope.can.techSupport) return NO_ACCESS;
      const names = await mcpNames();
      const inBranch = mcpBranchFilter(names, args.branch);
      const { from, to, docs } = await mcpRecent("techSupportTickets", args);
      const list = docs.filter(inBranch).filter(inScope(scope)).filter((x) => !args.status || x.status === args.status)
        .filter((x) => !args.overdueOnly || (x.isOverdue === true && !TICKET_DONE.includes(x.status)));
      return { period: { from, to }, matched: list.length, tickets: list.slice(0, mcpLimit(args.limit)).map((x) => ticketOut(x, names)) };
    },
  },
  {
    name: "list_trips",
    description: "School trips with date, branches, grades, fee, status and parent response counts (approved, declined, confirmed, receipts under review).",
    inputSchema: { type: "object", properties: { status: { type: "string", description: "OPEN, CLOSED, COMPLETED, CANCELLED" }, fromDate: { type: "string", description: "Trips on or after YYYY-MM-DD" } } },
    run: async (args, scope) => {
      if (scope && !scope.can.trips) return NO_ACCESS;
      const names = await mcpNames();
      const snap = await db.collection("trips").get();
      const list = snap.docs.map((d) => d.data())
        .filter((x) => !scope?.branches || (x.branches || []).some((b) => scope.branches.includes(b)))
        .filter((x) => (args.status ? x.status === args.status : x.status !== "CANCELLED"))
        .filter((x) => !mcpDay(args.fromDate) || x.date >= args.fromDate)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        trips: list.map((x) => ({
          code: x.tripCode, title: x.title, destination: x.destination, date: x.date, departTime: x.departTime, returnTime: x.returnTime,
          status: x.status, branches: (x.branches || []).map(names.branch), grades: x.stages || [], fee: x.fee || 0, capacity: x.capacity || null,
          responses: x.stats || {},
        })),
      };
    },
  },
];

async function mcpHandle(msg) {
  const { id, method, params } = msg || {};
  if (method === "initialize") {
    return {
      protocolVersion: params?.protocolVersion || MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mis-crm", title: SCHOOL_NAME ? `CRM — ${SCHOOL_NAME}` : "CRM", version: "1.0.0" },
      instructions: "Read-only access to the school's CRM (parent feedback/complaints, tech-support tickets, trips). Dates are in Riyadh time. Text is mostly Arabic.",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: MCP_TOOLS.map(({ run, ...tool }) => tool) };
  if (method === "tools/call") {
    const tool = MCP_TOOLS.find((x) => x.name === params?.name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
    try {
      const result = await tool.run(params?.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
    } catch (err) {
      console.error("mcp tool", tool.name, err.message);
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
  if (id === undefined) return undefined; // other notifications
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

exports.mcp = onRequest({ timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") { res.set("Allow", "POST").status(405).send("Method Not Allowed"); return; }
  const keyRef = await mcpKeyRef(req);
  if (!keyRef) { res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or revoked API key" } }); return; }
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const replies = [];
  for (const msg of messages) {
    if (msg?.method === "tools/call") {
      keyRef.update({ lastUsedAt: Timestamp.now(), calls: FieldValue.increment(1) }).catch(() => {});
    }
    try {
      const result = await mcpHandle(msg);
      if (msg?.id !== undefined && result !== undefined) replies.push({ jsonrpc: "2.0", id: msg.id, result });
    } catch (err) {
      if (msg?.id !== undefined) replies.push({ jsonrpc: "2.0", id: msg.id, error: { code: err.code || -32603, message: err.message } });
    }
  }
  if (!replies.length) { res.status(202).end(); return; }
  res.json(Array.isArray(req.body) ? replies : replies[0]);
});

// ===========================================================================
// Bevatel call center — calls are pulled from Bevatel's reports API every
// 15 minutes into calls/<dir>_<id> (Bevatel sends no call webhooks). The
// owner saves the API key (secureConfig/bevatel, never readable by clients)
// and maps each Bevatel queue to a branch (settings/bevatel.queueBranch).
// Each run re-reads the whole current day (and the previous one just after
// midnight) and upserts, so a missed run or a late update heals itself.
// ===========================================================================
const BEVATEL_API = "https://api.bevatel.com";

async function bevatelKey() {
  const snap = await db.collection("secureConfig").doc("bevatel").get();
  return snap.exists ? snap.data().apiKey || null : null;
}
async function bevatelGet(key, path, params = {}) {
  const url = new URL(path, BEVATEL_API);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v)); });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Bevatel ${res.status}: ${body.message || res.statusText}`);
  return body;
}
// Every page of a report for one day range (Riyadh time).
async function bevatelReport(key, path, fromDay, toDay) {
  const dmy = (day) => day.split("-").reverse().join("-");
  const rows = [];
  for (let page = 1; page <= 60; page++) {
    const body = await bevatelGet(key, path, { from_date: dmy(fromDay), to_date: dmy(toDay), time_zone: "+03:00", page, per_page: 100 });
    rows.push(...(body.data || []));
    if (!body.meta || page >= (body.meta.last_page || 1)) break;
  }
  return rows;
}
const hmsSec = (v) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(v || ""));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
// Caller numbers as the roster stores parent mobiles (05xxxxxxxx).
function callPhone(v) {
  let d = normalizeDigits(v).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3)}`;
  if (/^5\d{8}$/.test(d)) return `0${d}`;
  return d;
}

function callRecord(dir, row, queueBranch, queueNames) {
  const at = new Date(`${String(row.date || "").replace(" ", "T")}+03:00`);
  if (!row.id || Number.isNaN(at.getTime())) return null;
  const queue = String(row.queue_number || row.queue || "");
  const queueKey = queueBranch[queue] ? queue : Object.keys(queueNames).find((n) => queueNames[n] === queue) || queue;
  const talkSec = hmsSec(row.talk_time || row.duration);
  const event = String(row.event || "");
  const local = new Date(at.getTime() + 3 * 3600000); // Riyadh wall clock
  return {
    dir, callId: String(row.id), at: Timestamp.fromDate(at), day: String(row.date).slice(0, 10), hour: local.getUTCHours(), weekday: local.getUTCDay(),
    phone: callPhone(row.number), number: String(row.number || ""), queue: queueKey, queueName: row.queue_name || queueNames[queueKey] || (dir === "out" ? row.queue || "" : ""),
    branch: queueBranch[queueKey] || "", agent: row.agent || "", agentNumber: row.agent_number || "", event,
    answered: talkSec > 0 || /^COMPLETE|TRANSFER/i.test(event), ringSec: hmsSec(row.ring_time), waitSec: hmsSec(row.wait_time), talkSec,
    did: row.did || "", tags: row.tags && typeof row.tags === "object" ? row.tags : {},
  };
}

async function syncBevatelDays(fromDay, toDay) {
  const key = await bevatelKey();
  if (!key) return { skipped: "no key" };
  const cfgRef = db.collection("settings").doc("bevatel");
  const cfg = (await cfgRef.get()).data() || {};
  const queueBranch = cfg.queueBranch || {};
  const queueNames = Object.fromEntries((cfg.queues || []).map((q) => [q.number, q.name]));
  const [inbound, outbound] = await Promise.all([
    bevatelReport(key, "/v1/reports/calls", fromDay, toDay),
    bevatelReport(key, "/v1/reports/outbound/detailed-calls", fromDay, toDay),
  ]);
  const now = Timestamp.now();
  const records = [
    ...inbound.map((r) => callRecord("in", r, queueBranch, queueNames)),
    ...outbound.map((r) => callRecord("out", r, queueBranch, queueNames)),
  ].filter(Boolean);
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    records.slice(i, i + 400).forEach((r) => batch.set(db.collection("calls").doc(`${r.dir}_${r.callId.replace(/[^A-Za-z0-9._-]/g, "_")}`), { ...r, syncedAt: now }, { merge: true }));
    await batch.commit();
  }
  await cfgRef.set({ lastSyncAt: now, lastSyncCount: records.length, lastSyncError: FieldValue.delete() }, { merge: true });
  // Call-task attempts waiting for their Bevatel check («مهام الاتصال»).
  const verified = await verifyPendingCallTasks(now.toMillis()).catch((err) => { console.error("call verify", err.message); return 0; });
  return { inbound: inbound.length, outbound: outbound.length, verified };
}

exports.bevatelSync = onSchedule({ schedule: "every 15 minutes", timeZone: "Asia/Riyadh", timeoutSeconds: 300 }, async () => {
  const today = riyadhDay();
  const minutes = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(":", ""));
  try {
    const result = await syncBevatelDays(minutes < 100 ? riyadhDay(-1) : today, today);
    console.log("bevatel sync", JSON.stringify(result));
  } catch (err) {
    console.error("bevatel sync", err.message);
    await db.collection("settings").doc("bevatel").set({ lastSyncError: err.message, lastSyncErrorAt: Timestamp.now() }, { merge: true });
  }
});

async function bevatelOwner(request) {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "ربط بيفاتيل متاح لمنشئ النظام فقط.");
  return caller;
}

// Saves (or removes) the API key after checking it against Bevatel, and
// stores the workspace queues for the queue → branch mapping.
exports.setBevatelKey = onCall({ timeoutSeconds: 60 }, async (request) => {
  const caller = await bevatelOwner(request);
  const apiKey = String(request.data?.apiKey || "").trim();
  const cfgRef = db.collection("settings").doc("bevatel");
  if (!apiKey) {
    await db.collection("secureConfig").doc("bevatel").delete();
    await cfgRef.set({ connected: false, updatedAt: Timestamp.now() }, { merge: true });
    return { connected: false };
  }
  // The queue list proves the key; Bevatel sometimes answers it with a
  // server error (500), so retry once, then accept the key if a call report
  // opens with it (the queues can be loaded later).
  let queues = [];
  let checked = false;
  const errors = [];
  for (const attempt of [1, 2]) {
    try {
      queues = (await bevatelGet(apiKey, "/v1/settings/queues")).data || [];
      checked = true;
      break;
    } catch (err) {
      errors.push(err.message);
      if (/Bevatel 40[13]/.test(err.message)) break;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!checked && !errors.some((m) => /Bevatel 40[13]/.test(m))) {
    try {
      const today = riyadhDay().split("-").reverse().join("-");
      await bevatelGet(apiKey, "/v1/reports/outbound/detailed-calls", { from_date: today, to_date: today, time_zone: "+03:00", page: 1, per_page: 1 });
      checked = true;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (!checked) {
    const unauthorized = errors.some((m) => /Bevatel 40[13]/.test(m));
    // Which parts of the account the key reaches, for Bevatel support.
    const probe = async (path) => { try { await bevatelGet(apiKey, path, { page: 1, per_page: 1 }); return "200"; } catch (err) { return (/Bevatel (\d{3})/.exec(err.message) || [])[1] || "?"; } };
    const [contacts, agents] = unauthorized ? [] : await Promise.all([probe("/v1/contacts"), probe("/v1/settings/agents")]);
    const diag = unauthorized ? "" : ` [تشخيص: /v1/contacts=${contacts} · /v1/settings/agents=${agents} · /v1/settings/queues=500 · /v1/reports/outbound/detailed-calls=${(/Bevatel (\d{3})/.exec(errors[errors.length - 1]) || [])[1] || "?"}]`;
    throw new HttpsError("invalid-argument", unauthorized
      ? `رفضت بيفاتيل هذا المفتاح (${errors[errors.length - 1]}). تأكد من نسخه كاملاً من Client Console.`
      : `المفتاح صحيح لكن خادم بيفاتيل يرفض طلبات مركز الاتصال به (${errors[errors.length - 1]}). تأكد أن المفتاح مُنشأ من حساب مركز الاتصال ومفعّلة له صلاحية التقارير، أو أرسل هذا التشخيص لدعم بيفاتيل.${diag}`);
  }
  await db.collection("secureConfig").doc("bevatel").set({ apiKey, savedAt: Timestamp.now(), savedBy: caller.uid });
  const list = queues.map((q) => ({ number: String(q.number || ""), name: String(q.name || ""), type: q.type || "" }));
  await cfgRef.set({ connected: true, queues: list, updatedAt: Timestamp.now() }, { merge: true });
  return { connected: true, queues: list };
});

exports.saveBevatelQueues = onCall(async (request) => {
  await bevatelOwner(request);
  const map = request.data?.queueBranch || {};
  const clean = Object.fromEntries(Object.entries(map).filter(([q, b]) => q && typeof b === "string" && b).map(([q, b]) => [String(q).slice(0, 40), b.slice(0, 60)]));
  await db.collection("settings").doc("bevatel").set({ queueBranch: clean, updatedAt: Timestamp.now() }, { merge: true });
  return { ok: true };
});

// Pulls the last N days now (first connection, or after changing the
// queue → branch mapping so older calls get their branch).
exports.bevatelSyncNow = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  await bevatelOwner(request);
  const days = Math.min(60, Math.max(1, Math.floor(Number(request.data?.days) || 7)));
  const today = riyadhDay();
  try {
    return await syncBevatelDays(riyadhDay(-(days - 1)), today);
  } catch (err) {
    throw new HttpsError("internal", err.message);
  }
});

// ===========================================================================
// In-app AI assistant («المساعد الذكي») — Claude answers staff questions,
// searches the CRM and writes reports, through the same read-only tools as
// the MCP server, limited to the signed-in employee's branches and sections
// (mcpScopeOf). The owner saves the Anthropic API key (secureConfig/
// anthropic) and switches the assistant on (settings/assistant.enabled);
// each employee can be switched off on the Users page (modules.assistant).
// Conversations are stored append-only in assistantChats/<id> (their
// thinking blocks must be sent back unchanged), and each user gets
// ASSISTANT_DAILY_LIMIT messages a day.
// ===========================================================================
const Anthropic = require("@anthropic-ai/sdk");
const ASSISTANT_MODEL = "claude-opus-5-5";
const ASSISTANT_DAILY_LIMIT = 40;
const ASSISTANT_MAX_STEPS = 8;
const ASSISTANT_SYSTEM = `أنت «المساعد الذكي» داخل نظام علاقات العملاء (CRM) في ${SCHOOL_NAME || "المدرسة"}. يستخدمك موظفو المدرسة.

ما تفعله:
- تجيب عن أسئلة الموظف عن بيانات النظام: الملاحظات والشكاوى، المشكلات التقنية، المفقودات، الرحلات.
- تبحث في البيانات وتعدّ التقارير والملخصات والمقارنات بين الفروع والفترات.
- تشرح طريقة استخدام النظام.

قواعد البيانات:
- استخدم الأدوات للحصول على أي رقم أو سجل؛ لا تخمّن ولا تخترع أرقاماً أو أسماء. إذا لم تُرجع الأداة بيانات فقل ذلك.
- الأدوات تعيد فقط ما يحق لهذا الموظف رؤيته (فروعه وأقسامه). إذا أعادت أداة «ليس لديك صلاحية» فأخبره بلطف أن هذا خارج صلاحيته.
- أنت للقراءة فقط: لا تستطيع إنشاء أو تعديل أو حذف أي شيء. إذا طُلب منك ذلك فاشرح للموظف أين يفعله في النظام.
- الفترة الافتراضية للأدوات آخر 30 يوماً؛ حدّد from/to عندما يذكر الموظف فترة (التواريخ بتوقيت الرياض، بصيغة YYYY-MM-DD).
- الحالات: RECEIVED مستلمة، ASSIGNED مُسندة، IN_PROGRESS قيد المعالجة، WAITING_PARENT_RESPONSE بانتظار رد ولي الأمر، ESCALATED مصعّدة، SOLVED تم الحل، CLOSED مغلقة، REJECTED مرفوضة. اعرضها بالعربية.

طريقة الرد:
- اكتب بالعربية الفصحى المبسّطة (أو بالإنجليزية إذا كتب الموظف بالإنجليزية)، بإيجاز ووضوح.
- للتقارير: عنوان، ثم ملخص من سطرين، ثم جداول Markdown للأرقام، ثم «ملاحظات وتوصيات» عملية. اذكر الفترة والفروع التي يغطيها التقرير.
- عند ذكر سجل اذكر رقمه (مثل COM-2026-10023) ليبحث عنه الموظف.

دليل مختصر للنظام:
- «الملاحظات»: تسجيل ملاحظة/شكوى وإسنادها ومتابعتها حتى الحل؛ لكل ملاحظة مهلة حل وتُصعّد تلقائياً عند التأخر.
- «حل المشكلات التقنية»: بلاغات المنصات والحسابات، ومنها «حسابات الطلاب» لإرسال بيانات دخول كلاسيرا وبوابة الطالب.
- «المفقودات»، «زيارات الفروع» (رموز QR في الاستقبال)، «الرحلات المدرسية» (موافقات أولياء الأمور، الدفع، كشف صعود الحافلة).
- «التقارير»: تقارير الملاحظات والبلاغات مع زمن الحل والتأخير لكل فرع. «البحث المتقدم» و«سجل الطلاب» للبحث.
- «تحليل الاتصالات»: مكالمات بيفاتيل والمكالمات الفائتة.`;

const assistantTools = MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema }));

async function assistantClient() {
  const snap = await db.collection("secureConfig").doc("anthropic").get();
  const apiKey = snap.exists ? snap.data().apiKey : null;
  return apiKey ? new Anthropic({ apiKey, timeout: 120000, maxRetries: 2 }) : null;
}

exports.setAssistantKey = onCall({ timeoutSeconds: 60 }, async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "إعداد المساعد الذكي متاح لمنشئ النظام فقط.");
  const apiKey = String(request.data?.apiKey || "").trim();
  const cfgRef = db.collection("settings").doc("assistant");
  if (!apiKey) {
    await db.collection("secureConfig").doc("anthropic").delete();
    await cfgRef.set({ configured: false, enabled: false, updatedAt: Timestamp.now() }, { merge: true });
    return { configured: false };
  }
  try {
    await new Anthropic({ apiKey }).models.retrieve(ASSISTANT_MODEL);
  } catch (err) {
    throw new HttpsError("invalid-argument", `تعذر التحقق من المفتاح لدى Anthropic (${err.status || ""} ${err.message}).`);
  }
  await db.collection("secureConfig").doc("anthropic").set({ apiKey, savedAt: Timestamp.now(), savedBy: caller.uid });
  await cfgRef.set({ configured: true, enabled: true, model: ASSISTANT_MODEL, dailyLimit: ASSISTANT_DAILY_LIMIT, updatedAt: Timestamp.now() }, { merge: true });
  return { configured: true };
});

exports.setAssistantEnabled = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "إعداد المساعد الذكي متاح لمنشئ النظام فقط.");
  await db.collection("settings").doc("assistant").set({ enabled: request.data?.enabled === true, updatedAt: Timestamp.now() }, { merge: true });
  return { ok: true };
});

const assistantText = (content) => (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

exports.assistantChat = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const uid = request.auth.uid;
  const userSnap = await db.collection("users").doc(uid).get();
  const u = { uid, ...(userSnap.data() || {}) };
  if (!userSnap.exists || u.active === false || u.role === "RECEPTIONIST" || u.modules?.assistant === false) {
    throw new HttpsError("permission-denied", "المساعد الذكي غير متاح لحسابك.");
  }
  const cfg = (await db.collection("settings").doc("assistant").get()).data() || {};
  const client = cfg.enabled === true ? await assistantClient() : null;
  if (!client) throw new HttpsError("failed-precondition", "المساعد الذكي غير مفعّل حالياً.");
  const text = str(request.data?.message, 4000);
  if (!text) throw new HttpsError("invalid-argument", "اكتب سؤالك.");

  // Daily allowance per user (owner unlimited).
  const day = riyadhDay();
  const usageRef = db.collection("assistantUsage").doc(`${uid}_${day}`);
  if (u.isOwner !== true) {
    await db.runTransaction(async (tx) => {
      const used = (await tx.get(usageRef)).data()?.messages || 0;
      if (used >= (cfg.dailyLimit || ASSISTANT_DAILY_LIMIT)) throw new HttpsError("resource-exhausted", "وصلت للحد اليومي لأسئلة المساعد الذكي، يتجدد غداً.");
      tx.set(usageRef, { uid, day, messages: used + 1 }, { merge: true });
    });
  }

  // The conversation (append-only; a new chat when none or not this user's).
  let chatRef = request.data?.chatId ? db.collection("assistantChats").doc(String(request.data.chatId)) : null;
  let chat = chatRef ? (await chatRef.get()).data() : null;
  if (!chat || chat.uid !== uid) { chatRef = db.collection("assistantChats").doc(); chat = null; }
  const messages = chat ? JSON.parse(chat.messages || "[]") : [];
  const transcript = chat?.transcript || [];
  const scope = mcpScopeOf(u);
  const branchNames = (await mcpNames()).branch;
  const intro = messages.length ? "" : `[الموظف: ${u.name || ""} — الدور: ${u.role || ""}${scope?.branches ? ` — الفروع: ${scope.branches.map(branchNames).join("، ") || "—"}` : " — كل الفروع"}${scope?.assignedUid ? " — يرى ما أُسند إليه فقط" : ""}]\n`;
  messages.push({ role: "user", content: [{ type: "text", text: `${intro}[اليوم ${day}]\n${text}` }] });

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let reply = "";
  for (let step = 0; step < ASSISTANT_MAX_STEPS; step++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: ASSISTANT_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: assistantTools,
        messages,
      });
    } catch (err) {
      console.error("assistant", err.status, err.message);
      if (err instanceof Anthropic.RateLimitError) throw new HttpsError("resource-exhausted", "المساعد مشغول حالياً، حاول بعد دقيقة.");
      if (err instanceof Anthropic.AuthenticationError) throw new HttpsError("failed-precondition", "مفتاح المساعد الذكي غير صالح — يراجعه منشئ النظام.");
      throw new HttpsError("unavailable", "تعذر الوصول إلى المساعد الذكي، حاول مرة أخرى.");
    }
    const ru = response.usage || {};
    usage.input += ru.input_tokens || 0;
    usage.output += ru.output_tokens || 0;
    usage.cacheRead += ru.cache_read_input_tokens || 0;
    usage.cacheWrite += ru.cache_creation_input_tokens || 0;
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") { reply = "عذراً، لا أستطيع المساعدة في هذا الطلب."; break; }
    if (response.stop_reason === "pause_turn") continue;
    const calls = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !calls.length) { reply = assistantText(response.content); break; }
    const results = await Promise.all(calls.map(async (call) => {
      const tool = MCP_TOOLS.find((x) => x.name === call.name);
      try {
        const out = tool ? await tool.run(call.input || {}, scope) : { error: `Unknown tool ${call.name}` };
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out).slice(0, 60000) };
      } catch (err) {
        return { type: "tool_result", tool_use_id: call.id, content: `Error: ${err.message}`, is_error: true };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  if (!reply) reply = "لم أتمكن من إكمال الإجابة، جرّب سؤالاً أكثر تحديداً.";

  const now = Timestamp.now();
  transcript.push({ role: "user", text, at: now }, { role: "assistant", text: reply, at: now });
  const json = JSON.stringify(messages);
  await chatRef.set({
    uid, title: chat?.title || text.slice(0, 80), updatedAt: now, ...(chat ? {} : { createdAt: now }),
    // Very long chats are not stored further; the client starts a new one.
    messages: json.length < 900000 ? json : chat?.messages || "[]", full: json.length >= 900000, transcript,
  });
  await db.collection("assistantUsage").doc(`total_${day.slice(0, 7)}`).set({
    month: day.slice(0, 7), messages: FieldValue.increment(1), inputTokens: FieldValue.increment(usage.input), outputTokens: FieldValue.increment(usage.output),
    cacheReadTokens: FieldValue.increment(usage.cacheRead), cacheWriteTokens: FieldValue.increment(usage.cacheWrite),
  }, { merge: true });
  if (u.isOwner !== true) await usageRef.set({ inputTokens: FieldValue.increment(usage.input), outputTokens: FieldValue.increment(usage.output) }, { merge: true });
  return { chatId: chatRef.id, reply, full: json.length >= 900000 };
});

// The owner's view of this month's assistant use (tokens → estimated cost).
exports.assistantUsageSummary = onCall(async (request) => {
  const caller = await adminCaller(request);
  if (caller.isOwner !== true) throw new HttpsError("permission-denied", "متاح لمنشئ النظام فقط.");
  const month = riyadhDay().slice(0, 7);
  const t = (await db.collection("assistantUsage").doc(`total_${month}`).get()).data() || {};
  // Claude Opus 5.5: $4 / $20 per million input / output tokens; cache reads $0.20, cache writes ~1.25× input.
  const usd = ((t.inputTokens || 0) * 4 + (t.outputTokens || 0) * 20 + (t.cacheReadTokens || 0) * 0.2 + (t.cacheWriteTokens || 0) * 5) / 1e6;
  return { month, messages: t.messages || 0, inputTokens: t.inputTokens || 0, outputTokens: t.outputTokens || 0, estimatedUsd: Math.round(usd * 100) / 100 };
});

// --- Branch WhatsApp daily reports (until the numbers are on the API) --------
// At 13:00 on working days, staff with the «waReports» section are reminded
// of their branches' missing report for the previous working day.
exports.waReportReminders = onSchedule({ schedule: "0 13 * * 0-4", timeZone: "Asia/Riyadh", timeoutSeconds: 120 }, async () => {
  // Previous working day (Sunday looks back to Thursday).
  const today = riyadhDay();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const day = riyadhDay(dow === 0 ? -3 : -1);
  const [branchSnap, reportSnap, users] = await Promise.all([
    db.collection("branches").get(),
    db.collection("waDailyReports").where("day", "==", day).get(),
    loadActiveUsers(),
  ]);
  const done = new Set(reportSnap.docs.map((d) => d.data().branch));
  const missing = branchSnap.docs.filter((b) => b.data().active !== false && !done.has(b.id)).map((b) => ({ id: b.id, name: b.data().name || b.id }));
  if (!missing.length) return;
  const staff = users.filter((u) => u.modules?.waReports === true);
  for (const u of staff) {
    const own = u.access === "all" ? missing : missing.filter((b) => (u.branches || []).includes(b.id) || u.branch === b.id);
    if (!own.length) continue;
    await notifyUsers([u.id], {
      title: "تقرير واتساب الفرع لم يُدخل",
      body: `لم يُدخل تقرير واتساب ليوم ${day}: ${own.map((b) => b.name).join("، ")}`,
      complaintId: "", type: "WA_REPORT_MISSING",
    });
  }
  console.log("wa report reminders", day, missing.length);
});

// --- Lost & found steps --------------------------------------------------------
// The assignees (or staff with edit permission in the branch) move a report
// through: UNCLAIMED (awaiting receipt) → SEARCHING (receipt confirmed) →
// MATCHED (item found) → RETURNED (handed to its owner); or CLOSED. Each step
// is stamped on the report and logged, so it shows in the record, the
// student's file and the parent's tracking page. The WhatsApp «returned»
// message is still sent by handleLostFoundAssignment.
const LF_STEPS = {
  acknowledge: { from: ["UNCLAIMED"], to: "SEARCHING", log: "ITEM_ACKNOWLEDGED", stamp: "acknowledged" },
  found: { from: ["UNCLAIMED", "SEARCHING"], to: "MATCHED", log: "ITEM_MATCHED", stamp: "found" },
  returned: { from: ["MATCHED"], to: "RETURNED", log: "ITEM_RETURNED", stamp: "returned" },
  close: { from: ["UNCLAIMED", "SEARCHING", "MATCHED"], to: "CLOSED", log: "ITEM_CLOSED", stamp: "closed" },
};
exports.lostFoundAction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const { id, action } = request.data || {};
  const step = LF_STEPS[action];
  if (!step && action !== "convert") throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  if (!caller || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية تنفيذ هذا الإجراء.");
  const ref = db.collection("lostFoundItems").doc(String(id || ""));
  const item = (await ref.get()).data();
  if (!item) throw new HttpsError("not-found", "لم يتم العثور على البلاغ.");
  const inScope = caller.role === "ADMIN" || caller.access === "all" || (caller.branches || []).includes(item.branch) || caller.branch === item.branch;
  const allowed = caller.role === "ADMIN" || (item.assignedTo || []).includes(request.auth.uid) || (inScope && caller.perms?.edit === true);
  if (!allowed) throw new HttpsError("permission-denied", "هذا الإجراء للمسند إليهم البلاغ أو من لديه صلاحية التعديل.");
  // Lost report ↔ found report (the item was logged under the wrong type).
  if (action === "convert") {
    if (!["UNCLAIMED", "SEARCHING", "MATCHED"].includes(item.status)) throw new HttpsError("failed-precondition", "لا يمكن تحويل بلاغ مُسلَّم أو مغلق.");
    const to = item.reportType === "FOUND" ? "LOST" : "FOUND";
    const now = Timestamp.now();
    await ref.update({ reportType: to, updatedAt: now, typeChangedAt: now, typeChangedByName: caller.name || "" });
    await ref.collection("activityLog").add({ action: "ITEM_TYPE_CHANGED", actorId: request.auth.uid, actorName: caller.name || "مستخدم", metadata: { from: item.reportType || "", to, note: str(request.data?.note, 300) }, createdAt: now });
    return { ok: true, reportType: to };
  }
  if (!step.from.includes(item.status)) throw new HttpsError("failed-precondition", "لا يمكن تنفيذ هذا الإجراء في حالة البلاغ الحالية.");
  const returnedTo = str(request.data?.returnedTo, 80);
  const relation = str(request.data?.relation, 40);
  const place = str(request.data?.place, 120);
  const note = str(request.data?.note, 300);
  if (action === "returned" && !returnedTo) throw new HttpsError("invalid-argument", "اكتب اسم من استلم الغرض.");
  const now = Timestamp.now();
  const actorName = caller.name || "مستخدم";
  await ref.update({
    status: step.to, updatedAt: now,
    [`${step.stamp}At`]: now, [`${step.stamp}By`]: request.auth.uid, [`${step.stamp}ByName`]: actorName,
    ...(action === "found" && place ? { foundPlace: place } : {}),
    ...(action === "returned" ? { returnedTo, ...(relation ? { returnedToRelation: relation } : {}) } : {}),
  });
  await ref.collection("activityLog").add({
    action: step.log, actorId: request.auth.uid, actorName,
    metadata: { ...(returnedTo ? { returnedTo } : {}), ...(relation ? { relation } : {}), ...(place ? { place } : {}), ...(note ? { note } : {}) },
    createdAt: now,
  });
  // Item found: tell the reporter (WhatsApp API, when its template is set;
  // otherwise staff use the WhatsApp button in the record).
  let messageSent = false;
  if (action === "found" && WA_API_ENABLED) {
    const wa = (await db.collection("settings").doc("whatsappApi").get()).data() || {};
    if (wa.enabled && wa.autoSend !== false && (wa.templates || {}).lostFoundFound && item.reporterPhone) {
      await autoSendWa("lostFound", ref, "found");
      messageSent = Boolean((await ref.get()).data()?.foundMessageSentAt);
    }
  }
  return { ok: true, status: step.to, messageSent };
});

// Reminds the assignees of every lost & found report still awaiting receipt
// (older than an hour) in the caller's branches: one notification per person
// listing their reports; reports with no assignee go to the branch's lost &
// found officers. Each report is stamped and logged like a single reminder.
exports.remindLostFoundBranches = onCall({ timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  if (!caller || caller.active === false) throw new HttpsError("permission-denied", "لا تملك صلاحية إرسال التذكير.");
  const all = caller.role === "ADMIN" || caller.access === "all";
  if (!(caller.role === "ADMIN" || caller.isPrincipal === true || caller.perms?.edit === true || caller.isQuality === true)) {
    throw new HttpsError("permission-denied", "تذكير الفروع لمدير الفرع أو من لديه صلاحية التعديل.");
  }
  const mine = all ? null : (caller.branches || []).concat(caller.branch ? [caller.branch] : []);
  const snap = await db.collection("lostFoundItems").where("status", "==", "UNCLAIMED").get();
  const due = snap.docs.filter((d) => {
    const x = d.data();
    return (!mine || mine.includes(x.branch)) && x.createdAt && Date.now() - x.createdAt.toMillis() > 3600e3;
  });
  if (!due.length) return { reports: 0, people: 0 };
  const users = await loadActiveUsers();
  const perPerson = new Map();
  for (const d of due) {
    const x = d.data();
    const to = (x.assignedTo || []).length ? x.assignedTo : lostFoundOfficers(users, x.branch);
    to.forEach((uid) => { if (!perPerson.has(uid)) perPerson.set(uid, []); perPerson.get(uid).push(x); });
  }
  const sender = caller.name || "الإدارة";
  for (const [uid, list] of perPerson) {
    await notifyUsers([uid], {
      title: `تذكير: ${list.length} بلاغ مفقودات بانتظار تأكيد الاستلام`,
      body: `${sender} يذكّرك بتأكيد استلام البلاغات وبدء البحث: ${list.slice(0, 8).map((x) => `${x.itemCode} (${x.itemName || ""})`).join("، ")}${list.length > 8 ? "…" : ""}`,
      complaintId: "", type: "LF_REMINDER",
    });
  }
  const now = Timestamp.now();
  for (let i = 0; i < due.length; i += 200) {
    const batch = db.batch();
    due.slice(i, i + 200).forEach((d) => {
      batch.update(d.ref, { lastReminderAt: now, lastReminderBy: request.auth.uid, lastReminderByName: sender, reminderCount: FieldValue.increment(1) });
      batch.set(d.ref.collection("activityLog").doc(), { action: "REMINDER_SENT", actorId: request.auth.uid, actorName: sender, metadata: { bulk: true }, createdAt: now });
    });
    await batch.commit();
  }
  return { reports: due.length, people: perPerson.size };
});

// --- «نشاط المستخدمين»: last sign-in per user -----------------------------------
// The owner (or users the owner shared the page with, users.activityAccess)
// gets every staff account with its Firebase Auth times: last sign-in, last
// token refresh (≈ last time the app was open) and creation.
async function activityCaller(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const caller = (await db.collection("users").doc(request.auth.uid).get()).data();
  if (!caller || !(caller.isOwner === true || (caller.activityAccess === true && caller.active !== false))) {
    throw new HttpsError("permission-denied", "هذه الصفحة لمنشئ النظام ومن يشاركها معهم.");
  }
  return caller;
}

exports.getUserActivity = onCall({ timeoutSeconds: 60 }, async (request) => {
  await activityCaller(request);
  const times = {};
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    res.users.forEach((u) => { times[u.uid] = { lastSignIn: u.metadata.lastSignInTime || null, lastRefresh: u.metadata.lastRefreshTime || null, created: u.metadata.creationTime || null, disabled: u.disabled }; });
    pageToken = res.pageToken;
  } while (pageToken);
  const snap = await db.collection("users").get();
  const ms = (v) => (v ? Date.parse(v) || null : null);
  return {
    users: snap.docs.map((d) => {
      const u = d.data();
      const tm = times[d.id] || {};
      return {
        id: d.id, name: u.name || "", email: u.email || "", role: u.role || "", jobTitle: u.jobTitle || "", department: u.department || "",
        branches: u.access === "all" ? ["*"] : (Array.isArray(u.branches) && u.branches.length ? u.branches : u.branch ? [u.branch] : []),
        active: u.active !== false, isOwner: u.isOwner === true,
        lastSignIn: ms(tm.lastSignIn), lastRefresh: ms(tm.lastRefresh), created: ms(tm.created), disabled: tm.disabled === true,
      };
    }),
  };
});

// «تقرير نشاط المستخدمين»: what each user did between two days (Riyadh) —
// the actions they logged in each section (the activityLog of complaints,
// tech support, lost & found, trips and visits; the activity of platform
// leads) and how long the system was open on their screen (usage/<uid>_<day>,
// one minute per presence heartbeat). System actions (no actor) are left out.
const ACTIVITY_MODULES = { complaints: "complaints", techSupportTickets: "techSupport", lostFoundItems: "lostFound", trips: "trips", appointments: "visits", leads: "platform" };
const activityKind = (a) => (/COMMENT|^NOTE$/.test(a) ? "comments" : /_CREATED$|_REGISTERED$|_REQUESTED$|^REQUESTED$|^CREATED$/.test(a) ? "created" : "updates");
exports.getUserActivityReport = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  await activityCaller(request);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(request.data?.from || "");
  const to = String(request.data?.to || "");
  if (!day.test(from) || !day.test(to) || to < from) throw new HttpsError("invalid-argument", "حدّد فترة صحيحة.");
  const start = Date.parse(`${from}T00:00:00+03:00`);
  const end = Date.parse(`${to}T00:00:00+03:00`) + 86400e3;
  if (end - start > 366 * 86400e3) throw new HttpsError("invalid-argument", "أقصى فترة للتقرير سنة واحدة.");
  const range = (q, field) => q.where(field, ">=", Timestamp.fromMillis(start)).where(field, "<", Timestamp.fromMillis(end));
  const [logs, leadActs, usage, usersSnap] = await Promise.all([
    range(db.collectionGroup("activityLog"), "createdAt").select("action", "actorId", "actorName", "createdAt").get(),
    range(db.collectionGroup("activity"), "at").select("type", "byId", "byName", "at").get(),
    db.collection("usage").where("day", ">=", from).where("day", "<=", to).get(),
    db.collection("users").get(),
  ]);
  const riyadh = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
  const per = {};
  const row = (uid, name) => (per[uid] ||= { name: name || "", actions: 0, modules: {}, kinds: { created: 0, updates: 0, comments: 0 }, actionTypes: {}, days: new Set(), minutes: 0, lastActionAt: null });
  const totals = { actions: 0, minutes: 0, modules: {} };
  const daily = {};
  const count = (uid, name, module, action, ms) => {
    if (!uid || !ms) return;
    const r = row(uid, name);
    const d = riyadh(ms);
    r.actions += 1;
    r.modules[module] = (r.modules[module] || 0) + 1;
    r.kinds[activityKind(action)] += 1;
    r.actionTypes[`${module}:${action}`] = (r.actionTypes[`${module}:${action}`] || 0) + 1;
    r.days.add(d);
    r.lastActionAt = Math.max(r.lastActionAt || 0, ms);
    totals.actions += 1;
    totals.modules[module] = (totals.modules[module] || 0) + 1;
    (daily[d] ||= { actions: 0, users: new Set(), minutes: 0 }).actions += 1;
    daily[d].users.add(uid);
  };
  logs.docs.forEach((d) => {
    const x = d.data();
    const parent = d.ref.parent.parent?.parent?.id;
    count(x.actorId, x.actorName, ACTIVITY_MODULES[parent] || "other", x.action || "OTHER", x.createdAt?.toMillis?.());
  });
  leadActs.docs.forEach((d) => {
    if (d.ref.parent.parent?.parent?.id !== "leads") return;
    const x = d.data();
    count(x.byId, x.byName, "platform", x.type || "NOTE", x.at?.toMillis?.());
  });
  usage.docs.forEach((d) => {
    const x = d.data();
    if (!x.uid) return;
    const r = row(x.uid, "");
    const m = Number(x.minutes) || 0;
    r.minutes += m;
    r.days.add(x.day);
    totals.minutes += m;
    (daily[x.day] ||= { actions: 0, users: new Set(), minutes: 0 }).minutes += m;
    daily[x.day].users.add(x.uid);
  });
  const users = Object.fromEntries(usersSnap.docs.map((d) => [d.id, d.data()]));
  const ids = new Set([...Object.keys(per), ...usersSnap.docs.filter((d) => d.data().active !== false).map((d) => d.id)]);
  return {
    from, to, totals,
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ day: d, actions: v.actions, users: v.users.size, minutes: v.minutes })),
    users: [...ids].map((id) => {
      const u = users[id] || {};
      const r = per[id] || row(id, "");
      return {
        id, name: u.name || r.name || "", email: u.email || "", role: u.role || "", jobTitle: u.jobTitle || "",
        branches: u.access === "all" ? ["*"] : (Array.isArray(u.branches) && u.branches.length ? u.branches : u.branch ? [u.branch] : []),
        active: users[id] ? u.active !== false : false, deleted: !users[id],
        actions: r.actions, modules: r.modules, kinds: r.kinds, minutes: r.minutes, activeDays: r.days.size, lastActionAt: r.lastActionAt,
        topActions: Object.entries(r.actionTypes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ module: k.split(":")[0], action: k.split(":")[1], count: n })),
      };
    }),
  };
});

// --- Trips page indicators: the students behind a number --------------------
// The parent responses of the coming trips (OPEN / CLOSED, today onward) in
// one status — approved, confirmed, awaiting payment, receipt under review,
// declined — across the trips the caller can supervise. No phone numbers.
exports.tripEnrollmentsByStatus = onCall({ timeoutSeconds: 60 }, async (request) => {
  const caller = await tripCaller(request);
  const filter = String(request.data?.status || "");
  const allowed = ["APPROVED", "CONFIRMED", "AWAITING_PAYMENT", "RECEIPT_REVIEW", "RECEIPT_REJECTED", "DECLINED"];
  if (!allowed.includes(filter)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  const today = riyadhDay();
  const snap = await db.collection("trips").where("date", ">=", today).get();
  const trips = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((t) => ["OPEN", "CLOSED"].includes(t.status) && tripPerm.supervise(caller, t.branches || [], t));
  const rows = [];
  await Promise.all(trips.map(async (t) => {
    const enr = await t.ref.collection("enrollments").get();
    enr.docs.forEach((d) => {
      const e = d.data();
      const st = enrollmentStatus(e, t.fee);
      const match = filter === "APPROVED" ? e.decision === "APPROVED" : st === filter;
      if (!match) return;
      rows.push({
        tripId: t.id, tripTitle: t.title, tripDate: t.date, tripCode: t.tripCode, studentId: d.id, studentName: e.studentName || "",
        branch: e.branch || "", grade: e.grade || "", className: e.className || "", status: st, payMethod: e.payMethod || null,
        collectMethod: e.collectMethod || null, source: e.source || "parent", at: (e.updatedAt || e.submittedAt)?.toMillis?.() || null,
      });
    });
  }));
  rows.sort((a, b) => a.tripDate.localeCompare(b.tripDate) || (b.at || 0) - (a.at || 0));
  return { rows };
});

// Invoice for a confirmed trip payment: numbered once (INV-yyyy-nnnnn) and
// re-printable; the page prints it from the data returned here.
exports.issueTripInvoice = onCall(async (request) => {
  const caller = await tripCaller(request);
  const { tripId, studentId } = request.data || {};
  const { ref, trip } = await loadTrip(tripId, caller, "supervise");
  const enrollRef = ref.collection("enrollments").doc(String(studentId || ""));
  const e = (await enrollRef.get()).data();
  if (!e || e.payStatus !== "PAID") throw new HttpsError("failed-precondition", "تصدر الفاتورة بعد تأكيد الدفع فقط.");
  let invoiceNo = e.invoiceNo;
  let issuedAt = e.invoiceIssuedAt;
  if (!invoiceNo) {
    invoiceNo = await nextRecordNumber("INV");
    issuedAt = Timestamp.now();
    await enrollRef.update({ invoiceNo, invoiceIssuedAt: issuedAt, invoiceIssuedByName: caller.name || "" });
  }
  const branch = (await db.collection("branches").doc(e.branch || "_").get()).data();
  const student = (await db.collection("students").doc(String(studentId)).get()).data() || {};
  return {
    invoiceNo, issuedAt: issuedAt?.toMillis?.() || Date.now(), schoolName: SCHOOL_NAME,
    trip: { title: trip.title, code: trip.tripCode, destination: trip.destination, date: trip.date, dateLabel: formatTripDay(trip.date), departTime: trip.departTime || "", returnTime: trip.returnTime || "", fee: trip.fee || 0 },
    student: { name: e.studentName || student.nameAr || student.name || "", id: String(studentId), branch: branch?.name || e.branch || "", grade: e.grade || "", className: e.className || "", parentPhone: e.parentPhone || "" },
    payment: {
      amount: Number(e.paidAmount ?? trip.fee) || 0, method: e.collectMethod || (e.payMethod === "BANK" ? "TRANSFER" : "CASH"),
      collector: e.collectorName || "", confirmedBy: e.reviewedByName || "", confirmedAt: e.reviewedAt?.toMillis?.() || null, ref: e.cashReceiptNo || "",
    },
  };
});

// --- «مهام الاتصال»: customer-service call campaigns -------------------------
// Admins and call supervisors (users.callRoles.supervisor) create a campaign:
// the topic, the script, the outcomes to record, the parents to call (roster
// filters or student IDs from an Excel file; siblings share one call) and the
// agents (callRoles.agent). Calls are dealt to the agents automatically
// (evenly, by branch) or assigned by the supervisor, at a daily quota per
// agent (dueDay). recordCallResult saves each attempt, retries unanswered
// calls, and every attempt is checked against Bevatel's outbound calls to
// the parent's number (verifyCallTask, after each Bevatel sync).
const CALL_RESULTS = ["ANSWERED", "NO_ANSWER", "WRONG_NUMBER", "CALLBACK"];
const CALL_MAX_NO_ANSWER = 3;
const CALL_MAX_TASKS = 6000;
const CALL_VERIFY_BEFORE_MS = 90 * 60e3;
const CALL_VERIFY_AFTER_MS = 10 * 60e3;

function callRoleOf(u, role) {
  if (!u || u.active === false) return false;
  if (u.isOwner === true || u.role === "ADMIN") return true;
  return u.callRoles?.[role] === true;
}
const callScope = (u) => (u.isOwner === true || u.role === "ADMIN" || u.access === "all" ? null : [...new Set([...(u.branches || []), ...(u.branch ? [u.branch] : [])])]);
const inCallScope = (u, branch) => { const s = callScope(u); return !s || s.includes(branch); };
async function callCaller(request, role) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const u = (await db.collection("users").doc(request.auth.uid).get()).data();
  if (!callRoleOf(u, role)) throw new HttpsError("permission-denied", role === "supervisor" ? "إدارة حملات الاتصال للمدير ومشرفي الاتصال." : "مهام الاتصال لموظفي الاتصال.");
  return { ...u, uid: request.auth.uid };
}
// Working days (Sunday–Thursday) from a YYYY-MM-DD day.
function addWorkDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  const skip = () => { while ([5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); };
  skip();
  for (let i = 0; i < n; i++) { d.setUTCDate(d.getUTCDate() + 1); skip(); }
  return d.toISOString().slice(0, 10);
}
const riyadhDayOf = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);

// The parents a campaign calls: one task per parent mobile (siblings merged).
async function callTargets(caller, target) {
  const branchOf = await branchResolver();
  const scope = callScope(caller);
  let students;
  if (target?.mode === "IDS") {
    const ids = [...new Set((Array.isArray(target.ids) ? target.ids : []).map((x) => normalizeDigits(x).replace(/\D/g, "")).filter((x) => /^\d{6,15}$/.test(x)))].slice(0, CALL_MAX_TASKS * 2);
    if (!ids.length) throw new HttpsError("invalid-argument", "لم يُعثر على أرقام هوية في الملف.");
    students = [];
    for (let i = 0; i < ids.length; i += 300) {
      const snaps = await db.getAll(...ids.slice(i, i + 300).map((id) => db.collection("students").doc(id)));
      snaps.forEach((s) => { if (s.exists) students.push({ id: s.id, ...s.data() }); });
    }
    students.notFound = ids.length - students.length;
  } else {
    const snap = await db.collection("students").get();
    const branches = Array.isArray(target?.branches) ? target.branches.filter(Boolean) : [];
    const stages = Array.isArray(target?.stages) ? target.stages.filter(Boolean) : [];
    const classes = Array.isArray(target?.classes) ? target.classes.map((c) => String(c).trim().toUpperCase()).filter(Boolean) : [];
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.active !== false
      && (!branches.length || branches.includes(branchOf(s)))
      && (!stages.length || stages.includes(studentGrade(s)))
      && (!classes.length || classes.includes(String(s.className || "").trim().toUpperCase())));
    students.notFound = 0;
  }
  const byPhone = new Map();
  let outOfScope = 0;
  let noPhone = 0;
  for (const s of students) {
    const branch = branchOf(s);
    if (scope && !scope.includes(branch)) { outOfScope++; continue; }
    const phone = callPhone(s.mobile);
    if (!/^05\d{8}$/.test(phone)) { noPhone++; continue; }
    const kid = { id: s.id, name: s.nameAr || s.name || "", grade: studentGrade(s), className: s.className || "" };
    if (byPhone.has(phone)) byPhone.get(phone).students.push(kid);
    else byPhone.set(phone, { phone, branch, students: [kid] });
  }
  return { parents: [...byPhone.values()], students: students.length, notFound: students.notFound, outOfScope, noPhone };
}

// Deals tasks to agents: each to the least-loaded agent covering its branch
// (any agent when none does), then each agent's list is spread over working
// days at the daily quota.
function dealCallTasks(tasks, agents, { startDay, quota, existing = {} }) {
  const load = Object.fromEntries(agents.map((a) => [a.id, existing[a.id] || 0]));
  for (const tk of tasks) {
    const covering = agents.filter((a) => inCallScope(a, tk.branch));
    const pool = covering.length ? covering : agents;
    const pick = pool.reduce((best, a) => (load[a.id] < load[best.id] ? a : best), pool[0]);
    tk.assignedTo = pick.id;
    tk.assignedName = pick.name || "";
    tk.dueDay = addWorkDays(startDay, Math.floor(load[pick.id] / quota));
    load[pick.id] += 1;
  }
}

function callCampaignOut(id, c) {
  return {
    id, title: c.title, goal: c.goal || "", script: c.script || "", outcomes: c.outcomes || [], priority: c.priority, status: c.status,
    startDay: c.startDay, endDay: c.endDay, dailyQuota: c.dailyQuota, distribution: c.distribution, agents: c.agents || [], agentNames: c.agentNames || {},
    branches: c.branches || [], target: c.targetLabel || "", createdByName: c.createdByName || "", createdAt: c.createdAt?.toMillis?.() || null,
    counts: c.counts || {}, outcomeCounts: c.outcomeCounts || {},
  };
}

exports.saveCallCampaign = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  const caller = await callCaller(request, "supervisor");
  const d = request.data || {};
  const title = str(d.title, 120);
  if (!title) throw new HttpsError("invalid-argument", "اكتب عنوان الحملة.");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const startDay = day.test(d.startDay || "") ? d.startDay : riyadhDay();
  const endDay = day.test(d.endDay || "") && d.endDay >= startDay ? d.endDay : startDay;
  const quota = Math.min(500, Math.max(1, Math.floor(Number(d.dailyQuota) || 30)));
  const outcomes = [...new Set((Array.isArray(d.outcomes) ? d.outcomes : []).map((o) => str(o, 60)).filter(Boolean))].slice(0, 12);
  const distribution = d.distribution === "MANUAL" ? "MANUAL" : "AUTO";
  const priority = d.priority === "URGENT" ? "URGENT" : "NORMAL";
  const t = await callTargets(caller, d.target);
  const parents = t.parents.slice(0, CALL_MAX_TASKS);
  const summary = { parents: parents.length, students: t.students, notFound: t.notFound, outOfScope: t.outOfScope, noPhone: t.noPhone, truncated: t.parents.length - parents.length };
  const users = await loadActiveUsers();
  const agents = users.filter((u) => (d.agents || []).includes(u.id) && callRoleOf(u, "agent"));
  if (distribution === "AUTO" && !agents.length) throw new HttpsError("invalid-argument", "اختر موظف اتصال واحداً على الأقل للتوزيع التلقائي.");
  // Spread: the last due day at this quota, to warn when the period is short.
  const perAgent = agents.length ? Math.ceil(parents.length / agents.length) : 0;
  summary.lastDay = perAgent ? addWorkDays(startDay, Math.floor((perAgent - 1) / quota)) : startDay;
  if (d.preview) return summary;
  if (!parents.length) throw new HttpsError("failed-precondition", "لا يوجد أولياء أمور مطابقون (بأرقام جوال صحيحة) لهذه الحملة.");

  const now = Timestamp.now();
  const branches = [...new Set(parents.map((p) => p.branch).filter(Boolean))];
  const campRef = db.collection("callCampaigns").doc();
  const tasks = parents.map((p) => ({
    campaignId: campRef.id, campaignTitle: title, priority, phone: p.phone, branch: p.branch,
    studentId: p.students[0].id, studentIds: p.students.map((s) => s.id), studentName: p.students.map((s) => s.name).join("، "),
    grade: p.students.map((s) => [s.grade, s.className].filter(Boolean).join(" ")).join("، "),
    status: "PENDING", assignedTo: null, assignedName: "", dueDay: startDay, dueAt: null, attempts: 0, noAnswerCount: 0, history: [], verifyPending: false, createdAt: now,
  }));
  if (distribution === "AUTO") dealCallTasks(tasks, agents, { startDay, quota });
  await campRef.set({
    title, goal: str(d.goal, 500), script: str(d.script, 3000), outcomes, priority, status: "ACTIVE", startDay, endDay, dailyQuota: quota, distribution,
    agents: agents.map((a) => a.id), agentNames: Object.fromEntries(agents.map((a) => [a.id, a.name || ""])), branches,
    targetLabel: str(d.targetLabel, 200), createdBy: caller.uid, createdByName: caller.name || "", createdAt: now, updatedAt: now,
    counts: { total: tasks.length, pending: tasks.length, done: 0, answered: 0, noAnswer: 0, wrong: 0, failed: 0, unassigned: tasks.filter((x) => !x.assignedTo).length },
    outcomeCounts: {},
  });
  for (let i = 0; i < tasks.length; i += 450) {
    const batch = db.batch();
    tasks.slice(i, i + 450).forEach((x) => batch.set(db.collection("callTasks").doc(), x));
    await batch.commit();
  }
  const perAgentCount = {};
  tasks.forEach((x) => { if (x.assignedTo) perAgentCount[x.assignedTo] = (perAgentCount[x.assignedTo] || 0) + 1; });
  for (const [uid, n] of Object.entries(perAgentCount)) {
    await notifyUsers([uid], { title: `حملة اتصال جديدة: ${title}`, body: `أُسند إليك ${n} اتصالاً، بمعدل ${quota} يومياً من ${startDay}.`, complaintId: campRef.id, type: "CALL_ASSIGNED" });
  }
  return { id: campRef.id, ...summary, created: tasks.length };
});

async function loadCallCampaign(caller, id) {
  const ref = db.collection("callCampaigns").doc(String(id || ""));
  const c = (await ref.get()).data();
  if (!c) throw new HttpsError("not-found", "لم يتم العثور على الحملة.");
  const scope = callScope(caller);
  if (scope && c.createdBy !== caller.uid && !(c.branches || []).some((b) => scope.includes(b))) throw new HttpsError("permission-denied", "هذه الحملة خارج فروعك.");
  return { ref, c };
}

exports.listCallCampaigns = onCall(async (request) => {
  const caller = await callCaller(request, "supervisor");
  const snap = await db.collection("callCampaigns").orderBy("createdAt", "desc").limit(200).get();
  const scope = callScope(caller);
  return {
    campaigns: snap.docs.filter((x) => !scope || x.data().createdBy === caller.uid || (x.data().branches || []).some((b) => scope.includes(b))).map((x) => callCampaignOut(x.id, x.data())),
  };
});

exports.getCallCampaign = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const caller = await callCaller(request, "supervisor");
  const { ref, c } = await loadCallCampaign(caller, request.data?.id);
  const [tasks, bev] = await Promise.all([db.collection("callTasks").where("campaignId", "==", ref.id).get(), db.collection("settings").doc("bevatel").get()]);
  return {
    campaign: callCampaignOut(ref.id, c),
    bevatelSyncAt: bev.data()?.lastSyncAt?.toMillis?.() || null,
    tasks: tasks.docs.map((x) => {
      const k = x.data();
      return {
        id: x.id, studentName: k.studentName, studentIds: k.studentIds, grade: k.grade, branch: k.branch, phone: k.phone, status: k.status,
        assignedTo: k.assignedTo, assignedName: k.assignedName, dueDay: k.dueDay, dueAt: k.dueAt?.toMillis?.() || null, attempts: k.attempts, outcome: k.outcome || "",
        result: k.result || "", note: k.note || "", completedAt: k.completedAt?.toMillis?.() || null,
        history: (k.history || []).map((h) => ({ result: h.result, outcome: h.outcome || "", note: h.note || "", at: h.at?.toMillis?.() || null, byName: h.byName || "", verified: h.verified ?? null, talkSec: h.talkSec || 0, callAgent: h.callAgent || "" })),
      };
    }),
  };
});

// Supervisor: hand tasks to an agent (manual distribution, or moving late
// calls), scheduled from today at the campaign's daily quota.
exports.assignCallTasks = onCall({ timeoutSeconds: 120 }, async (request) => {
  const caller = await callCaller(request, "supervisor");
  const { ref, c } = await loadCallCampaign(caller, request.data?.campaignId);
  const agent = (await db.collection("users").doc(String(request.data?.agentId || "")).get()).data();
  if (!callRoleOf(agent, "agent")) throw new HttpsError("invalid-argument", "اختر موظف اتصال.");
  const ids = [...new Set(Array.isArray(request.data?.taskIds) ? request.data.taskIds.map(String) : [])].slice(0, 3000);
  if (!ids.length) throw new HttpsError("invalid-argument", "اختر الاتصالات المراد إسنادها.");
  const agentId = String(request.data.agentId);
  const mine = await db.collection("callTasks").where("campaignId", "==", ref.id).where("assignedTo", "==", agentId).where("status", "==", "PENDING").get();
  const startDay = c.startDay > riyadhDay() ? c.startDay : riyadhDay();
  let load = mine.size;
  let wasUnassigned = 0;
  let moved = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await db.getAll(...ids.slice(i, i + 300).map((id) => db.collection("callTasks").doc(id)));
    const batch = db.batch();
    snaps.forEach((s) => {
      const k = s.data();
      if (!k || k.campaignId !== ref.id || k.status !== "PENDING" || k.assignedTo === agentId) return;
      if (!k.assignedTo) wasUnassigned++;
      batch.update(s.ref, { assignedTo: agentId, assignedName: agent.name || "", dueDay: addWorkDays(startDay, Math.floor(load / (c.dailyQuota || 30))), dueAt: null });
      load++;
      moved++;
    });
    await batch.commit();
  }
  await ref.set({ counts: { unassigned: FieldValue.increment(-wasUnassigned) }, agents: FieldValue.arrayUnion(agentId), agentNames: { [agentId]: agent.name || "" }, updatedAt: Timestamp.now() }, { merge: true });
  if (moved) await notifyUsers([agentId], { title: `اتصالات جديدة: ${c.title}`, body: `أُسند إليك ${moved} اتصالاً.`, complaintId: ref.id, type: "CALL_ASSIGNED" });
  return { moved };
});

exports.setCallCampaignStatus = onCall(async (request) => {
  const caller = await callCaller(request, "supervisor");
  const { ref } = await loadCallCampaign(caller, request.data?.id);
  const status = ["ACTIVE", "PAUSED", "CLOSED"].includes(request.data?.status) ? request.data.status : null;
  if (!status) throw new HttpsError("invalid-argument", "طلب غير صالح.");
  await ref.update({ status, updatedAt: Timestamp.now() });
  return { ok: true };
});

// Each attempt against Bevatel's outbound calls to the parent's number: a
// call between 90 minutes before and 10 minutes after the attempt was saved
// verifies it (with its talk time). Without one, the attempt is marked
// unverified once Bevatel has synced past it; until then it stays pending.
async function verifyCallTask(ref, lastSyncMs) {
  const k = (await ref.get()).data();
  if (!k || !(k.history || []).some((h) => h.verified == null)) return;
  const calls = (await db.collection("calls").where("phone", "==", k.phone).where("dir", "==", "out").get()).docs.map((x) => x.data());
  let pending = false;
  const history = k.history.map((h) => {
    if (h.verified != null) return h;
    const at = h.at.toMillis();
    const match = calls.filter((c) => { const t = c.at?.toMillis?.() || 0; return t >= at - CALL_VERIFY_BEFORE_MS && t <= at + CALL_VERIFY_AFTER_MS; })
      .sort((a, b) => (b.talkSec || 0) - (a.talkSec || 0))[0];
    if (match) return { ...h, verified: true, talkSec: match.talkSec || 0, callAt: match.at, callAgent: match.agent || "" };
    if (lastSyncMs && lastSyncMs > at + CALL_VERIFY_AFTER_MS + 5 * 60e3) return { ...h, verified: false };
    if (Date.now() - at > 3 * 86400e3) return { ...h, verified: false };
    pending = true;
    return h;
  });
  await ref.update({ history, verifyPending: pending });
}
async function verifyPendingCallTasks(lastSyncMs) {
  const snap = await db.collection("callTasks").where("verifyPending", "==", true).limit(500).get();
  for (const x of snap.docs) await verifyCallTask(x.ref, lastSyncMs);
  return snap.size;
}

exports.recordCallResult = onCall(async (request) => {
  const caller = await callCaller(request, "agent");
  const d = request.data || {};
  const ref = db.collection("callTasks").doc(String(d.taskId || ""));
  const k = (await ref.get()).data();
  if (!k) throw new HttpsError("not-found", "لم يتم العثور على الاتصال.");
  if (k.assignedTo !== caller.uid && !(callRoleOf(caller, "supervisor") && inCallScope(caller, k.branch))) throw new HttpsError("permission-denied", "هذا الاتصال مسند لموظف آخر.");
  if (k.status !== "PENDING") throw new HttpsError("failed-precondition", "تم تسجيل نتيجة هذا الاتصال من قبل.");
  const result = CALL_RESULTS.includes(d.result) ? d.result : null;
  if (!result) throw new HttpsError("invalid-argument", "اختر نتيجة الاتصال.");
  const campRef = db.collection("callCampaigns").doc(k.campaignId);
  const camp = (await campRef.get()).data() || {};
  const outcome = str(d.outcome, 60);
  if (result === "ANSWERED" && (camp.outcomes || []).length && !(camp.outcomes || []).includes(outcome)) throw new HttpsError("invalid-argument", "اختر نتيجة المكالمة.");
  const callbackAt = result === "CALLBACK" ? Number(d.callbackAt) : null;
  if (result === "CALLBACK" && !(callbackAt > Date.now() && callbackAt < Date.now() + 14 * 86400e3)) throw new HttpsError("invalid-argument", "حدّد وقت معاودة الاتصال.");
  const now = Timestamp.now();
  const entry = {
    result, outcome: result === "ANSWERED" ? outcome : "", note: str(d.note, 500), at: now, byId: caller.uid, byName: caller.name || "", verified: null,
    ...(callbackAt ? { callbackAt: Timestamp.fromMillis(callbackAt) } : {}),
  };
  const update = { attempts: FieldValue.increment(1), lastAttemptAt: now, result, note: entry.note, history: FieldValue.arrayUnion(entry), verifyPending: true };
  const counts = {};
  if (result === "ANSWERED") {
    Object.assign(update, { status: "DONE", outcome: entry.outcome, completedAt: now, completedByName: caller.name || "" });
    Object.assign(counts, { pending: -1, done: 1, answered: 1 });
  } else if (result === "WRONG_NUMBER") {
    Object.assign(update, { status: "FAILED", completedAt: now, completedByName: caller.name || "" });
    Object.assign(counts, { pending: -1, failed: 1, wrong: 1 });
  } else if (result === "NO_ANSWER") {
    const n = (k.noAnswerCount || 0) + 1;
    update.noAnswerCount = n;
    counts.noAnswer = 1;
    if (n >= CALL_MAX_NO_ANSWER) {
      Object.assign(update, { status: "FAILED", completedAt: now, completedByName: caller.name || "" });
      Object.assign(counts, { pending: -1, failed: 1 });
    } else {
      // Retry in two hours, then on the next working day.
      const next = n === 1 ? Date.now() + 2 * 3600e3 : Date.parse(`${addWorkDays(riyadhDayOf(Date.now()), 1)}T08:00:00+03:00`);
      Object.assign(update, { dueAt: Timestamp.fromMillis(next), dueDay: riyadhDayOf(next) });
    }
  } else {
    Object.assign(update, { dueAt: Timestamp.fromMillis(callbackAt), dueDay: riyadhDayOf(callbackAt) });
  }
  await ref.update(update);
  await campRef.set({
    counts: Object.fromEntries(Object.entries(counts).map(([key, v]) => [key, FieldValue.increment(v)])),
    ...(result === "ANSWERED" && entry.outcome ? { outcomeCounts: { [entry.outcome]: FieldValue.increment(1) } } : {}),
    updatedAt: now,
  }, { merge: true });
  if (result === "WRONG_NUMBER" && camp.createdBy) {
    await notifyUsers([camp.createdBy], { title: "رقم ولي أمر غير صحيح", body: `${k.studentName} — ${k.phone} (حملة: ${camp.title || ""}). يحتاج تحديث الرقم في سجل الطلاب.`, complaintId: k.campaignId, type: "CALL_WRONG_NUMBER" });
  }
  const bev = (await db.collection("settings").doc("bevatel").get()).data();
  await verifyCallTask(ref, bev?.lastSyncAt?.toMillis?.() || 0);
  return { ok: true, status: update.status || "PENDING" };
});

// Morning: each agent's calls for today. Afternoon: each campaign's day,
// to whoever created it.
exports.callTasksMorning = onSchedule({ schedule: "0 7 * * 0-4", timeZone: "Asia/Riyadh" }, async () => {
  const today = riyadhDay();
  const [tasks, camps] = await Promise.all([db.collection("callTasks").where("status", "==", "PENDING").get(), db.collection("callCampaigns").where("status", "==", "ACTIVE").get()]);
  const active = new Set(camps.docs.map((x) => x.id));
  const per = {};
  tasks.docs.forEach((x) => { const k = x.data(); if (k.assignedTo && active.has(k.campaignId) && k.dueDay <= today) per[k.assignedTo] = (per[k.assignedTo] || 0) + 1; });
  for (const [uid, n] of Object.entries(per)) await notifyUsers([uid], { title: "مهام الاتصال اليوم", body: `لديك ${n} اتصالاً مطلوباً اليوم.`, complaintId: "", type: "CALL_DAILY" });
});
exports.callTasksSummary = onSchedule({ schedule: "0 16 * * 0-4", timeZone: "Asia/Riyadh" }, async () => {
  const today = riyadhDay();
  const camps = await db.collection("callCampaigns").where("status", "==", "ACTIVE").get();
  for (const cd of camps.docs) {
    const c = cd.data();
    const tasks = await db.collection("callTasks").where("campaignId", "==", cd.id).get();
    let attempts = 0;
    let answered = 0;
    tasks.docs.forEach((x) => (x.data().history || []).forEach((h) => { if (riyadhDayOf(h.at.toMillis()) === today) { attempts++; if (h.result === "ANSWERED") answered++; } }));
    const late = tasks.docs.filter((x) => x.data().status === "PENDING" && x.data().dueDay < today).length;
    await notifyUsers([c.createdBy], {
      title: `ملخص اليوم: ${c.title}`,
      body: `اتصالات اليوم ${attempts} (ردّ ${answered}). المنجز ${c.counts?.done || 0} من ${c.counts?.total || 0}، المتبقي ${c.counts?.pending || 0}${late ? `، متأخر ${late}` : ""}.`,
      complaintId: cd.id, type: "CALL_SUMMARY",
    });
  }
});

// --- Special education data (بيانات التربية الخاصة) --------------------------
// The ministry's import template (one per branch stage and academic year) is
// uploaded on the platform as a form (spedForms: the file itself, its stage
// and year, and the dropdown lists). Parents fill its columns through
// /sped/<formId>: one entry per student, and sending again with the same
// student and guardian IDs updates it. The platform downloads the entries
// written into that same template, ready to upload to the ministry.
const SPED_MAX = 500;
const SPED_ID = /^[12]\d{9}$/;

async function spedFormOf(formId) {
  if (typeof formId !== "string" || !/^[A-Za-z0-9]{6,40}$/.test(formId)) throw new HttpsError("invalid-argument", "الرابط غير صحيح.");
  const snap = await db.collection("spedForms").doc(formId).get();
  if (!snap.exists) throw new HttpsError("not-found", "الرابط غير صحيح.");
  return snap.data();
}
const spedId = (v) => normalizeDigits(v).replace(/\D/g, "");
function spedPhone(v) {
  let d = normalizeDigits(v).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^9665\d{8}$/.test(d)) d = `0${d.slice(3)}`;
  if (/^5\d{8}$/.test(d)) d = `0${d}`;
  return d;
}
// Gregorian "YYYY-MM-DD" from minYear up to today.
function spedDate(v, minYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (!m) return "";
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCDate() !== +m[3] || +m[1] < minYear || ms > Date.now()) return "";
  return m[0];
}
const spedOut = (x) => ({
  studentName: x.studentName, studentId: x.studentId, studentDob: x.studentDob, guardianName: x.guardianName, guardianId: x.guardianId,
  guardianDob: x.guardianDob, relation: x.relation, email: x.email, phone: x.phone, altPhone: x.altPhone || "",
  grade: x.grade, inclusionType: x.inclusionType, disability: x.disability,
});

exports.getSpedForm = onCall(async (request) => {
  const f = await spedFormOf(request.data?.formId);
  if (f.active === false) throw new HttpsError("failed-precondition", "انتهى استقبال البيانات عبر هذا الرابط. للاستفسار تواصلوا مع المدرسة.");
  return { title: f.title || "", stageName: f.stageName || "", year: f.year || "", lists: f.lists || {} };
});

// An entry sent earlier, for the parent to edit: both IDs must match.
exports.getSpedEntry = onCall(async (request) => {
  const formId = request.data?.formId;
  await spedFormOf(formId);
  const studentId = spedId(request.data?.studentId);
  const guardianId = spedId(request.data?.guardianId);
  if (!SPED_ID.test(studentId) || !SPED_ID.test(guardianId)) throw new HttpsError("invalid-argument", "أدخل رقم هوية الطالب/ة ورقم هوية ولي الأمر (10 أرقام).");
  const guardRef = db.collection("tripVerify").doc(`sped_${formId}_${studentId}`);
  const guard = (await guardRef.get()).data() || {};
  const recent = guard.lastAt && Date.now() - guard.lastAt.toMillis() < 3600 * 1000;
  if (recent && (guard.failures || 0) >= 8) throw new HttpsError("resource-exhausted", "محاولات كثيرة، حاول بعد ساعة أو تواصل مع المدرسة.");
  const x = (await db.collection("spedSubmissions").doc(`${formId}_${studentId}`).get()).data();
  if (!x || x.guardianId !== guardianId) {
    await guardRef.set({ failures: (recent ? guard.failures || 0 : 0) + 1, lastAt: Timestamp.now() });
    throw new HttpsError("not-found", "لا توجد بيانات مرسلة بهذين الرقمين.");
  }
  if (guard.failures) await guardRef.delete();
  return spedOut(x);
});

exports.submitSpedEntry = onCall(async (request) => {
  const d = request.data || {};
  const f = await spedFormOf(d.formId);
  if (f.active === false) throw new HttpsError("failed-precondition", "انتهى استقبال البيانات عبر هذا الرابط.");
  const lists = f.lists || {};
  const bad = (msg) => { throw new HttpsError("invalid-argument", msg); };
  const e = {
    studentName: str(d.studentName, 120), studentId: spedId(d.studentId), studentDob: spedDate(d.studentDob, 1990),
    guardianName: str(d.guardianName, 120), guardianId: spedId(d.guardianId), guardianDob: spedDate(d.guardianDob, 1930),
    relation: str(d.relation, 60), email: str(d.email, 120).toLowerCase(), phone: spedPhone(d.phone), altPhone: spedPhone(d.altPhone),
    grade: str(d.grade, 120), inclusionType: str(d.inclusionType, 120), disability: str(d.disability, 160),
  };
  if (!e.studentName || !e.guardianName) bad("أدخل اسم الطالب/ة واسم ولي الأمر.");
  if (!SPED_ID.test(e.studentId)) bad("رقم هوية الطالب/ة يجب أن يكون 10 أرقام.");
  if (!SPED_ID.test(e.guardianId)) bad("رقم هوية ولي الأمر يجب أن يكون 10 أرقام.");
  if (e.studentId === e.guardianId) bad("رقم هوية ولي الأمر مطابق لرقم هوية الطالب/ة.");
  if (!e.studentDob) bad("أدخل تاريخ ميلاد الطالب/ة بالتقويم الميلادي.");
  if (!e.guardianDob) bad("أدخل تاريخ ميلاد ولي الأمر بالتقويم الميلادي.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.email)) bad("أدخل بريداً إلكترونياً صحيحاً.");
  if (!/^05\d{8}$/.test(e.phone)) bad("أدخل رقم جوال صحيحاً (05xxxxxxxx).");
  if (e.altPhone && !/^0\d{8,9}$/.test(e.altPhone)) bad("رقم التواصل الآخر غير صحيح.");
  const inList = (key, v, label) => { if (!(lists[key] || []).includes(v)) bad(`اختر ${label} من القائمة.`); };
  inList("relations", e.relation, "العلاقة مع الطالب/ة");
  inList("grades", e.grade, "الصف");
  inList("inclusionTypes", e.inclusionType, "نوع الدمج التعليمي");
  inList("disabilities", e.disability, "نوع الإعاقة");

  const ref = db.collection("spedSubmissions").doc(`${d.formId}_${e.studentId}`);
  const prev = (await ref.get()).data();
  if (prev && prev.guardianId !== e.guardianId) {
    throw new HttpsError("already-exists", "تم إرسال بيانات هذا الطالب/ة مسبقاً برقم هوية ولي أمر مختلف. للتعديل تواصلوا مع المدرسة.");
  }
  if (!prev) {
    const n = (await db.collection("spedSubmissions").where("formId", "==", d.formId).count().get()).data().count;
    if (n >= SPED_MAX) throw new HttpsError("resource-exhausted", "اكتمل العدد المسموح في هذا النموذج. تواصلوا مع المدرسة.");
  }
  const s = (await db.collection("students").doc(e.studentId).get()).data();
  const now = Timestamp.now();
  await ref.set({
    ...e, formId: d.formId, inRoster: !!s, rosterName: s ? s.nameAr || s.name || "" : "", rosterBranch: s ? (await branchResolver())(s) : "",
    createdAt: prev?.createdAt || now, updatedAt: now, editCount: prev ? (prev.editCount || 0) + 1 : 0,
  });
  return { updated: !!prev };
});
