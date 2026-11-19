import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Loader2, Users, DoorOpen, UserCheck, GraduationCap, ChevronLeft, ArrowRight, Layers, TrendingUp, Sparkles, Wand2 } from 'lucide-react';
import { callSupport, SUPPORT_TYPES, TYPE_STYLE, SUBJECTS } from '../../config/support';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';

const PROGRAM_ICON = { REMEDIAL: TrendingUp, ENRICHMENT: Sparkles };
const PROGRAM_TONE = { REMEDIAL: 'from-amber-50 border-amber-200 text-amber-800', ENRICHMENT: 'from-sky-50 border-sky-200 text-sky-700' };

// «Make the groups»: the consented students with no group, into groups by
// branch, programme, stage and subject (matching groups with room are filled
// first). Shows the plan, then makes it.
export function AutoGroupsModal({ cycle, type = '', branchName, onClose, onDone }) {
  const { t } = useTranslation();
  const [capacity, setCapacity] = useState(15);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const preview = async (cap = capacity) => {
    setBusy('preview');
    setError(null);
    try { setPlan(await callSupport('supportAutoGroups', { id: cycle.id, type, capacity: Number(cap) || 0 })); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  useEffect(() => { preview(15); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => {
    setBusy('apply');
    setError(null);
    try { onDone(await callSupport('supportAutoGroups', { id: cycle.id, type, capacity: Number(capacity) || 0, apply: true })); } catch (err) { setError(err.message); setBusy(''); }
  };
  const rows = plan?.plan || [];
  return (
    <Modal title={t('support.auto.title')} onClose={onClose} size="max-w-3xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={!!busy || !rows.length} onClick={apply} className={btn.primary}>{busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{t('support.auto.apply', { n: plan?.students || 0 })}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <p className="text-sm text-slate-600">{t('support.auto.hint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('support.auto.capacity')} hint={t('support.auto.capacityHint')}><input type="number" min={0} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={`${inputCls} w-32`} /></Field>
        <button type="button" disabled={!!busy} onClick={() => preview()} className={`${btn.ghost} mb-1`}>{busy === 'preview' && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.auto.preview')}</button>
      </div>
      {!plan ? <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : !rows.length ? <p className="text-sm text-slate-500 text-center py-6">{t('support.auto.none')}</p> : (
        <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0"><tr>{['group', 'program', 'stage', 'subject', 'grades', 'count'].map((k) => <th key={k} className="px-2 py-1.5 text-start font-medium">{t(`support.auto.col.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 font-medium text-slate-900">{r.name}{r.existing ? <span className="ms-1 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t('support.auto.existing')}</span> : <span className="ms-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{t('support.auto.new')}</span>}{r.branch && branchName ? <span className="block text-xs text-slate-400">{branchName(r.branch)}</span> : null}</td>
                  <td className="px-2 py-1.5"><Pill className={TYPE_STYLE[r.type]}>{t(`support.types.${r.type}`)}</Pill></td>
                  <td className="px-2 py-1.5 text-xs">{t(`support.groups.stages.${r.stage || 'OTHER'}`)}</td>
                  <td className="px-2 py-1.5 text-xs">{r.subject || '—'}</td>
                  <td className="px-2 py-1.5 text-xs" dir="ltr">{r.grades.join(', ')}</td>
                  <td className="px-2 py-1.5 text-center font-bold">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const waitingAll = data.students.filter((s) => s.status === 'CONSENTED' && !s.groupId).length;
  return (
    <div className="space-y-3">
    {data.cycle.canManage && waitingAll > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAuto(true)} className={btn.primary}><Wand2 className="w-4 h-4" />{t('support.auto.button')}</button>
        <p className="text-sm text-amber-700">{t('support.groups.waiting', { n: waitingAll })}</p>
      </div>
    )}
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
        <p className={`text-sm ${waiting.length ? 'text-amber-700' : 'text-slate-500'}`}>{t('support.groups.waiting', { n: waiting.length })}</p>
      </div>
      {done && <p className="text-sm rounded-xl p-3 border bg-emerald-50 text-emerald-800 border-emerald-100">{t('support.auto.done', { groups: done.created, n: done.placed })}</p>}
      {auto && <AutoGroupsModal cycle={c} type={type} branchName={branchName} onClose={() => setAuto(false)} onDone={async (r) => { setAuto(false); setDone(r); await reload(); }} />}
      {!groups.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.programs.empty')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groups.map((g) => {
            const list = members(g.id);
            const full = g.capacity && list.length >= g.capacity;
            return (
              <div key={g.id} role="button" tabIndex={0} onClick={() => onOpen(g.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(g.id); }} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 cursor-pointer hover:border-primary/40 hover:shadow-sm transition">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">{g.name}</p>
                  <Pill className={TYPE_STYLE[g.type]}>{t(`support.types.${g.type}`)}</Pill>
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

function GroupEditor({ data, branchName, group, onClose, onSaved }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [f, setF] = useState({
    name: group.name || '', type: group.type || 'REMEDIAL', branch: group.branch || c.branches[0] || '', subject: group.subject || '', grades: (group.grades || []).join('، '),
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
