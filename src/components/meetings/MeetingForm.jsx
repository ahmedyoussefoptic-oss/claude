import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2, AlertTriangle, Plus, Trash2, Users as UsersIcon, FileSpreadsheet, Download, BookUser } from 'lucide-react';
import { readTeachersFile, downloadTeachersTemplate, teacherForMeeting } from '../../utils/meetingTeachersExcel';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { userBranches } from '../../utils/scope';
import { STAGES } from '../../config/complaintTypes';
import { MEETING_TYPES, STAFF_ROLES, STAFF_POSITIONS, SUBJECTS, positionLabel, isIndividual, isRequests, callMeeting, classLabel } from '../../config/meetings';

const EMPTY = {
  title: '', type: 'REQUESTS', branches: [], stages: [], classes: [], sections: [], gender: 'ALL',
  date: '', startTime: '16:00', endTime: '19:00', location: '', teamsLink: '', agenda: '',
  slotsStart: '16:30', slotsEnd: '19:00', slotMinutes: 10, breakStart: '', breakEnd: '', regDeadline: '', autoReminders: true, teachers: [],
};
const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

function Section({ title, children, hint }) {
  return (
    <section className="border border-slate-100 rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children, hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
function Chips({ options, value, onChange, ltr }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([id, label]) => (
        <button key={id} type="button" onClick={() => toggle(id)} dir={ltr ? 'ltr' : undefined}
          className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${value.includes(id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Create / edit a parent meeting.
export default function MeetingForm({ meeting, onClose, onSaved }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const departments = useDepartments();
  const editing = !!meeting?.id;
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(meeting || {}), teachers: (meeting?.teachers || []).map((x) => ({ ...x })) }));
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [notifyChange, setNotifyChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const myBranches = useMemo(() => {
    if (userData?.role === 'ADMIN' || userData?.access === 'all') return allBranches;
    const mine = userBranches(userData);
    return allBranches.filter((b) => mine.includes(b.id));
  }, [allBranches, userData]);

  // Audience size and the classes of the chosen branches / grades.
  const audienceKey = JSON.stringify([form.branches, form.stages, form.classes, form.sections, form.gender]);
  useEffect(() => {
    if (!form.branches.length) { setPreview(null); return undefined; }
    let alive = true;
    setPreviewing(true);
    const timer = setTimeout(() => {
      callMeeting('previewMeetingAudience', { meeting: { branches: form.branches, stages: form.stages, classes: form.classes, sections: form.sections, gender: form.gender } })
        .then((r) => { if (alive) setPreview(r); })
        .catch(() => { if (alive) setPreview(null); })
        .finally(() => { if (alive) setPreviewing(false); });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [audienceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const classOptions = (preview?.classes || []).map((c) => [c.key, `${classLabel(c.key)} (${c.count})`]);
  // Teachers pick among the meeting's classes (or all of the audience's).
  const teacherClassOptions = form.classes.length ? form.classes.map((k) => [k, classLabel(k)]) : (preview?.classes || []).map((c) => [c.key, classLabel(c.key)]);

  const setTeacher = (i, k, v) => setForm((f) => ({ ...f, teachers: f.teachers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  // A manager's position (and a supervisor's subject): the title field
  // follows it unless it was written by hand.
  const setPosition = (i, patch) => setForm((f) => ({
    ...f,
    teachers: f.teachers.map((x, j) => {
      if (j !== i) return x;
      const next = { ...x, ...patch };
      if (next.position !== 'SUBJECT_SUPERVISOR') next.posSubject = '';
      const was = positionLabel(t, x);
      if (!x.subject || x.subject === was) next.subject = positionLabel(t, next);
      return next;
    }),
  }));
  // Rooms change from one meeting to the next, so they are typed here (not
  // taken from the Excel files), only when the meeting needs them.
  const [showRooms, setShowRooms] = useState(() => (meeting?.teachers || []).some((x) => x.room));
  const [allRooms, setAllRooms] = useState('');
  const addTeacher = (role = 'TEACHER') => setForm((f) => ({ ...f, teachers: [...f.teachers, { name: '', subject: '', room: '', role, classes: [] }] }));
  // Interviews on request: the roles parents will not find in this meeting.
  const missingRoles = isRequests(form) ? ['ACADEMIC', 'ADMIN'].filter((r) => !form.teachers.some((x) => (x.role || 'TEACHER') === r)) : [];

  // Teachers from an Excel file: a teacher already in the list (same name)
  // is updated, the others are added.
  const [importMsg, setImportMsg] = useState(null);
  const [importing, setImporting] = useState(false);
  const mergeTeachers = (teachers) => {
    const key = (n) => String(n || '').replace(/\s+/g, ' ').trim();
    let added = 0;
    let updated = 0;
    const list = [...form.teachers];
    teachers.forEach((x) => {
      const i = list.findIndex((y) => key(y.name) === key(x.name));
      if (i >= 0) {
        list[i] = { ...list[i], subject: x.subject || list[i].subject, role: x.role || list[i].role || 'TEACHER', position: x.position || list[i].position || '', posSubject: x.posSubject || list[i].posSubject || '', classes: x.classes.length ? x.classes : list[i].classes || [] };
        updated++;
      } else { list.push(x); added++; }
    });
    set('teachers', list);
    return { added, updated };
  };
  // From «دليل المعلمين»: the teachers of the chosen branches who teach one
  // of the meeting's classes (or list no classes).
  const fromDirectory = async () => {
    if (!form.branches.length || !teacherClassOptions.length) { setImportMsg({ ok: false, text: t('meetings.form.directoryPickFirst') }); return; }
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await callMeeting('getMeetingTeacherDirectory', { branches: form.branches });
      const keys = teacherClassOptions.map(([k]) => k);
      const all = r.branches.flatMap((b) => b.teachers);
      if (!all.length) { setImportMsg({ ok: false, text: t('meetings.form.directoryEmpty') }); return; }
      const picked = all.map((x) => teacherForMeeting(x, keys)).filter((x) => x.teaches).map((x) => x.teacher);
      const { added, updated } = mergeTeachers(picked);
      setImportMsg({ ok: true, text: `${t('meetings.form.imported', { added, updated })} · ${t('meetings.form.directoryOthers', { count: all.length - picked.length })}` });
    } catch (err) { setImportMsg({ ok: false, text: err.message }); } finally { setImporting(false); }
  };
  const importTeachers = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const { teachers, unmatched, skipped } = await readTeachersFile(file, teacherClassOptions.map(([k]) => k));
      if (!teachers.length) { setImportMsg({ ok: false, text: t('meetings.form.importEmpty') }); return; }
      const { added, updated } = mergeTeachers(teachers);
      const parts = [t('meetings.form.imported', { added, updated })];
      if (skipped) parts.push(t('meetings.form.importSkipped', { count: skipped }));
      if (unmatched.length) parts.push(teacherClassOptions.length ? t('meetings.form.importUnmatched', { list: unmatched.join('، ') }) : t('meetings.form.importNoClasses'));
      setImportMsg({ ok: !unmatched.length, text: parts.join(' · ') });
    } catch (err) {
      setImportMsg({ ok: false, text: err.message === 'header' ? t('meetings.form.importHeader') : t('meetings.form.importFailed') });
    } finally { setImporting(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, form[k]]));
      payload.teachers = form.teachers.map((x) => ({ id: x.id, name: x.name, subject: x.subject, role: x.role || 'TEACHER', position: (x.role || 'TEACHER') === 'TEACHER' ? '' : x.position || '', posSubject: x.posSubject || '', room: showRooms ? (x.room || '').trim() : '', classes: x.classes || [] }));
      const r = await callMeeting('saveMeeting', { id: meeting?.id || null, meeting: payload, notifyChange: editing && notifyChange });
      onSaved(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const live = editing && ['OPEN', 'CLOSED'].includes(meeting.status);

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-2 sm:p-4">
      <form onSubmit={save} className="bg-white rounded-2xl w-full max-w-3xl max-h-[94vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{editing ? t('meetings.form.editTitle') : t('meetings.form.newTitle')}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <Section title={t('meetings.form.basics')}>
            <Field label={t('meetings.form.title')}><input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('meetings.form.titlePh')} className={inputCls} /></Field>
            <Field label={t('meetings.form.type')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {MEETING_TYPES.map((ty) => (
                  <button type="button" key={ty} onClick={() => set('type', ty)} className={`p-2.5 rounded-xl border text-start ${form.type === ty ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                    <p className="text-sm font-medium text-slate-800">{t(`meetings.type.${ty}`)}</p>
                    <p className="text-[11px] text-slate-500">{t(`meetings.typeHint.${ty}`)}</p>
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label={t('common.date')}><input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} className={inputCls} /></Field>
              <Field label={t('meetings.form.start')}><input type="time" required value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className={inputCls} /></Field>
              <Field label={t('meetings.form.end')}><input type="time" required value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputCls} /></Field>
              <Field label={t('meetings.form.regDeadline')}><input type="date" value={form.regDeadline} max={form.date || undefined} onChange={(e) => set('regDeadline', e.target.value)} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('meetings.form.location')}><input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder={t('meetings.form.locationPh')} className={inputCls} /></Field>
              <Field label={t('meetings.form.teamsLink')} hint={t('meetings.form.teamsHint')}><input dir="ltr" value={form.teamsLink} onChange={(e) => set('teamsLink', e.target.value)} placeholder="https://teams.microsoft.com/..." className={inputCls} /></Field>
            </div>
            <Field label={t('meetings.form.agenda')} hint={t('meetings.form.agendaHint')}><textarea rows={3} value={form.agenda} onChange={(e) => set('agenda', e.target.value)} className={inputCls} /></Field>
          </Section>

          <Section title={t('meetings.form.audience')} hint={t('meetings.form.audienceHint')}>
            <Field label={t('meetings.form.branches')}><Chips options={myBranches.map((b) => [b.id, b.name])} value={form.branches} onChange={(v) => set('branches', v)} /></Field>
            <Field label={t('meetings.form.stages')} hint={t('meetings.form.allIfEmpty')}><Chips ltr options={STAGES.map((s) => [s, s])} value={form.stages} onChange={(v) => set('stages', v)} /></Field>
            {classOptions.length > 0 && <Field label={t('meetings.form.classes')} hint={t('meetings.form.allIfEmpty')}><Chips ltr options={classOptions} value={form.classes} onChange={(v) => set('classes', v)} /></Field>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('meetings.form.sections')} hint={t('meetings.form.allIfEmpty')}><Chips options={departments.map((d) => [d.id, d.name])} value={form.sections} onChange={(v) => set('sections', v)} /></Field>
              <Field label={t('meetings.form.gender')}>
                <select value={form.gender} onChange={(e) => set('gender', e.target.value)} className={inputCls}>
                  {['ALL', 'BOYS', 'GIRLS'].map((g) => <option key={g} value={g}>{t(`trips.gender.${g}`)}</option>)}
                </select>
              </Field>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-700 flex items-center gap-2">
              <UsersIcon className="w-4 h-4 text-primary shrink-0" />
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : preview
                ? t('meetings.form.audienceCount', { families: preview.families, students: preview.students, noPhone: preview.noPhone })
                : t('meetings.form.pickBranches')}
            </div>
          </Section>

          {isIndividual(form) && (
            <Section title={t('meetings.form.slots')} hint={t('meetings.form.slotsHint')}>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Field label={t('meetings.form.slotsStart')}><input type="time" value={form.slotsStart} onChange={(e) => set('slotsStart', e.target.value)} className={inputCls} /></Field>
                <Field label={t('meetings.form.slotsEnd')}><input type="time" value={form.slotsEnd} onChange={(e) => set('slotsEnd', e.target.value)} className={inputCls} /></Field>
                <Field label={t('meetings.form.slotMinutes')}><input type="number" min={5} max={60} value={form.slotMinutes} onChange={(e) => set('slotMinutes', e.target.value)} className={inputCls} /></Field>
                <Field label={t('meetings.form.breakStart')}><input type="time" value={form.breakStart} onChange={(e) => set('breakStart', e.target.value)} className={inputCls} /></Field>
                <Field label={t('meetings.form.breakEnd')}><input type="time" value={form.breakEnd} onChange={(e) => set('breakEnd', e.target.value)} className={inputCls} /></Field>
              </div>
            </Section>
          )}

          <Section title={isRequests(form) ? t('meetings.form.staffTitle') : t('meetings.form.teachers')} hint={isRequests(form) ? t('meetings.form.staffHint') : t('meetings.form.teachersHint')}>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={showRooms} onChange={(e) => setShowRooms(e.target.checked)} />
                {t('meetings.form.roomsToggle')}
              </label>
              {showRooms && form.teachers.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={allRooms} onChange={(e) => setAllRooms(e.target.value)} placeholder={t('meetings.form.roomForAll')} className={`${inputCls} max-w-xs`} />
                  <button type="button" disabled={!allRooms.trim()} onClick={() => set('teachers', form.teachers.map((x) => ({ ...x, room: allRooms.trim() })))} className="px-3 py-2 text-sm border border-slate-200 bg-white rounded-xl disabled:opacity-50">{t('meetings.form.applyRoom')}</button>
                </div>
              )}
              <p className="text-[11px] text-slate-400">{t('meetings.form.roomsHint')}</p>
            </div>
            {form.teachers.map((tc, i) => (
              <div key={tc.id || i} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className={`grid grid-cols-1 gap-2 ${showRooms ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                  <select value={tc.role || 'TEACHER'} onChange={(e) => setTeacher(i, 'role', e.target.value)} className={inputCls} aria-label={t('meetings.form.role')}>
                    {STAFF_ROLES.map((r) => <option key={r} value={r}>{t(`meetings.roles.${r}`)}</option>)}
                  </select>
                  <input required placeholder={t('meetings.form.teacherName')} value={tc.name} onChange={(e) => setTeacher(i, 'name', e.target.value)} className={inputCls} />
                  <div className="flex gap-2">
                    <input placeholder={(tc.role || 'TEACHER') === 'TEACHER' ? t('meetings.form.subject') : t('meetings.form.staffTitleField')} value={tc.subject} onChange={(e) => setTeacher(i, 'subject', e.target.value)} className={inputCls} />
                    {!showRooms && <button type="button" onClick={() => setForm((f) => ({ ...f, teachers: f.teachers.filter((_, j) => j !== i) }))} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg shrink-0" aria-label={t('common.delete')}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  {showRooms && <div className="flex gap-2">
                    <input placeholder={t('meetings.form.room')} value={tc.room || ''} onChange={(e) => setTeacher(i, 'room', e.target.value)} className={inputCls} />
                    <button type="button" onClick={() => setForm((f) => ({ ...f, teachers: f.teachers.filter((_, j) => j !== i) }))} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg shrink-0" aria-label={t('common.delete')}><Trash2 className="w-4 h-4" /></button>
                  </div>}
                </div>
                {(tc.role || 'TEACHER') !== 'TEACHER' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select value={tc.position || ''} onChange={(e) => setPosition(i, { position: e.target.value })} className={inputCls} aria-label={t('meetings.form.position')}>
                      <option value="">{t('meetings.form.positionPick')}</option>
                      {(STAFF_POSITIONS[tc.role] || []).map((p) => <option key={p} value={p}>{t(`meetings.positions.${p}`)}</option>)}
                    </select>
                    {tc.position === 'SUBJECT_SUPERVISOR' && (
                      <select value={tc.posSubject || ''} onChange={(e) => setPosition(i, { posSubject: e.target.value })} className={inputCls} aria-label={t('meetings.form.subjectPick')}>
                        <option value="">{t('meetings.form.subjectPick')}</option>
                        {SUBJECTS.map((x) => <option key={x} value={x}>{t(`meetings.subjects.${x}`)}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {teacherClassOptions.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">{t('meetings.form.teacherClasses')}</p>
                    <Chips ltr options={teacherClassOptions} value={tc.classes || []} onChange={(v) => setTeacher(i, 'classes', v)} />
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => addTeacher()} className="text-sm text-primary flex items-center gap-1 hover:underline"><Plus className="w-4 h-4" />{t('meetings.form.addTeacher')}</button>
              {isRequests(form) && ['ACADEMIC', 'ADMIN'].map((r) => (
                <button key={r} type="button" onClick={() => addTeacher(r)} className="text-sm text-primary flex items-center gap-1 hover:underline"><Plus className="w-4 h-4" />{t('meetings.form.addRole', { role: t(`meetings.roles.${r}`) })}</button>
              ))}
              <button type="button" disabled={importing} onClick={fromDirectory} className="text-sm text-indigo-700 flex items-center gap-1 hover:underline"><BookUser className="w-4 h-4" />{t('meetings.form.fromDirectory')}</button>
              <label className="text-sm text-emerald-700 flex items-center gap-1 hover:underline cursor-pointer">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}{t('meetings.form.importTeachers')}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { importTeachers(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button type="button" onClick={() => downloadTeachersTemplate()} className="text-sm text-slate-500 flex items-center gap-1 hover:underline"><Download className="w-4 h-4" />{t('meetings.form.teachersTemplate')}</button>
            </div>
            <p className="text-[11px] text-slate-400">{t('meetings.form.importHint')}</p>
            {missingRoles.length > 0 && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2 flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{t('meetings.form.missingRoles', { roles: missingRoles.map((r) => t(`meetings.roles.${r}`)).join(t('meetings.form.and')) })}</p>
            )}
            {importMsg && <p className={`text-xs rounded-lg p-2 ${importMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{importMsg.text}</p>}
          </Section>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.autoReminders} onChange={(e) => set('autoReminders', e.target.checked)} />
            {t('meetings.form.autoReminders')}
          </label>
          {live && (
            <label className="flex items-center gap-2 text-sm text-slate-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <input type="checkbox" checked={notifyChange} onChange={(e) => setNotifyChange(e.target.checked)} />
              {t('meetings.form.notifyChange')}
            </label>
          )}
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl">{t('common.cancel')}</button>
          <button disabled={busy} className="px-4 py-2 text-sm bg-primary text-white rounded-xl flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('common.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
