import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { collection, query, orderBy, limit, onSnapshot, addDoc, doc, updateDoc, getDocs, where, arrayUnion, Timestamp } from 'firebase/firestore';
import { DoorOpen, Plus, Loader2, Clock, CheckCircle2, XCircle, Megaphone, LogOut, Undo2, Ban, MessageCircle, ShieldCheck, ShieldAlert, Link2, Copy, Check, Repeat, Paperclip, FileDown } from 'lucide-react';
import { format, isToday, startOfMonth } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { waLink } from '../../utils/whatsapp';
import { Modal, Tile, Field, Pill, inputCls, btn } from '../../components/platform/ui';
import StudentPicker from '../../components/platform/StudentPicker';
import {
  LEAVE_REASONS, LEAVE_STATUSES, LEAVE_STATUS_STYLES, LEAVE_OPEN, PICKUP_RELATIONS, usePlatformSettings, rosterGrade, randomCode,
} from '../../config/platform';

const ms = (ts) => ts?.toMillis?.() || 0;

// New leave request taken at reception / by phone.
function LeaveForm({ onClose, branchName }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const [student, setStudent] = useState(null);
  const [pickups, setPickups] = useState([]);
  const [form, setForm] = useState({ reason: 'MEDICAL', type: 'FULL', time: format(new Date(Date.now() + 30 * 60000), "yyyy-MM-dd'T'HH:mm"), pickupId: '', pickupName: '', pickupRelation: 'FATHER', pickupNationalId: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!student) { setPickups([]); return; }
    getDocs(query(collection(db, 'authorizedPickups'), where('studentId', '==', student.nationalId), where('active', '==', true)))
      .then((snap) => setPickups(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [student]);

  const save = async () => {
    setError(null);
    if (!student) { setError(t('platform.leaves.pickStudent')); return; }
    const chosen = pickups.find((p) => p.id === form.pickupId);
    if (!chosen && !form.pickupName.trim()) { setError(t('platform.leaves.pickupRequired')); return; }
    setBusy(true);
    try {
      const now = Timestamp.now();
      await addDoc(collection(db, 'leaveRequests'), {
        code: randomCode('LV'), studentId: student.nationalId, studentName: student.name, branch: student.branch || '', grade: rosterGrade(student),
        className: student.className || '', parentPhone: student.mobile || '', reason: form.reason, note: form.note.trim(), type: form.type,
        requestedAt: Timestamp.fromDate(new Date(form.time)),
        pickup: chosen
          ? { authorizedId: chosen.id, name: chosen.name, relation: chosen.relation, nationalId: chosen.nationalId || '', authorized: true }
          : { name: form.pickupName.trim(), relation: form.pickupRelation, nationalId: form.pickupNationalId.trim(), authorized: false },
        attachment: null, source: 'RECEPTION', status: 'PENDING',
        history: [{ action: 'REQUESTED', at: now, byName: userData?.name || '', byId: user.uid }],
        createdAt: now, updatedAt: now,
      });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={t('platform.leaves.newTitle')} onClose={onClose} size="max-w-2xl"
      footer={<><button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <Field label={t('platform.student')} required><StudentPicker value={student} onChange={setStudent} branchName={branchName} /></Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label={t('platform.leaves.reason')} required>
          <select value={form.reason} onChange={set('reason')} className={inputCls}>{LEAVE_REASONS.map((r) => <option key={r} value={r}>{t(`platform.leaves.reasons.${r}`)}</option>)}</select>
        </Field>
        <Field label={t('platform.leaves.type')}>
          <select value={form.type} onChange={set('type')} className={inputCls}><option value="FULL">{t('platform.leaves.types.FULL')}</option><option value="TEMPORARY">{t('platform.leaves.types.TEMPORARY')}</option></select>
        </Field>
        <Field label={t('platform.leaves.time')} required><input type="datetime-local" value={form.time} onChange={set('time')} className={inputCls} dir="ltr" /></Field>
      </div>
      <Field label={t('platform.leaves.pickup')} required hint={pickups.length ? t('platform.leaves.pickupHint') : t('platform.leaves.noAuthorized')}>
        <select value={form.pickupId} onChange={set('pickupId')} className={inputCls}>
          <option value="">{t('platform.leaves.otherPerson')}</option>
          {pickups.map((p) => <option key={p.id} value={p.id}>{p.name} — {t(`platform.relations.${p.relation}`, p.relation)}</option>)}
        </select>
      </Field>
      {!form.pickupId && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('platform.leaves.pickupName')}><input value={form.pickupName} onChange={set('pickupName')} className={inputCls} /></Field>
          <Field label={t('platform.leaves.relation')}><select value={form.pickupRelation} onChange={set('pickupRelation')} className={inputCls}>{PICKUP_RELATIONS.map((r) => <option key={r} value={r}>{t(`platform.relations.${r}`)}</option>)}</select></Field>
          <Field label={t('platform.leaves.nationalId')}><input value={form.pickupNationalId} onChange={set('pickupNationalId')} className={inputCls} dir="ltr" /></Field>
        </div>
      )}
      <Field label={t('platform.notes')}><textarea rows={2} value={form.note} onChange={set('note')} className={inputCls} /></Field>
    </Modal>
  );
}

// Handing the student over: verify the person collecting them.
function ExitDialog({ leave, onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const [receiverName, setReceiverName] = useState(leave.pickup?.name || '');
  const [receiverId, setReceiverId] = useState(leave.pickup?.nationalId || '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const authorized = leave.pickup?.authorized;
  const save = async () => {
    setBusy(true);
    const now = Timestamp.now();
    await updateDoc(doc(db, 'leaveRequests', leave.id), {
      status: 'EXITED', exitAt: now, exitByName: userData?.name || '', receiver: { name: receiverName.trim(), nationalId: receiverId.trim(), authorized: !!authorized, parentConfirmed: !authorized && confirmed },
      history: arrayUnion({ action: 'EXITED', at: now, byName: userData?.name || '', byId: user.uid }), updatedAt: now,
    });
    onClose();
  };
  return (
    <Modal title={t('platform.leaves.exitTitle')} subtitle={`${leave.studentName} · ${leave.code}`} onClose={onClose} size="max-w-lg" z="z-[120]"
      footer={<><button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button disabled={busy || !receiverName.trim() || (!authorized && !confirmed)} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}<LogOut className="w-4 h-4" />{t('platform.leaves.confirmExit')}</button></>}>
      <div className={`rounded-xl p-3 text-sm flex gap-2 ${authorized ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
        {authorized ? <ShieldCheck className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
        {authorized ? t('platform.leaves.authorizedNote', { name: leave.pickup.name }) : t('platform.leaves.notAuthorizedNote', { name: leave.pickup?.name || '' })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('platform.leaves.receiverName')} required><input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} className={inputCls} /></Field>
        <Field label={t('platform.leaves.nationalId')}><input value={receiverId} onChange={(e) => setReceiverId(e.target.value)} className={inputCls} dir="ltr" /></Field>
      </div>
      {!authorized && (
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t('platform.leaves.parentConfirmed')}</label>
      )}
    </Modal>
  );
}

function NoteDialog({ title, label, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  return (
    <Modal title={title} onClose={onClose} size="max-w-md" z="z-[120]"
      footer={<><button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button disabled={!text.trim()} onClick={() => onConfirm(text.trim())} className={btn.primary}>{t('common.confirm')}</button></>}>
      <Field label={label} required><textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} /></Field>
    </Modal>
  );
}

// الاستئذانات — today's queue at the branches: approve, call the student to
// reception, hand over to a verified person, record the return.
export default function Leaves() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const settings = usePlatformSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leaves, setLeaves] = useState(null);
  const [range, setRange] = useState('TODAY');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [exiting, setExiting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => onSnapshot(query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'), limit(1000)), (snap) => {
    setLeaves(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => setLeaves([])), []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const openId = searchParams.get('openId');
  useEffect(() => { if (openId) { setRange('ALL'); setSearchParams({}, { replace: true }); } }, [openId, setSearchParams]);

  const monthStart = startOfMonth(new Date()).getTime();
  const monthCount = useMemo(() => {
    const m = {};
    (leaves || []).forEach((l) => { if (ms(l.requestedAt) >= monthStart && !['REJECTED', 'CANCELLED'].includes(l.status)) m[l.studentId] = (m[l.studentId] || 0) + 1; });
    return m;
  }, [leaves, monthStart]);

  const list = (leaves || []).filter((l) => (range === 'ALL' || isToday(l.requestedAt?.toDate?.() || new Date(0)) || LEAVE_OPEN.includes(l.status))
    && (statusFilter === 'ALL' || l.status === statusFilter) && (!branchFilter || l.branch === branchFilter));
  const today = (leaves || []).filter((l) => isToday(l.requestedAt?.toDate?.() || new Date(0)));
  const stats = {
    pending: (leaves || []).filter((l) => l.status === 'PENDING').length,
    waiting: (leaves || []).filter((l) => ['APPROVED', 'CALLED'].includes(l.status)).length,
    exitedToday: today.filter((l) => ['EXITED', 'RETURNED'].includes(l.status)).length,
    repeated: Object.values(monthCount).filter((n) => n >= settings.leaveMonthlyLimit).length,
  };

  const act = async (l, status, extra = {}, note) => {
    const at = Timestamp.now();
    await updateDoc(doc(db, 'leaveRequests', l.id), {
      status, ...extra, updatedAt: at,
      history: arrayUnion({ action: status, at, byName: userData?.name || '', byId: user.uid, ...(note ? { note } : {}) }),
    });
  };
  const link = `${window.location.origin}/leave`;
  const fmtTime = (ts) => (ts?.toDate ? format(ts.toDate(), 'p', { locale: dateLocale }) : '');
  const msg = (l, kind) => t(`platform.leaves.wa.${kind}`, { name: l.studentName, time: fmtTime(kind === 'exit' ? l.exitAt : l.requestedAt), pickup: l.receiver?.name || l.pickup?.name || '' });

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.map((l) => ({
      [t('platform.code')]: l.code, [t('platform.student')]: l.studentName, [t('platform.nationalId')]: l.studentId, [t('common.branch')]: branchName(l.branch), [t('platform.grade')]: `${l.grade || ''} ${l.className || ''}`,
      [t('platform.leaves.reason')]: t(`platform.leaves.reasons.${l.reason}`), [t('platform.leaves.time')]: l.requestedAt?.toDate ? format(l.requestedAt.toDate(), 'yyyy-MM-dd HH:mm') : '',
      [t('platform.leaves.pickup')]: l.pickup?.name || '', [t('platform.leaves.authorized')]: l.pickup?.authorized ? '✓' : '✗', [t('common.status')]: t(`platform.leaves.status.${l.status}`),
      [t('platform.leaves.exitAt')]: l.exitAt?.toDate ? format(l.exitAt.toDate(), 'HH:mm') : '',
    }))), 'Leaves');
    XLSX.writeFile(wb, `leaves-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><DoorOpen className="w-6 h-6 text-primary" />{t('platform.leaves.title')}</h1>
          <p className="text-slate-500 mt-1">{t('platform.leaves.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }} className={btn.ghost}>{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Link2 className="w-4 h-4" />}{t('platform.leaves.copyParentLink')}</button>
          <button onClick={exportExcel} className={btn.ghost}><FileDown className="w-4 h-4" />{t('platform.exportExcel')}</button>
          <button onClick={() => setShowForm(true)} className={btn.primary}><Plus className="w-4 h-4" />{t('platform.leaves.new')}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={t('platform.leaves.statPending')} value={stats.pending} icon={Clock} tone="text-amber-600" onClick={() => setStatusFilter('PENDING')} active={statusFilter === 'PENDING'} />
        <Tile label={t('platform.leaves.statWaiting')} value={stats.waiting} icon={Megaphone} tone="text-sky-700" onClick={() => setStatusFilter('APPROVED')} active={statusFilter === 'APPROVED'} />
        <Tile label={t('platform.leaves.statExited')} value={stats.exitedToday} icon={LogOut} tone="text-emerald-700" onClick={() => { setStatusFilter('EXITED'); setRange('TODAY'); }} active={statusFilter === 'EXITED'} />
        <Tile label={t('platform.leaves.statRepeated', { n: settings.leaveMonthlyLimit })} value={stats.repeated} icon={Repeat} tone="text-rose-600" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {['TODAY', 'ALL'].map((r) => <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-lg text-sm ${range === r ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{t(`platform.range.${r}`)}</button>)}
          <span className="w-px h-6 bg-slate-200 mx-1" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="ALL">{t('platform.allStatuses')}</option>
            {LEAVE_STATUSES.map((s) => <option key={s} value={s}>{t(`platform.leaves.status.${s}`)}</option>)}
          </select>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">{t('common.allBranches')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {!leaves ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          : list.length === 0 ? <p className="py-16 text-center text-slate-400 text-sm">{t('platform.leaves.empty')}</p> : (
            <ul className="divide-y divide-slate-100">
              {list.map((l) => {
                const due = ms(l.requestedAt);
                const urgent = l.status === 'PENDING' && due - now < settings.leaveUrgentMinutes * 60000;
                const count = monthCount[l.studentId] || 0;
                return (
                  <li key={l.id} className={`p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${urgent ? 'bg-rose-50/50' : ''} ${l.id === openId ? 'ring-2 ring-primary/40' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                        {l.studentName}
                        <span className="text-xs font-normal text-slate-500" dir="ltr">{l.grade} {l.className}</span>
                        <Pill className={LEAVE_STATUS_STYLES[l.status]}>{t(`platform.leaves.status.${l.status}`)}</Pill>
                        {urgent && <Pill className="bg-rose-100 text-rose-700 border-rose-200">{t('platform.leaves.urgent')}</Pill>}
                        {count >= settings.leaveMonthlyLimit && <Pill className="bg-rose-50 text-rose-700 border-rose-200"><Repeat className="w-3 h-3 ml-1" />{t('platform.leaves.repeatedBadge', { n: count })}</Pill>}
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {branchName(l.branch)} · {t(`platform.leaves.reasons.${l.reason}`)}{l.note && ` — ${l.note}`} · {t(`platform.leaves.types.${l.type}`)}
                      </p>
                      <p className="text-sm mt-0.5 flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">{t('platform.leaves.pickup')}:</span>
                        <span className="font-medium text-slate-800">{l.pickup?.name}</span>
                        <span className="text-xs text-slate-500">{t(`platform.relations.${l.pickup?.relation}`, l.pickup?.relation || '')}</span>
                        {l.pickup?.authorized ? <Pill className="bg-emerald-50 text-emerald-700 border-emerald-200">{t('platform.leaves.authorized')}</Pill> : <Pill className="bg-amber-50 text-amber-800 border-amber-200">{t('platform.leaves.notAuthorized')}</Pill>}
                        {l.attachment?.fileUrl && <a href={l.attachment.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{t('platform.attachment')}</a>}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        <span dir="ltr">{l.code}</span> · {t(`platform.leaves.source.${l.source}`, l.source)}
                        {l.rejectReason && <span className="text-rose-600"> · {l.rejectReason}</span>}
                        {l.exitAt && <span className="text-emerald-700"> · {t('platform.leaves.exitedAt', { time: fmtTime(l.exitAt), name: l.receiver?.name || '' })}</span>}
                        {l.returnAt && <span className="text-teal-700"> · {t('platform.leaves.returnedAt', { time: fmtTime(l.returnAt) })}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 lg:text-left space-y-2">
                      <p className="text-sm font-bold text-slate-800 flex items-center gap-1 lg:justify-end"><Clock className="w-4 h-4 text-slate-400" />{fmtTime(l.requestedAt)}{!isToday(l.requestedAt?.toDate?.() || new Date(0)) && <span className="text-xs font-normal text-slate-400"> · {l.requestedAt?.toDate && format(l.requestedAt.toDate(), 'd MMM', { locale: dateLocale })}</span>}</p>
                      <div className="flex flex-wrap gap-1.5 lg:justify-end">
                        {l.status === 'PENDING' && <>
                          <button onClick={() => act(l, 'APPROVED', { approvedAt: Timestamp.now(), approvedByName: userData?.name || '' })} className={`${btn.small} bg-emerald-600 text-white`}><CheckCircle2 className="w-3.5 h-3.5" />{t('platform.leaves.approve')}</button>
                          <button onClick={() => setRejecting(l)} className={`${btn.small} bg-rose-50 text-rose-700 border border-rose-200`}><XCircle className="w-3.5 h-3.5" />{t('platform.leaves.reject')}</button>
                        </>}
                        {l.status === 'APPROVED' && <button onClick={() => act(l, 'CALLED', { calledAt: Timestamp.now() })} className={`${btn.small} bg-indigo-600 text-white`}><Megaphone className="w-3.5 h-3.5" />{t('platform.leaves.call')}</button>}
                        {['APPROVED', 'CALLED'].includes(l.status) && <button onClick={() => setExiting(l)} className={`${btn.small} bg-primary text-white`}><LogOut className="w-3.5 h-3.5" />{t('platform.leaves.handOver')}</button>}
                        {l.status === 'EXITED' && l.type === 'TEMPORARY' && <button onClick={() => act(l, 'RETURNED', { returnAt: Timestamp.now() })} className={`${btn.small} bg-teal-600 text-white`}><Undo2 className="w-3.5 h-3.5" />{t('platform.leaves.returned')}</button>}
                        {LEAVE_OPEN.includes(l.status) && <button onClick={() => act(l, 'CANCELLED')} className={`${btn.small} text-slate-500 hover:bg-slate-100`}><Ban className="w-3.5 h-3.5" />{t('platform.leaves.cancel')}</button>}
                        {l.parentPhone && ['APPROVED', 'CALLED'].includes(l.status) && <a href={waLink(l.parentPhone, msg(l, 'approved'))} target="_blank" rel="noreferrer" className={`${btn.small} bg-[#25D366] text-white`}><MessageCircle className="w-3.5 h-3.5" />{t('platform.leaves.waApproved')}</a>}
                        {l.parentPhone && l.status === 'EXITED' && <a href={waLink(l.parentPhone, msg(l, 'exit'))} target="_blank" rel="noreferrer" className={`${btn.small} bg-[#25D366] text-white`}><MessageCircle className="w-3.5 h-3.5" />{t('platform.leaves.waExit')}</a>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>

      {showForm && <LeaveForm onClose={() => setShowForm(false)} branchName={branchName} />}
      {exiting && <ExitDialog leave={exiting} onClose={() => setExiting(null)} />}
      {rejecting && <NoteDialog title={t('platform.leaves.reject')} label={t('platform.leaves.rejectReason')} onClose={() => setRejecting(null)} onConfirm={async (note) => { await act(rejecting, 'REJECTED', { rejectReason: note }, note); setRejecting(null); }} />}
    </div>
  );
}
