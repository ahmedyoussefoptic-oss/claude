import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, doc, updateDoc, getDocs, query, where, limit, Timestamp } from 'firebase/firestore';
import { Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { useUsers } from '../../hooks/useUsers';
import { STAGES } from '../../config/complaintTypes';
import { LEAD_SOURCES, INTEREST_LEVELS, normalizePhone, randomCode } from '../../config/platform';
import { Modal, Field, inputCls, btn } from './ui';

const emptyStudent = () => ({ name: '', gender: '', birthDate: '', grade: '', curriculum: '', currentSchool: '' });

// Create or edit a prospective family's file. The parent's mobile is the
// file's key: a number that already has a file opens that file instead.
export default function LeadForm({ lead, onClose, onSaved }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const users = useUsers();
  const staff = users.filter((u) => u.active !== false && u.role !== 'RECEPTIONIST').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  const [form, setForm] = useState(() => ({
    parentName: lead?.parentName || '', phone: lead?.phone ? `0${String(lead.phone).slice(3)}` : '', altPhone: lead?.altPhone ? `0${String(lead.altPhone).slice(3)}` : '',
    district: lead?.district || '', preferredContact: lead?.preferredContact || 'CALL', branch: lead?.branch || '', source: lead?.source || 'CALL_CENTER',
    campaign: lead?.campaign || '', referrer: lead?.referrer || '', interest: lead?.interest || '', assignedTo: lead?.assignedTo || user?.uid || '',
    nextFollowUp: format(lead?.nextFollowUp?.toDate ? lead.nextFollowUp.toDate() : new Date(Date.now() + 86400e3), "yyyy-MM-dd'T'HH:mm"),
    note: '',
  }));
  const [students, setStudents] = useState(() => (lead?.students?.length ? lead.students : [emptyStudent()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setStudent = (i, k, v) => setStudents((list) => list.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  const save = async () => {
    setError(null);
    const phone = normalizePhone(form.phone);
    if (!form.parentName.trim() || !/^9665\d{8}$/.test(phone)) { setError(t('platform.leads.form.required')); return; }
    if (!students.some((s) => s.name.trim() || s.grade)) { setError(t('platform.leads.form.studentRequired')); return; }
    setBusy(true);
    try {
      if (!lead) {
        const dup = await getDocs(query(collection(db, 'leads'), where('phone', '==', phone), limit(1)));
        if (!dup.empty) { setDuplicate({ id: dup.docs[0].id, ...dup.docs[0].data() }); setBusy(false); return; }
      }
      const assignee = staff.find((u) => u.id === form.assignedTo);
      const now = Timestamp.now();
      const data = {
        parentName: form.parentName.trim(), phone, altPhone: normalizePhone(form.altPhone) || '', district: form.district.trim(), preferredContact: form.preferredContact,
        branch: form.branch, source: form.source, campaign: form.campaign.trim(), referrer: form.referrer.trim(), interest: form.interest,
        assignedTo: assignee?.id || null, assignedToName: assignee?.name || '',
        nextFollowUp: Timestamp.fromDate(new Date(form.nextFollowUp)),
        students: students.filter((s) => s.name.trim() || s.grade).map((s) => ({ ...s, name: s.name.trim(), currentSchool: s.currentSchool.trim() })),
        updatedAt: now,
      };
      let id = lead?.id;
      if (lead) {
        await updateDoc(doc(db, 'leads', lead.id), data);
        await addDoc(collection(db, 'leads', lead.id, 'activity'), { type: 'EDITED', text: t('platform.leads.activity.edited'), byName: userData?.name || '', byId: user.uid, at: now });
      } else {
        const ref = await addDoc(collection(db, 'leads'), {
          ...data, code: randomCode('LD'), stage: 'INQUIRY', sideStatus: null, sideReason: '', stageEnteredAt: now, stageHistory: { INQUIRY: now },
          noAnswerCount: 0, documents: {}, createdAt: now, createdByName: userData?.name || '', firstResponseAt: null,
        });
        id = ref.id;
        await addDoc(collection(db, 'leads', id, 'activity'), { type: 'CREATED', text: form.note.trim() || t('platform.leads.activity.created'), byName: userData?.name || '', byId: user.uid, at: now });
      }
      onSaved(id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={lead ? t('platform.leads.form.editTitle') : t('platform.leads.form.newTitle')} subtitle={lead?.code} onClose={onClose}
      footer={<><button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      {duplicate && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4" />{t('platform.leads.form.duplicate', { code: duplicate.code, name: duplicate.parentName })}
          <button onClick={() => onSaved(duplicate.id)} className={`${btn.small} bg-amber-600 text-white`}>{t('platform.leads.form.openExisting')}</button>
        </div>
      )}
      <h3 className="text-sm font-bold text-slate-800">{t('platform.leads.form.parent')}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('platform.leads.form.parentName')} required><input value={form.parentName} onChange={set('parentName')} className={inputCls} /></Field>
        <Field label={t('platform.leads.form.phone')} required><input value={form.phone} onChange={set('phone')} disabled={!!lead} className={`${inputCls} disabled:bg-slate-50`} dir="ltr" placeholder="05xxxxxxxx" /></Field>
        <Field label={t('platform.leads.form.altPhone')}><input value={form.altPhone} onChange={set('altPhone')} className={inputCls} dir="ltr" /></Field>
        <Field label={t('platform.leads.form.district')}><input value={form.district} onChange={set('district')} className={inputCls} /></Field>
        <Field label={t('platform.leads.form.preferredContact')}>
          <select value={form.preferredContact} onChange={set('preferredContact')} className={inputCls}>{['CALL', 'WHATSAPP', 'VISIT'].map((c) => <option key={c} value={c}>{t(`platform.leads.contact.${c}`)}</option>)}</select>
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">{t('platform.leads.form.students')}</h3>
        <button type="button" onClick={() => setStudents((l) => [...l, emptyStudent()])} className={`${btn.small} text-primary hover:bg-primary/10`}><Plus className="w-3.5 h-3.5" />{t('platform.leads.form.addStudent')}</button>
      </div>
      {students.map((s, i) => (
        <div key={i} className="border border-slate-100 rounded-xl p-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <Field label={t('platform.leads.form.studentName')} className="col-span-2"><input value={s.name} onChange={(e) => setStudent(i, 'name', e.target.value)} className={inputCls} /></Field>
          <Field label={t('platform.leads.form.gender')}><select value={s.gender} onChange={(e) => setStudent(i, 'gender', e.target.value)} className={inputCls}><option value="">—</option><option value="M">{t('platform.gender.M')}</option><option value="F">{t('platform.gender.F')}</option></select></Field>
          <Field label={t('platform.leads.form.birthDate')}><input type="date" value={s.birthDate} onChange={(e) => setStudent(i, 'birthDate', e.target.value)} className={inputCls} /></Field>
          <Field label={t('platform.grade')}><select value={s.grade} onChange={(e) => setStudent(i, 'grade', e.target.value)} className={inputCls}><option value="">—</option>{STAGES.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
          <Field label={t('platform.leads.form.curriculum')}><select value={s.curriculum} onChange={(e) => setStudent(i, 'curriculum', e.target.value)} className={inputCls}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label={t('platform.leads.form.currentSchool')} className="col-span-2 md:col-span-5"><input value={s.currentSchool} onChange={(e) => setStudent(i, 'currentSchool', e.target.value)} className={inputCls} /></Field>
          {students.length > 1 && <button type="button" onClick={() => setStudents((l) => l.filter((_, j) => j !== i))} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg justify-self-end"><Trash2 className="w-4 h-4" /></button>}
        </div>
      ))}

      <h3 className="text-sm font-bold text-slate-800">{t('platform.leads.form.routing')}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('platform.leads.form.branch')}><select value={form.branch} onChange={set('branch')} className={inputCls}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label={t('platform.leads.form.source')}><select value={form.source} onChange={set('source')} className={inputCls}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`platform.leads.sources.${s}`)}</option>)}</select></Field>
        <Field label={t('platform.leads.form.campaign')}><input value={form.campaign} onChange={set('campaign')} className={inputCls} /></Field>
        <Field label={t('platform.leads.form.referrer')}><input value={form.referrer} onChange={set('referrer')} className={inputCls} /></Field>
        <Field label={t('platform.leads.form.interest')}><select value={form.interest} onChange={set('interest')} className={inputCls}><option value="">—</option>{INTEREST_LEVELS.map((x) => <option key={x} value={x}>{t(`platform.leads.interest.${x}`)}</option>)}</select></Field>
        <Field label={t('platform.leads.form.assignedTo')}><select value={form.assignedTo} onChange={set('assignedTo')} className={inputCls}><option value="">—</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></Field>
        <Field label={t('platform.leads.nextFollowUp')} required><input type="datetime-local" value={form.nextFollowUp} onChange={set('nextFollowUp')} className={inputCls} dir="ltr" /></Field>
      </div>
      {!lead && <Field label={t('platform.notes')}><textarea rows={2} value={form.note} onChange={set('note')} className={inputCls} /></Field>}
    </Modal>
  );
}
