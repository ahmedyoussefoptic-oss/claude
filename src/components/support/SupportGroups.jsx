import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Loader2, Users, DoorOpen, UserCheck, GraduationCap, ChevronLeft, ArrowRight, Layers, TrendingUp, Sparkles, Wand2, Combine, BookOpen, Copy, Check, MessageCircle, Power, RefreshCw } from 'lucide-react';
import { callSupport, SUPPORT_TYPES, SUPPORT_CURRICULA, CURRICULUM_STYLE, TYPE_STYLE, SUBJECTS } from '../../config/support';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { subjectKey, subjectFamily } from '../../utils/supportSubjects';

const PROGRAM_ICON = { REMEDIAL: TrendingUp, ENRICHMENT: Sparkles };
const PROGRAM_TONE = { REMEDIAL: 'from-amber-50 border-amber-200 text-amber-800', ENRICHMENT: 'from-sky-50 border-sky-200 text-sky-700' };

// «Make the groups»: the consented students with no group, into groups by
// branch, programme, curriculum, stage and subject — each stage apart with its own
// subject (matching groups with room are filled first). Shows the plan;
// ticked groups of the plan can be merged into one, then it makes it.
export function AutoGroupsModal({ cycle, type = '', branchName, onClose, onDone }) {
  const { t } = useTranslation();
  const [capacity, setCapacity] = useState(15);
  const [by, setBy] = useState('grade');
  const [curriculum, setCurriculum] = useState('');
  const [related, setRelated] = useState(false);
  const [plan, setPlan] = useState(null);
  const [merges, setMerges] = useState([]);
  const [ticked, setTicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const preview = async (cap = capacity, m = merges, how = by, cur = curriculum, rel = related) => {
    setBusy('preview');
    setError(null);
    try { setPlan(await callSupport('supportAutoGroups', { id: cycle.id, type, by: how, curriculum: cur, related: rel, capacity: Number(cap) || 0, merges: m })); setMerges(m); setTicked([]); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  useEffect(() => { preview(15, []); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => {
    setBusy('apply');
    setError(null);
    try { onDone(await callSupport('supportAutoGroups', { id: cycle.id, type, by, curriculum, related, capacity: Number(capacity) || 0, merges, apply: true })); } catch (err) { setError(err.message); setBusy(''); }
  };
  const rows = plan?.plan || [];
  const keyOf = (r) => r.members.join('|');
  const tickedRows = rows.filter((r) => ticked.includes(keyOf(r)));
  const mixed = new Set(tickedRows.map((r) => `${r.type}|${r.branch}`)).size > 1 || new Set(tickedRows.map((r) => r.curriculum).filter(Boolean)).size > 1;
  const merge = () => {
    const joined = [...new Set(tickedRows.flatMap((r) => r.members))];
    preview(capacity, [...merges.filter((m) => !m.some((x) => joined.includes(x))), joined]);
  };
  const unmerge = (r) => preview(capacity, merges.filter((m) => !m.some((x) => r.members.includes(x))));
  return (
    <Modal title={t('support.auto.title')} onClose={onClose} size="max-w-3xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={!!busy || !rows.length} onClick={apply} className={btn.primary}>{busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{t('support.auto.apply', { n: plan?.students || 0 })}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <p className="text-sm text-slate-600">{t('support.auto.hint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('support.auto.by')}>
          <div className="flex gap-1.5">{['grade', 'stage'].map((x) => <button key={x} type="button" disabled={!!busy} onClick={() => { setBy(x); preview(capacity, [], x); }} className={`px-3 py-2 rounded-xl text-sm border ${by === x ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`support.auto.by_${x}`)}</button>)}</div>
        </Field>
        <Field label={t('support.curriculum.label')}>
          <div className="flex gap-1.5">{['', ...SUPPORT_CURRICULA].map((x) => <button key={x || 'all'} type="button" disabled={!!busy} onClick={() => { setCurriculum(x); preview(capacity, [], by, x); }} className={`px-3 py-2 rounded-xl text-sm border ${curriculum === x ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{x ? t(`support.curriculum.${x}`) : t('support.curriculum.each')}</button>)}</div>
        </Field>
        <Field label={t('support.autoMerge.subjects')}>
          <div className="flex gap-1.5">{[false, true].map((x) => <button key={String(x)} type="button" disabled={!!busy} onClick={() => { setRelated(x); preview(capacity, [], by, curriculum, x); }} className={`px-3 py-2 rounded-xl text-sm border ${related === x ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`support.autoMerge.${x ? 'related' : 'same'}`)}</button>)}</div>
        </Field>
        <Field label={t('support.auto.capacity')} hint={t('support.auto.capacityHint')}><input type="number" min={0} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={`${inputCls} w-32`} /></Field>
        <button type="button" disabled={!!busy} onClick={() => preview(capacity, [])} className={`${btn.ghost} mb-1`}>{busy === 'preview' && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.auto.preview')}</button>
        {rows.length > 1 && (
          <button type="button" disabled={!!busy || tickedRows.length < 2 || mixed} onClick={merge} title={mixed ? t('support.merge.mixed') : ''} className={`${btn.ghost} mb-1`}><Combine className="w-4 h-4" />{t('support.merge.selected', { n: tickedRows.length })}</button>
        )}
      </div>
      {rows.length > 1 && <p className="text-xs text-slate-500">{mixed ? <span className="text-amber-700">{t('support.merge.mixed')}</span> : t('support.merge.autoHint')}</p>}
      {!plan ? <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : !rows.length ? <p className="text-sm text-slate-500 text-center py-6">{t('support.auto.none')}</p> : (
        <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr><th className="px-2 py-1.5" />{['group', 'program', 'curriculum', 'stage', 'subject', 'grades', 'count'].map((k) => <th key={k} className="px-2 py-1.5 text-start font-medium">{t(`support.auto.col.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={keyOf(r)} className={ticked.includes(keyOf(r)) ? 'bg-primary/5' : ''}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={ticked.includes(keyOf(r))} onChange={(e) => setTicked((x) => (e.target.checked ? [...x, keyOf(r)] : x.filter((y) => y !== keyOf(r))))} /></td>
                  <td className="px-2 py-1.5 font-medium text-slate-900">{r.name}{r.existing ? <span className="ms-1 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t('support.auto.existing')}</span> : <span className="ms-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{t('support.auto.new')}</span>}
                    {r.merged && <><span className="ms-1 text-[11px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">{t('support.merge.mergedN', { n: r.members.length })}</span><button type="button" disabled={!!busy} onClick={() => unmerge(r)} className="ms-1 text-[11px] text-rose-600 hover:underline">{t('support.merge.undo')}</button></>}
                    {r.branch && branchName ? <span className="block text-xs text-slate-400">{branchName(r.branch)}</span> : null}</td>
                  <td className="px-2 py-1.5"><Pill className={TYPE_STYLE[r.type]}>{t(`support.types.${r.type}`)}</Pill></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.curriculum ? <Pill className={CURRICULUM_STYLE[r.curriculum]}>{t(`support.curriculum.${r.curriculum}`)}</Pill> : <span className="text-xs text-slate-400">{t('support.curriculum.NONE')}</span>}</td>
                  <td className="px-2 py-1.5 text-xs">{(r.stages || [r.stage]).map((x) => t(`support.groups.stages.${x || 'OTHER'}`)).join('، ')}</td>
                  <td className="px-2 py-1.5 text-xs">{r.subject || '—'}</td>
                  <td className="px-2 py-1.5 text-xs" dir="ltr">{r.grades.join(', ')}</td>
                  <td className="px-2 py-1.5 text-center font-bold">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan?.curricula?.NONE > 0 && <p className="text-xs text-amber-700">{t('support.curriculum.noneWaiting', { n: plan.curricula.NONE })}</p>}
      <p className="text-xs text-slate-500">{t('support.auto.after')}</p>
    </Modal>
  );
}

// The cycle's programmes (remedial / enrichment), each a section of its own
// with its groups and students; one opens into its groups.
export function SupportProgramTypes({ data, onOpen, branchName, reload }) {
  const { t } = useTranslation();
  const [auto, setAuto] = useState(false);
  const [done, setDone] = useState(null);
  const [classLink, setClassLink] = useState(false);
  const waitingAll = data.students.filter((s) => s.status === 'CONSENTED' && !s.groupId).length;
  return (
    <div className="space-y-3">
    {data.cycle.canManage && (
      <div className="flex flex-wrap items-center gap-2">
        {waitingAll > 0 && <button type="button" onClick={() => setAuto(true)} className={btn.primary}><Wand2 className="w-4 h-4" />{t('support.auto.button')}</button>}
        {waitingAll > 0 && <p className="text-sm text-amber-700">{t('support.groups.waiting', { n: waitingAll })}</p>}
        <button type="button" onClick={() => setClassLink(true)} className={`${btn.ghost} ms-auto`}><BookOpen className="w-4 h-4" />{t('support.clink.button')}</button>
      </div>
    )}
    {classLink && <ClassLinkModal cycle={data.cycle} initial={data.classLink} onClose={() => { setClassLink(false); reload?.(); }} />}
    {done && <p className="text-sm rounded-xl p-3 border bg-emerald-50 text-emerald-800 border-emerald-100">{t('support.auto.done', { groups: done.created, n: done.placed })}</p>}
    {auto && <AutoGroupsModal cycle={data.cycle} branchName={branchName} onClose={() => setAuto(false)} onDone={async (r) => { setAuto(false); setDone(r); await reload?.(); }} />}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {SUPPORT_TYPES.map((type) => {
        const groups = data.groups.filter((g) => g.type === type);
        const ids = new Set(groups.map((g) => g.id));
        const inGroups = data.students.filter((s) => s.status === 'CONSENTED' && ids.has(s.groupId)).length;
        const waiting = data.students.filter((s) => s.status === 'CONSENTED' && !s.groupId && s.type === type).length;
        const Icon = PROGRAM_ICON[type];
        return (
          <button key={type} type="button" onClick={() => onOpen(type)} className={`text-start bg-gradient-to-b ${PROGRAM_TONE[type]} to-white border rounded-2xl p-5 hover:shadow-md transition`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-slate-900">{t(`support.programs.${type}`)}</p>
                <p className="text-sm font-medium opacity-80" dir="auto">{t(`support.programs.${type}_en`)}</p>
              </div>
              <span className="w-11 h-11 rounded-xl bg-white/80 border border-current/20 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 mt-4">
              <span className="flex items-center gap-1"><Layers className="w-4 h-4" />{t('support.programs.groupsN', { n: groups.length })}</span>
              <span className="flex items-center gap-1"><Users className="w-4 h-4" />{t('support.programs.studentsN', { n: inGroups })}</span>
              {waiting > 0 && <span className="text-amber-700">{t('support.groups.waiting', { n: waiting })}</span>}
            </div>
            <p className="text-xs text-primary font-medium flex items-center gap-1 mt-3"><ChevronLeft className="w-3.5 h-3.5 ltr:rotate-180" />{t('support.programs.open')}</p>
          </button>
        );
      })}
    </div>
    </div>
  );
}

// One programme's groups: branch, grades, subject, teacher, room, capacity
// and supervisor — with how many students each holds. Students go into a
// group from the students tab.
export default function SupportGroups({ data, type, branchName, reload, onOpen, onBack }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [auto, setAuto] = useState(false);
  const [done, setDone] = useState(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [merging, setMerging] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const groups = data.groups.filter((g) => g.type === type);
  const members = (gid) => data.students.filter((s) => s.groupId === gid && s.status === 'CONSENTED');
  const waiting = data.students.filter((s) => s.status === 'CONSENTED' && !s.groupId && s.type === type);
  const supName = (id) => data.supervisors.find((s) => s.id === id)?.name || '';
  const remove = async (g) => {
    if (!window.confirm(t('support.groups.deleteConfirm', { name: g.name }))) return;
    setBusy(g.id);
    try { await callSupport('supportDeleteGroup', { id: c.id, groupId: g.id }); await reload(); } catch (err) { window.alert(err.message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div>
        <button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1 mb-1"><ArrowRight className="w-4 h-4" />{t('support.programs.back')}</button>
        <h3 className="text-lg font-bold text-slate-900">{t(`support.programs.${type}`)} <span className="text-sm font-medium text-slate-500" dir="auto">— {t(`support.programs.${type}_en`)}</span></h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {c.canManage && <button type="button" onClick={() => setEditing({ type })} className={btn.primary}><Plus className="w-4 h-4" />{t('support.groups.add')}</button>}
        {c.canManage && waiting.length > 0 && <button type="button" onClick={() => setAuto(true)} className={btn.ghost}><Wand2 className="w-4 h-4" />{t('support.auto.button')}</button>}
        {c.canManage && groups.length > 1 && (picking ? (
          <>
            <button type="button" disabled={picked.length < 2} onClick={() => setMerging(true)} className={btn.primary}><Combine className="w-4 h-4" />{t('support.merge.selected', { n: picked.length })}</button>
            <button type="button" onClick={() => { setPicking(false); setPicked([]); }} className={btn.ghost}>{t('common.cancel')}</button>
          </>
        ) : <>
          <button type="button" onClick={() => setAutoMerge(true)} className={btn.ghost}><Wand2 className="w-4 h-4" />{t('support.autoMerge.button')}</button>
          <button type="button" onClick={() => setPicking(true)} className={btn.ghost}><Combine className="w-4 h-4" />{t('support.merge.button')}</button>
        </>)}
        <p className={`text-sm ${waiting.length ? 'text-amber-700' : 'text-slate-500'}`}>{t('support.groups.waiting', { n: waiting.length })}</p>
      </div>
      {picking && <p className="text-xs text-slate-500">{t('support.merge.pickHint')}</p>}
      {done && <p className="text-sm rounded-xl p-3 border bg-emerald-50 text-emerald-800 border-emerald-100">{done.autoMerged != null ? t('support.autoMerge.done', { n: done.autoMerged, groups: done.removed }) : done.merged ? t('support.merge.done', { name: done.name, n: done.count }) : t('support.auto.done', { groups: done.created, n: done.placed })}</p>}
      {merging && <MergeModal cycle={c} groups={groups.filter((g) => picked.includes(g.id))} members={members} branchName={branchName} onClose={() => setMerging(false)} onDone={async (r) => { setMerging(false); setPicking(false); setPicked([]); setDone({ merged: true, ...r }); await reload(); }} />}
      {auto && <AutoGroupsModal cycle={c} type={type} branchName={branchName} onClose={() => setAuto(false)} onDone={async (r) => { setAuto(false); setDone(r); await reload(); }} />}
      {autoMerge && <AutoMergeModal cycle={c} groups={groups} members={members} branchName={branchName} onClose={() => setAutoMerge(false)} onDone={async (r) => { setAutoMerge(false); setDone(r); await reload(); }} />}
      {!groups.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.programs.empty')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groups.map((g) => {
            const list = members(g.id);
            const full = g.capacity && list.length >= g.capacity;
            const on = picked.includes(g.id);
            const open = () => (picking ? setPicked((x) => (on ? x.filter((y) => y !== g.id) : [...x, g.id])) : onOpen(g.id));
            return (
              <div key={g.id} role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} className={`bg-white border rounded-2xl p-4 space-y-2 cursor-pointer hover:shadow-sm transition ${on ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200 hover:border-primary/40'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900 flex items-start gap-2">{picking && <input type="checkbox" checked={on} readOnly className="mt-1" />}{g.name}</p>
                  <span className="flex flex-wrap justify-end gap-1">{g.curriculum && <Pill className={CURRICULUM_STYLE[g.curriculum]}>{t(`support.curriculum.${g.curriculum}`)}</Pill>}<Pill className={TYPE_STYLE[g.type]}>{t(`support.types.${g.type}`)}</Pill></span>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  {g.subject && <p className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5 text-primary" />{g.subject}{g.grades?.length ? ` · ${g.grades.join('، ')}` : ''}</p>}
                  <p className="flex items-center gap-1"><DoorOpen className="w-3.5 h-3.5 text-primary" />{[branchName(g.branch), g.room, g.teacher].filter(Boolean).join(' · ') || '—'}</p>
                  <p className="flex items-center gap-1"><UserCheck className="w-3.5 h-3.5 text-primary" />{supName(g.supervisorId) || <span className="text-amber-700">{t('support.groups.noSupervisor')}</span>}</p>
                  <p className={`flex items-center gap-1 ${full ? 'text-rose-700 font-bold' : ''}`}><Users className="w-3.5 h-3.5 text-primary" />{g.capacity ? t('support.groups.countOf', { n: list.length, cap: g.capacity }) : t('support.groups.count', { n: list.length })}</p>
                </div>
                <div className="flex items-center gap-3 pt-1" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => onOpen(g.id)} className="text-xs text-primary font-medium flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5 ltr:rotate-180" />{t('support.groups.open')}</button>
                {c.canManage && (
                  <>
                    <button type="button" onClick={() => setEditing(g)} className="text-xs text-primary flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />{t('support.edit')}</button>
                    <button type="button" disabled={busy === g.id} onClick={() => remove(g)} className="text-xs text-rose-600 flex items-center gap-1">{busy === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}{t('support.groups.delete')}</button>
                  </>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <GroupEditor data={data} branchName={branchName} group={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </div>
  );
}

// «Merge by itself»: this programme's groups of the same branch, curriculum,
// grade (or stage) and subject — or related subjects (the sciences…) — put
// together, each merged group up to `max` students (0 = no limit). Shows the
// proposals (each can be left out and renamed), then merges them one by one.
const STAGE_OF = (grade) => { const g = String(grade || ''); if (/^KG/i.test(g)) return 'KG'; const n = Number((g.match(/\d+/) || [])[0]); return !n ? 'OTHER' : n <= 6 ? 'PRIMARY' : n <= 9 ? 'MIDDLE' : n <= 12 ? 'SECONDARY' : 'OTHER'; };
const gradeSort = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const baseName = (name) => String(name || '').replace(/\s*\(\d+(?:-\d+)?\)\s*$/, '').trim();
function mergeProposals(groups, members, { by = 'grade', subjects = 'same', max = 0 } = {}) {
  const keyOf = subjects === 'related' ? subjectFamily : subjectKey;
  const clusters = new Map();
  groups.forEach((g) => {
    const list = members(g.id);
    const grades = [...new Set((list.length ? list.map((s) => s.grade) : g.grades || []).filter(Boolean))].sort(gradeSort);
    if (!grades.length || !String(g.subject || '').trim()) return;
    const curs = [...new Set(list.map((s) => s.curriculum || ''))];
    const cur = g.curriculum || (curs.length === 1 ? curs[0] : curs.length ? 'MIXED' : '');
    const where = by === 'stage' ? [...new Set(grades.map(STAGE_OF))].sort().join(',') : grades.join(',');
    const key = [g.branch || '', cur, where, keyOf(g.subject)].join('|');
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push({ g, n: list.length, grades });
  });
  const limit = Number(max) > 0 ? Number(max) : Infinity;
  const out = [];
  clusters.forEach((items) => {
    if (items.length < 2) return;
    const bins = [];
    // Smallest first: the small groups join up before a large one is topped up.
    [...items].sort((a, b) => a.n - b.n).forEach((x) => {
      const bin = bins.find((b) => b.total + x.n <= limit);
      if (bin) { bin.items.push(x); bin.total += x.n; } else bins.push({ items: [x], total: x.n });
    });
    bins.filter((b) => b.items.length > 1).forEach((b) => {
      // The one that stays: the one already set up (teacher, supervisor, room), else the largest.
      const target = [...b.items].sort((x, y) => Number(!!(y.g.teacher || y.g.supervisorId || y.g.room)) - Number(!!(x.g.teacher || x.g.supervisorId || x.g.room)) || y.n - x.n)[0].g;
      out.push({ key: b.items.map((x) => x.g.id).sort().join('|'), target: target.id, name: baseName(target.name), groups: b.items.map((x) => ({ ...x.g, n: x.n })), total: b.total,
        grades: [...new Set(b.items.flatMap((x) => x.grades))].sort(gradeSort), subjects: [...new Set(b.items.map((x) => x.g.subject))] });
    });
  });
  // Names unique among the groups that remain.
  const taken = new Set(groups.filter((g) => !out.some((p) => p.groups.some((x) => x.id === g.id))).map((g) => g.name));
  out.forEach((p) => { let name = p.name; for (let i = 2; taken.has(name); i++) name = `${p.name} (${i})`; taken.add(name); p.name = name; });
  return out;
}

function AutoMergeModal({ cycle, groups, members, branchName, onClose, onDone }) {
  const { t } = useTranslation();
  const [by, setBy] = useState('grade');
  const [subjects, setSubjects] = useState('same');
  const [max, setMax] = useState(25);
  const [skip, setSkip] = useState([]);
  const [names, setNames] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const proposals = useMemo(() => mergeProposals(groups, members, { by, subjects, max }), [groups, members, by, subjects, max]);
  const chosen = proposals.filter((p) => !skip.includes(p.key));
  const nameOf = (p) => names[p.key] ?? p.name;
  const apply = async () => {
    setBusy(true);
    setError(null);
    let merged = 0;
    let removed = 0;
    try {
      for (const p of chosen) {
        await callSupport('supportMergeGroups', { id: cycle.id, groupIds: p.groups.map((g) => g.id), targetId: p.target, name: nameOf(p).trim() || p.name });
        merged++;
        removed += p.groups.length - 1;
      }
      onDone({ autoMerged: merged, removed });
    } catch (err) {
      setError(merged ? `${t('support.autoMerge.partial', { n: merged })} — ${err.message}` : err.message);
      setBusy(false);
    }
  };
  const chip = (on) => `px-3 py-2 rounded-xl text-sm border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;
  return (
    <Modal title={t('support.autoMerge.title')} onClose={onClose} size="max-w-3xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !chosen.length} onClick={apply} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Combine className="w-4 h-4" />}{t('support.autoMerge.apply', { n: chosen.length })}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <p className="text-sm text-slate-600">{t('support.autoMerge.hint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('support.auto.by')}><div className="flex gap-1.5">{['grade', 'stage'].map((x) => <button key={x} type="button" onClick={() => setBy(x)} className={chip(by === x)}>{t(`support.auto.by_${x}`)}</button>)}</div></Field>
        <Field label={t('support.autoMerge.subjects')}><div className="flex gap-1.5">{['same', 'related'].map((x) => <button key={x} type="button" onClick={() => setSubjects(x)} className={chip(subjects === x)}>{t(`support.autoMerge.${x}`)}</button>)}</div></Field>
        <Field label={t('support.autoMerge.max')} hint={t('support.autoMerge.maxHint')}><input type="number" min={0} max={200} value={max} onChange={(e) => setMax(e.target.value)} className={`${inputCls} w-28`} /></Field>
      </div>
      {!proposals.length ? <p className="text-sm text-slate-500 text-center py-6">{t('support.autoMerge.none')}</p> : (
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {proposals.map((p) => {
            const on = !skip.includes(p.key);
            return (
              <div key={p.key} className={`border rounded-xl p-3 space-y-2 ${on ? 'border-primary/40 bg-primary/5' : 'border-slate-200 opacity-60'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={on} onChange={(e) => setSkip((x) => (e.target.checked ? x.filter((y) => y !== p.key) : [...x, p.key]))} />
                  <input value={nameOf(p)} onChange={(e) => setNames((x) => ({ ...x, [p.key]: e.target.value }))} disabled={!on} className={`${inputCls} flex-1 min-w-48 py-1.5`} />
                  <span className="text-sm font-bold text-slate-800">{t('support.groups.count', { n: p.total })}</span>
                </div>
                <p className="text-xs text-slate-500">{[p.subjects.join(' / '), p.grades.join('، '), branchName(p.groups[0].branch), p.groups[0].curriculum ? t(`support.curriculum.${p.groups[0].curriculum}`) : ''].filter(Boolean).join(' · ')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.groups.map((g) => <span key={g.id} className={`text-xs px-2 py-1 rounded-lg border ${g.id === p.target ? 'bg-white border-primary text-primary font-medium' : 'bg-white border-slate-200 text-slate-600'}`}>{g.name} ({g.n}){g.id === p.target ? ` — ${t('support.autoMerge.keeps')}` : ''}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-slate-500">{t('support.merge.after')}</p>
    </Modal>
  );
}

// Merging the ticked groups into one: which one stays (its teacher, room and
// supervisor) and the merged group's name.
function MergeModal({ cycle, groups, members, branchName, onClose, onDone }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(groups[0]?.id || '');
  const [name, setName] = useState(groups[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const branches = new Set(groups.map((g) => g.branch || ''));
  const curricula = new Set(groups.map((g) => g.curriculum).filter(Boolean));
  const total = groups.reduce((n, g) => n + members(g.id).length, 0);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { onDone(await callSupport('supportMergeGroups', { id: cycle.id, groupIds: groups.map((g) => g.id), targetId: target, name })); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={t('support.merge.title', { n: groups.length })} onClose={onClose} size="max-w-lg"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || branches.size > 1 || curricula.size > 1 || !name.trim()} onClick={save} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Combine className="w-4 h-4" />}{t('support.merge.apply', { n: total })}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      {(branches.size > 1 || curricula.size > 1) && <div className="bg-amber-50 text-amber-800 text-sm rounded-xl p-3">{t('support.merge.mixed')}</div>}
      <Field label={t('support.merge.keep')} hint={t('support.merge.keepHint')}>
        <div className="space-y-1.5">
          {groups.map((g) => (
            <label key={g.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${target === g.id ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
              <input type="radio" checked={target === g.id} onChange={() => { setTarget(g.id); setName(g.name); }} />
              <span className="font-medium text-slate-900">{g.name}</span>
              <span className="text-xs text-slate-500">{[g.curriculum ? t(`support.curriculum.${g.curriculum}`) : '', g.subject, (g.grades || []).join('، '), branchName(g.branch), g.teacher].filter(Boolean).join(' · ')}</span>
              <span className="ms-auto text-xs text-slate-600">{t('support.groups.count', { n: members(g.id).length })}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label={t('support.merge.name')} required><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
      <p className="text-xs text-slate-500">{t('support.merge.after')}</p>
    </Modal>
  );
}

function GroupEditor({ data, branchName, group, onClose, onSaved }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [f, setF] = useState({
    name: group.name || '', type: group.type || 'REMEDIAL', curriculum: group.curriculum || '', branch: group.branch || c.branches[0] || '', subject: group.subject || '', grades: (group.grades || []).join('، '),
    teacher: group.teacher || '', room: group.room || '', capacity: group.capacity || '', supervisorId: group.supervisorId || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await callSupport('supportSaveGroup', { id: c.id, group: { ...f, id: group.id, grades: f.grades.split(/[،,\s]+/).filter(Boolean), capacity: Number(f.capacity) || 0 } });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const chip = (on) => `px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;
  const branchOptions = c.branches.length ? c.branches : [...new Set(data.students.map((s) => s.branch))];
  return (
    <Modal title={group.id ? t('support.groups.editTitle') : t('support.groups.newTitle')} onClose={onClose} size="max-w-xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <Field label={t('support.groups.name')} required><input value={f.name} onChange={set('name')} placeholder={t('support.groups.namePh')} className={inputCls} /></Field>
      <Field label={t('support.col.type')}><div className="flex gap-2">{SUPPORT_TYPES.map((x) => <button key={x} type="button" onClick={() => setF((y) => ({ ...y, type: x }))} className={chip(f.type === x)}>{t(`support.types.${x}`)}</button>)}</div></Field>
      <Field label={t('support.curriculum.label')} hint={t('support.curriculum.groupHint')}><div className="flex flex-wrap gap-2">{['', ...SUPPORT_CURRICULA].map((x) => <button key={x || 'both'} type="button" onClick={() => setF((y) => ({ ...y, curriculum: x }))} className={chip(f.curriculum === x)}>{x ? t(`support.curriculum.${x}`) : t('support.curriculum.both')}</button>)}</div></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('common.branch')}><select value={f.branch} onChange={set('branch')} className={inputCls}><option value="">—</option>{branchOptions.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></Field>
        <Field label={t('support.groups.subject')}><input list="support-subjects" value={f.subject} onChange={set('subject')} className={inputCls} /><datalist id="support-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist></Field>
        <Field label={t('support.groups.grades')} hint={t('support.groups.gradesHint')}><input value={f.grades} onChange={set('grades')} className={inputCls} dir="ltr" /></Field>
        <Field label={t('support.groups.capacity')}><input type="number" min={0} max={200} value={f.capacity} onChange={set('capacity')} className={inputCls} /></Field>
        <Field label={t('support.groups.teacher')}><input value={f.teacher} onChange={set('teacher')} className={inputCls} /></Field>
        <Field label={t('support.groups.room')}><input value={f.room} onChange={set('room')} className={inputCls} /></Field>
      </div>
      <Field label={t('support.groups.supervisor')} hint={data.supervisors.length ? '' : t('support.groups.addSupervisorsFirst')}>
        <select value={f.supervisorId} onChange={set('supervisorId')} className={inputCls}><option value="">—</option>{data.supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
    </Modal>
  );
}

// The class teachers' link (one per cycle) and its PIN: copy / send, a new
// link (the old one stops), pause — and each group teacher's follow-up:
// classes written of those due, final evaluations, last entry.
function ClassLinkModal({ cycle, initial, onClose }) {
  const { t } = useTranslation();
  const [link, setLink] = useState(initial);
  const [busy, setBusy] = useState(initial ? 'list' : '');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const run = async (action) => {
    setBusy(action);
    setError(null);
    try { setLink(await callSupport('supportClassLink', { id: cycle.id, action })); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  useEffect(() => {
    if (!initial) return;
    callSupport('supportClassLink', { id: cycle.id, action: 'list' }).then((r) => r && setLink(r)).catch((err) => setError(err.message)).finally(() => setBusy(''));
  }, [cycle.id, initial]);
  const teachers = link?.teachers || [];
  const message = link?.link ? t('support.clink.message', { cycle: cycle.title, link: link.link, pin: link.pin }) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('', message); } };
  const when = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <Modal title={t('support.clink.title')} onClose={onClose} size="max-w-2xl" footer={<button type="button" onClick={onClose} className={btn.ghost}>{t('common.close')}</button>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <p className="text-sm text-slate-600">{t('support.clink.hint')}</p>
      {!link?.link ? (
        <button type="button" disabled={!!busy} onClick={() => run('create')} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}{t('support.tlink.create')}</button>
      ) : (
        <div className="space-y-3">
          <div className={`rounded-xl border p-3 space-y-2 ${link.enabled ? 'border-slate-200 bg-slate-50' : 'border-rose-200 bg-rose-50'}`}>
            {!link.enabled && <p className="text-sm font-bold text-rose-700">{t('support.clink.paused')}</p>}
            <p className="text-xs text-slate-500">{t('support.tlink.link')}</p>
            <p className="text-sm font-mono break-all" dir="ltr">{link.link}</p>
            <p className="text-xs text-slate-500">{t('support.tlink.pin')}</p>
            <p className="text-2xl font-mono tracking-[0.3em]" dir="ltr">{link.pin}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={btn.primary}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? t('support.sup.copied') : t('support.tlink.copy')}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={btn.ghost}><MessageCircle className="w-4 h-4" />{t('support.tlink.whatsapp')}</a>
            <button type="button" disabled={!!busy} onClick={() => run(link.enabled ? 'disable' : 'enable')} className={btn.ghost}>{busy === 'disable' || busy === 'enable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}{link.enabled ? t('support.tlink.pause') : t('support.tlink.resume')}</button>
            <button type="button" disabled={!!busy} onClick={() => { if (window.confirm(t('support.tlink.renewConfirm'))) run('renew'); }} className={btn.ghost}>{busy === 'renew' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{t('support.tlink.renew')}</button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-2">{t('support.clink.teachers', { n: teachers.length })}{busy === 'list' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}</p>
            {link.noTeacher?.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{t('support.clink.noTeacherGroups', { list: link.noTeacher.join('، ') })}</p>}
            {!teachers.length ? (busy !== 'list' && <p className="text-xs text-slate-400">{t('support.clink.noTeachers')}</p>) : (
              <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['tName', 'tGroups', 'tLessons', 'tFinals', 'tLast'].map((k) => <th key={k} className="px-2 py-1.5 text-start font-medium">{t(`support.clink.${k}`)}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {teachers.map((x) => (
                      <tr key={x.name}>
                        <td className="px-2 py-1.5 font-medium text-slate-900">{x.name}</td>
                        <td className="px-2 py-1.5 text-slate-600">{x.groups.join('، ')}</td>
                        <td className={`px-2 py-1.5 text-center whitespace-nowrap ${x.due && x.lessons < x.due ? 'text-amber-700 font-bold' : 'text-emerald-700'}`}>{x.lessons} / {x.due}</td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">{x.finals} / {x.students}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap" dir="ltr">{when(x.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
