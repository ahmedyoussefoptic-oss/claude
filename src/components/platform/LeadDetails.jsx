import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, doc, updateDoc, onSnapshot, query, orderBy, Timestamp, increment } from 'firebase/firestore';
import { Phone, MessageCircle, Pencil, Loader2, ChevronLeft, PauseCircle, XCircle, ListOrdered, RotateCcw, CheckCircle2, AlertTriangle, Paperclip, Upload } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches, useDepartments } from '../../hooks/useOrgData';
import { waLink } from '../../utils/whatsapp';
import { uploadStaffFile } from '../../utils/uploadStaffFile';
import { useSlaSettings } from '../../utils/businessTime';
import {
  LEAD_STAGES, LEAD_SIDE, LOSS_REASONS, INTEREST_LEVELS, ACTIVITY_TYPES, TEST_RESULTS, LEAD_DOCUMENTS, STAGE_COLORS, SIDE_STYLES, usePlatformSettings,
} from '../../config/platform';
import { Modal, Field, Pill, inputCls, btn } from './ui';
import LeadForm from './LeadForm';
import { leadOpen, stageOverdue, followUpOverdue, tsMs } from './leadUtils';

const dtLocal = (ms) => format(new Date(ms), "yyyy-MM-dd'T'HH:mm");

// One prospective family's file: stage progress, the next step with what it
// needs, side statuses, follow-up log and timeline.
export default function LeadDetails({ lead, onClose }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const settings = usePlatformSettings();
  const slaCfg = useSlaSettings();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const deptName = (id) => departments.find((d) => d.id === id)?.name || id || '';
  const [activity, setActivity] = useState([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // 'advance' | 'side' | null
  const nextStage = LEAD_STAGES[LEAD_STAGES.indexOf(lead.stage) + 1];
  const open = leadOpen(lead);
  const defaultFollow = dtLocal(Math.max(Date.now() + 86400e3, tsMs(lead.nextFollowUp)));
  const [adv, setAdv] = useState({ visitAt: '', interest: lead.interest || '', testAt: '', testResult: '', academicNumber: '', amount: '', receipt: null, followUp: defaultFollow, note: '' });
  const [side, setSide] = useState({ status: 'POSTPONED', reason: 'PRICE', followUp: defaultFollow, note: '' });
  const [log, setLog] = useState({ type: 'CALL', text: '', followUp: defaultFollow });

  useEffect(() => onSnapshot(query(collection(db, 'leads', lead.id, 'activity'), orderBy('at', 'desc')), (snap) => {
    setActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => {}), [lead.id]);

  const by = () => ({ byName: userData?.name || '', byId: user.uid });
  const write = async (patch, act) => {
    setBusy(true);
    setError(null);
    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, 'leads', lead.id), { ...patch, updatedAt: now });
      if (act) await addDoc(collection(db, 'leads', lead.id, 'activity'), { ...act, ...by(), at: now });
      setPanel(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const advance = async () => {
    const need = {
      VISIT_BOOKED: adv.visitAt, VISITED: adv.interest, TEST: adv.testAt, RESULT: adv.testResult, ENROLLED: adv.academicNumber.trim(),
    }[nextStage];
    if (need === '' || (nextStage !== 'ENROLLED' && !adv.followUp)) { setError(t('platform.leads.advanceMissing')); return; }
    const now = Timestamp.now();
    let receipt = null;
    if (adv.receipt) receipt = await uploadStaffFile('leads', lead.code, adv.receipt);
    const patch = {
      stage: nextStage, stageEnteredAt: now, [`stageHistory.${nextStage}`]: now, sideStatus: null, sideReason: '',
      ...(nextStage !== 'ENROLLED' ? { nextFollowUp: Timestamp.fromDate(new Date(adv.followUp)) } : { nextFollowUp: null, enrolledAt: now, academicNumber: adv.academicNumber.trim() }),
      ...(nextStage === 'VISIT_BOOKED' ? { visitAt: Timestamp.fromDate(new Date(adv.visitAt)) } : {}),
      ...(nextStage === 'VISITED' ? { interest: adv.interest } : {}),
      ...(nextStage === 'TEST' ? { testAt: Timestamp.fromDate(new Date(adv.testAt)) } : {}),
      ...(nextStage === 'RESULT' ? { testResult: adv.testResult } : {}),
      ...(receipt ? { paymentReceipt: receipt } : {}),
      ...(adv.amount ? { paidAmount: Number(adv.amount) || 0 } : {}),
    };
    await write(patch, { type: 'STAGE', stage: nextStage, text: [t(`platform.leads.stages.${nextStage}`), adv.note.trim()].filter(Boolean).join(' — ') });
  };

  const setSideStatus = async () => {
    if (side.status !== 'LOST' && side.status !== 'UNQUALIFIED' && !side.followUp) { setError(t('platform.leads.advanceMissing')); return; }
    await write({
      sideStatus: side.status, sideReason: side.status === 'LOST' ? side.reason : side.note.trim(), sideAt: Timestamp.now(),
      nextFollowUp: ['POSTPONED', 'WAITLIST'].includes(side.status) ? Timestamp.fromDate(new Date(side.followUp)) : null,
    }, { type: 'SIDE', side: side.status, text: [t(`platform.leads.side.${side.status}`), side.status === 'LOST' ? t(`platform.leads.loss.${side.reason}`) : '', side.note.trim()].filter(Boolean).join(' — ') });
  };

  const addLog = async () => {
    if (!log.text.trim() && log.type !== 'NO_ANSWER') { setError(t('platform.leads.logMissing')); return; }
    if (open && !log.followUp) { setError(t('platform.leads.followUpRequired')); return; }
    const first = !lead.firstResponseAt && ['CALL', 'WHATSAPP', 'VISIT'].includes(log.type);
    await write({
      ...(open ? { nextFollowUp: Timestamp.fromDate(new Date(log.followUp)) } : {}),
      ...(first ? { firstResponseAt: Timestamp.now() } : {}),
      ...(log.type === 'NO_ANSWER' ? { noAnswerCount: increment(1) } : {}),
      lastContactAt: Timestamp.now(),
    }, { type: log.type, text: log.text.trim() || t('platform.leads.activityTypes.NO_ANSWER') });
    setLog((l) => ({ ...l, text: '' }));
  };

  const toggleDoc = (k) => write({ [`documents.${k}`]: !(lead.documents || {})[k] });
  const stageIdx = LEAD_STAGES.indexOf(lead.stage);
  const overdue = stageOverdue(lead, settings, slaCfg);
  const followLate = followUpOverdue(lead);
  const msg = t('platform.leads.waGreeting', { name: lead.parentName });

  return (
    <Modal
      title={<span className="flex flex-wrap items-center gap-2">{lead.parentName}<span className="text-xs font-mono font-normal text-slate-400" dir="ltr">{lead.code}</span>{lead.sideStatus && <Pill className={`${SIDE_STYLES[lead.sideStatus]} border-transparent`}>{t(`platform.leads.side.${lead.sideStatus}`)}</Pill>}</span>}
      subtitle={<span className="flex flex-wrap items-center gap-3">
        <a href={`tel:+${lead.phone}`} className="flex items-center gap-1 hover:text-primary" dir="ltr"><Phone className="w-4 h-4" />0{String(lead.phone).slice(3)}</a>
        <a href={waLink(lead.phone, msg)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-700"><MessageCircle className="w-4 h-4" />WhatsApp</a>
        <span>{branchName(lead.branch)} · {t(`platform.leads.sources.${lead.source}`, lead.source)}{lead.assignedToName && ` · ${lead.assignedToName}`}</span>
      </span>}
      onClose={onClose} size="max-w-5xl"
    >
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}

      {/* Stage progress */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {LEAD_STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <span className={`px-2 py-1 rounded-lg text-[11px] font-medium ${i < stageIdx ? 'bg-emerald-100 text-emerald-700' : i === stageIdx ? `${STAGE_COLORS[s]} text-white` : 'bg-slate-100 text-slate-400'}`}>{i + 1}. {t(`platform.leads.stages.${s}`)}</span>
            {i < LEAD_STAGES.length - 1 && <ChevronLeft className="w-3 h-3 text-slate-300" />}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {overdue && <Pill className="bg-rose-100 text-rose-700 border-rose-200"><AlertTriangle className="w-3 h-3 ml-1" />{t('platform.leads.stageOverdue')}</Pill>}
        {followLate && <Pill className="bg-amber-100 text-amber-800 border-amber-200">{t('platform.leads.followUpLate')}</Pill>}
        {lead.nextFollowUp && <span className="text-slate-500">{t('platform.leads.nextFollowUp')}: <b dir="ltr">{format(lead.nextFollowUp.toDate(), 'yyyy-MM-dd HH:mm')}</b></span>}
        {lead.noAnswerCount > 0 && <span className="text-slate-500">{t('platform.leads.noAnswerCount', { n: lead.noAnswerCount })}</span>}
        {lead.stageEnteredAt && <span className="text-slate-400">{t('platform.leads.inStageSince', { ago: formatDistanceToNow(lead.stageEnteredAt.toDate(), { locale: dateLocale }) })}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setEditing(true)} className={btn.ghost}><Pencil className="w-4 h-4" />{t('common.edit')}</button>
        {open && !lead.sideStatus && nextStage && <button onClick={() => setPanel(panel === 'advance' ? null : 'advance')} className={btn.primary}><CheckCircle2 className="w-4 h-4" />{t('platform.leads.moveTo', { stage: t(`platform.leads.stages.${nextStage}`) })}</button>}
        {open && <button onClick={() => setPanel(panel === 'side' ? null : 'side')} className={btn.ghost}><PauseCircle className="w-4 h-4" />{t('platform.leads.setSide')}</button>}
        {lead.sideStatus && <button disabled={busy} onClick={() => write({ sideStatus: null, sideReason: '', nextFollowUp: Timestamp.fromMillis(Date.now() + 86400e3) }, { type: 'SIDE', side: 'RESUMED', text: t('platform.leads.resumed') })} className={btn.ghost}><RotateCcw className="w-4 h-4" />{t('platform.leads.resume')}</button>}
        {open && lead.noAnswerCount >= 3 && lead.sideStatus !== 'LOST' && <button disabled={busy} onClick={() => write({ sideStatus: 'LOST', sideReason: 'NO_ANSWER', sideAt: Timestamp.now(), nextFollowUp: null }, { type: 'SIDE', side: 'LOST', text: t('platform.leads.loss.NO_ANSWER') })} className={btn.danger}><XCircle className="w-4 h-4" />{t('platform.leads.markNoAnswer')}</button>}
      </div>

      {panel === 'advance' && (
        <div className="border border-primary/20 bg-primary/5 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">{t('platform.leads.moveTo', { stage: t(`platform.leads.stages.${nextStage}`) })}</p>
          <p className="text-xs text-slate-500">{t(`platform.leads.stageHint.${nextStage}`)}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {nextStage === 'VISIT_BOOKED' && <Field label={t('platform.leads.visitAt')} required><input type="datetime-local" value={adv.visitAt} onChange={(e) => setAdv((a) => ({ ...a, visitAt: e.target.value }))} className={inputCls} dir="ltr" /></Field>}
            {nextStage === 'VISITED' && <Field label={t('platform.leads.form.interest')} required><select value={adv.interest} onChange={(e) => setAdv((a) => ({ ...a, interest: e.target.value }))} className={inputCls}><option value="">—</option>{INTEREST_LEVELS.map((x) => <option key={x} value={x}>{t(`platform.leads.interest.${x}`)}</option>)}</select></Field>}
            {nextStage === 'TEST' && <Field label={t('platform.leads.testAt')} required><input type="datetime-local" value={adv.testAt} onChange={(e) => setAdv((a) => ({ ...a, testAt: e.target.value }))} className={inputCls} dir="ltr" /></Field>}
            {nextStage === 'RESULT' && <Field label={t('platform.leads.testResult')} required><select value={adv.testResult} onChange={(e) => setAdv((a) => ({ ...a, testResult: e.target.value }))} className={inputCls}><option value="">—</option>{TEST_RESULTS.map((x) => <option key={x} value={x}>{t(`platform.leads.results.${x}`)}</option>)}</select></Field>}
            {nextStage === 'ENROLLED' && <>
              <Field label={t('platform.leads.academicNumber')} required><input value={adv.academicNumber} onChange={(e) => setAdv((a) => ({ ...a, academicNumber: e.target.value }))} className={inputCls} dir="ltr" /></Field>
              <Field label={t('platform.leads.paidAmount')}><input type="number" value={adv.amount} onChange={(e) => setAdv((a) => ({ ...a, amount: e.target.value }))} className={inputCls} /></Field>
            </>}
            {['PAYMENT', 'ENROLLED'].includes(nextStage) && (
              <Field label={t('platform.leads.receipt')}>
                <label className="flex items-center gap-2 px-3 py-2 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-600 cursor-pointer bg-white">
                  <Upload className="w-4 h-4" />{adv.receipt ? adv.receipt.name : t('platform.chooseFile')}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setAdv((a) => ({ ...a, receipt: e.target.files?.[0] || null }))} />
                </label>
              </Field>
            )}
            {nextStage !== 'ENROLLED' && <Field label={t('platform.leads.nextFollowUp')} required><input type="datetime-local" value={adv.followUp} onChange={(e) => setAdv((a) => ({ ...a, followUp: e.target.value }))} className={inputCls} dir="ltr" /></Field>}
            <Field label={t('platform.notes')} className="md:col-span-3"><input value={adv.note} onChange={(e) => setAdv((a) => ({ ...a, note: e.target.value }))} className={inputCls} /></Field>
          </div>
          <div className="flex justify-end gap-2"><button onClick={() => setPanel(null)} className={btn.ghost}>{t('common.cancel')}</button><button disabled={busy} onClick={advance} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.confirm')}</button></div>
        </div>
      )}

      {panel === 'side' && (
        <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {LEAD_SIDE.map((s) => <button key={s} onClick={() => setSide((x) => ({ ...x, status: s }))} className={`px-3 py-1.5 rounded-lg text-sm border ${side.status === s ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`platform.leads.side.${s}`)}</button>)}
          </div>
          <p className="text-xs text-slate-500">{t(`platform.leads.sideHint.${side.status}`)}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {side.status === 'LOST' && <Field label={t('platform.leads.lossReason')} required><select value={side.reason} onChange={(e) => setSide((x) => ({ ...x, reason: e.target.value }))} className={inputCls}>{LOSS_REASONS.map((r) => <option key={r} value={r}>{t(`platform.leads.loss.${r}`)}</option>)}</select></Field>}
            {['POSTPONED', 'WAITLIST'].includes(side.status) && <Field label={t('platform.leads.nextFollowUp')} required><input type="datetime-local" value={side.followUp} onChange={(e) => setSide((x) => ({ ...x, followUp: e.target.value }))} className={inputCls} dir="ltr" /></Field>}
            <Field label={t('platform.notes')} className="md:col-span-2"><input value={side.note} onChange={(e) => setSide((x) => ({ ...x, note: e.target.value }))} className={inputCls} /></Field>
          </div>
          <div className="flex justify-end gap-2"><button onClick={() => setPanel(null)} className={btn.ghost}>{t('common.cancel')}</button><button disabled={busy} onClick={setSideStatus} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.confirm')}</button></div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-slate-100 rounded-2xl p-4">
            <p className="text-sm font-bold text-slate-800 mb-2">{t('platform.leads.form.students')}</p>
            <ul className="space-y-1.5 text-sm">
              {(lead.students || []).map((s, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-medium text-slate-900">{s.name || '—'}</span>
                  {s.grade && <span dir="ltr" className="text-slate-600">{s.grade}</span>}
                  {s.curriculum && <span className="text-slate-500">{deptName(s.curriculum)}</span>}
                  {s.gender && <span className="text-slate-500">{t(`platform.gender.${s.gender}`)}</span>}
                  {s.birthDate && <span className="text-slate-400" dir="ltr">{s.birthDate}</span>}
                  {s.currentSchool && <span className="text-slate-400">{t('platform.leads.from')} {s.currentSchool}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              {lead.district && <span>{t('platform.leads.form.district')}: {lead.district}</span>}
              {lead.campaign && <span>{t('platform.leads.form.campaign')}: {lead.campaign}</span>}
              {lead.referrer && <span>{t('platform.leads.form.referrer')}: {lead.referrer}</span>}
              {lead.interest && <span>{t('platform.leads.form.interest')}: {t(`platform.leads.interest.${lead.interest}`)}</span>}
              {lead.visitAt && <span>{t('platform.leads.visitAt')}: <b dir="ltr">{format(lead.visitAt.toDate(), 'yyyy-MM-dd HH:mm')}</b></span>}
              {lead.testAt && <span>{t('platform.leads.testAt')}: <b dir="ltr">{format(lead.testAt.toDate(), 'yyyy-MM-dd HH:mm')}</b></span>}
              {lead.testResult && <span>{t('platform.leads.testResult')}: {t(`platform.leads.results.${lead.testResult}`)}</span>}
              {lead.academicNumber && <span>{t('platform.leads.academicNumber')}: <b dir="ltr">{lead.academicNumber}</b></span>}
              {lead.paymentReceipt?.fileUrl && <a href={lead.paymentReceipt.fileUrl} target="_blank" rel="noreferrer" className="text-primary flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{t('platform.leads.receipt')}</a>}
              {lead.sideReason && <span className="text-rose-600">{lead.sideStatus === 'LOST' ? t(`platform.leads.loss.${lead.sideReason}`, lead.sideReason) : lead.sideReason}</span>}
            </div>
          </div>

          {open && (
            <div className="border border-slate-100 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-slate-800">{t('platform.leads.logTitle')}</p>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((x) => <button key={x} onClick={() => setLog((l) => ({ ...l, type: x }))} className={`px-2.5 py-1 rounded-lg text-xs border ${log.type === x ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`platform.leads.activityTypes.${x}`)}</button>)}
              </div>
              <textarea rows={2} value={log.text} onChange={(e) => setLog((l) => ({ ...l, text: e.target.value }))} placeholder={t('platform.leads.logPlaceholder')} className={inputCls} />
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('platform.leads.nextFollowUp')} required><input type="datetime-local" value={log.followUp} onChange={(e) => setLog((l) => ({ ...l, followUp: e.target.value }))} className={inputCls} dir="ltr" /></Field>
                <button disabled={busy} onClick={addLog} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('platform.leads.addLog')}</button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {reachedDocs(lead) && (
            <div className="border border-slate-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1"><ListOrdered className="w-4 h-4" />{t('platform.leads.documents')}</p>
              {LEAD_DOCUMENTS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700 py-0.5"><input type="checkbox" checked={!!(lead.documents || {})[k]} onChange={() => toggleDoc(k)} disabled={busy} />{t(`platform.leads.docs.${k}`)}</label>
              ))}
            </div>
          )}
          <div className="border border-slate-100 rounded-2xl p-4">
            <p className="text-sm font-bold text-slate-800 mb-2">{t('platform.leads.timeline')}</p>
            <ul className="space-y-2 text-xs max-h-96 overflow-y-auto">
              {activity.map((a) => (
                <li key={a.id} className="border-r-2 border-slate-200 pr-2">
                  <p className="text-slate-400" dir="ltr">{a.at?.toDate ? format(a.at.toDate(), 'yyyy-MM-dd HH:mm') : ''}</p>
                  <p className="text-slate-700"><b>{t(`platform.leads.activityTypes.${a.type}`, a.type)}</b> — {a.text}</p>
                  <p className="text-slate-400">{a.byName}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {editing && <LeadForm lead={lead} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </Modal>
  );
}

function reachedDocs(lead) {
  return LEAD_STAGES.indexOf(lead.stage) >= LEAD_STAGES.indexOf('RESULT');
}
