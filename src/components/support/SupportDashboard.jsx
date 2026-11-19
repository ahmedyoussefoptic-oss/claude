import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, FileDown, Printer, AlertTriangle, MessageCircle, Phone, FileText, Users, CheckCircle2, XCircle, FileSignature, Clock, ClipboardList, BellRing, Check, X, Wand2 } from 'lucide-react';
import { callSupport, riyadhDay, attRate, time12, TYPE_STYLE, STATUS_STYLE } from '../../config/support';
import { printPage, escapeHtml as esc } from '../../utils/printPage';
import ComplaintForm from '../complaints/ComplaintForm';
import { AutoGroupsModal } from './SupportGroups';
import { Tile, Pill, btn } from '../platform/ui';

const MARK_SIGN = { P: '✓', L: 'م', A: 'غ', E: 'ع' };
const day = (ms) => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(0, 10) : '');
const rateTone = (r) => (r == null ? 'text-slate-400' : r < 75 ? 'text-rose-700' : r < 90 ? 'text-amber-700' : 'text-emerald-700');
const tally = () => ({ P: 0, L: 0, A: 0, E: 0, students: new Set(), sessions: new Set() });
const rateOf = (x) => attRate(x);

// The cycle's follow-up board: where every student stands (nominated → consent
// / pledge), attendance by group, branch, grade and teacher, the absences and
// how each parent was reached (WhatsApp, call), the students absent most (with
// a note opened on their case), the Excel of every list, the printed report
// and each group's attendance sheet.
export default function SupportDashboard({ data, branchName, groupName, reload }) {
  const { t, i18n } = useTranslation();
  const c = data.cycle;
  const [att, setAtt] = useState(null);
  const [list, setList] = useState('');
  const [by, setBy] = useState('group');
  const [openOnly, setOpenOnly] = useState(false);
  const [noteFor, setNoteFor] = useState(null);
  const [busy, setBusy] = useState('');
  const [actError, setActError] = useState(null);
  const [auto, setAuto] = useState(false);
  useEffect(() => { callSupport('supportAttendance', { id: c.id }).then(setAtt).catch(() => setAtt({ sessions: [], calls: [], notTaken: {} })); }, [c.id]);

  const today = riyadhDay();
  const students = data.students;
  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.studentId, s])), [students]);
  const groupsById = useMemo(() => Object.fromEntries(data.groups.map((g) => [g.id, g])), [data.groups]);
  const supName = useMemo(() => Object.fromEntries((data.supervisors || []).map((s) => [s.id, s.name])), [data.supervisors]);
  const callsById = useMemo(() => Object.fromEntries((att?.calls || []).map((x) => [x.id, x])), [att]);
  const callsOf = (sid) => (att?.calls || []).filter((x) => x.studentId === sid);
  const older = (ms, h) => ms && Date.now() - ms > h * 3600e3;

  // Where the students stand.
  const lists = useMemo(() => {
    const of = (st) => students.filter((s) => s.status === st);
    return {
      all: students.filter((s) => s.status !== 'REJECTED'),
      NOMINATED: of('NOMINATED'), APPROVED: of('APPROVED'), PENDING_CONSENT: of('PENDING_CONSENT'), CONSENTED: of('CONSENTED'),
      noGroup: of('CONSENTED').filter((s) => !s.groupId), DECLINED: of('DECLINED'), PLEDGE_SENT: of('PLEDGE_SENT'), PLEDGE_SIGNED: of('PLEDGE_SIGNED'), WITHDRAWN: of('WITHDRAWN'),
      alerts: students.filter((s) => s.absenceAlert),
    };
  }, [students]);

  // Attendance by group / branch / grade / teacher, from the marks themselves.
  const stats = useMemo(() => {
    const out = { group: {}, branch: {}, grade: {}, teacher: {}, total: tally() };
    const absences = [];
    (att?.sessions || []).forEach((s) => {
      const g = groupsById[s.groupId] || {};
      Object.entries(s.marks || {}).forEach(([sid, m]) => {
        const st = byId[sid] || {};
        const keys = { group: s.groupId, branch: g.branch || st.branch || '', grade: st.grade || '', teacher: g.teacher || '' };
        [...Object.entries(keys).map(([k, v]) => (out[k][v] ||= tally())), out.total].forEach((x) => { x[m.s] = (x[m.s] || 0) + 1; x.students.add(sid); x.sessions.add(s.id); });
        if (m.s === 'A') absences.push({ day: s.day, sid, groupId: s.groupId, note: m.note || '', notified: s.notified?.[sid] || null });
      });
    });
    absences.sort((a, b) => b.day.localeCompare(a.day) || (byId[a.sid]?.name || '').localeCompare(byId[b.sid]?.name || '', 'ar'));
    const passed = c.sessions.filter((d) => d <= today);
    const expected = passed.length * data.groups.filter((g) => students.some((s) => s.groupId === g.id && s.status === 'CONSENTED')).length;
    const taken = new Set((att?.sessions || []).filter((s) => s.day <= today).map((s) => s.id)).size;
    return { ...out, absences, expected, taken, passed };
  }, [att, groupsById, byId, c.sessions, data.groups, students, today]);

  const rowsBy = (key) => Object.entries(stats[key]).map(([k, x]) => ({
    key: k, label: key === 'group' ? (groupName[k] || k) : key === 'branch' ? (branchName(k) || '—') : (k || '—'),
    students: x.students.size, sessions: x.sessions.size, P: x.P, L: x.L, A: x.A, E: x.E, rate: rateOf(x),
  })).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
  const mostAbsent = students.filter((s) => (s.att.A || 0) > 0).sort((a, b) => (b.att.A || 0) - (a.att.A || 0)).slice(0, 40);
  const shownAbsences = stats.absences.filter((a) => !openOnly || (a.notified?.call && callsById[a.notified.call]?.status === 'PENDING'));
  const waSent = stats.absences.filter((a) => a.notified?.wa === 'sent').length;
  const absenceCalls = (att?.calls || []).filter((x) => x.kind === 'ABSENT');
  const openCalls = (att?.calls || []).filter((x) => x.status === 'PENDING').length;
  const totalRate = rateOf(stats.total);

  const statusDay = (s) => day(s.status === 'PENDING_CONSENT' ? s.sentAt : s.status === 'CONSENTED' ? s.consent?.at : s.status === 'DECLINED' ? s.decline?.at
    : s.status === 'PLEDGE_SENT' ? s.pledgeSentAt : s.status === 'PLEDGE_SIGNED' ? s.pledge?.at : s.nominatedAt);
  const callText = (x) => (x ? `${t(`support.callKind.${x.kind}`)}: ${x.status === 'PENDING' ? `${t('callTasks.taskStatus.PENDING')}${x.attempts ? ` (${x.attempts})` : ''}` : `${x.result ? t(`callTasks.results.${x.result}`) : t(`callTasks.taskStatus.${x.status}`)}${x.outcome ? ` — ${x.outcome}` : ''}`}` : '');

  // --- Excel ---------------------------------------------------------------
  const studentRow = (s) => ({
    [t('support.col.student')]: s.name, ID: s.studentId, [t('support.col.grade')]: s.grade, [t('support.dash.class')]: s.className, [t('support.dash.branch')]: branchName(s.branch),
    [t('support.col.type')]: t(`support.types.${s.type}`), [t('support.col.subjects')]: s.subjects.join('، '), [t('support.col.reason')]: s.reason, [t('support.col.status')]: t(`support.status.${s.status}`),
    [t('support.dash.statusDay')]: statusDay(s), [t('support.col.nominatedBy')]: s.nominatedByName,
    [t('support.col.answer')]: s.consent ? `${t('support.status.CONSENTED')} — ${s.consent.name}` : s.decline ? `${t('support.status.DECLINED')} — ${s.decline.name}${s.decline.reason ? `: ${s.decline.reason}` : ''}` : '',
    [t('support.col.pledge')]: s.pledge ? `${s.pledge.name} ${day(s.pledge.at)}` : '', [t('support.col.group')]: groupName[s.groupId] || '',
    [t('support.marks.P')]: s.att.P || 0, [t('support.marks.L')]: s.att.L || 0, [t('support.marks.A')]: s.att.A || 0, [t('support.marks.E')]: s.att.E || 0, [t('support.col.rate')]: attRate(s.att) ?? '',
    [t('support.dash.calls')]: callsOf(s.studentId).map(callText).join(' | '), [t('support.dash.notes')]: s.notes.map((n) => n.no).join('، '),
  });
  const rateRow = (r) => ({ [t('support.dash.name')]: r.label, [t('support.dash.studentsN')]: r.students, [t('support.dash.classes')]: r.sessions, [t('support.marks.P')]: r.P, [t('support.marks.L')]: r.L, [t('support.marks.A')]: r.A, [t('support.marks.E')]: r.E, [t('support.col.rate')]: r.rate ?? '' });
  const absenceRow = (a) => {
    const s = byId[a.sid] || {};
    const call = a.notified?.call ? callsById[a.notified.call] : null;
    return { [t('support.att.day')]: a.day, [t('support.col.student')]: s.name || a.sid, ID: a.sid, [t('support.col.grade')]: s.grade || '', [t('support.col.group')]: groupName[a.groupId] || '', [t('support.att.note')]: a.note,
      [t('support.dash.waCol')]: a.notified ? t(`support.waState.${a.notified.wa || 'none'}`) : t('support.waState.waiting'), [t('support.dash.callCol')]: callText(call), [t('support.dash.agent')]: call?.assignedName || '', [t('support.dash.callNote')]: call?.note || '' };
  };
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': '' }]), name.slice(0, 31));
    add(t('support.dash.sheets.students'), lists.all.map(studentRow));
    add(t('support.dash.sheets.noReply'), lists.PENDING_CONSENT.map(studentRow));
    add(t('support.dash.sheets.declined'), [...lists.DECLINED, ...lists.PLEDGE_SENT].map(studentRow));
    add(t('support.dash.sheets.signed'), lists.PLEDGE_SIGNED.map(studentRow));
    add(t('support.dash.sheets.noGroup'), lists.noGroup.map(studentRow));
    ['group', 'branch', 'grade', 'teacher'].forEach((k) => add(t(`support.dash.by.${k}`), rowsBy(k).map(rateRow)));
    add(t('support.dash.sheets.absences'), stats.absences.map(absenceRow));
    add(t('support.att.mostAbsent'), mostAbsent.map(studentRow));
    XLSX.writeFile(wb, `${c.title.slice(0, 30)}-follow-up.xlsx`);
  };

  // --- printing --------------------------------------------------------------
  const print = (title, body, landscape = false) => printPage({
    title, subtitle: `${c.title} · ${c.startDay} → ${c.endDay}`, school: t('trips.print.school'), body, landscape, dir: i18n.dir(), lang: i18n.language,
    css: 'table{width:100%;border-collapse:collapse;margin:6px 0 14px}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:start;font-size:8.5pt}th{background:#f1f5f9}h3{margin:10px 0 4px;color:#0369a1;font-size:11pt}.c{text-align:center}.sheet{page-break-after:always}.sheet:last-child{page-break-after:auto}.meta{color:#475569;font-size:9pt;margin-bottom:4px}.sign{margin-top:18px;display:flex;justify-content:space-between;font-size:9pt}',
  });
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const printReport = () => {
    const tiles = [['all', lists.all.length], ['NOMINATED', lists.NOMINATED.length], ['APPROVED', lists.APPROVED.length], ['PENDING_CONSENT', lists.PENDING_CONSENT.length], ['CONSENTED', lists.CONSENTED.length],
      ['noGroup', lists.noGroup.length], ['DECLINED', lists.DECLINED.length], ['PLEDGE_SENT', lists.PLEDGE_SENT.length], ['PLEDGE_SIGNED', lists.PLEDGE_SIGNED.length], ['WITHDRAWN', lists.WITHDRAWN.length]];
    const rateHead = [t('support.dash.name'), t('support.dash.studentsN'), t('support.dash.classes'), t('support.marks.P'), t('support.marks.L'), t('support.marks.A'), t('support.marks.E'), t('support.col.rate')];
    const rateRows = (k) => rowsBy(k).map((r) => [r.label, r.students, r.sessions, r.P, r.L, r.A, r.E, r.rate == null ? '' : `${r.rate}%`]);
    const body = `<h3>${esc(t('support.dash.standing'))}</h3>${table(tiles.map(([k]) => t(`support.dash.tile.${k}`)), [tiles.map(([, n]) => n)])}
<h3>${esc(t('support.dash.attendance'))}</h3>${table([t('support.dash.totalRate'), t('support.dash.taken'), t('support.dash.absencesN'), t('support.dash.waSent'), t('support.dash.callsAbsent'), t('support.dash.alertsN')],
      [[totalRate == null ? '—' : `${totalRate}%`, `${stats.taken} / ${stats.expected}`, stats.total.A, waSent, absenceCalls.length, lists.alerts.length]])}
${['group', 'branch', 'grade', 'teacher'].map((k) => `<h3>${esc(t(`support.dash.by.${k}`))}</h3>${table(rateHead, rateRows(k))}`).join('')}
<h3>${esc(t('support.att.mostAbsent'))}</h3>${table([t('support.col.student'), t('support.col.grade'), t('support.col.group'), t('support.marks.A'), t('support.col.rate'), t('support.dash.lastAbsent'), t('support.dash.calls')],
      mostAbsent.map((s) => [s.name, `${s.grade} ${s.className}`, groupName[s.groupId] || '', s.att.A || 0, `${attRate(s.att) ?? ''}%`, s.att.lastAbsent || '', callsOf(s.studentId).filter((x) => x.kind === 'ABSENT').map(callText).slice(-1)[0] || '']))}`;
    print(t('support.dash.reportTitle'), body);
  };
  // A group's attendance sheet: its students × the cycle's class days (the
  // marks so far; the coming days blank, to fill by hand).
  const sheetOf = (g) => {
    const members = students.filter((s) => s.groupId === g.id && s.status === 'CONSENTED').sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const marks = {};
    (att?.sessions || []).filter((s) => s.groupId === g.id).forEach((s) => { marks[s.day] = s.marks || {}; });
    const days = c.sessions;
    const chunks = [];
    for (let i = 0; i < days.length; i += 14) chunks.push(days.slice(i, i + 14));
    if (!chunks.length) chunks.push([]);
    const meta = [g.subject && `${t('support.groups.subject')}: ${g.subject}`, g.teacher && `${t('support.groups.teacher')}: ${g.teacher}`, g.room && `${t('support.groups.room')}: ${g.room}`,
      g.supervisorId && supName[g.supervisorId] && `${t('support.dash.supervisor')}: ${supName[g.supervisorId]}`, g.branch && branchName(g.branch), (g.grades || []).join('، ')].filter(Boolean).join(' · ');
    return chunks.map((ds, ci) => `<div class="sheet"><h3>${esc(g.name)} — ${esc(t(`support.types.${g.type}`))}${chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}</h3><div class="meta">${esc(meta)}</div>
<table><thead><tr><th class="c">#</th><th>${esc(t('support.col.student'))}</th><th>${esc(t('support.col.grade'))}</th>${ds.map((d) => `<th class="c" dir="ltr">${d.slice(5)}</th>`).join('')}<th class="c">${esc(t('support.marks.A'))}</th></tr></thead>
<tbody>${members.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${esc(s.name)}</td><td>${esc(`${s.grade} ${s.className}`)}</td>${ds.map((d) => `<td class="c">${esc(MARK_SIGN[marks[d]?.[s.studentId]?.s] || '')}</td>`).join('')}<td class="c">${s.att.A || 0}</td></tr>`).join('')}</tbody></table>
<div class="meta">${esc(t('support.dash.legend'))}</div><div class="sign"><span>${esc(t('support.dash.signSupervisor'))}: ..................</span><span>${esc(t('support.dash.signCoordinator'))}: ..................</span></div></div>`).join('');
  };
  const printSheets = (groups) => print(t('support.dash.sheetTitle'), groups.map(sheetOf).join(''), true);

  if (!att) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const tile = (k, icon, tone, sub) => <Tile key={k} label={t(`support.dash.tile.${k}`)} value={lists[k].length} icon={icon} tone={tone} sub={sub} onClick={() => setList(list === k ? '' : k)} active={list === k} />;
  const picked = list ? lists[list] : [];
  // Approve / reject from the list: one student, or every nominated one.
  const canReview = c.canManage && picked.some((s) => ['NOMINATED', 'REJECTED', ...['APPROVED', 'PENDING_CONSENT', 'DECLINED', 'PLEDGE_SENT']].includes(s.status));
  const review = async (action, ids, key, note = '') => {
    setBusy(key);
    setActError(null);
    try { await callSupport('supportAction', { id: c.id, action, studentIds: ids, note }); await reload(); } catch (err) { setActError(err.message); } finally { setBusy(''); }
  };
  const rejectOne = (s) => { const note = window.prompt(t('support.act.rejectReason', { name: s.name })); if (note !== null) review('reject', [s.id], `reject:${s.id}`, note); };
  const nominatedHere = picked.filter((s) => s.status === 'NOMINATED');
  const awaitingHere = picked.filter((s) => ['APPROVED', 'PENDING_CONSENT'].includes(s.status));
  const notTakenToday = att.notTaken?.[today];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={exportExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('support.dash.excelAll')}</button>
        <button type="button" onClick={printReport} className={btn.ghost}><Printer className="w-4 h-4" />{t('support.dash.printReport')}</button>
        {data.groups.length > 0 && <button type="button" onClick={() => printSheets(data.groups)} className={btn.ghost}><ClipboardList className="w-4 h-4" />{t('support.dash.printSheets')}</button>}
      </div>

      <section>
        <p className="text-sm font-bold text-slate-800 mb-2">{t('support.dash.standing')}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {tile('all', Users)}
          {tile('NOMINATED', Clock, 'text-slate-700')}
          {tile('APPROVED', Clock, 'text-sky-700')}
          {tile('PENDING_CONSENT', BellRing, 'text-amber-700', t('support.dash.over48', { n: lists.PENDING_CONSENT.filter((s) => older(s.sentAt, 48)).length }))}
          {tile('CONSENTED', CheckCircle2, 'text-emerald-700')}
          {tile('noGroup', Users, lists.noGroup.length ? 'text-amber-700' : 'text-slate-900')}
          {tile('DECLINED', XCircle, 'text-rose-700')}
          {tile('PLEDGE_SENT', FileSignature, 'text-orange-700')}
          {tile('PLEDGE_SIGNED', FileSignature, 'text-violet-700')}
          {tile('WITHDRAWN', XCircle, 'text-slate-500')}
        </div>
      </section>

      {list && (
        <section className="bg-white rounded-2xl border border-primary/30 shadow-sm overflow-x-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
            <p className="font-bold text-slate-800 text-sm">{t(`support.dash.tile.${list}`)} ({picked.length})</p>
            <div className="flex-1" />
            {c.canManage && nominatedHere.length > 0 && (
              <button type="button" disabled={!!busy} onClick={() => { if (window.confirm(t('support.act.approveAllConfirm', { n: nominatedHere.length }))) review('approve', nominatedHere.map((s) => s.id), 'approveAll'); }} className="me-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1">
                {busy === 'approveAll' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('support.act.approveAll', { n: nominatedHere.length })}
              </button>
            )}
            {c.canManage && list === 'noGroup' && picked.length > 0 && (
              <button type="button" onClick={() => setAuto(true)} className="me-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white flex items-center gap-1"><Wand2 className="w-3.5 h-3.5" />{t('support.auto.button')}</button>
            )}
            {c.canManage && awaitingHere.length > 0 && (
              <button type="button" disabled={!!busy} onClick={() => { if (window.confirm(t('support.act.consentAllConfirm', { n: awaitingHere.length }))) review('consentMany', awaitingHere.map((s) => s.id), 'consentAll'); }} className="me-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1">
                {busy === 'consentAll' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('support.act.consentAll', { n: awaitingHere.length })}
              </button>
            )}
            <button type="button" onClick={async () => { const XLSX = await import('xlsx'); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(picked.map(studentRow)), 'List'); XLSX.writeFile(wb, `${c.title.slice(0, 20)}-${list}.xlsx`); }} className={`${btn.small} border border-slate-200`}><FileDown className="w-3.5 h-3.5" />Excel</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="px-3 py-2 text-start">{t('support.col.student')}</th><th className="px-3 py-2 text-start">{t('support.col.grade')}</th><th className="px-3 py-2 text-start">{t('support.col.type')}</th><th className="px-3 py-2 text-start">{t('support.col.status')}</th><th className="px-3 py-2 text-start">{t('support.dash.statusDay')}</th><th className="px-3 py-2 text-start">{t('support.dash.calls')}</th>{canReview && <th className="px-3 py-2" />}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {picked.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.name}<span className="block text-xs text-slate-400">{branchName(s.branch)}{s.nominatedByName ? ` · ${s.nominatedByName}` : ''}</span></td>
                  <td className="px-3 py-2 text-xs">{s.grade} {s.className}</td>
                  <td className="px-3 py-2"><Pill className={TYPE_STYLE[s.type]}>{t(`support.types.${s.type}`)}</Pill></td>
                  <td className="px-3 py-2"><Pill className={STATUS_STYLE[s.status]}>{t(`support.status.${s.status}`)}</Pill></td>
                  <td className="px-3 py-2 text-xs" dir="ltr">{statusDay(s)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{callsOf(s.studentId).map(callText).join(' · ')}</td>
                  {canReview && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {['APPROVED', 'PENDING_CONSENT', 'DECLINED', 'PLEDGE_SENT'].includes(s.status) && <button type="button" title={t('support.act.consentOneHint')} disabled={!!busy} onClick={() => review('consentMany', [s.id], `consentMany:${s.id}`)} className="px-2 py-1 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1">{busy === `consentMany:${s.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('support.act.consentOne')}</button>}
                      {['NOMINATED', 'REJECTED'].includes(s.status) && (
                        <span className="flex gap-1">
                          <button type="button" disabled={!!busy} onClick={() => review('approve', [s.id], `approve:${s.id}`)} className="px-2 py-1 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1">{busy === `approve:${s.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{t('support.act.approveOne')}</button>
                          {s.status === 'NOMINATED' && <button type="button" disabled={!!busy} onClick={() => rejectOne(s)} className="px-2 py-1 rounded-lg text-xs font-medium border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60 flex items-center gap-1">{busy === `reject:${s.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}{t('support.act.rejectOne')}</button>}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {auto && <AutoGroupsModal cycle={c} branchName={branchName} onClose={() => setAuto(false)} onDone={async () => { setAuto(false); await reload(); }} />}
          {actError && <p className="mx-4 my-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{actError}</p>}
          {!picked.length && <p className="py-6 text-center text-sm text-slate-400">{t('support.noStudents')}</p>}
        </section>
      )}

      <section>
        <p className="text-sm font-bold text-slate-800 mb-2">{t('support.dash.attendance')}</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Tile label={t('support.dash.totalRate')} value={totalRate == null ? '—' : `${totalRate}%`} tone={rateTone(totalRate)} />
          <Tile label={t('support.dash.taken')} value={`${stats.taken}/${stats.expected}`} tone={stats.taken < stats.expected ? 'text-amber-700' : 'text-slate-900'} sub={notTakenToday ? t('support.dash.notTakenToday', { n: notTakenToday }) : t('support.dash.classDays', { n: stats.passed.length })} />
          <Tile label={t('support.dash.absencesN')} value={stats.total.A} tone="text-rose-700" />
          <Tile label={t('support.dash.waSent')} value={waSent} icon={MessageCircle} />
          <Tile label={t('support.dash.callsAbsent')} value={absenceCalls.length} icon={Phone} sub={t('support.dash.openCalls', { n: openCalls })} />
          <Tile label={t('support.dash.alertsN')} value={lists.alerts.length} icon={AlertTriangle} tone={lists.alerts.length ? 'text-rose-700' : 'text-slate-900'} onClick={() => setList(list === 'alerts' ? '' : 'alerts')} active={list === 'alerts'} />
        </div>
        <p className="text-xs text-slate-500 mt-1.5">{t('support.dash.closeHint', { time: time12(c.closeTime) })}</p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <div className="flex flex-wrap gap-1 p-2 border-b border-slate-100">
          {['group', 'branch', 'grade', 'teacher'].map((k) => <button key={k} type="button" onClick={() => setBy(k)} className={`px-3 py-1.5 rounded-lg text-xs ${by === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`support.dash.by.${k}`)}</button>)}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="px-3 py-2 text-start">{t('support.dash.name')}</th><th className="px-3 py-2">{t('support.dash.studentsN')}</th><th className="px-3 py-2">{t('support.dash.classes')}</th><th className="px-3 py-2">{t('support.marks.P')}</th><th className="px-3 py-2">{t('support.marks.L')}</th><th className="px-3 py-2">{t('support.marks.A')}</th><th className="px-3 py-2">{t('support.marks.E')}</th><th className="px-3 py-2 text-start w-40">{t('support.col.rate')}</th>{by === 'group' && <th />}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rowsBy(by).map((r) => {
              const g = by === 'group' ? groupsById[r.key] : null;
              return (
                <tr key={r.key}>
                  <td className="px-3 py-2">{r.label}{g && <span className="block text-xs text-slate-400">{[g.teacher, g.supervisorId && supName[g.supervisorId], g.room].filter(Boolean).join(' · ')}</span>}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.students}</td><td className="px-3 py-2 text-center tabular-nums">{r.sessions}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-emerald-700">{r.P}</td><td className="px-3 py-2 text-center tabular-nums text-amber-700">{r.L}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-rose-700">{r.A}</td><td className="px-3 py-2 text-center tabular-nums text-slate-500">{r.E}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${r.rate < 75 ? 'bg-rose-500' : r.rate < 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${r.rate || 0}%` }} /></div><span className={`text-xs font-bold tabular-nums ${rateTone(r.rate)}`}>{r.rate ?? '—'}%</span></div></td>
                  {by === 'group' && <td className="px-2">{g && <button type="button" title={t('support.dash.printSheet')} onClick={() => printSheets([g])} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><Printer className="w-4 h-4" /></button>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rowsBy(by).length && <p className="py-6 text-center text-sm text-slate-400">{t('support.dash.noMarks')}</p>}
      </section>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-100">
          <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5"><Phone className="w-4 h-4 text-primary" />{t('support.dash.absenceFollow')} ({stats.absences.length})</p>
          <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />{t('support.dash.openOnly')}</label>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="px-3 py-2 text-start">{t('support.att.day')}</th><th className="px-3 py-2 text-start">{t('support.col.student')}</th><th className="px-3 py-2 text-start">{t('support.col.group')}</th><th className="px-3 py-2 text-start">{t('support.dash.waCol')}</th><th className="px-3 py-2 text-start">{t('support.dash.callCol')}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shownAbsences.slice(0, 150).map((a) => {
              const s = byId[a.sid] || {};
              const call = a.notified?.call ? callsById[a.notified.call] : null;
              const wa = a.notified ? a.notified.wa || 'none' : 'waiting';
              return (
                <tr key={`${a.day}_${a.sid}`}>
                  <td className="px-3 py-2 text-xs whitespace-nowrap" dir="ltr">{a.day}</td>
                  <td className="px-3 py-2">{s.name || a.sid}{a.note && <span className="block text-xs text-slate-500">{a.note}</span>}</td>
                  <td className="px-3 py-2 text-xs">{groupName[a.groupId] || ''}</td>
                  <td className="px-3 py-2"><Pill className={wa === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : wa === 'failed' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200'}>{t(`support.waState.${wa}`)}</Pill></td>
                  <td className="px-3 py-2 text-xs">{call ? <span className={call.status === 'PENDING' ? 'text-amber-700' : call.status === 'DONE' ? 'text-emerald-700' : 'text-rose-700'}>{callText(call)}{call.assignedName ? ` · ${call.assignedName}` : ''}{call.note ? ` — ${call.note}` : ''}</span> : <span className="text-slate-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shownAbsences.length && <p className="py-6 text-center text-sm text-emerald-700">{t('support.att.noAbsence')}</p>}
      </section>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5 px-4 py-2 border-b border-slate-100"><AlertTriangle className="w-4 h-4 text-rose-600" />{t('support.att.mostAbsent')}</p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {mostAbsent.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2">{s.name}<span className="block text-xs text-slate-400">{s.grade} {s.className} · {groupName[s.groupId] || ''}</span></td>
                <td className="px-3 py-2 text-rose-700 font-bold whitespace-nowrap">{t('support.absentN', { n: s.att.A })}</td>
                <td className={`px-3 py-2 text-xs ${rateTone(attRate(s.att))}`}>{attRate(s.att)}%</td>
                <td className="px-3 py-2 text-xs text-slate-400" dir="ltr">{s.att.lastAbsent || ''}</td>
                <td className="px-3 py-2">{s.absenceAlert && <Pill className="bg-rose-50 text-rose-700 border-rose-200">{t('support.dash.alerted', { day: day(s.absenceAlert.at) })}</Pill>}</td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    {s.notes.map((n) => <Link key={n.id} to={`/complaints?openId=${n.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-slate-50 text-primary border-slate-200 font-mono" dir="ltr"><FileText className="w-3 h-3" />{n.no || n.id}</Link>)}
                    {c.canManage && <button type="button" onClick={() => setNoteFor(s)} className={`${btn.small} border border-slate-200 text-slate-700`}><FileText className="w-3.5 h-3.5" />{t('support.dash.toNote')}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!mostAbsent.length && <p className="py-6 text-center text-sm text-emerald-700">{t('support.att.noAbsence')}</p>}
      </section>

      {noteFor && (
        <ComplaintForm onClose={() => setNoteFor(null)}
          onCreated={async ({ id }) => { try { await callSupport('supportAction', { id: c.id, action: 'linkNote', studentIds: [noteFor.id], complaintDocId: id }); await reload(); } catch { /* the note itself is saved */ } }}
          prefill={{ studentId: noteFor.studentId, details: t('support.dash.noteDetails', { program: t(`support.types.${noteFor.type}`), cycle: c.title, n: noteFor.att.A || 0, rate: attRate(noteFor.att) ?? 0, days: stats.absences.filter((a) => a.sid === noteFor.studentId).map((a) => a.day).join('، ') }) }} />
      )}
    </div>
  );
}
