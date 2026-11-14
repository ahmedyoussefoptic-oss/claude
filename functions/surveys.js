// «تقييمات أولياء الأمور» — a feedback form sent to parents as one link (like
// the Parent-Teacher Conference Google Form): staff build it in the CRM from
// a template (every question can be edited), share /survey/<code> (a branch
// can be fixed with ?branch=<id>) or its QR poster, and the answers come back
// here with the averages.
//   surveyForms/{id}                  the form: title, intro, items, branches, status, code
//   surveyForms/{id}/responses/{id}   one parent's answers for one child
//   surveyThrottle/{hash}             submissions per network address (spam guard)
// Read and written only here (firestore.rules deny these collections).
const { meetingsAllowed } = require("./meetingAccess");

// Question types: «teacher» = the meeting with one subject's teacher (1–5 or
// «لم أقابله»); «rating» = 1 lowest … 5 highest; «agree» = 1 strongly
// disagree … 5 strongly agree; «choice» = one of a few options; «text».
const ITEM_TYPES = ["teacher", "rating", "agree", "choice", "text"];
const RATED = new Set(["teacher", "rating", "agree"]);
const GRADES = ["KG1", "KG2", "KG3", ...Array.from({ length: 12 }, (_, i) => `G${i + 1}`)];
const CURRICULA = ["AMERICAN", "BRITISH"];
const MAX_ITEMS = 60;
const THROTTLE = { max: 40, window: 10 * 60e3 };
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const clip = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// A parent's answers to a form's questions: only valid values are kept
// (1–5, «NA» where allowed, a listed option, text); `missing` = required
// questions left out; `low` = any rating of 1 or 2. Also used by the
// meeting pages (functions/meetings.js) when a meeting links a form.
function cleanAnswers(f, raw) {
  const answers = {};
  const missing = [];
  for (const it of f.items) {
    const v = raw?.[it.id];
    let a = null;
    if (RATED.has(it.type)) {
      const n = Math.floor(Number(v));
      if (v === "NA" && it.na) a = "NA";
      else if (n >= 1 && n <= 5) a = n;
    } else if (it.type === "choice") {
      if ((it.options || []).some((o) => o.id === v)) a = v;
    } else {
      a = clip(v, 1500) || null;
    }
    if (a === null) { if (it.required) missing.push(it.id); } else answers[it.id] = a;
  }
  const low = f.items.some((it) => RATED.has(it.type) && typeof answers[it.id] === "number" && answers[it.id] <= 2);
  return { answers, low, missing };
}

function surveysModule(d) {
  const { db, Timestamp, FieldValue, HttpsError, onCall, crypto, str, callerHasBranch, callerAll } = d;
  const out = {};
  const ms = (ts) => (ts?.toMillis ? ts.toMillis() : 0);
  const forms = () => db.collection("surveyForms");

  async function caller(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
    const u = (await db.collection("users").doc(request.auth.uid).get()).data();
    if (!meetingsAllowed(u)) throw new HttpsError("permission-denied", "لا تملك صلاحية «تقييمات أولياء الأمور».");
    return { uid: request.auth.uid, ...u };
  }
  // A form for every branch (none chosen) is seen by all; its answers are
  // still shown only for the caller's branches.
  const sees = (u, f) => callerAll(u) || f.createdBy === u.uid || !(f.branches || []).length || f.branches.some((b) => callerHasBranch(u, b));
  const manages = (u, f) => callerAll(u) || f.createdBy === u.uid;
  const seesAnswer = (u, r) => callerAll(u) || callerHasBranch(u, r.info?.branch);

  async function loadForm(id, u) {
    if (typeof id !== "string" || !/^[A-Za-z0-9]{6,40}$/.test(id)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
    const ref = forms().doc(id);
    const snap = await ref.get();
    if (!snap.exists || !sees(u, snap.data())) throw new HttpsError("not-found", "التقييم غير موجود.");
    return { ref, f: snap.data() };
  }

  const text2 = (x, max) => ({ ar: str(x?.ar, max), en: str(x?.en, max) });
  function cleanItems(list) {
    if (!Array.isArray(list)) throw new HttpsError("invalid-argument", "أسئلة التقييم غير صالحة.");
    const seen = new Set();
    const items = list.slice(0, MAX_ITEMS).map((x) => {
      if (!ITEM_TYPES.includes(x?.type)) return null;
      let id = /^[A-Za-z0-9_]{1,24}$/.test(x.id || "") ? x.id : "";
      if (!id || seen.has(id)) id = `q${crypto.randomBytes(4).toString("hex")}`;
      const it = { id, type: x.type, ...text2(x, 300), required: x.required === true };
      if (!it.ar && !it.en) return null;
      if (RATED.has(it.type)) it.na = it.type === "teacher" || x.na === true;
      if (it.type !== "teacher") it.group = text2(x.group, 120);
      if (it.type === "choice") {
        it.options = (Array.isArray(x.options) ? x.options : []).slice(0, 8)
          .map((o, i) => ({ id: /^[A-Za-z0-9_]{1,16}$/.test(o?.id || "") ? o.id : `O${i + 1}`, ...text2(o, 80) }))
          .filter((o) => o.ar || o.en);
        if (new Set(it.options.map((o) => o.id)).size !== it.options.length || it.options.length < 2) return null;
      }
      seen.add(id);
      return it;
    }).filter(Boolean);
    if (!items.length) throw new HttpsError("invalid-argument", "أضف سؤالاً واحداً على الأقل.");
    return items;
  }

  const formOut = (id, f, full) => ({
    id, code: f.code, title: f.title, date: f.date || "", status: f.status, branches: f.branches || [],
    responses: f.responses || 0, lastResponseAt: ms(f.lastResponseAt), createdByName: f.createdByName || "", createdAt: ms(f.createdAt),
    items: f.items.length,
    ...(full ? { intro: f.intro || { ar: "", en: "" }, items: f.items, askClass: f.askClass !== false } : {}),
  });

  async function newCode() {
    for (let i = 0; i < 6; i++) {
      const code = Array.from(crypto.randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
      if ((await forms().where("code", "==", code).limit(1).get()).empty) return code;
    }
    throw new HttpsError("internal", "تعذّر إنشاء الرابط، حاول مرة أخرى.");
  }

  // --- staff -----------------------------------------------------------------
  out.listSurveyForms = onCall(async (request) => {
    const u = await caller(request);
    const snap = await forms().orderBy("createdAt", "desc").limit(300).get();
    return { forms: snap.docs.filter((x) => sees(u, x.data())).map((x) => ({ ...formOut(x.id, x.data(), false), canManage: manages(u, x.data()) })) };
  });

  out.saveSurveyForm = onCall(async (request) => {
    const u = await caller(request);
    const dd = request.data || {};
    const title = str(dd.title, 160);
    if (!title) throw new HttpsError("invalid-argument", "اكتب عنوان التقييم.");
    let branches = Array.isArray(dd.branches) ? [...new Set(dd.branches.filter((b) => typeof b === "string" && /^[A-Z0-9_]{2,40}$/.test(b)))] : [];
    if (!callerAll(u)) {
      if (branches.some((b) => !callerHasBranch(u, b))) throw new HttpsError("permission-denied", "اختر من فروعك فقط.");
      if (!branches.length) branches = [...new Set([...(u.branches || []), u.branch].filter(Boolean))];
    }
    const data = {
      title, date: /^\d{4}-\d{2}-\d{2}$/.test(dd.date || "") ? dd.date : "",
      intro: text2(dd.intro, 2500), items: cleanItems(dd.items), branches, askClass: dd.askClass !== false,
      updatedAt: Timestamp.now(), updatedBy: u.uid,
    };
    if (dd.id) {
      const { ref, f } = await loadForm(dd.id, u);
      if (!manages(u, f)) throw new HttpsError("permission-denied", "يعدّله من أنشأه أو الإدارة.");
      await ref.update(data);
      return { id: ref.id };
    }
    const ref = forms().doc();
    await ref.set({ ...data, code: await newCode(), status: "OPEN", responses: 0, createdBy: u.uid, createdByName: u.name || "", createdAt: Timestamp.now() });
    return { id: ref.id };
  });

  out.getSurveyForm = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    const u = await caller(request);
    const { ref, f } = await loadForm(request.data?.id, u);
    const snap = await ref.collection("responses").orderBy("createdAt", "desc").limit(6000).get();
    const responses = snap.docs.map((x) => ({ id: x.id, ...x.data() })).filter((r) => seesAnswer(u, r))
      .map((r) => ({ id: r.id, info: r.info, answers: r.answers || {}, low: r.low === true, createdAt: ms(r.createdAt) }));
    return { form: { ...formOut(ref.id, f, true), canManage: manages(u, f) }, responses, hidden: snap.size - responses.length };
  });

  out.surveyFormAction = onCall(async (request) => {
    const u = await caller(request);
    const { action, id, responseId } = request.data || {};
    const { ref, f } = await loadForm(id, u);
    if (!manages(u, f)) throw new HttpsError("permission-denied", "يديره من أنشأه أو الإدارة.");
    if (action === "open" || action === "close") {
      await ref.update({ status: action === "open" ? "OPEN" : "CLOSED", updatedAt: Timestamp.now(), updatedBy: u.uid });
    } else if (action === "deleteResponse") {
      if (typeof responseId !== "string" || !/^[A-Za-z0-9]{6,40}$/.test(responseId)) throw new HttpsError("invalid-argument", "طلب غير صالح.");
      const rRef = ref.collection("responses").doc(responseId);
      await db.runTransaction(async (tx) => {
        if (!(await tx.get(rRef)).exists) return;
        tx.delete(rRef);
        tx.update(ref, { responses: FieldValue.increment(-1) });
      });
    } else if (action === "delete") {
      if (!(await ref.collection("responses").limit(1).get()).empty) throw new HttpsError("failed-precondition", "في التقييم ردود — أغلقه بدلاً من حذفه.");
      await ref.delete();
    } else {
      throw new HttpsError("invalid-argument", "طلب غير صالح.");
    }
    return { ok: true };
  });

  // --- parents (no sign-in) ----------------------------------------------------
  async function formByCode(code) {
    if (typeof code !== "string" || !/^[a-z0-9]{6,16}$/.test(code)) throw new HttpsError("not-found", "رابط التقييم غير صحيح.");
    const snap = await forms().where("code", "==", code).limit(1).get();
    if (snap.empty) throw new HttpsError("not-found", "رابط التقييم غير صحيح.");
    return { ref: snap.docs[0].ref, f: snap.docs[0].data() };
  }

  out.surveyFormPublic = onCall(async (request) => {
    const { f } = await formByCode(request.data?.code);
    return {
      title: f.title, date: f.date || "", intro: f.intro || { ar: "", en: "" }, items: f.items,
      branches: f.branches || [], askClass: f.askClass !== false, open: f.status === "OPEN",
    };
  });

  // At most THROTTLE.max answers per network address in its window (a school
  // network is shared by many parents on the day, hence the high number).
  async function throttle(request) {
    const ip = String(request.rawRequest?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || request.rawRequest?.ip || "";
    if (!ip) return;
    const ref = db.collection("surveyThrottle").doc(crypto.createHash("sha256").update(`survey:${ip}`).digest("hex").slice(0, 32));
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data();
      const now = Date.now();
      const fresh = !cur || now - ms(cur.since) > THROTTLE.window;
      if (!fresh && (cur.count || 0) >= THROTTLE.max) throw new HttpsError("resource-exhausted", "أُرسل عدد كبير من التقييمات من هذه الشبكة، حاول بعد دقائق.");
      tx.set(ref, fresh ? { since: Timestamp.now(), count: 1 } : { since: cur.since, count: (cur.count || 0) + 1 });
    });
  }

  out.submitSurveyResponse = onCall(async (request) => {
    const dd = request.data || {};
    const { ref, f } = await formByCode(dd.code);
    if (f.status !== "OPEN") throw new HttpsError("failed-precondition", "انتهت فترة هذا التقييم، شكراً لكم.");
    const i = dd.info || {};
    const info = {
      studentName: str(i.studentName, 120).replace(/\s+/g, " "), branch: str(i.branch, 40),
      curriculum: CURRICULA.includes(i.curriculum) ? i.curriculum : "", grade: GRADES.includes(i.grade) ? i.grade : "",
      className: f.askClass !== false ? str(i.className, 20) : "",
    };
    const branchOk = /^[A-Z0-9_]{2,40}$/.test(info.branch) && (!(f.branches || []).length || f.branches.includes(info.branch));
    if (info.studentName.length < 2 || !branchOk || !info.curriculum || !info.grade) throw new HttpsError("invalid-argument", "أكمل بيانات الطالب/ة (الاسم، الفرع، المنهج، الصف).");
    const { answers, low, missing } = cleanAnswers(f, dd.answers);
    if (missing.length) throw new HttpsError("invalid-argument", "أجب عن الأسئلة المطلوبة (*).");
    if (!Object.keys(answers).length) throw new HttpsError("invalid-argument", "أجب عن سؤال واحد على الأقل.");
    await throttle(request);
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(ref.collection("responses").doc(), { info, answers, low, lang: dd.lang === "en" ? "en" : "ar", createdAt: now });
    batch.update(ref, { responses: FieldValue.increment(1), lastResponseAt: now });
    await batch.commit();
    return { ok: true };
  });

  return out;
}

module.exports = surveysModule;
Object.assign(module.exports, { cleanAnswers, GRADES, CURRICULA });
