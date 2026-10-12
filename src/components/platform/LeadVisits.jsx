import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, doc, updateDoc, onSnapshot, query, where, Timestamp, increment } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format, addDays, isToday, isTomorrow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { CalendarPlus, CalendarCheck, CalendarClock, CheckCircle2, XCircle, UserX, MessageCircle, Send, Loader2, ChevronRight, ChevronLeft, BellRing, Clock, MapPin, User, Users, FolderOpen } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { useWhatsAppApi } from '../../hooks/useWhatsAppApi';
import { waLink } from '../../utils/whatsapp';
import { VISIT_TYPES, VISIT_ACTIVE, VISIT_STATUS_STYLES, INTEREST_LEVELS, LEAD_STAGES, usePlatformSettings } from '../../config/platform';
import { Modal, Field, Pill, Tile, inputCls, btn } from './ui';
import { leadOpen } from './leadUtils';

// Visit / school-tour appointments for new-customer files (leadVisits):
// booking from the lead's file, a day view with its own indicators, and
// WhatsApp confirmations / reminders (API template when configured,
// otherwise a prefilled wa.me message that is logged when opened).
export const dayKeyOf = (d) => format(d, 'yyyy-MM-dd');
const stageIdx = (s) => LEAD_STAGES.indexOf(s);

export function useVisitTools() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const wa = useWhatsAppApi();
  const settings = usePlatformSettings();
  const apiReady = !!(wa.enabled && String(settings.leadVisitTemplate || '').trim());
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const when = (v) => (v.at?.toDate ? format(v.at.toDate(), 'EEEE d MMMM · h:mm a', { locale: dateLocale }) : '');
  const typeLabel = (v) => t(`platform.visits.types.${v.type}`, v.type);
  const message = (v, kind) => t(kind === 'confirm' ? 'platform.visits.msgConfirm' : 'platform.visits.msgReminder', {
    parent: v.parentName, type: typeLabel(v), branch: branchName(v.branch), when: when(v), interpolation: { escapeValue: false },
  });
  const logText = (key, v) => t(`platform.visits.log.${key}`, { type: typeLabel(v), when: when(v), interpolation: { escapeValue: false } });
  const by = () => ({ byName: userData?.name || '', byId: user?.uid || null });
  const logLead = (leadId, text, type = 'VISIT') => addDoc(collection(db, 'leads', leadId, 'activity'), { type, text, ...by(), at: Timestamp.now() });

  const sendApi = async (ids, kind) => (await httpsCallable(functions, 'sendLeadVisitReminders')({ ids, kind })).data;
  // The wa.me link was opened: record it on the visit and the lead's timeline.
  const markManual = async (v, kind) => {
    const now = Timestamp.now();
    await updateDoc(doc(db, 'leadVisits', v.id), kind === 'reminder'
      ? { reminderCount: increment(1), lastReminderAt: now, lastReminderByName: userData?.name || '', lastReminderVia: 'MANUAL', updatedAt: now }
      : { confirmationSentAt: now, updatedAt: now });
    await logLead(v.leadId, logText(kind, v), 'WHATSAPP');
  };

  const setStatus = async (v, status, lead, interest) => {
    const now = Timestamp.now();
    await updateDoc(doc(db, 'leadVisits', v.id), { status, statusAt: now, statusByName: userData?.name || '', ...(interest ? { interest } : {}), updatedAt: now });
    const patch = {};
    const open = lead && leadOpen(lead);
    if (status === 'ATTENDED') {
      patch.visitedAt = now;
      if (interest) patch.interest = interest;
      if (open && stageIdx(lead.stage) < stageIdx('VISITED')) {
        Object.assign(patch, { stage: 'VISITED', stageEnteredAt: now, 'stageHistory.VISITED': now, sideStatus: null, sideReason: '' });
        if (!(lead.stageHistory || {}).VISIT_BOOKED) patch['stageHistory.VISIT_BOOKED'] = now;
      }
      if (open) patch.nextFollowUp = Timestamp.fromMillis(Date.now() + 86400e3);
    }
    if (status === 'NO_SHOW' && open) patch.nextFollowUp = Timestamp.fromMillis(Date.now() + 2 * 3600e3);
    if (Object.keys(patch).length) await updateDoc(doc(db, 'leads', v.leadId), { ...patch, updatedAt: now });
    await logLead(v.leadId, logText(status, v));
  };

  return { t, dateLocale, apiReady, branches, branchName, when, typeLabel, message, logText, logLead, sendApi, markManual, setStatus, userData };
}

// Book a new appointment for `lead`, or move `visit` to another time.
export function VisitForm({ lead, visit, onClose }) {
  const tools = useVisitTools();
  const { t, apiReady, branches } = tools;
  const start = visit?.at?.toDate ? visit.at.toDate() : addDays(new Date(), 1);
  const [f, setF] = useState({
    type: visit?.type || 'VISIT_TOUR', date: dayKeyOf(start), time: visit?.at?.toDate ? format(start, 'HH:mm') : '10:00',
    branch: visit?.branch || lead.branch || '', host: visit?.host || '', notes: visit?.notes || '', sendConfirm: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // saved visit awaiting a manual WhatsApp confirmation
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    if (!f.date || !f.time || !f.branch) { setError(t('platform.visits.missing')); return; }
    setBusy(true);
    setError(null);
    try {
      const now = Timestamp.now();
      const at = Timestamp.fromDate(new Date(`${f.date}T${f.time}`));
      const data = { type: f.type, at, dayKey: f.date, branch: f.branch, host: f.host.trim(), notes: f.notes.trim(), updatedAt: now };
      let saved;
      if (visit) {
        await updateDoc(doc(db, 'leadVisits', visit.id), { ...data, status: 'SCHEDULED', previousAt: visit.at || null, rescheduledCount: increment(1), autoRemindedFor: null, confirmationSentAt: null });
        saved = { ...visit, ...data };
      } else {
        const fields = {
          ...data, leadId: lead.id, leadCode: lead.code || '', parentName: lead.parentName || '', phone: lead.phone || '',
          students: (lead.students || []).map((s) => `${s.name || ''} ${s.grade || ''}`.trim()).filter(Boolean).join('، '),
          assignedToName: lead.assignedToName || '', status: 'SCHEDULED', reminderCount: 0, createdAt: now, createdByName: tools.userData?.name || '',
        };
        const ref = await addDoc(collection(db, 'leadVisits'), fields);
        saved = { id: ref.id, ...fields };
      }
      const patch = { visitAt: at, nextVisitId: saved.id, updatedAt: now };
      if (leadOpen(lead)) {
        patch.nextFollowUp = at;
        if (stageIdx(lead.stage) < stageIdx('VISIT_BOOKED')) Object.assign(patch, { stage: 'VISIT_BOOKED', stageEnteredAt: now, 'stageHistory.VISIT_BOOKED': now, sideStatus: null, sideReason: '' });
      }
      await updateDoc(doc(db, 'leads', lead.id), patch);
      await tools.logLead(lead.id, [tools.logText(visit ? 'rescheduled' : 'booked', saved), saved.host && t('platform.visits.host_label', { name: saved.host })].filter(Boolean).join(' — '));
      if (f.sendConfirm) {
        if (apiReady) {
          const r = await tools.sendApi([saved.id], 'confirm');
          if (r.failed) { setError(r.errors?.[0]?.message || 'WhatsApp'); setBusy(false); return; }
        } else {
          setDone(saved);
          setBusy(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={visit ? t('platform.visits.editTitle') : t('platform.visits.bookTitle')} subtitle={`${lead.parentName || ''} · ${lead.code || ''}`} onClose={onClose} size="max-w-xl" z="z-[130]">
      {done ? (
        <div className="text-center space-y-4 py-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <p className="font-bold text-slate-900">{t('platform.visits.saved')}</p>
          <p className="text-sm text-slate-600">{tools.typeLabel(done)} — {tools.when(done)}</p>
          <div className="flex justify-center gap-2">
            <a href={waLink(done.phone, tools.message(done, 'confirm'))} target="_blank" rel="noreferrer" onClick={() => { tools.markManual(done, 'confirm').finally(onClose); }} className={`${btn.primary} bg-emerald-600 hover:bg-emerald-700`}>
              <MessageCircle className="w-4 h-4" />{t('platform.visits.sendConfirmWa')}
            </a>
            <button onClick={onClose} className={btn.ghost}>{t('common.close')}</button>
          </div>
        </div>
      ) : (
        <>
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
          <Field label={t('platform.visits.type')}>
            <div className="flex flex-wrap gap-2">
              {VISIT_TYPES.map((x) => <button key={x} type="button" onClick={() => setF((v) => ({ ...v, type: x }))} className={`px-3 py-2 rounded-xl text-sm border ${f.type === x ? 'bg-primary text-white border-primary font-medium' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`platform.visits.types.${x}`)}</button>)}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('platform.visits.date')} required><input type="date" value={f.date} onChange={set('date')} className={inputCls} dir="ltr" /></Field>
            <Field label={t('platform.visits.time')} required><input type="time" value={f.time} onChange={set('time')} step="900" className={inputCls} dir="ltr" /></Field>
            <Field label={t('platform.visits.branch')} required>
              <select value={f.branch} onChange={set('branch')} className={inputCls}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
            <Field label={t('platform.visits.host')}><input value={f.host} onChange={set('host')} placeholder={t('platform.visits.hostPlaceholder')} className={inputCls} /></Field>
          </div>
          <Field label={t('platform.notes')}><input value={f.notes} onChange={set('notes')} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.sendConfirm} onChange={set('sendConfirm')} />{t('platform.visits.sendConfirm')}</label>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button>
            <button disabled={busy} onClick={save} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}{t('platform.visits.save')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// One appointment with its actions. `lead` may be missing in the day view
// before the leads list loads; status changes still work.
export function VisitRow({ v, lead, tools, onOpenLead, showLead }) {
  const { t, dateLocale } = tools;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [attending, setAttending] = useState(false);
  const [interest, setInterest] = useState(lead?.interest || '');
  const [editing, setEditing] = useState(false);
  const active = VISIT_ACTIVE.includes(v.status);
  const run = (key, fn) => async () => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const remindApi = run('remind', async () => {
    const r = await tools.sendApi([v.id], 'reminder');
    if (r.failed) throw new Error(r.errors?.[0]?.message || 'WhatsApp');
  });
  const act = 'px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1 disabled:opacity-50';

  return (
    <li className={`p-3 md:p-4 ${active && v.at?.toMillis() < Date.now() ? 'bg-amber-50/50' : ''}`}>
      <div className="flex flex-col md:flex-row md:items-start gap-3">
        <div className="w-16 shrink-0 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums" dir="ltr">{v.at?.toDate ? format(v.at.toDate(), 'h:mm') : ''}</p>
          <p className="text-[11px] text-slate-500">{v.at?.toDate ? format(v.at.toDate(), 'a', { locale: dateLocale }) : ''}</p>
          {!showLead && v.at?.toDate && <p className="text-[11px] text-slate-400" dir="ltr">{format(v.at.toDate(), 'dd/MM')}</p>}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {showLead && <button onClick={() => onOpenLead?.(v.leadId)} className="font-bold text-slate-900 hover:text-primary">{v.parentName}</button>}
            <Pill className={VISIT_STATUS_STYLES[v.status]}>{t(`platform.visits.statuses.${v.status}`)}</Pill>
            <span className="text-sm font-medium text-slate-700">{tools.typeLabel(v)}</span>
          </div>
          <p className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
            {!showLead && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{tools.when(v)}</span>}
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{tools.branchName(v.branch)}</span>
            {v.host && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{v.host}</span>}
            {showLead && v.students && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{v.students}</span>}
            {showLead && v.assignedToName && <span>· {v.assignedToName}</span>}
            {showLead && v.phone && <a href={`tel:+${v.phone}`} dir="ltr" className="hover:text-primary">0{String(v.phone).slice(3)}</a>}
          </p>
          {v.notes && <p className="text-xs text-slate-600">{v.notes}</p>}
          <p className="text-[11px] text-slate-400 flex flex-wrap gap-x-3">
            {v.reminderCount > 0
              ? <span className="text-emerald-700 flex items-center gap-1"><BellRing className="w-3 h-3" />{t('platform.visits.reminded', { n: v.reminderCount, when: v.lastReminderAt?.toDate ? format(v.lastReminderAt.toDate(), 'dd/MM HH:mm') : '' })}</span>
              : active && <span className="text-amber-700">{t('platform.visits.notReminded')}</span>}
            {v.confirmationSentAt && <span>{t('platform.visits.confirmationSent')}</span>}
            {v.rescheduledCount > 0 && <span>{t('platform.visits.rescheduled', { n: v.rescheduledCount })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 md:justify-end md:max-w-[340px]">
          {active && (tools.apiReady ? (
            <button disabled={!!busy} onClick={remindApi} className={`${act} bg-emerald-600 text-white border-emerald-600`}>{busy === 'remind' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{t('platform.visits.actions.remind')}</button>
          ) : (
            <a href={waLink(v.phone, tools.message(v, 'reminder'))} target="_blank" rel="noreferrer" onClick={() => { tools.markManual(v, 'reminder').catch((err) => setError(err.message)); }} className={`${act} bg-emerald-600 text-white border-emerald-600`}><MessageCircle className="w-3.5 h-3.5" />{t('platform.visits.actions.remindWa')}</a>
          ))}
          {v.status === 'SCHEDULED' && <button disabled={!!busy} onClick={run('confirm', () => tools.setStatus(v, 'CONFIRMED', lead))} className={`${act} bg-white text-indigo-700 border-indigo-200`}><CalendarCheck className="w-3.5 h-3.5" />{t('platform.visits.actions.confirmed')}</button>}
          {active && <button disabled={!!busy} onClick={() => setAttending((x) => !x)} className={`${act} bg-white text-emerald-700 border-emerald-200`}><CheckCircle2 className="w-3.5 h-3.5" />{t('platform.visits.actions.attended')}</button>}
          {active && <button disabled={!!busy} onClick={run('noshow', () => tools.setStatus(v, 'NO_SHOW', lead))} className={`${act} bg-white text-rose-700 border-rose-200`}><UserX className="w-3.5 h-3.5" />{t('platform.visits.actions.noShow')}</button>}
          {(active || v.status === 'NO_SHOW') && lead && <button disabled={!!busy} onClick={() => setEditing(true)} className={`${act} bg-white text-slate-700 border-slate-200`}><CalendarClock className="w-3.5 h-3.5" />{t('platform.visits.actions.reschedule')}</button>}
          {active && <button disabled={!!busy} onClick={() => { if (window.confirm(`${t('platform.visits.actions.cancel')}؟`)) run('cancel', () => tools.setStatus(v, 'CANCELLED', lead))(); }} className={`${act} bg-white text-slate-500 border-slate-200`}><XCircle className="w-3.5 h-3.5" />{t('platform.visits.actions.cancel')}</button>}
          {showLead && <button onClick={() => onOpenLead?.(v.leadId)} className={`${act} bg-white text-primary border-primary/30`}><FolderOpen className="w-3.5 h-3.5" />{t('platform.visits.actions.open')}</button>}
        </div>
      </div>
      {attending && (
        <div className="mt-3 flex flex-wrap items-end gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <Field label={t('platform.visits.interestAsk')}>
            <select value={interest} onChange={(e) => setInterest(e.target.value)} className={inputCls}><option value="">—</option>{INTEREST_LEVELS.map((x) => <option key={x} value={x}>{t(`platform.leads.interest.${x}`)}</option>)}</select>
          </Field>
          <button disabled={!!busy} onClick={run('attend', async () => { await tools.setStatus(v, 'ATTENDED', lead, interest); setAttending(false); })} className={btn.primary}>{busy === 'attend' && <Loader2 className="w-4 h-4 animate-spin" />}{t('platform.visits.attendedSave')}</button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {editing && lead && <VisitForm lead={lead} visit={v} onClose={() => setEditing(false)} />}
    </li>
  );
}

// Inside a lead's file.
export function LeadVisitsSection({ lead }) {
  const tools = useVisitTools();
  const { t } = tools;
  const [visits, setVisits] = useState([]);
  const [booking, setBooking] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, 'leadVisits'), where('leadId', '==', lead.id)), (snap) => {
    setVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0)));
  }, () => {}), [lead.id]);
  return (
    <div className="border border-slate-100 rounded-2xl">
      <div className="p-4 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-primary" />{t('platform.visits.title')} <span className="text-slate-400 font-normal">({visits.length})</span></p>
        <button onClick={() => setBooking(true)} className={btn.primary}><CalendarPlus className="w-4 h-4" />{t('platform.visits.book')}</button>
      </div>
      {visits.length === 0 ? <p className="px-4 pb-4 text-xs text-slate-400">{t('platform.visits.empty')}</p> : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">{visits.map((v) => <VisitRow key={v.id} v={v} lead={lead} tools={tools} />)}</ul>
      )}
      {booking && <VisitForm lead={lead} onClose={() => setBooking(false)} />}
    </div>
  );
}

// Day view: today's (or any day's) appointments with their indicators and
// a bulk reminder.
export function LeadVisitsDay({ leads, onOpenLead }) {
  const tools = useVisitTools();
  const { t, dateLocale } = tools;
  const [day, setDay] = useState(() => new Date());
  const [visits, setVisits] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [result, setResult] = useState(null);
  const key = dayKeyOf(day);
  useEffect(() => {
    setVisits(null);
    return onSnapshot(query(collection(db, 'leadVisits'), where('dayKey', '==', key)), (snap) => {
      setVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0)));
    }, () => setVisits([]));
  }, [key]);

  const list = visits || [];
  const shown = list.filter((v) => v.status !== 'CANCELLED');
  const toRemind = list.filter((v) => VISIT_ACTIVE.includes(v.status) && !v.reminderCount);
  const remindAll = async () => {
    if (!window.confirm(t('platform.visits.remindAllConfirm', { n: toRemind.length }))) return;
    setBulk(true);
    setResult(null);
    try {
      const r = await tools.sendApi(toRemind.map((v) => v.id), 'reminder');
      setResult({ ok: !r.failed, text: t('platform.visits.sentResult', { sent: r.sent }) + (r.failed ? t('platform.visits.failedSuffix', { n: r.failed, names: (r.errors || []).map((e) => e.parentName).join('، ') }) : '') });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBulk(false);
    }
  };
  const dayLabel = isToday(day) ? t('platform.visits.today') : isTomorrow(day) ? t('platform.visits.tomorrow') : '';
  const chip = (active, onClick, label) => <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setDay((d) => addDays(d, -1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
        {chip(isToday(day), () => setDay(new Date()), t('platform.visits.today'))}
        {chip(isTomorrow(day), () => setDay(addDays(new Date(), 1)), t('platform.visits.tomorrow'))}
        <button onClick={() => setDay((d) => addDays(d, 1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
        <input type="date" value={key} onChange={(e) => e.target.value && setDay(new Date(`${e.target.value}T12:00`))} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" dir="ltr" />
        <span className="font-bold text-slate-800">{format(day, 'EEEE d MMMM', { locale: dateLocale })}{dayLabel && <span className="text-slate-400 font-normal"> · {dayLabel}</span>}</span>
        <div className="flex-1" />
        {tools.apiReady && <button disabled={bulk || !toRemind.length} onClick={remindAll} className={`${btn.primary} bg-emerald-600 hover:bg-emerald-700`}>{bulk ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('platform.visits.remindAll', { n: toRemind.length })}</button>}
      </div>
      {!tools.apiReady && <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">{t('platform.visits.apiMissing')}</p>}
      {result && <p className={`text-sm rounded-xl p-3 ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{result.text}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label={t('platform.visits.tiles.total')} value={shown.length} icon={CalendarClock} />
        <Tile label={t('platform.visits.tiles.confirmed')} value={list.filter((v) => v.status === 'CONFIRMED').length} icon={CalendarCheck} tone="text-indigo-700" />
        <Tile label={t('platform.visits.tiles.attended')} value={list.filter((v) => v.status === 'ATTENDED').length} icon={CheckCircle2} tone="text-emerald-700" />
        <Tile label={t('platform.visits.tiles.noShow')} value={list.filter((v) => v.status === 'NO_SHOW').length} icon={UserX} tone="text-rose-600" />
        <Tile label={t('platform.visits.tiles.toRemind')} value={toRemind.length} icon={BellRing} tone="text-amber-600" />
      </div>

      {!visits ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : list.length === 0 ? <p className="py-12 text-center text-slate-400 text-sm">{t('platform.visits.dayEmpty')}</p> : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
            {list.map((v) => <VisitRow key={v.id} v={v} lead={(leads || []).find((l) => l.id === v.leadId)} tools={tools} onOpenLead={onOpenLead} showLead />)}
          </ul>
        )}
    </div>
  );
}
