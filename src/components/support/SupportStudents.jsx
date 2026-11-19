import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { UserPlus, Loader2, Check, X, Send, BellRing, FileSignature, Layers, Undo2, Link2, MessageCircle, FileDown, Phone, Search, Upload, FileSpreadsheet } from 'lucide-react';
import { NOMINATION_TEMPLATE_URL, readNominationRows } from '../../utils/supportNominationExcel';
import { callSupport, SUPPORT_STATUSES, SUPPORT_TYPES, STATUS_STYLE, TYPE_STYLE, SUBJECTS, attRate } from '../../config/support';
import { waLink } from '../../utils/whatsapp';
import StudentPicker from '../platform/StudentPicker';
import { Modal, Field, Pill, Tile, inputCls, btn } from '../platform/ui';

const sel = 'px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
const day = (ms) => (ms ? format(new Date(ms), 'yyyy-MM-dd') : '');

// The cycle's students: nominate (one by one or from Excel), filter by
// state / type / branch / grade, and — for the coordinator — approve, send
// the consent link (WhatsApp or copied), remind, send the pledge, put in a
// group, record a parent's answer taken by phone, withdraw.
export default function SupportStudents({ data, branchName, groupName, reload }) {
  const { t } = useTranslation();
  const c = data.cycle;
  const manage = c.canManage;
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [branch, setBranch] = useState('');
  const [grade, setGrade] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [nominating, setNominating] = useState(false);
  const [answering, setAnswering] = useState(null);
  const [groupTo, setGroupTo] = useState('');
  const [notifyGroup, setNotifyGroup] = useState(true);

  const students = data.students;
  const counts = useMemo(() => { const m = {}; students.forEach((s) => { m[s.status] = (m[s.status] || 0) + 1; }); return m; }, [students]);
  const grades = [...new Set(students.map((s) => s.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const branchesIn = [...new Set(students.map((s) => s.branch).filter(Boolean))];
  const shown = students.filter((s) => (!status || s.status === status) && (!type || s.type === type) && (!branch || s.branch === branch) && (!grade || s.grade === grade)
    && (!q || `${s.name} ${s.studentId} ${s.className}`.includes(q.trim())))
    .sort((a, b) => a.grade.localeCompare(b.grade, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'ar'));
  const picked = shown.filter((s) => selected.includes(s.id));

  const act = async (action, extra = {}, ids = selected) => {
    setBusy(action);
    setNotice(null);
    try {
      const r = await callSupport('supportAction', { id: c.id, action, studentIds: ids, ...extra });
      setNotice({ action, ...r });
      setSelected([]);
      await reload();
    } catch (err) { setNotice({ error: err.message }); } finally { setBusy(''); }
  };
  const copyLinks = async (list) => {
    const text = list.filter((s) => s.link).map((s) => `${s.name}: ${s.link}`).join('\n');
    try { await navigator.clipboard.writeText(text); setNotice({ copied: list.length }); } catch { window.prompt('', text); }
  };
  const waText = (s) => `${t('support.wa.greeting', { name: s.name })}\n${t('support.wa.body', { program: t(`support.types.${s.type}`), cycle: c.title })}\n${s.link}`;

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = shown.map((s) => ({
      [t('support.col.student')]: s.name, ID: s.studentId, [t('common.branch')]: branchName(s.branch), [t('support.col.grade')]: `${s.grade} ${s.className}`.trim(),
      [t('support.col.type')]: t(`support.types.${s.type}`), [t('support.col.subjects')]: s.subjects.join('، '), [t('support.col.reason')]: s.reason,
      [t('support.col.status')]: t(`support.status.${s.status}`), [t('support.col.answer')]: s.consent ? `${s.consent.name} ${day(s.consent.at)}` : s.decline ? `${s.decline.name} ${day(s.decline.at)} — ${s.decline.reason || ''}` : '',
      [t('support.col.pledge')]: s.pledge ? `${s.pledge.name} ${day(s.pledge.at)}` : '', [t('support.col.group')]: groupName[s.groupId] || '',
      [t('support.col.present')]: (s.att.P || 0) + (s.att.L || 0), [t('support.col.absent')]: s.att.A || 0, [t('support.col.rate')]: attRate(s.att) ?? '',
      [t('support.nom.teacher')]: s.nominatedTeacher || '', [t('support.col.nominatedBy')]: s.nominatedByName, ...(manage ? { [t('support.col.link')]: s.link || '' } : {}),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Students');
    XLSX.writeFile(wb, `${c.title.slice(0, 30)}.xlsx`);
  };

  const bulk = (action, Icon, label, tone = btn.ghost, extra) => (
    <button type="button" disabled={!!busy} onClick={() => act(action, extra)} className={tone}>{busy === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{label}</button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        <Tile label={t('support.all')} value={students.length} tone="text-slate-900" onClick={() => setStatus('')} active={!status} />
        {SUPPORT_STATUSES.map((k) => <Tile key={k} label={t(`support.status.${k}`)} value={counts[k] || 0} tone="text-slate-900" onClick={() => setStatus(status === k ? '' : k)} active={status === k} />)}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
        {c.status === 'ACTIVE' && <button type="button" onClick={() => setNominating(true)} className={btn.primary}><UserPlus className="w-4 h-4" />{t('support.nominate')}</button>}
        <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('support.search')} className={`${sel} pr-9 w-52`} /></div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}><option value="">{t('support.allTypes')}</option>{SUPPORT_TYPES.map((x) => <option key={x} value={x}>{t(`support.types.${x}`)}</option>)}</select>
        {branchesIn.length > 1 && <select value={branch} onChange={(e) => setBranch(e.target.value)} className={sel}><option value="">{t('common.allBranches')}</option>{branchesIn.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select>}
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={sel}><option value="">{t('support.allGrades')}</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <div className="flex-1" />
        <button type="button" onClick={exportExcel} className={btn.ghost}><FileDown className="w-4 h-4" />Excel</button>
      </div>

      {manage && picked.length > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">{t('support.selectedN', { n: picked.length })}</span>
          {picked.some((s) => s.status === 'NOMINATED') && bulk('approve', Check, t('support.act.approve'), btn.primary)}
          {picked.some((s) => s.status === 'NOMINATED') && bulk('reject', X, t('support.act.reject'))}
          {picked.some((s) => ['APPROVED', 'PENDING_CONSENT'].includes(s.status)) && bulk('send', Send, t('support.act.send'), btn.primary)}
          {picked.some((s) => s.status === 'PENDING_CONSENT') && bulk('remind', BellRing, t('support.act.remind'))}
          {picked.some((s) => ['DECLINED', 'PLEDGE_SENT'].includes(s.status)) && bulk('sendPledge', FileSignature, t('support.act.pledge'))}
          {picked.some((s) => s.link) && <button type="button" onClick={() => copyLinks(picked)} className={btn.ghost}><Link2 className="w-4 h-4" />{t('support.act.copyLinks')}</button>}
          {picked.some((s) => s.status === 'CONSENTED') && (
            <span className="flex items-center gap-1.5">
              <select value={groupTo} onChange={(e) => setGroupTo(e.target.value)} className={`${sel} py-1.5`}>
                <option value="">{t('support.act.chooseGroup')}</option>
                {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name} — {t(`support.types.${g.type}`)}</option>)}
                <option value="__none">{t('support.act.noGroup')}</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={notifyGroup} onChange={(e) => setNotifyGroup(e.target.checked)} />{t('support.act.notify')}</label>
              <button type="button" disabled={!groupTo || !!busy} onClick={() => act('setGroup', { groupId: groupTo === '__none' ? '' : groupTo, notify: notifyGroup })} className={btn.ghost}>{busy === 'setGroup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}{t('support.act.setGroup')}</button>
            </span>
          )}
          {picked.some((s) => s.status === 'WITHDRAWN') ? bulk('restore', Undo2, t('support.act.restore')) : (
            <button type="button" disabled={!!busy} onClick={() => { const note = window.prompt(t('support.act.withdrawReason')); if (note !== null) act('withdraw', { note }); }} className={btn.ghost}><Undo2 className="w-4 h-4" />{t('support.act.withdraw')}</button>
          )}
        </div>
      )}
      {notice && (
        <div className={`text-sm rounded-xl p-3 border ${notice.error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-800 border-emerald-100'}`}>
          {notice.error || (notice.nominate ? <>{t('support.nomResult', notice.nominate)}{notice.nominate.notFoundIds?.length > 0 && <span className="block text-xs text-amber-800 mt-1">{t('support.nom.notFoundIds')}: <span dir="ltr">{notice.nominate.notFoundIds.join('، ')}</span></span>}</> : notice.copied != null ? t('support.copied', { n: notice.copied }) : notice.noWa ? t('support.noWa', { n: notice.done }) : notice.sent != null ? t('support.sentResult', { done: notice.done, sent: notice.sent, failed: notice.failed }) : t('support.doneN', { n: notice.done }))}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              {manage && <th className="px-2 py-2"><input type="checkbox" checked={shown.length > 0 && shown.every((s) => selected.includes(s.id))} onChange={(e) => setSelected(e.target.checked ? shown.map((s) => s.id) : [])} /></th>}
              {['student', 'type', 'status', 'answer', 'group', 'attendance', 'nominatedBy', ''].map((k) => <th key={k} className="px-2 py-2 text-start font-medium whitespace-nowrap">{k && t(`support.col.${k}`)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.slice(0, 1000).map((s) => {
              const rate = attRate(s.att);
              return (
                <tr key={s.id} className="align-top">
                  {manage && <td className="px-2 py-2"><input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} /></td>}
                  <td className="px-2 py-2"><p className="font-medium text-slate-900">{s.name}</p><p className="text-xs text-slate-500"><span dir="ltr">{s.studentId}</span> · {branchName(s.branch)} · <span dir="ltr">{s.grade} {s.className}</span></p></td>
                  <td className="px-2 py-2"><Pill className={TYPE_STYLE[s.type]}>{t(`support.types.${s.type}`)}</Pill>{s.subjects.length > 0 && <p className="text-xs text-slate-500 mt-1">{s.subjects.join('، ')}</p>}{s.reason && <p className="text-xs text-slate-400 mt-0.5 max-w-56">{s.reason}</p>}</td>
                  <td className="px-2 py-2 whitespace-nowrap"><Pill className={STATUS_STYLE[s.status]}>{t(`support.status.${s.status}`)}</Pill>{s.wa?.status === 'failed' && <p className="text-[11px] text-rose-600 mt-1 max-w-48 whitespace-normal" title={s.wa.error}>{t('support.waFailed')}</p>}{s.sentAt > 0 && <p className="text-[11px] text-slate-400 mt-1">{t('support.sentOn', { day: day(s.sentAt) })}</p>}{s.reviewNote && <p className="text-[11px] text-slate-500 mt-1">{s.reviewNote}</p>}</td>
                  <td className="px-2 py-2 text-xs">
                    {s.consent && <p className="text-emerald-700">✓ {s.consent.name}{s.consent.relation ? ` (${s.consent.relation})` : ''} · {day(s.consent.at)}{s.consent.via === 'STAFF' ? ` · ${t('support.byPhone', { name: s.consent.byName || '' })}` : ''}</p>}
                    {s.decline && <p className="text-rose-700">✗ {s.decline.name} · {day(s.decline.at)}{s.decline.reason ? ` — ${s.decline.reason}` : ''}</p>}
                    {s.pledge && <p className="text-violet-700">✍ {t('support.pledgeSigned', { name: s.pledge.name, day: day(s.pledge.at) })}</p>}
                  </td>
                  <td className="px-2 py-2 text-xs">{groupName[s.groupId] || <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{rate == null ? <span className="text-slate-300">—</span> : <span className={rate < 75 ? 'text-rose-700 font-bold' : 'text-emerald-700'}>{rate}%</span>}{(s.att.A || 0) > 0 && <span className="block text-rose-600">{t('support.absentN', { n: s.att.A })}</span>}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{s.nominatedTeacher && <span className="block text-slate-700">{s.nominatedTeacher}</span>}{s.nominatedByName}<span className="block text-slate-400">{day(s.nominatedAt)}</span></td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {manage && s.link && (
                      <span className="flex gap-1">
                        <button type="button" title={t('support.act.copyLink')} onClick={() => copyLinks([s])} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Link2 className="w-3.5 h-3.5" /></button>
                        {s.phone && <a title={t('support.act.whatsapp')} href={waLink(s.phone, waText(s))} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50"><MessageCircle className="w-3.5 h-3.5" /></a>}
                        {['APPROVED', 'PENDING_CONSENT', 'DECLINED', 'CONSENTED'].includes(s.status) && <button type="button" title={t('support.act.recordAnswer')} onClick={() => setAnswering(s)} className="p-1.5 rounded-lg border border-slate-200 text-primary hover:bg-primary/5"><Phone className="w-3.5 h-3.5" /></button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="py-10 text-center text-sm text-slate-400">{t('support.noStudents')}</p>}
      </section>
      <p className="text-xs text-slate-500">{t('support.flowHint')}</p>

      {nominating && <NominateModal cycle={c} onClose={() => setNominating(false)} onDone={async (r) => { setNominating(false); await reload(); setNotice({ nominate: r }); }} />}
      {answering && <AnswerModal cycle={c} student={answering} onClose={() => setAnswering(null)} onDone={async () => { setAnswering(null); await reload(); }} />}
    </div>
  );
}

// Nominating: the programme, subjects and reason, and the students — picked
// one by one or read from Excel: the teachers' form (each row its own
// programme, subject, reason and teacher; the choices here fill the blanks),
// or any list with 10-digit IDs in it.
function NominateModal({ cycle, onClose, onDone }) {
  const { t } = useTranslation();
  const [type, setType] = useState('REMEDIAL');
  const [subjects, setSubjects] = useState([]);
  const [other, setOther] = useState('');
  const [reason, setReason] = useState('');
  const [list, setList] = useState([]);
  const [fileRows, setFileRows] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chip = (on) => `px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;
  // Several files (one per teacher) add up; a later row for the same student wins.
  const readFiles = async (picked) => {
    setError(null);
    const XLSX = await import('xlsx');
    const byId = new Map(fileRows.map((r) => [r.studentId, r]));
    const names = [];
    for (const file of picked) {
      try {
        const { rows } = readNominationRows(XLSX, XLSX.read(await file.arrayBuffer()));
        rows.forEach((r) => byId.set(r.studentId, r));
        names.push(`${file.name} (${rows.length})`);
      } catch { setError(t('support.nom.badFile', { name: file.name })); }
    }
    setFileRows([...byId.values()]);
    setFiles((x) => [...x, ...names]);
  };
  const fileIds = fileRows.map((r) => r.studentId);
  const ids = [...new Set([...list.map((s) => s.nationalId), ...fileIds])];
  const noType = fileRows.filter((r) => !r.type).length;
  const save = async () => {
    setError(null);
    if (!ids.length) { setError(t('support.nom.needStudents')); return; }
    setBusy(true);
    try {
      const r = await callSupport('supportNominate', {
        id: cycle.id, type, subjects: [...subjects, ...other.split(/[،,]/).map((x) => x.trim()).filter(Boolean)], reason,
        studentIds: list.map((s) => s.nationalId).filter((x) => !fileIds.includes(x)),
        entries: fileRows.map(({ studentId, type: rowType, subjects: rowSubjects, reason: rowReason, teacher }) => ({ studentId, type: rowType, subjects: rowSubjects, reason: rowReason, teacher })),
      });
      onDone(r);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={t('support.nom.title')} onClose={onClose} size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.nom.submit', { n: ids.length })}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <Field label={t('support.nom.type')} required><div className="flex gap-2">{SUPPORT_TYPES.map((x) => <button key={x} type="button" onClick={() => setType(x)} className={chip(type === x)}>{t(`support.types.${x}`)}</button>)}</div></Field>
      <Field label={t('support.nom.subjects')} hint={t('support.nom.subjectsHint')}>
        <div className="flex flex-wrap gap-1.5">{SUBJECTS.map((s) => <button key={s} type="button" onClick={() => setSubjects((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} className={chip(subjects.includes(s))}>{s}</button>)}</div>
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('support.nom.otherSubject')} className={`${inputCls} mt-2`} />
      </Field>
      <Field label={t('support.nom.reason')}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
      <Field label={t('support.nom.students')}>
        <StudentPicker value={null} onChange={(s) => { if (s && !list.some((x) => x.nationalId === s.nationalId)) setList((x) => [...x, s]); }} />
        {list.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{list.map((s) => <span key={s.nationalId} className="px-2 py-1 rounded-lg bg-sky-50 border border-sky-100 text-xs flex items-center gap-1">{s.nameAr || s.name}<button type="button" onClick={() => setList((x) => x.filter((y) => y.nationalId !== s.nationalId))}><X className="w-3 h-3" /></button></span>)}</div>}
        <div className="mt-2 border border-dashed border-primary/40 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer">
              <Upload className="w-4 h-4" />{fileIds.length ? t('support.nom.fromFile', { n: fileIds.length }) : t('support.nom.upload')}
              <input type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) readFiles(f); }} />
            </label>
            <a href={NOMINATION_TEMPLATE_URL} download={t('support.nom.templateFile')} className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5 flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" />{t('support.nom.template')}</a>
          </div>
          <p className="text-xs text-slate-500">{t('support.nom.templateHint')}</p>
          {files.length > 0 && <p className="text-xs text-slate-600">{files.join(' · ')} <button type="button" onClick={() => { setFileRows([]); setFiles([]); }} className="text-rose-600 ms-1">{t('support.nom.clearFiles')}</button></p>}
          {fileRows.some((r) => r.name || r.type || r.reason) && (
            <div className="max-h-56 overflow-auto border border-slate-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['col.student', 'col.grade', 'col.type', 'col.subjects', 'col.reason', 'nom.teacher'].map((k) => <th key={k} className="px-2 py-1.5 text-start font-medium">{t(`support.${k}`)}</th>)}</tr></thead>
                <tbody>
                  {fileRows.map((r) => (
                    <tr key={r.studentId} className="border-t border-slate-100">
                      <td className="px-2 py-1.5"><p className="text-slate-800">{r.name || '—'}</p><p className="text-slate-400" dir="ltr">{r.studentId}</p></td>
                      <td className="px-2 py-1.5" dir="ltr">{[r.grade, r.className].filter(Boolean).join(' ')}</td>
                      <td className="px-2 py-1.5">{r.type ? <Pill className={TYPE_STYLE[r.type]}>{t(`support.types.${r.type}`)}</Pill> : <span className="text-amber-700">{t(`support.types.${type}`)}*</span>}</td>
                      <td className="px-2 py-1.5">{r.subjects.join('، ')}</td>
                      <td className="px-2 py-1.5 max-w-48">{r.reason}</td>
                      <td className="px-2 py-1.5">{r.teacher}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {noType > 0 && <p className="text-xs text-amber-700">{t('support.nom.noTypeRows', { n: noType, type: t(`support.types.${type}`) })}</p>}
        </div>
      </Field>
      <p className="text-xs text-slate-500">{cycle.requireApproval && !cycle.canManage ? t('support.nom.needsApproval') : t('support.nom.direct')}</p>
    </Modal>
  );
}

// A parent's answer taken by phone or in person.
function AnswerModal({ cycle, student, onClose, onDone }) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState('YES');
  const [parentName, setParentName] = useState('');
  const [relation, setRelation] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await callSupport('supportAction', { id: cycle.id, action: 'recordAnswer', studentIds: [student.id], answer, parentName, relation, note }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  const chip = (on, tone) => `px-4 py-2 rounded-xl text-sm border ${on ? tone : 'bg-white text-slate-600 border-slate-200'}`;
  return (
    <Modal title={t('support.ans.title', { name: student.name })} onClose={onClose} size="max-w-md"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setAnswer('YES')} className={chip(answer === 'YES', 'bg-emerald-600 text-white border-emerald-600')}>{t('support.ans.yes')}</button>
        <button type="button" onClick={() => setAnswer('NO')} className={chip(answer === 'NO', 'bg-rose-600 text-white border-rose-600')}>{t('support.ans.no')}</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('support.ans.parent')}><input value={parentName} onChange={(e) => setParentName(e.target.value)} className={inputCls} /></Field>
        <Field label={t('support.ans.relation')}><input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder={t('support.ans.relationPh')} className={inputCls} /></Field>
      </div>
      <Field label={answer === 'NO' ? t('support.ans.reason') : t('support.ans.note')}><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
    </Modal>
  );
}
