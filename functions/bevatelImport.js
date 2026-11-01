// Bevatel's Excel call reports (importBevatelCalls). The reports have no call
// id, so each row is matched to a saved webhook call by number and time.

const HOP_SEC = 5; // a call's next queue starts when its wait in the last ends
const MATCH_SEC = 120; // report time against webhook time, on top of the wait
const SAME_CALL_SEC = 60;
const MAX_ROWS = 20000;

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const secOf = (v) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(v || "").trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
const msOf = (date) => Date.parse(`${date.replace(" ", "T")}+03:00`);
const isShortNumber = (v) => /^\d{1,5}$/.test(String(v || ""));
// Numbers are compared by their last digits: the report and the webhook
// write the same number with different prefixes.
const phoneTail = (v) => String(v || "").slice(-9);

// Only the fields the report has; rows without a usable date are dropped and
// a row sent twice (the same file picked twice) counts once.
function cleanReportRows(list) {
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const seen = new Set();
  return (Array.isArray(list) ? list.slice(0, MAX_ROWS) : []).flatMap((r) => {
    const date = text(r?.date, 19);
    if (!["in", "out"].includes(r?.dir) || !DATE_RE.test(date) || Number.isNaN(msOf(date))) return [];
    const row = {
      dir: r.dir, date, ms: msOf(date), number: text(r.number, 30), queue: text(r.queue, 80), agent: /^none$/i.test(text(r.agent, 80)) ? "" : text(r.agent, 80),
      event: text(r.event, 30), waitSec: secOf(r.wait), talkSec: secOf(r.talk), did: text(r.did, 30),
    };
    const dup = `${row.dir}|${row.date}|${row.number}|${row.event}`;
    if (seen.has(dup)) return [];
    seen.add(dup);
    return [row];
  });
}

// A call that times out in one queue and moves to the next is a row per
// queue in the report: one call, ending as its last row did.
function mergeQueueHops(rows) {
  const merged = [];
  const last = new Map(); // number → that caller's latest call
  [...rows].sort((a, b) => a.ms - b.ms).forEach((r) => {
    const prev = last.get(r.number);
    if (prev && /TIMEOUT/i.test(prev.event) && Math.abs(r.ms - prev.endMs) <= HOP_SEC * 1000) {
      Object.assign(prev, { event: r.event, queue: r.queue, agent: r.agent, talkSec: r.talkSec, waitSec: prev.waitSec + r.waitSec, endMs: r.ms + r.waitSec * 1000, hops: prev.hops + 1 });
      return;
    }
    const call = { ...r, endMs: r.ms + r.waitSec * 1000, hops: 1 };
    merged.push(call);
    last.set(r.number, call);
  });
  return merged;
}

// Pairs rows ({ key, dir, ms, phone, answered, waitSec }) with saved calls
// ({ id, dir, ms, phone, answered, reportKey, via }), closest first and
// answered with answered. A call matched by an earlier import keeps its row.
// `extra` are saved calls with no row of their own: a second leg of a call
// the report has once, or an internal number the report leaves out.
function matchReportCalls(rows, calls) {
  const keys = new Set(rows.map((r) => r.key));
  const pairs = new Map(calls.filter((c) => keys.has(c.reportKey)).map((c) => [c.reportKey, c]));
  const free = calls.filter((c) => !c.reportKey);
  const open = rows.filter((r) => !pairs.has(r.key));
  const options = [];
  open.forEach((r) => free.forEach((c) => {
    const gap = Math.abs(r.ms - c.ms);
    if (c.dir === r.dir && c.phone === r.phone && gap <= (r.waitSec + MATCH_SEC) * 1000) options.push({ r, c, gap, same: r.answered === c.answered });
  }));
  options.sort((a, b) => Number(b.same) - Number(a.same) || a.gap - b.gap);
  const used = new Set();
  options.forEach(({ r, c }) => {
    if (pairs.has(r.key) || used.has(c.id)) return;
    pairs.set(r.key, c);
    used.add(c.id);
  });
  const extra = free.filter((c) => !used.has(c.id) && (
    (c.dir === "out" && isShortNumber(c.phone)) ||
    rows.some((r) => r.dir === c.dir && r.phone === c.phone && Math.abs(r.ms - c.ms) <= SAME_CALL_SEC * 1000)
  ));
  return { pairs, extra };
}

module.exports = { cleanReportRows, mergeQueueHops, matchReportCalls, isShortNumber, phoneTail };
