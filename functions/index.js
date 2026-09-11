const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getMessaging } = require("firebase-admin/messaging");
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

  const openCount = (
    await db.collection("complaints")
      .where("assignedTo", "array-contains", uid)
      .where("status", "in", OPEN_STATUSES)
      .get()
  ).size;
  if (openCount > 0) {
    throw new HttpsError("failed-precondition", `لا يمكن الحذف: لدى هذا الموظف ${openCount} ملاحظة مفتوحة — أعد إسنادها أولاً.`);
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

  const { name, email, password, role, branch, access, perms, phone, jobTitle, department, active } = request.data || {};
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
    branch: branch || null,
    access: access === "all" ? "all" : "branch",
    perms: {
      edit: !!perms?.edit,
      delete: !!perms?.delete,
      users: !!perms?.users,
    },
    phone: phone || null,
    jobTitle: jobTitle || null,
    department: department || null,
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
async function notifyUsers(userIds, { title, body, complaintId, type }) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;

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

// Helper to add working hours skipping weekends (Fri/Sat)
function addWorkingHours(startDate, hoursToAdd) {
  let currentDate = new Date(startDate.getTime());
  let remainingHours = hoursToAdd;

  while (remainingHours > 0) {
    currentDate.setHours(currentDate.getHours() + 1);
    const day = currentDate.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
    if (day !== 5 && day !== 6) {
      remainingHours--;
    }
  }
  return currentDate;
}

// 1. Calculate Initial SLA when Complaint is Created + email the parent a receipt confirmation
exports.calculateInitialSLA = onDocumentCreated({ document: "complaints/{complaintId}", secrets: EMAIL_SECRETS }, async (event) => {
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
    await notifyUsers(data.assignedTo, {
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

  if (data.dueDate) return; // Already has due date

  const priority = data.priority || 'NORMAL';
  let hours = 48;
  if (priority === 'URGENT') hours = 6;
  if (priority === 'HIGH') hours = 24;

  const dueDate = addWorkingHours(new Date(), hours);

  return snap.ref.update({
    dueDate: Timestamp.fromDate(dueDate),
    slaStatus: 'ACTIVE'
  });
});

// Tech-support tickets: compute the 4-working-hour close SLA and notify an
// assignee chosen at creation time (the form auto-assigns an IT specialist).
exports.calculateItTicketSla = onDocumentCreated("techSupportTickets/{ticketId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();

  if (data.assignedTo) {
    await notifyUsers([data.assignedTo], {
      title: "بلاغ تقني جديد أُسند إليك",
      body: `البلاغ رقم ${data.ticketId} (${data.problemType}) تم إسناده إليك.`,
      complaintId: event.params.ticketId,
      type: "IT_ASSIGNED",
    });
  }

  if (data.dueDate) return;
  const dueDate = addWorkingHours(new Date(), 4);
  return snap.ref.update({ dueDate: Timestamp.fromDate(dueDate) });
});

// Notifies a (re)assigned IT specialist on later transfers — creation-time
// assignment is handled by calculateItTicketSla above. Also notifies
// managers/executives when a staff member manually escalates a ticket
// (see TechSupportDetails.jsx's handleEscalate, which bumps `escalation`).
exports.handleItTicketAssignment = onDocumentUpdated("techSupportTickets/{ticketId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (after.assignedTo && after.assignedTo !== before.assignedTo) {
    await notifyUsers([after.assignedTo], {
      title: "تم إسناد بلاغ تقني لك",
      body: `البلاغ رقم ${after.ticketId} تم إسناده إليك للمعالجة.`,
      complaintId: event.params.ticketId,
      type: "IT_ASSIGNED",
    });
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

// Emails a staff member whenever they receive an in-app notification
// (assignment, SLA reminder, escalation), so nothing depends on them having
// the app open.
exports.emailOnNotification = onDocumentCreated({ document: "notifications/{notificationId}", secrets: EMAIL_SECRETS }, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const userDoc = await db.collection("users").doc(data.userId).get();
  const email = userDoc.exists ? userDoc.data().email : null;
  if (!email) return;

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
exports.handleSlaStatusChanges = onDocumentUpdated("complaints/{complaintId}", async (event) => {
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

  // Notify managers/admin when a complaint is escalated (manually or via SLA breach)
  if (before.status !== 'ESCALATED' && after.status === 'ESCALATED') {
    const managerIds = await getUserIdsByRoles(["DEPARTMENT_MANAGER", "UPPER_MANAGEMENT", "ADMIN"]);
    await notifyUsers(managerIds, {
      title: "تصعيد ملاحظة",
      body: `الملاحظة رقم ${after.complaintId} تم تصعيدها وتحتاج متابعة.`,
      complaintId,
      type: "ESCALATED",
    });
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
      const now = Date.now();
      const pausedTimeMs = now - pausedAt.toMillis();
      
      const newDueDateMs = currentDueDate.toMillis() + pausedTimeMs;
      
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
  // SLA and no escalation.
  const itSnapshot = await db.collection("techSupportTickets")
    .where("status", "in", ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_CONFIRMATION"])
    .get();

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
          metadata: { info: `تجاوز مدة الإغلاق المعتمدة (4 ساعات) — تصعيد مستوى ${level}` },
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
        if (elapsed >= 60 * 60 * 1000 && data.assignedTo) {
          await notifyUsers([data.assignedTo], {
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

  const match = TRACKABLE_TYPES.find((t) => trackingId.startsWith(t.prefix));
  if (!match) {
    throw new HttpsError("not-found", "عفواً، لم يتم العثور على سجل بهذا الرقم.");
  }

  const snapshot = await db.collection(match.collection).where(match.idField, "==", trackingId).limit(1).get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "عفواً، لم يتم العثور على سجل بهذا الرقم.");
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  const logsSnapshot = await db.collection(`${match.collection}/${doc.id}/activityLog`).orderBy("createdAt", "desc").get();
  const history = logsSnapshot.docs
    .map((d) => d.data())
    .filter((l) => l.action !== "INTERNAL_COMMENT_ADDED" && l.action !== "NOTE_ADDED")
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
    studentName: data.studentName || null,
    itemName: data.itemName || null,
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
  if (ticket.status !== "WAITING_CONFIRMATION") {
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
      closedAt: now,
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
