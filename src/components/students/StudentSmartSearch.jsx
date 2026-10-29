import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { Sparkles, Search, Loader2, FileSpreadsheet, UserPlus, Pencil, Plus, Trash2, Users, FileText, Bus, HeartHandshake, DoorOpen, ListPlus } from 'lucide-react';
import { format } from 'date-fns';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { useAdminPermissions, adminCan, canSeePlatform } from '../../config/adminPermissions';
import { canSeeTrips } from '../../utils/scope';
import { searchStudents, lookupStudentById, buildStudentRecord, studentDisplayName, normalizeStudentId } from '../../utils/students';
import { studentKey } from '../../utils/studentKey';
import { Modal, Field, inputCls } from '../platform/ui';

const STATUS_NS = { complaint: 'complaint', tech: 'techSupport', lostFound: 'lostFound' };
const STAGE_NAMES = ['أمريكي', 'بريطاني', 'تربية خاصة', 'رياض أطفال'];
const GRADE_NAMES = [...[1, 2, 3].map((n) => `KG ${n}`), ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`), 'SEN'];
const EMPTY = { nameAr: '', name: '', nationalId: '', branch: '', stageName: '', gradeName: '', className: '', mobile: '', parentNationalId: '', gender: '' };
const day = (ms) => (ms ? format(new Date(ms), 'yyyy-MM-dd') : '');
const btnCls = 'px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50';

// The roster's fields in display / export order.
function rosterRows(s, t, branchName) {
  return [
    ['nameAr', s.nameAr], ['name', s.name], ['nationalId', s.nationalId], ['branch', branchName(s.branch) || s.branchName],
    ['stageName', s.stageName], ['gradeName', s.gradeName], ['className', s.className], ['mobile', s.mobile],
    ['parentNationalId', s.parentNationalId], ['gender', s.gender ? t(`studentRecords.smart.genders.${s.gender}`) : ''],
    ['status', t(s.active === false ? 'studentRecords.smart.inactive' : 'studentRecords.smart.active')],
    ['source', t(s.source === 'manual' ? 'studentRecords.smart.sourceManual' : 'studentRecords.smart.sourceImport')],
    ['updatedAt', day(s.updatedAt?.toMillis?.() || (s.importedAt ? Date.parse(s.importedAt) : null))],
  ].map(([k, v]) => [t(`studentRecords.smart.fields.${k}`), v || '']);
}

// «البحث الذكي في بيانات الطلاب»: any part of the Arabic / English name,
// the student's ID, or the parent's ID / mobile (all siblings), over the
// imported roster. Each student opens a full file (roster data, extra data,
// siblings, records, trips, and for the platform users special education and
// leaves) that exports to Excel; students can be added and edited.
export default function StudentSmartSearch({ records, branchName }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const caps = useAdminPermissions();
  const canEdit = canSeePlatform(userData) || adminCan(userData, caps, 'settings');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(null); // { student | null }

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setResults(null); setError(null); return undefined; }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchStudents(q, 25)
        .then((list) => { if (alive) { setResults(list); setError(null); } })
        .catch((err) => { if (alive) { setResults([]); setError(err.message); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [term]);

  const exportResults = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const extraKeys = [...new Set(results.flatMap((s) => Object.keys(s.extraFields || {})))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.map((s) => ({
      ...Object.fromEntries(rosterRows(s, t, branchName)),
      ...Object.fromEntries(extraKeys.map((k) => [k, s.extraFields?.[k] || ''])),
    }))), t('studentRecords.smart.sheetStudent'));
    XLSX.writeFile(wb, `students-search-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const saved = async (nationalId) => {
    setEditing(null);
    const fresh = await lookupStudentById(nationalId);
    if (fresh) {
      setProfile(fresh);
      setResults((list) => (list ? [fresh, ...list.filter((s) => s.nationalId !== nationalId)] : [fresh]));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-6 overflow-hidden">
      <div className="p-4 md:p-5 bg-gradient-to-l from-primary/5 to-transparent border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div>
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />{t('studentRecords.smart.title')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t('studentRecords.smart.hint')}</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing({ student: null })} className={`${btnCls} bg-primary text-white hover:bg-primary/90 self-start md:self-auto`}><UserPlus className="w-4 h-4" />{t('studentRecords.smart.addStudent')}</button>
        )}
      </div>
      <div className="p-4 md:p-5 space-y-3">
        <div className="relative">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">{searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}</div>
          <input type="text" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('studentRecords.smart.placeholder')} className="block w-full pr-10 pl-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {results && !error && (results.length === 0 ? (
          <p className="text-sm text-slate-500 py-2">{t('studentRecords.smart.noMatch')}</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{t('studentRecords.smart.found', { count: results.length })}</span>
              <button type="button" onClick={exportResults} className="text-emerald-700 hover:underline flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" />{t('studentRecords.smart.exportResults')}</button>
            </div>
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>{['nameAr', 'nationalId', 'branch', 'gradeName', 'mobile', 'parentNationalId'].map((k) => <th key={k} className="px-3 py-2.5 font-medium whitespace-nowrap">{t(`studentRecords.smart.fields.${k}`)}</th>)}<th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((s) => (
                    <tr key={s.nationalId} className="hover:bg-slate-50 cursor-pointer" onClick={() => setProfile(s)}>
                      <td className="px-3 py-2.5"><p className="font-medium text-slate-900">{studentDisplayName(s)}</p>{s.nameAr && s.name !== s.nameAr && <p className="text-xs text-slate-400" dir="ltr">{s.name}</p>}</td>
                      <td className="px-3 py-2.5 text-slate-600" dir="ltr">{s.nationalId}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{branchName(s.branch) || s.branchName || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{[s.gradeName, s.className].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600" dir="ltr">{s.mobile || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600" dir="ltr">{s.parentNationalId || '—'}</td>
                      <td className="px-3 py-2.5 text-left"><span className="text-xs text-primary whitespace-nowrap">{t('studentRecords.smart.openFile')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
      </div>

      {profile && !editing && (
        <StudentFile student={profile} records={records} branchName={branchName} canEdit={canEdit}
          onEdit={() => setEditing({ student: profile })} onOpen={setProfile} onClose={() => setProfile(null)} />
      )}
      {editing && <StudentForm student={editing.student} onSaved={saved} onClose={() => setEditing(null)} />}
    </div>
  );
}

// The full file of one roster student.
function StudentFile({ student: s, records, branchName, canEdit, onEdit, onOpen, onClose }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const platform = canSeePlatform(userData);
  const tripsOk = canSeeTrips(userData);
  const [siblings, setSiblings] = useState(null);
  const [trips, setTrips] = useState(tripsOk ? null : []);
  const [extra, setExtra] = useState(platform ? null : { leaves: [], sped: [] });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    const keep = (fn) => (v) => { if (alive) fn(v); };
    setSiblings(null);
    const byParent = s.parentNationalId
      ? getDocs(query(collection(db, 'students'), where('parentNationalId', '==', s.parentNationalId), limit(20))).then((snap) => snap.docs.map((d) => d.data()))
      : Promise.resolve([]);
    byParent.then((list) => list.filter((x) => x.nationalId !== s.nationalId && x.active !== false)).catch(() => []).then(keep(setSiblings));
    if (tripsOk) {
      setTrips(null);
      httpsCallable(functions, 'getStudentTrips')({ studentId: s.nationalId, full: true }).then((r) => r.data.trips).catch(() => []).then(keep(setTrips));
    }
    if (platform) {
      setExtra(null);
      Promise.all([
        httpsCallable(functions, 'getStudent360')({ studentId: s.nationalId }).then((r) => r.data).catch(() => ({})),
        getDocs(query(collection(db, 'spedSubmissions'), where('studentId', '==', s.nationalId))).then((snap) => snap.docs.map((d) => d.data())).catch(() => []),
      ]).then(([d360, sped]) => ({ leaves: d360.leaves || [], pickups: d360.pickups || [], reenrollments: d360.reenrollments || [], calls: d360.calls || [], sped })).then(keep(setExtra));
    }
    return () => { alive = false; };
  }, [s.nationalId, s.parentNationalId, tripsOk, platform]);

  const keys = new Set([`id:${s.nationalId}`, studentKey('', s.nameAr), studentKey('', s.name)].filter(Boolean));
  const mine = records.filter((r) => keys.has(studentKey(r.studentId, r.studentName))).sort((a, b) => b.date - a.date);
  const recordRow = (r) => ({
    [t('studentRecords.kind')]: t(`studentRecords.kinds.${r.kind}`), [t('studentRecords.number')]: r.number, [t('common.date')]: format(r.date, 'yyyy-MM-dd HH:mm'),
    [t('studentRecords.topic')]: [r.title, r.subject].filter(Boolean).join(' — '), [t('common.status')]: t(`statuses.${STATUS_NS[r.kind]}.${r.status}`, r.status), [t('common.branch')]: branchName(r.branch),
  });
  const tripRow = (tr) => ({
    [t('studentRecords.smart.trip')]: tr.title, [t('common.date')]: tr.date, [t('common.status')]: t(`trips.enrollment.${tr.status}`, tr.status),
    [t('studentRecords.smart.fee')]: tr.fee ?? '', [t('studentRecords.smart.paid')]: tr.paidAmount ?? '', [t('studentRecords.smart.attendance')]: tr.boarded === true ? '✓' : tr.boarded === false ? '✗' : '',
    [t('studentRecords.smart.notes')]: [tr.healthNotes, ...(tr.incidents || []).map((x) => x.note)].filter(Boolean).join(' | '),
  });
  const spedRow = (e) => ({
    [t('spedForm.guardianName')]: e.guardianName, [t('spedForm.guardianId')]: e.guardianId, [t('spedForm.relation')]: e.relation, [t('spedForm.studentDob')]: e.studentDob,
    [t('spedForm.email')]: e.email, [t('spedForm.phone')]: e.phone, [t('spedForm.altPhone')]: e.altPhone, [t('spedForm.grade')]: e.grade,
    [t('spedForm.inclusionType')]: e.inclusionType, [t('spedForm.disability')]: e.disability, [t('common.date')]: day(e.updatedAt?.toMillis?.()),
  });
  const leaveRow = (l) => ({ [t('platform.leaves.reason')]: t(`platform.leaves.reasons.${l.reason}`, l.reason || ''), [t('common.date')]: day(l.at), [t('platform.leaves.pickup')]: l.pickup, [t('common.status')]: t(`platform.leaves.status.${l.status}`, l.status || '') });

  const exportFile = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const sheet = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31)); };
      const info = [...rosterRows(s, t, branchName), ...Object.entries(s.extraFields || {})].map(([k, v]) => ({ [t('studentRecords.smart.field')]: k, [t('studentRecords.smart.value')]: v }));
      sheet(t('studentRecords.smart.sheetStudent'), info);
      sheet(t('studentRecords.smart.siblings'), (siblings || []).map((x) => Object.fromEntries(rosterRows(x, t, branchName).slice(0, 8))));
      sheet(t('studentRecords.smart.records'), mine.map(recordRow));
      sheet(t('studentRecords.smart.trips'), (trips || []).map(tripRow));
      sheet(t('studentRecords.smart.sped'), (extra?.sped || []).map(spedRow));
      sheet(t('studentRecords.smart.leaves'), (extra?.leaves || []).map(leaveRow));
      sheet(t('studentRecords.smart.pickups'), (extra?.pickups || []).map((p) => ({ [t('studentRecords.smart.fields.nameAr')]: p.name, [t('platform.leaves.relation')]: t(`platform.relations.${p.relation}`, p.relation || ''), [t('studentRecords.smart.fields.nationalId')]: p.nationalId || '', [t('studentRecords.smart.fields.mobile')]: p.phone || '' })));
      sheet(t('studentRecords.smart.reenroll'), (extra?.reenrollments || []).map((r) => ({ [t('studentRecords.smart.year')]: r.year, [t('common.status')]: t(`platform.reenroll.intents.${r.intent}`, r.intent || '') })));
      sheet(t('studentRecords.smart.calls'), (extra?.calls || []).map((c) => ({ [t('common.date')]: day(c.at), [t('studentRecords.smart.campaign')]: c.campaign, [t('studentRecords.smart.result')]: c.outcome || c.result, [t('studentRecords.smart.notes')]: c.note, [t('studentRecords.smart.by')]: c.byName })));
      XLSX.writeFile(wb, `student-${s.nationalId}.xlsx`);
    } finally {
      setExporting(false);
    }
  };
  const loading = siblings === null || trips === null || extra === null;

  const section = (Icon, title, count, body) => (
    <section className="border border-slate-100 rounded-2xl p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-2"><Icon className="w-4 h-4 text-primary" />{title}{count != null && <span className="text-slate-400 font-normal">({count})</span>}</p>
      {body}
    </section>
  );
  const empty = <p className="text-xs text-slate-400">—</p>;
  const list = (rows, render) => (rows === null ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : rows.length ? <ul className="divide-y divide-slate-50 text-sm">{rows.map(render)}</ul> : empty);

  return (
    <Modal title={studentDisplayName(s)} subtitle={<span dir="ltr">{s.nationalId}</span>} onClose={onClose} size="max-w-5xl"
      footer={<>
        {canEdit && <button type="button" onClick={onEdit} className={`${btnCls} border border-slate-300 text-slate-700 hover:bg-slate-100`}><Pencil className="w-4 h-4" />{t('studentRecords.smart.edit')}</button>}
        <button type="button" onClick={exportFile} disabled={loading || exporting} className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}>{loading || exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}{t('studentRecords.smart.exportAll')}</button>
      </>}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 bg-slate-50 rounded-2xl p-4">
        {rosterRows(s, t, branchName).map(([label, v]) => (
          <div key={label} className="min-w-0"><p className="text-[11px] text-slate-500">{label}</p><p className="text-sm font-medium text-slate-900 break-words">{v || '—'}</p></div>
        ))}
      </div>

      {section(ListPlus, t('studentRecords.smart.extraData'), null, Object.keys(s.extraFields || {}).length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(s.extraFields).map(([k, v]) => <div key={k} className="text-sm"><span className="text-slate-500">{k}: </span><span className="text-slate-900 font-medium">{v}</span></div>)}
        </div>
      ) : <p className="text-xs text-slate-400">{canEdit ? t('studentRecords.smart.noExtraEdit') : '—'}</p>)}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {section(Users, t('studentRecords.smart.siblings'), siblings?.length, list(siblings, (x) => (
          <li key={x.nationalId} className="py-1.5 flex justify-between gap-2 cursor-pointer hover:text-primary" onClick={() => onOpen(x)}>
            <span>{studentDisplayName(x)}</span><span className="text-xs text-slate-500">{[x.gradeName, x.className].filter(Boolean).join(' · ')}</span>
          </li>
        )))}
        {section(FileText, t('studentRecords.smart.records'), mine.length, list(mine, (r) => (
          <li key={`${r.kind}-${r.id}`} className="py-1.5 flex justify-between gap-2">
            <span><span className="text-xs text-slate-400">{t(`studentRecords.kinds.${r.kind}`)}</span> {r.title}</span>
            <span className="text-xs text-slate-500 shrink-0">{t(`statuses.${STATUS_NS[r.kind]}.${r.status}`, r.status)} · {format(r.date, 'yyyy-MM-dd')}</span>
          </li>
        )))}
        {tripsOk && section(Bus, t('studentRecords.smart.trips'), trips?.length, list(trips, (tr) => (
          <li key={tr.tripId} className="py-1.5 flex justify-between gap-2">
            <span>{tr.title}</span><span className="text-xs text-slate-500 shrink-0">{t(`trips.enrollment.${tr.status}`, tr.status)} · {tr.date}</span>
          </li>
        )))}
        {platform && section(HeartHandshake, t('studentRecords.smart.sped'), extra?.sped.length, list(extra && extra.sped, (e, i) => (
          <li key={i} className="py-1.5 text-sm">{[e.grade, e.inclusionType, e.disability].filter(Boolean).join(' · ')} <span className="text-xs text-slate-500">— {e.guardianName}</span></li>
        )))}
        {platform && section(DoorOpen, t('studentRecords.smart.leaves'), extra?.leaves.length, list(extra && extra.leaves, (l) => (
          <li key={l.id} className="py-1.5 flex justify-between gap-2">
            <span>{t(`platform.leaves.reasons.${l.reason}`, l.reason || '')}</span><span className="text-xs text-slate-500 shrink-0">{t(`platform.leaves.status.${l.status}`, l.status || '')} · {day(l.at)}</span>
          </li>
        )))}
      </div>
    </Modal>
  );
}

// Adds a student to the roster or edits one, with «بيانات إضافية» (any
// label → value). Saved through saveRosterStudent.
function StudentForm({ student, onSaved, onClose }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const isNew = !student;
  const [form, setForm] = useState(() => (student ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, student[k] || ''])) : EMPTY));
  const [extra, setExtra] = useState(() => {
    const rows = Object.entries(student?.extraFields || {}).map(([label, value]) => ({ label, value }));
    return rows.length ? rows : [{ label: '', value: '' }];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setRow = (i, k) => (e) => setExtra((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const record = buildStudentRecord({ ...form, nationalId: normalizeStudentId(form.nationalId) }, branches);
      const extraFields = Object.fromEntries(extra.filter((r) => r.label.trim() && r.value.trim()).map((r) => [r.label.trim(), r.value.trim()]));
      const { data } = await httpsCallable(functions, 'saveRosterStudent')({ isNew, student: { ...record, extraFields } });
      await onSaved(data.nationalId);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const text = (k, props = {}) => <input value={form[k]} onChange={set(k)} className={inputCls} {...props} />;
  return (
    <Modal title={t(isNew ? 'studentRecords.smart.addStudent' : 'studentRecords.smart.editTitle')} subtitle={student && studentDisplayName(student)} onClose={onClose} size="max-w-2xl" z="z-[120]"
      footer={<>
        <button type="button" onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>{t('common.cancel')}</button>
        <button type="submit" form="roster-student-form" disabled={busy} className={`${btnCls} bg-primary text-white hover:bg-primary/90`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button>
      </>}
    >
      <form id="roster-student-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('studentRecords.smart.fields.nameAr')} required>{text('nameAr', { required: true, maxLength: 120 })}</Field>
          <Field label={t('studentRecords.smart.fields.name')}>{text('name', { maxLength: 120, dir: 'ltr' })}</Field>
          <Field label={t('studentRecords.smart.fields.nationalId')} required hint={isNew ? null : t('studentRecords.smart.idLocked')}>{text('nationalId', { required: true, maxLength: 20, dir: 'ltr', inputMode: 'numeric', disabled: !isNew })}</Field>
          <Field label={t('studentRecords.smart.fields.branch')} required>
            <select required value={form.branch} onChange={set('branch')} className={inputCls}>
              <option value="">{t('spedForm.choose')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label={t('studentRecords.smart.fields.stageName')}>{text('stageName', { list: 'roster-stage-names', maxLength: 60 })}</Field>
          <Field label={t('studentRecords.smart.fields.gradeName')}>{text('gradeName', { list: 'roster-grade-names', maxLength: 30, dir: 'ltr' })}</Field>
          <Field label={t('studentRecords.smart.fields.className')}>{text('className', { maxLength: 30, dir: 'ltr', placeholder: 'MA5-1' })}</Field>
          <Field label={t('studentRecords.smart.fields.gender')}>
            <select value={form.gender} onChange={set('gender')} className={inputCls}>
              <option value="">—</option>
              {['M', 'F'].map((g) => <option key={g} value={g}>{t(`studentRecords.smart.genders.${g}`)}</option>)}
            </select>
          </Field>
          <Field label={t('studentRecords.smart.fields.mobile')}>{text('mobile', { maxLength: 14, dir: 'ltr', inputMode: 'tel', placeholder: '05xxxxxxxx' })}</Field>
          <Field label={t('studentRecords.smart.fields.parentNationalId')}>{text('parentNationalId', { maxLength: 20, dir: 'ltr', inputMode: 'numeric' })}</Field>
        </div>
        <datalist id="roster-stage-names">{STAGE_NAMES.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="roster-grade-names">{GRADE_NAMES.map((v) => <option key={v} value={v} />)}</datalist>

        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><ListPlus className="w-4 h-4 text-primary" />{t('studentRecords.smart.extraData')}</p>
          <p className="text-xs text-slate-500">{t('studentRecords.smart.extraHint')}</p>
          {extra.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input value={r.label} onChange={setRow(i, 'label')} maxLength={60} placeholder={t('studentRecords.smart.field')} className={`${inputCls} sm:max-w-[40%]`} />
              <input value={r.value} onChange={setRow(i, 'value')} maxLength={500} placeholder={t('studentRecords.smart.value')} className={inputCls} />
              <button type="button" onClick={() => setExtra((rows) => rows.filter((_, j) => j !== i))} className="p-2 text-slate-400 hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setExtra((rows) => [...rows, { label: '', value: '' }])} className="text-sm text-primary flex items-center gap-1"><Plus className="w-4 h-4" />{t('studentRecords.smart.addField')}</button>
        </div>
        {!isNew && student.source !== 'manual' && <p className="text-xs text-amber-700 bg-amber-50 rounded-xl p-2.5">{t('studentRecords.smart.importNote')}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
