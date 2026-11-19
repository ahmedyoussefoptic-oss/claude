import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Plus, Loader2, X, FileDown, Printer, Pause, Play, Lock, Upload, Users as UsersIcon, ShieldCheck, ShieldAlert, ShieldQuestion, Flame, ArrowRight, Pencil, Shuffle } from 'lucide-react';
import { functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { STAGES } from '../../config/complaintTypes';
import { callRoleOf } from '../../config/adminPermissions';
import { printPage, escapeHtml } from '../../utils/printPage';
import { Modal, Field, Tile, Pill, inputCls, btn } from '../platform/ui';
import { readCallSheet, callRows } from '../../utils/callExcel';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const riyadhDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const STATUS_STYLE = { ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200', PAUSED: 'bg-amber-50 text-amber-800 border-amber-200', CLOSED: 'bg-slate-100 text-slate-500 border-slate-200' };
const TASK_STYLE = { PENDING: 'bg-sky-50 text-sky-700 border-sky-200', DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200', FAILED: 'bg-rose-50 text-rose-700 border-rose-200' };

const ROW_STYLE = {
  ROSTER: 'bg-emerald-50 text-emerald-700 border-emerald-200', FILE: 'bg-sky-50 text-sky-700 border-sky-200', MERGED: 'bg-slate-50 text-slate-600 border-slate-200',
  NO_PHONE: 'bg-rose-50 text-rose-700 border-rose-200', NOT_FOUND: 'bg-rose-50 text-rose-700 border-rose-200', OUT_OF_SCOPE: 'bg-amber-50 text-amber-800 border-amber-200', DUPLICATE: 'bg-slate-50 text-slate-500 border-slate-200',
};
const ROW_OK = ['ROSTER', 'FILE', 'MERGED'];

// The uploaded file as a table: which columns hold the ID / mobile / name,
// and (after «معاينة») what became of each row.
function FilePreview({ sheet, cols, setCols, merge, setMerge, status }) {
  const { t } = useTranslation();
  const [onlyOut, setOnlyOut] = useState(false);
  const roles = { idCol: t('callTasks.file.idCol'), phoneCol: t('callTasks.file.phoneCol'), nameCol: t('callTasks.file.nameCol') };
  const roleOf = (i) => Object.keys(roles).find((k) => cols[k] === i);
  const rows = sheet.data.map((r, i) => ({ r, i, st: status?.[i] })).filter((x) => !onlyOut || (x.st && !ROW_OK.includes(x.st)));
  const counts = {};
  (status || []).forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {Object.entries(roles).map(([k, label]) => (
          <Field key={k} label={label}>
            <select value={cols[k]} onChange={(e) => setCols((c) => ({ ...c, [k]: Number(e.target.value) }))} className={inputCls}>
              <option value={-1}>—</option>
              {sheet.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
            </select>
          </Field>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />{t('callTasks.file.merge')}</label>
      {status && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {Object.keys(ROW_STYLE).filter((k) => counts[k]).map((k) => <Pill key={k} className={ROW_STYLE[k]}>{t(`callTasks.file.status.${k}`)}: {counts[k]}</Pill>)}
          {Object.keys(counts).some((k) => !ROW_OK.includes(k)) && <label className="flex items-center gap-1.5 text-slate-600 ms-2"><input type="checkbox" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} />{t('callTasks.file.onlyOut')}</label>}
        </div>
      )}
      <div className="border border-slate-200 rounded-xl overflow-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-start">#</th>
              {status && <th className="px-2 py-1.5 text-start whitespace-nowrap">{t('callTasks.file.result')}</th>}
              {sheet.headers.map((h, i) => (
                <th key={i} className={`px-2 py-1.5 text-start whitespace-nowrap ${roleOf(i) ? 'bg-sky-100 text-sky-900' : ''}`}>{h}{roleOf(i) && <span className="block text-[10px] font-normal text-sky-700">{roles[roleOf(i)]}</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 300).map(({ r, i, st }) => (
              <tr key={i} className={st && !ROW_OK.includes(st) ? 'bg-rose-50/40' : ''}>
                <td className="px-2 py-1 text-slate-400 tabular-nums">{i + 1}</td>
                {status && <td className="px-2 py-1 whitespace-nowrap">{st && <Pill className={ROW_STYLE[st]}>{t(`callTasks.file.status.${st}`)}</Pill>}</td>}
                {sheet.headers.map((_, j) => <td key={j} className={`px-2 py-1 whitespace-nowrap max-w-56 truncate ${roleOf(j) ? 'bg-sky-50/50' : ''}`} title={r[j]}>{r[j]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{rows.length > 300 ? t('callTasks.file.first', { n: rows.length }) : t('callTasks.file.count', { n: rows.length })}{!status && ` — ${t('callTasks.file.previewHint')}`}</p>
    </div>
  );
}

// The last attempt's Bevatel check.
function Verify({ h, bevatelSyncAt }) {
  const { t } = useTranslation();
  if (!h) return null;
  if (h.verified === true) return <span className="text-emerald-700 inline-flex items-center gap-1 text-xs"><ShieldCheck className="w-3.5 h-3.5" />{t('callTasks.verified', { time: mmss(h.talkSec || 0) })}</span>;
  if (h.verified === false) return <span className="text-rose-700 inline-flex items-center gap-1 text-xs"><ShieldAlert className="w-3.5 h-3.5" />{t('callTasks.unverified')}</span>;
  return <span className="text-slate-400 inline-flex items-center gap-1 text-xs"><ShieldQuestion className="w-3.5 h-3.5" />{bevatelSyncAt ? t('callTasks.verifyPending') : t('callTasks.noBevatel')}</span>;
}

function CampaignForm({ onClose, onSaved }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const branches = useBranches();
  const users = useUsers();
  const myBranches = userData?.role === 'ADMIN' || userData?.isOwner || userData?.access === 'all' ? null : [...(userData?.branches || []), ...(userData?.branch ? [userData.branch] : [])];
  const scopeBranches = branches.filter((b) => !myBranches || myBranches.includes(b.id));
  const agents = users.filter((u) => u.active !== false && u.callRoles?.agent === true);
  const [f, setF] = useState({ title: '', goal: '', script: '', outcomes: '', priority: 'NORMAL', startDay: riyadhDay(), endDay: riyadhDay(), dailyQuota: 30, distribution: 'AUTO', agents: [] });
  const [mode, setMode] = useState('ROSTER');
  const [rb, setRb] = useState([]);
  const [stages, setStages] = useState([]);
  const [classes, setClasses] = useState('');
  const [sheet, setSheet] = useState(null);
  const [cols, setColsRaw] = useState({ idCol: -1, phoneCol: -1, nameCol: -1 });
  const [merge, setMergeRaw] = useState(true);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setPreview(null); };
  const toggle = (list, setList, v) => { setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]); setPreview(null); };
  const setCols = (fn) => { setColsRaw(fn); setPreview(null); };
  const setMerge = (v) => { setMergeRaw(v); setPreview(null); };
  const upload = async (file) => {
    setError(null);
    setPreview(null);
    setFileName(file.name);
    try {
      const sh = await readCallSheet(file);
      setSheet(sh);
      setColsRaw({ idCol: sh.idCol, phoneCol: sh.phoneCol, nameCol: sh.nameCol });
      if (!sh.data.length) setError(t('callTasks.file.empty'));
    } catch {
      setSheet(null);
      setError(t('callTasks.file.unreadable'));
    }
  };

  const targetLabel = mode === 'IDS'
    ? t('callTasks.form.fromExcel', { name: fileName, n: sheet?.data.length || 0 })
    : [rb.length ? rb.map((id) => branches.find((b) => b.id === id)?.name || id).join('، ') : t('common.allBranches'), stages.join('، '), classes].filter(Boolean).join(' · ');
  const payload = (extra = {}) => ({
    ...f, outcomes: f.outcomes.split(/[\n،,]/).map((x) => x.trim()).filter(Boolean), dailyQuota: Number(f.dailyQuota),
    target: mode === 'IDS' ? { mode, ...callRows(sheet, cols), merge } : { mode, branches: rb, stages, classes: classes.split(/[\s،,]+/).filter(Boolean) },
    targetLabel, ...extra,
  });
  const run = async (isPreview) => {
    setError(null);
    if (!f.title.trim()) { setError(t('callTasks.form.titleRequired')); return; }
    if (mode === 'IDS' && !sheet?.data.length) { setError(t('callTasks.form.excelRequired')); return; }
    if (mode === 'IDS' && cols.idCol < 0 && cols.phoneCol < 0) { setError(t('callTasks.file.needColumn')); return; }
    if (f.distribution === 'AUTO' && !f.agents.length) { setError(t('callTasks.form.agentsRequired')); return; }
    setBusy(true);
    try {
      const r = await call('saveCallCampaign', payload(isPreview ? { preview: true } : {}));
      if (isPreview) setPreview(r); else { onSaved(r); }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const chip = (active) => `px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;

  return (
    <Modal title={t('callTasks.form.title')} onClose={onClose} size="max-w-3xl"
      footer={<>
        <button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
        <button disabled={busy} onClick={() => run(true)} className={btn.ghost}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('callTasks.form.preview')}</button>
        <button disabled={busy || !preview} onClick={() => run(false)} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('callTasks.form.create')}</button>
      </>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('callTasks.form.name')} required className="md:col-span-2"><input value={f.title} onChange={set('title')} className={inputCls} /></Field>
        <Field label={t('callTasks.form.priority')}>
          <div className="flex gap-2">{['NORMAL', 'URGENT'].map((p) => <button type="button" key={p} onClick={() => setF((x) => ({ ...x, priority: p }))} className={chip(f.priority === p)}>{t(`callTasks.priority.${p}`)}</button>)}</div>
        </Field>
      </div>
      <Field label={t('callTasks.goal')}><input value={f.goal} onChange={set('goal')} className={inputCls} /></Field>
      <Field label={t('callTasks.script')} hint={t('callTasks.form.scriptHint')}><textarea rows={4} value={f.script} onChange={set('script')} className={inputCls} /></Field>
      <Field label={t('callTasks.form.outcomes')} hint={t('callTasks.form.outcomesHint')}><textarea rows={2} value={f.outcomes} onChange={set('outcomes')} className={inputCls} placeholder={t('callTasks.form.outcomesPlaceholder')} /></Field>

      <div className="border border-slate-200 rounded-xl p-3 space-y-3">
        <p className="text-sm font-bold text-slate-800">{t('callTasks.form.targets')}</p>
        <div className="flex gap-2">{['ROSTER', 'IDS'].map((m) => <button type="button" key={m} onClick={() => { setMode(m); setPreview(null); }} className={chip(mode === m)}>{t(`callTasks.form.mode.${m}`)}</button>)}</div>
        {mode === 'ROSTER' ? (
          <>
            <div className="flex flex-wrap gap-1.5">{scopeBranches.map((b) => <button type="button" key={b.id} onClick={() => toggle(rb, setRb, b.id)} className={chip(rb.includes(b.id))}>{b.name}</button>)}</div>
            <div className="flex flex-wrap gap-1.5">{STAGES.map((s) => <button type="button" key={s} onClick={() => toggle(stages, setStages, s)} className={chip(stages.includes(s))} dir="ltr">{s}</button>)}</div>
            <Field label={t('callTasks.form.classes')} hint={t('callTasks.form.classesHint')}><input value={classes} onChange={(e) => { setClasses(e.target.value); setPreview(null); }} className={inputCls} dir="ltr" /></Field>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer border border-dashed border-primary/40 rounded-xl p-3">
              <Upload className="w-4 h-4" />{fileName ? t('callTasks.form.fromExcel', { name: fileName, n: sheet?.data.length || 0 }) : t('callTasks.form.uploadExcel')}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload(file); }} />
            </label>
            {sheet && sheet.data.length > 0 && <FilePreview sheet={sheet} cols={cols} setCols={setCols} merge={merge} setMerge={setMerge} status={preview?.rowStatus} />}
          </>
        )}
      </div>

      <div className="border border-slate-200 rounded-xl p-3 space-y-3">
        <p className="text-sm font-bold text-slate-800">{t('callTasks.form.distribution')}</p>
        <div className="flex gap-2">{['AUTO', 'MANUAL'].map((m) => <button type="button" key={m} onClick={() => { setF((x) => ({ ...x, distribution: m })); setPreview(null); }} className={chip(f.distribution === m)}>{t(`callTasks.form.dist.${m}`)}</button>)}</div>
        <p className="text-xs text-slate-500">{t(`callTasks.form.distHint.${f.distribution}`)}</p>
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => <button type="button" key={a.id} onClick={() => { setF((x) => ({ ...x, agents: x.agents.includes(a.id) ? x.agents.filter((y) => y !== a.id) : [...x.agents, a.id] })); setPreview(null); }} className={chip(f.agents.includes(a.id))}>{a.name}</button>)}
          {!agents.length && <p className="text-xs text-amber-700">{t('callTasks.form.noAgents')}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('callTasks.form.startDay')}><input type="date" value={f.startDay} onChange={set('startDay')} className={inputCls} /></Field>
          <Field label={t('callTasks.form.endDay')}><input type="date" value={f.endDay} onChange={set('endDay')} className={inputCls} /></Field>
          <Field label={t('callTasks.form.quota')}><input type="number" min={1} max={500} value={f.dailyQuota} onChange={set('dailyQuota')} className={inputCls} /></Field>
        </div>
      </div>

      {preview && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm text-emerald-900 space-y-1">
          <p className="font-bold">{t('callTasks.form.previewCalls', { n: preview.parents })}</p>
          {preview.rowStatus
            ? <p className="text-xs">{t('callTasks.file.summary', { rows: preview.rows, calls: preview.parents, roster: preview.rowStatus.filter((x) => x === 'ROSTER').length, file: preview.fromFile, merged: preview.merged, out: preview.noPhone + preview.notFound + preview.outOfScope + preview.duplicates })}</p>
            : <p className="text-xs">{t('callTasks.form.previewDetail', { students: preview.students, noPhone: preview.noPhone, notFound: preview.notFound, outOfScope: preview.outOfScope })}</p>}
          {f.distribution === 'AUTO' && f.agents.length > 0 && (
            <p className={`text-xs ${preview.lastDay > f.endDay ? 'text-rose-700 font-bold' : ''}`}>{t('callTasks.form.previewSpread', { per: Math.ceil(preview.parents / f.agents.length), last: preview.lastDay })}{preview.lastDay > f.endDay ? ` — ${t('callTasks.form.previewOver')}` : ''}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// Editing a campaign's details (its targets and calls stay as they are).
function EditCampaign({ campaign: c, onClose, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ title: c.title, goal: c.goal || '', script: c.script || '', outcomes: (c.outcomes || []).join('\n'), priority: c.priority, endDay: c.endDay, dailyQuota: c.dailyQuota });
  const [reschedule, setReschedule] = useState(false);
  const users = useUsers();
  const allAgents = users.filter((u) => u.active !== false && u.callRoles?.agent === true);
  const [agents, setAgents] = useState(c.agents || []);
  const [redistribute, setRedistribute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleAgent = (id) => { setAgents((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])); setRedistribute(true); };
  const chip = (active) => `px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;
  const save = async () => {
    setError(null);
    if (!f.title.trim()) { setError(t('callTasks.form.titleRequired')); return; }
    if (redistribute && !agents.length) { setError(t('callTasks.form.agentsRequired')); return; }
    setBusy(true);
    try {
      const r = await call('updateCallCampaign', { id: c.id, ...f, outcomes: f.outcomes.split(/[\n،,]/).map((x) => x.trim()).filter(Boolean), dailyQuota: Number(f.dailyQuota), agents, redistribute, reschedule: !redistribute && reschedule });
      onSaved(r);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={t('callTasks.edit.title')} onClose={onClose} size="max-w-2xl"
      footer={<>
        <button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
        <button disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button>
      </>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('callTasks.form.name')} required className="md:col-span-2"><input value={f.title} onChange={set('title')} className={inputCls} /></Field>
        <Field label={t('callTasks.form.priority')}>
          <div className="flex gap-2">{['NORMAL', 'URGENT'].map((p) => <button type="button" key={p} onClick={() => setF((x) => ({ ...x, priority: p }))} className={chip(f.priority === p)}>{t(`callTasks.priority.${p}`)}</button>)}</div>
        </Field>
      </div>
      <Field label={t('callTasks.goal')}><input value={f.goal} onChange={set('goal')} className={inputCls} /></Field>
      <Field label={t('callTasks.script')} hint={t('callTasks.form.scriptHint')}><textarea rows={4} value={f.script} onChange={set('script')} className={inputCls} /></Field>
      <Field label={t('callTasks.form.outcomes')} hint={t('callTasks.form.outcomesHint')}><textarea rows={3} value={f.outcomes} onChange={set('outcomes')} className={inputCls} placeholder={t('callTasks.form.outcomesPlaceholder')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('callTasks.form.endDay')}><input type="date" min={c.startDay} value={f.endDay} onChange={set('endDay')} className={inputCls} /></Field>
        <Field label={t('callTasks.form.quota')}><input type="number" min={1} max={500} value={f.dailyQuota} onChange={set('dailyQuota')} className={inputCls} /></Field>
      </div>
      <div className="border border-slate-200 rounded-xl p-3 space-y-2">
        <p className="text-sm font-bold text-slate-800">{t('callTasks.edit.agents')}</p>
        <div className="flex flex-wrap gap-1.5">
          {allAgents.map((a) => <button type="button" key={a.id} onClick={() => toggleAgent(a.id)} className={chip(agents.includes(a.id))}>{a.name}</button>)}
          {!allAgents.length && <p className="text-xs text-amber-700">{t('callTasks.form.noAgents')}</p>}
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={redistribute} onChange={(e) => setRedistribute(e.target.checked)} /><span>{t('callTasks.edit.redistribute')}<span className="block text-xs text-slate-500">{t('callTasks.edit.redistributeHint')}</span></span></label>
      </div>
      {!redistribute && <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={reschedule} onChange={(e) => setReschedule(e.target.checked)} /><span>{t('callTasks.edit.reschedule')}<span className="block text-xs text-slate-500">{t('callTasks.edit.rescheduleHint')}</span></span></label>}
      <p className="text-xs text-slate-500">{t('callTasks.edit.note')}</p>
    </Modal>
  );
}

// Sharing a campaign's remaining calls by hand: how many each agent holds.
function RebalanceCalls({ campaignId, tasks, onClose, onSaved }) {
  const { t } = useTranslation();
  const users = useUsers();
  const pending = tasks.filter((k) => k.status === 'PENDING');
  const current = {};
  pending.forEach((k) => { if (k.assignedTo) current[k.assignedTo] = (current[k.assignedTo] || 0) + 1; });
  const unassigned = pending.filter((k) => !k.assignedTo).length;
  const agentIds = new Set(users.filter((u) => u.active !== false && u.callRoles?.agent === true).map((u) => u.id));
  Object.keys(current).forEach((id) => agentIds.add(id));
  const nameOf = (id) => users.find((u) => u.id === id)?.name || pending.find((k) => k.assignedTo === id)?.assignedName || id;
  const rows = [...agentIds].map((id) => ({ id, name: nameOf(id), now: current[id] || 0 })).sort((a, b) => b.now - a.now || a.name.localeCompare(b.name, 'ar'));
  const [counts, setCounts] = useState(() => Object.fromEntries(rows.map((r) => [r.id, String(r.now)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const num = (id) => Math.max(0, Math.floor(Number(counts[id]) || 0));
  const sum = rows.reduce((s, r) => s + num(r.id), 0);
  const left = pending.length - sum;
  const even = () => {
    const chosen = rows.filter((r) => num(r.id) > 0);
    const list = chosen.length ? chosen : rows;
    const base = Math.floor(pending.length / list.length);
    let extra = pending.length % list.length;
    setCounts(Object.fromEntries(rows.map((r) => [r.id, String(list.includes(r) ? base + (extra-- > 0 ? 1 : 0) : 0)])));
  };
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await call('rebalanceCallTasks', { campaignId, counts: Object.fromEntries(rows.filter((x) => num(x.id) > 0).map((x) => [x.id, num(x.id)])) });
      onSaved(r);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={t('callTasks.rebalance.title')} onClose={onClose} size="max-w-lg"
      footer={<>
        <button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
        <button disabled={busy || left !== 0 || !pending.length} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('callTasks.rebalance.save')}</button>
      </>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <p className="text-xs text-slate-500">{t('callTasks.rebalance.hint')}</p>
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 bg-slate-50 rounded-t-xl">
          <span className="flex-1">{t('callTasks.col.agent')}</span><span className="w-16 text-center">{t('callTasks.rebalance.now')}</span><span className="w-24 text-center">{t('callTasks.rebalance.new')}</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${num(r.id) !== r.now ? 'bg-sky-50/50' : ''}`}>
            <span className="flex-1 truncate">{r.name}</span>
            <span className="w-16 text-center tabular-nums text-slate-500">{r.now}</span>
            <input type="number" min={0} value={counts[r.id]} onChange={(e) => setCounts((x) => ({ ...x, [r.id]: e.target.value }))} className={`${inputCls} w-24 text-center py-1`} />
          </div>
        ))}
        {unassigned > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-amber-800">
            <span className="flex-1">{t('callTasks.unassigned')}</span><span className="w-16 text-center tabular-nums">{unassigned}</span><span className="w-24 text-center tabular-nums">0</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`font-medium ${left === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {t('callTasks.rebalance.sum', { sum, total: pending.length })}{left !== 0 && ` — ${left > 0 ? t('callTasks.rebalance.left', { n: left }) : t('callTasks.rebalance.over', { n: -left })}`}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={even} className={btn.ghost}>{t('callTasks.rebalance.even')}</button>
      </div>
    </Modal>
  );
}

function CampaignDetails({ id, onBack }) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const users = useUsers();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b || '—';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [agentFilter, setAgentFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  const [notice, setNotice] = useState('');
  const today = riyadhDay();

  const load = useCallback(() => call('getCallCampaign', { id }).then(setData).catch((err) => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const c = data?.campaign;
  const tasks = useMemo(() => data?.tasks || [], [data]);
  const last = (k) => k.history[k.history.length - 1];
  const late = (k) => k.status === 'PENDING' && k.dueDay < today;
  const shown = tasks.filter((k) => (filter === 'ALL' || (filter === 'LATE' ? late(k) : filter === 'UNASSIGNED' ? !k.assignedTo && k.status === 'PENDING' : filter === 'UNVERIFIED' ? k.history.some((h) => h.verified === false) : k.status === filter))
    && (!agentFilter || k.assignedTo === agentFilter));
  const perAgent = useMemo(() => {
    const m = {};
    tasks.forEach((k) => {
      const key = k.assignedTo || '';
      const a = (m[key] ||= { id: key, name: k.assignedName || '', total: 0, done: 0, pending: 0, late: 0, today: 0, attempts: 0, verified: 0, unverified: 0 });
      a.total++;
      if (k.status !== 'PENDING') a.done++; else a.pending++;
      if (late(k)) a.late++;
      k.history.forEach((h) => { a.attempts++; if (h.verified === true) a.verified++; if (h.verified === false) a.unverified++; if (h.at && riyadhDay(new Date(h.at)) === today) a.today++; });
    });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [tasks, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const agents = users.filter((u) => u.active !== false && u.callRoles?.agent === true);

  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const n = c.counts || {};
  const lateCount = tasks.filter(late).length;
  const maxOutcome = Math.max(1, ...Object.values(c.outcomeCounts));

  const setStatus = async (status) => { setBusy(true); try { await call('setCallCampaignStatus', { id, status }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const assign = async () => {
    setBusy(true);
    try { await call('assignCallTasks', { campaignId: id, taskIds: selected, agentId: assignTo }); setSelected([]); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const fileCols = c.fileColumns || [];
  const fileVal = (k, col) => (k.fileData || []).map((x) => x.data?.[col]).filter(Boolean).join(' | ');
  const row = (k) => ({
    [t('callTasks.col.student')]: k.studentName, [t('callTasks.col.ids')]: k.studentIds.join(' '), [t('callTasks.col.grade')]: k.grade, [t('common.branch')]: branchName(k.branch), [t('common.phone')]: k.phone,
    [t('callTasks.col.agent')]: k.assignedName, [t('callTasks.col.status')]: t(`callTasks.taskStatus.${k.status}`), [t('callTasks.col.outcome')]: k.outcome || (k.result ? t(`callTasks.results.${k.result}`) : ''),
    [t('callTasks.col.note')]: k.note, [t('callTasks.col.attempts')]: k.attempts, [t('callTasks.col.due')]: k.dueDay,
    [t('callTasks.col.verify')]: last(k) ? (last(k).verified === true ? `✓ ${mmss(last(k).talkSec)}` : last(k).verified === false ? '✗' : '…') : '',
    ...Object.fromEntries(fileCols.map((col) => [col, fileVal(k, col)])),
  });
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shown.map(row)), 'Calls');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perAgent.map((a) => ({ [t('callTasks.col.agent')]: a.name || t('callTasks.unassigned'), [t('callTasks.agentCol.total')]: a.total, [t('callTasks.agentCol.done')]: a.done, [t('callTasks.agentCol.pending')]: a.pending, [t('callTasks.agentCol.late')]: a.late, [t('callTasks.agentCol.attempts')]: a.attempts, [t('callTasks.agentCol.verified')]: a.verified, [t('callTasks.agentCol.unverified')]: a.unverified }))), 'Agents');
    XLSX.writeFile(wb, `calls-${c.title.slice(0, 30)}-${today}.xlsx`);
  };
  const print = () => {
    const head = [t('callTasks.col.agent'), t('callTasks.agentCol.total'), t('callTasks.agentCol.done'), t('callTasks.agentCol.pending'), t('callTasks.agentCol.late'), t('callTasks.agentCol.attempts'), t('callTasks.agentCol.verified'), t('callTasks.agentCol.unverified')];
    printPage({
      title: c.title, subtitle: `${c.startDay} — ${c.endDay} · ${c.target}`, school: t('trips.print.school'), dir: i18n.dir(), lang: i18n.language,
      body: `<p>${escapeHtml(t('callTasks.summaryLine', { total: n.total || 0, done: n.done || 0, answered: n.answered || 0, failed: n.failed || 0, pending: n.pending || 0, late: lateCount }))}</p>
<h3>${escapeHtml(t('callTasks.outcomesTitle'))}</h3><table><tbody>${Object.entries(c.outcomeCounts).map(([o, v]) => `<tr><td>${escapeHtml(o)}</td><td><b>${v}</b></td></tr>`).join('') || '<tr><td>—</td></tr>'}</tbody></table>
<h3>${escapeHtml(t('callTasks.byAgent'))}</h3><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${perAgent.map((a) => `<tr><td>${escapeHtml(a.name || t('callTasks.unassigned'))}</td><td>${a.total}</td><td>${a.done}</td><td>${a.pending}</td><td>${a.late}</td><td>${a.attempts}</td><td>${a.verified}</td><td>${a.unverified}</td></tr>`).join('')}</tbody></table>
<h3>${escapeHtml(t('callTasks.callsList', { n: shown.length, filter: t(`callTasks.filters.${filter}`) }))}</h3><table><thead><tr>${['student', 'grade', 'agent', 'due', 'status', 'outcome', 'attempts', 'verify'].map((k) => `<th>${escapeHtml(t(`callTasks.col.${k}`))}</th>`).join('')}${fileCols.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead><tbody>${shown.map((k) => `<tr><td>${escapeHtml(k.studentName)}<br><span dir="ltr" style="color:#64748b">${escapeHtml(k.phone)}</span></td><td dir="ltr">${escapeHtml(k.grade)}</td><td>${escapeHtml(k.assignedName || t('callTasks.unassigned'))}</td><td dir="ltr">${k.dueAt && k.status === 'PENDING' ? format(k.dueAt, 'yyyy-MM-dd HH:mm') : k.dueDay}</td><td>${escapeHtml(t(`callTasks.taskStatus.${k.status}`))}</td><td>${escapeHtml(k.outcome || (k.result ? t(`callTasks.results.${k.result}`) : ''))}${k.note ? `<br><span style="color:#64748b">${escapeHtml(k.note)}</span>` : ''}</td><td>${k.attempts || ''}</td><td>${last(k) ? (last(k).verified === true ? `✓ ${mmss(last(k).talkSec || 0)}` : last(k).verified === false ? '✗' : '…') : ''}</td>${fileCols.map((col) => `<td>${escapeHtml(fileVal(k, col))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      landscape: true,
      css: `h3 { color: #0369a1; font-size: 11pt; margin: 12px 0 5px } table { width: 100%; border-collapse: collapse; font-size: 9pt } th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: start } th { background: #f1f5f9 }`,
    });
  };
  const th = 'px-3 py-2 text-start font-medium whitespace-nowrap';
  const td = 'px-3 py-2 whitespace-nowrap';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-sm text-primary flex items-center gap-1 mb-1"><ArrowRight className="w-4 h-4" />{t('callTasks.backToCampaigns')}</button>
          <h2 className="text-xl font-bold text-slate-900 flex flex-wrap items-center gap-2">{c.title}<Pill className={STATUS_STYLE[c.status]}>{t(`callTasks.status.${c.status}`)}</Pill>{c.priority === 'URGENT' && <Pill className="bg-rose-50 text-rose-700 border-rose-200"><Flame className="w-3 h-3 ml-0.5" />{t('callTasks.urgent')}</Pill>}</h2>
          <p className="text-sm text-slate-500">{c.startDay} — {c.endDay} · {t('callTasks.quotaLine', { n: c.dailyQuota })} · {t(`callTasks.form.dist.${c.distribution}`)} · {c.target}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => setEditing(true)} className={btn.ghost}><Pencil className="w-4 h-4" />{t('callTasks.edit.button')}</button>
          {c.status === 'ACTIVE' && <button disabled={busy} onClick={() => setStatus('PAUSED')} className={btn.ghost}><Pause className="w-4 h-4" />{t('callTasks.pause')}</button>}
          {c.status === 'PAUSED' && <button disabled={busy} onClick={() => setStatus('ACTIVE')} className={btn.ghost}><Play className="w-4 h-4" />{t('callTasks.resume')}</button>}
          {c.status !== 'CLOSED' && <button disabled={busy} onClick={() => { if (window.confirm(t('callTasks.closeConfirm'))) setStatus('CLOSED'); }} className={btn.ghost}><Lock className="w-4 h-4" />{t('callTasks.close')}</button>}
          <button onClick={exportExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('platform.exportExcel')}</button>
          <button onClick={print} className={btn.ghost}><Printer className="w-4 h-4" />{t('callTasks.print')}</button>
        </div>
      </div>

      {notice && <p className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3">{notice}</p>}
      {editing && <EditCampaign campaign={c} onClose={() => setEditing(false)} onSaved={async (r) => { setEditing(false); setNotice(r.moved ? t('callTasks.edit.savedMoved', { n: r.moved }) : t('callTasks.edit.saved')); await load(); }} />}
      {rebalancing && <RebalanceCalls campaignId={id} tasks={tasks} onClose={() => setRebalancing(false)} onSaved={async (r) => { setRebalancing(false); setNotice(t('callTasks.rebalance.saved', { n: r.moved })); await load(); }} />}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label={t('callTasks.stat.progress')} value={`${pct(n.done + n.failed, n.total)}%`} sub={t('callTasks.stat.progressSub', { done: (n.done || 0) + (n.failed || 0), total: n.total || 0 })} tone="text-slate-900" />
        <Tile label={t('callTasks.stat.answered')} value={n.answered || 0} sub={`${pct(n.answered, (n.done || 0) + (n.failed || 0))}%`} tone="text-emerald-700" onClick={() => setFilter('DONE')} active={filter === 'DONE'} />
        <Tile label={t('callTasks.stat.failed')} value={n.failed || 0} sub={t('callTasks.stat.wrong', { n: n.wrong || 0 })} tone="text-rose-700" onClick={() => setFilter('FAILED')} active={filter === 'FAILED'} />
        <Tile label={t('callTasks.stat.pending')} value={n.pending || 0} sub={n.unassigned ? t('callTasks.stat.unassigned', { n: n.unassigned }) : ''} tone="text-sky-700" onClick={() => setFilter(n.unassigned ? 'UNASSIGNED' : 'PENDING')} active={['PENDING', 'UNASSIGNED'].includes(filter)} />
        <Tile label={t('callTasks.stat.late')} value={lateCount} tone="text-amber-700" onClick={() => setFilter('LATE')} active={filter === 'LATE'} />
      </div>
      {!data.bevatelSyncAt && <p className="text-xs bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3">{t('callTasks.bevatelMissing')}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <h3 className="font-bold text-slate-800 mb-3">{t('callTasks.outcomesTitle')}</h3>
          <div className="space-y-2">
            {Object.entries(c.outcomeCounts).sort((a, b) => b[1] - a[1]).map(([o, v]) => (
              <div key={o} className="flex items-center gap-2 text-sm">
                <span className="w-40 truncate text-slate-700">{o}</span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${(v / maxOutcome) * 100}%` }} /></div>
                <span className="w-10 text-end font-medium tabular-nums">{v}</span>
              </div>
            ))}
            {!Object.keys(c.outcomeCounts).length && <p className="text-sm text-slate-400 text-center py-3">—</p>}
          </div>
        </section>
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5"><UsersIcon className="w-4 h-4" />{t('callTasks.byAgent')}</h3>
            {c.status !== 'CLOSED' && (n.pending || 0) > 0 && <button onClick={() => setRebalancing(true)} className="text-xs text-primary border border-primary/30 rounded-lg px-2.5 py-1 hover:bg-primary/5 inline-flex items-center gap-1"><Shuffle className="w-3.5 h-3.5" />{t('callTasks.rebalance.button')}</button>}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr>{['agent', 'done', 'pending', 'late', 'today', 'verified'].map((k) => <th key={k} className="text-start py-1 px-1">{t(k === 'agent' ? 'callTasks.col.agent' : `callTasks.agentCol.${k}`)}</th>)}</tr></thead>
            <tbody>
              {perAgent.map((a) => (
                <tr key={a.id} className="border-t border-slate-50">
                  <td className="py-1.5 px-1"><button onClick={() => setAgentFilter(agentFilter === a.id ? '' : a.id)} className={`text-start ${agentFilter === a.id ? 'text-primary font-bold' : ''}`}>{a.name || t('callTasks.unassigned')}</button></td>
                  <td className="px-1">{a.done}/{a.total}</td><td className="px-1">{a.pending}</td><td className={`px-1 ${a.late ? 'text-amber-700 font-bold' : ''}`}>{a.late}</td><td className="px-1">{a.today}</td>
                  <td className="px-1 text-xs">{a.attempts ? <><span className="text-emerald-700">{a.verified}</span> / <span className="text-rose-700">{a.unverified}</span></> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {['ALL', 'PENDING', 'LATE', 'UNASSIGNED', 'DONE', 'FAILED', 'UNVERIFIED'].map((k) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm ${filter === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`callTasks.filters.${k}`)}</button>)}
          <div className="flex-1" />
          {selected.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">{t('callTasks.selected', { n: selected.length })}</span>
              <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="">{t('callTasks.assignTo')}</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button disabled={busy || !assignTo} onClick={assign} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('callTasks.assign')}</button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
              <tr>
                <th className={th}><input type="checkbox" checked={shown.length > 0 && shown.filter((k) => k.status === 'PENDING').every((k) => selected.includes(k.id))} onChange={(e) => setSelected(e.target.checked ? shown.filter((k) => k.status === 'PENDING').map((k) => k.id) : [])} /></th>
                {['student', 'grade', 'agent', 'due', 'status', 'outcome', 'attempts', 'verify'].map((k) => <th key={k} className={th}>{t(`callTasks.col.${k}`)}</th>)}
                {fileCols.map((col) => <th key={`f-${col}`} className={`${th} bg-sky-50 text-sky-800`}>{col}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.slice(0, 1000).map((k) => (
                <tr key={k.id} className={late(k) ? 'bg-amber-50/40' : ''}>
                  <td className={td}>{k.status === 'PENDING' && <input type="checkbox" checked={selected.includes(k.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, k.id] : selected.filter((x) => x !== k.id))} />}</td>
                  <td className={td}><p className="font-medium text-slate-900">{k.studentName}</p><p className="text-xs text-slate-400" dir="ltr">{k.phone} · {branchName(k.branch)}</p></td>
                  <td className={`${td} text-xs`} dir="ltr">{k.grade}</td>
                  <td className={td}>{k.assignedName || <span className="text-amber-700 text-xs">{t('callTasks.unassigned')}</span>}</td>
                  <td className={`${td} text-xs ${late(k) ? 'text-amber-700 font-bold' : ''}`}>{k.dueAt && k.status === 'PENDING' ? format(k.dueAt, 'yyyy-MM-dd HH:mm') : k.dueDay}</td>
                  <td className={td}><Pill className={TASK_STYLE[k.status]}>{t(`callTasks.taskStatus.${k.status}`)}</Pill></td>
                  <td className={`${td} max-w-56 truncate`} title={k.note}>{k.outcome || (k.result ? t(`callTasks.results.${k.result}`) : '')}{k.note && <span className="block text-xs text-slate-400 truncate">{k.note}</span>}</td>
                  <td className={td}>{k.attempts || ''}</td>
                  <td className={td}><Verify h={last(k)} bevatelSyncAt={data.bevatelSyncAt} />{last(k)?.callAgent && <span className="block text-[11px] text-slate-400">{last(k).callAgent}</span>}</td>
                  {fileCols.map((col) => <td key={`f-${col}`} className={`${td} text-xs max-w-56 truncate`} title={fileVal(k, col)}>{fileVal(k, col)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{t('callTasks.noCalls')}</p>}
          {shown.length > 1000 && <p className="py-3 text-center text-xs text-slate-400">{t('callTasks.firstThousand', { n: shown.length })}</p>}
        </div>
      </section>
    </div>
  );
}

// «الحملات»: campaigns with their progress; a campaign opens its follow-up.
export default function CallCampaigns() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [created, setCreated] = useState(null);
  const load = useCallback(() => call('listCallCampaigns').then((r) => setList(r.campaigns)).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  if (openId) return <CampaignDetails id={openId} onBack={() => { setOpenId(null); load(); }} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{t('callTasks.campaignsHint')}</p>
        {callRoleOf(userData, 'supervisor') && <button onClick={() => setShowForm(true)} className={btn.primary}><Plus className="w-4 h-4" />{t('callTasks.newCampaign')}</button>}
      </div>
      {created && <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm rounded-xl p-3 flex justify-between">{t('callTasks.createdMsg', { n: created.created })}<button onClick={() => setCreated(null)}><X className="w-4 h-4" /></button></div>}
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      {!list ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        : list.length === 0 ? <p className="py-16 text-center text-slate-400 text-sm">{t('callTasks.noCampaigns')}</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map((c) => {
              const n = c.counts || {};
              const finished = (n.done || 0) + (n.failed || 0);
              return (
                <button key={c.id} onClick={() => setOpenId(c.id)} className="text-start bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:border-primary/40 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-slate-900">{c.title}</p>
                    <div className="flex gap-1 shrink-0">{c.priority === 'URGENT' && <Pill className="bg-rose-50 text-rose-700 border-rose-200">{t('callTasks.urgent')}</Pill>}<Pill className={STATUS_STYLE[c.status]}>{t(`callTasks.status.${c.status}`)}</Pill></div>
                  </div>
                  <p className="text-xs text-slate-500">{c.startDay} — {c.endDay} · {c.target} · {c.createdByName}</p>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct(finished, n.total)}%` }} /></div>
                  <p className="text-xs text-slate-600">{t('callTasks.cardLine', { done: finished, total: n.total || 0, answered: n.answered || 0, pending: n.pending || 0 })}{n.unassigned ? ` · ${t('callTasks.stat.unassigned', { n: n.unassigned })}` : ''}</p>
                </button>
              );
            })}
          </div>
        )}
      {showForm && <CampaignForm onClose={() => setShowForm(false)} onSaved={(r) => { setShowForm(false); setCreated(r); load(); }} />}
    </div>
  );
}
