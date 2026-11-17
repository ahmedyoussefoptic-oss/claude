import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Loader2, Users, DoorOpen, UserCheck, GraduationCap } from 'lucide-react';
import { callSupport, SUPPORT_TYPES, TYPE_STYLE, SUBJECTS } from '../../config/support';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';

// The cycle's groups: programme, branch, grades, subject, teacher, room,
// capacity and supervisor — with how many students each holds. Students go
// into a group from the students tab.
export default function SupportGroups({ data, branchName, reload }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const members = (gid) => data.students.filter((s) => s.groupId === gid && s.status === 'CONSENTED');
  const waiting = data.students.filter((s) => s.status === 'CONSENTED' && !s.groupId);
  const supName = (id) => data.supervisors.find((s) => s.id === id)?.name || '';
  const remove = async (g) => {
    if (!window.confirm(t('support.groups.deleteConfirm', { name: g.name }))) return;
    setBusy(g.id);
    try { await callSupport('supportDeleteGroup', { id: c.id, groupId: g.id }); await reload(); } catch (err) { window.alert(err.message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {c.canManage && <button type="button" onClick={() => setEditing({})} className={btn.primary}><Plus className="w-4 h-4" />{t('support.groups.add')}</button>}
        <p className={`text-sm ${waiting.length ? 'text-amber-700' : 'text-slate-500'}`}>{t('support.groups.waiting', { n: waiting.length })}</p>
      </div>
      {!data.groups.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.groups.empty')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.groups.map((g) => {
            const list = members(g.id);
            const full = g.capacity && list.length >= g.capacity;
            return (
              <div key={g.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
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
                {list.length > 0 && <p className="text-xs text-slate-500 leading-5">{list.map((s) => s.name).join('، ')}</p>}
                {c.canManage && (
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setEditing(g)} className="text-xs text-primary flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />{t('support.edit')}</button>
                    <button type="button" disabled={busy === g.id} onClick={() => remove(g)} className="text-xs text-rose-600 flex items-center gap-1">{busy === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}{t('support.groups.delete')}</button>
                  </div>
                )}
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
