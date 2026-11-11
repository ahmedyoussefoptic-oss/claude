import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, ArrowLeft, Loader2, Send, RefreshCw, Lock, Unlock, CheckCircle2, XCircle, Pencil, Copy, Check, MessageCircle, Search,
  CalendarDays, Clock, MapPin, Video, Users as UsersIcon, UserCheck, ClipboardList, Activity, FileBarChart, KeyRound, AlertTriangle, X, Phone, Undo2,
  QrCode, Printer, Link2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { printPage, escapeHtml } from '../../utils/printPage';
import { useBranches } from '../../hooks/useOrgData';
import {
  MEETING_STATUS_STYLES, RESPONSE_STYLES, WA_STATUS_STYLES, REQUEST_STATUS_STYLES, isIndividual, isRequests, callMeeting, meetingTime, classLabel, pct,
} from '../../config/meetings';
import MeetingForm from './MeetingForm';
import MeetingReport from './MeetingReport';

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}
      className="px-2 py-1 text-xs border border-slate-200 rounded-lg flex items-center gap-1 text-slate-600 hover:border-primary/40">
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}{label}
    </button>
  );
}
const waLink = (phone, text) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `966${d.slice(1)}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

function Stat({ label, value, sub, tone = 'text-slate-900' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {sub != null && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Dialog({ title, children, onClose }) {
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[140] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// A printable A4 poster with the meeting's general link as a QR code.
async function printPoster(m, t, i18n) {
  const qr = await QRCode.toDataURL(m.publicLink, { width: 900, margin: 1, errorCorrectionLevel: 'M' });
  printPage({
    title: m.title, subtitle: `${m.date} · ${m.startTime} – ${m.endTime}${m.location ? ` · ${m.location}` : ''}`, school: t('trips.print.school'),
    body: `<div style="text-align:center;margin-top:20mm">
      <h2 style="font-size:24pt;color:#0369a1;margin:0 0 6mm">${escapeHtml(t('meetings.publicLink.posterTitle'))}</h2>
      <p style="font-size:14pt;margin:0 0 10mm">${escapeHtml(t('meetings.publicLink.posterHint'))}</p>
      <img src="${qr}" style="width:120mm;height:120mm" alt="">
      <p style="font-size:10pt;color:#64748b;margin-top:6mm;direction:ltr">${escapeHtml(m.publicLink)}</p></div>`,
    dir: i18n.dir(), lang: i18n.language,
  });
}

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

// One meeting: actions, invitations, the teachers' schedule, the live view
// on the day and the report.
export default function MeetingDetails({ id, onBack, onChanged }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // 'complete' | 'cancel' | {respond: invite}
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('ALL');

  const load = useCallback(async () => {
    try {
      setData(await callMeeting('getMeeting', { id }));
      setError(null);
    } catch (err) { setError(err.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // The day view refreshes itself.
  useEffect(() => {
    if (tab !== 'live') return undefined;
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [tab, load]);

  const m = data?.meeting;
  const teachersById = useMemo(() => Object.fromEntries((m?.teachers || []).map((x) => [x.id, x])), [m]);
  const invitesById = useMemo(() => Object.fromEntries((data?.invites || []).map((x) => [x.id, x])), [data]);
  const requestsBy = useMemo(() => (data?.requests || []).reduce((acc, r) => { (acc[r.inviteId] = acc[r.inviteId] || []).push(r); return acc; }, {}), [data]);
  const names = (inv) => (inv?.students || []).map((s) => s.name).join('، ');

  const run = async (action, extra = {}) => {
    setBusy(action);
    setNotice(null);
    try {
      const r = await callMeeting('meetingAction', { id, action, ...extra });
      const parts = [];
      if (r.build) parts.push(t('meetings.notice.built', r.build));
      if (r.send) parts.push(t('meetings.notice.sent', r.send));
      if (r.manual) parts.push(t('meetings.notice.manual'));
      if (r.survey) parts.push(t('meetings.notice.survey', r.survey));
      if (r.absent) parts.push(t('meetings.notice.absent', r.absent));
      if (r.calls) parts.push(t('meetings.notice.calls', { count: r.calls.created || 0 }));
      setNotice({ ok: true, text: parts.join(' · ') || t('meetings.notice.done') });
      setDialog(null);
      await load();
      onChanged?.();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally { setBusy(''); }
  };
  const inviteAction = async (inv, action, extra = {}) => {
    setBusy(`${inv.id}:${action}`);
    setNotice(null);
    try {
      const r = await callMeeting('meetingInviteAction', { id, inviteId: inv.id, action, ...extra });
      if (r.text) window.open(waLink(r.phone, r.text), '_blank', 'noopener');
      else if (r.sent) setNotice({ ok: true, text: t('meetings.notice.oneSent') });
      setDialog(null);
      await load();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally { setBusy(''); }
  };

  if (error) return <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>;
  if (!data) return <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const s = m.stats || {};
  const live = ['OPEN', 'CLOSED'].includes(m.status);
  const BackIcon = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const tabs = [
    ['overview', ClipboardList, t('meetings.tabs.overview')],
    ['invites', UsersIcon, t('meetings.tabs.invites', { count: data.invites.length })],
    ...(isIndividual(m) ? [['schedule', CalendarDays, t('meetings.tabs.schedule')]] : []),
    ['live', Activity, t('meetings.tabs.live')],
    ['report', FileBarChart, t('meetings.tabs.report')],
  ];

  const shown = data.invites.filter((inv) => {
    if (q && !`${names(inv)} ${(inv.students || []).map((x) => `${x.id} ${x.className}`).join(' ')} ${inv.code}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'NO_RESPONSE') return !inv.response;
    if (filter === 'ATTENDED') return inv.attended;
    if (filter === 'NOT_ATTENDED') return !inv.attended;
    if (filter === 'FAILED') return inv.wa.status === 'failed' || !inv.hasPhone;
    if (['ATTEND', 'REMOTE', 'DECLINE'].includes(filter)) return inv.response === filter;
    return true;
  }).sort((a, b) => names(a).localeCompare(names(b), 'ar'));

  // --- live view ---
  // Meeting times are Riyadh time.
  const riyadh = new Date(Date.now() + 3 * 3600e3);
  const nowMin = riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes();
  const today = riyadh.toISOString().slice(0, 10) === m.date;
  const toMin = (hhmm) => { const x = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return x ? Number(x[1]) * 60 + Number(x[2]) : 0; };
  const confirmed = data.invites.filter((x) => x.response === 'ATTEND');
  const late = confirmed.filter((x) => {
    if (x.attended || !today) return false;
    const first = Math.min(...(x.slots || []).map((sl) => toMin(sl.time)), toMin(m.startTime) + 15);
    return nowMin > first;
  });
  const teacherLive = (m.teachers || []).map((tc) => {
    const mine = data.slots.filter((sl) => sl.teacherId === tc.id).sort((a, b) => a.time.localeCompare(b.time));
    const waiting = mine.filter((sl) => !sl.doneAt && invitesById[sl.inviteId]?.attended);
    const next = mine.find((sl) => !sl.doneAt && toMin(sl.time) + (m.slotMinutes || 10) > nowMin);
    return { tc, booked: mine.length, done: mine.filter((sl) => sl.doneAt).length, waiting, next };
  });

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1 hover:underline"><BackIcon className="w-4 h-4" />{t('meetings.back')}</button>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex flex-wrap items-center gap-2">
              {m.title}
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${MEETING_STATUS_STYLES[m.status]}`}>{t(`meetings.status.${m.status}`)}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1" dir="ltr">{m.code}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 mt-2">
              <span className="flex items-center gap-1"><CalendarDays className="w-4 h-4 text-primary" />{m.date}</span>
              <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-primary" />{meetingTime(m.startTime, lang)} – {meetingTime(m.endTime, lang)}</span>
              {m.location && <span className="flex items-center gap-1"><MapPin className="w-4 h-4 text-primary" />{m.location}</span>}
              {m.teamsLink && <span className="flex items-center gap-1"><Video className="w-4 h-4 text-primary" />{t('meetings.remoteOn')}</span>}
              <span>{t(`meetings.type.${m.type}`)}</span>
              <span>{m.branches.map(branchName).join('، ')}{m.stages.length ? ` · ${m.stages.join(', ')}` : ''}{m.classes.length ? ` · ${m.classes.map(classLabel).join(', ')}` : ''}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!['COMPLETED', 'CANCELLED'].includes(m.status) && <button type="button" onClick={() => setEditing(true)} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5"><Pencil className="w-4 h-4" />{t('common.edit')}</button>}
            {['DRAFT', 'OPEN'].includes(m.status) && (
              <button type="button" disabled={!!busy} onClick={() => run('invite')} className="px-3 py-2 text-sm bg-primary text-white rounded-xl flex items-center gap-1.5 disabled:opacity-60">
                {busy === 'invite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{m.status === 'DRAFT' ? t('meetings.actions.invite') : t('meetings.actions.inviteNew')}
              </button>
            )}
            {m.status === 'OPEN' && data.waReady && <button type="button" disabled={!!busy} onClick={() => run('resend')} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 disabled:opacity-60">{busy === 'resend' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{t('meetings.actions.resend')}</button>}
            {m.status === 'OPEN' && <button type="button" disabled={!!busy} onClick={() => run('close')} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5"><Lock className="w-4 h-4" />{t('meetings.actions.close')}</button>}
            {m.status === 'CLOSED' && <button type="button" disabled={!!busy} onClick={() => run('reopen')} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5"><Unlock className="w-4 h-4" />{t('meetings.actions.reopen')}</button>}
            {live && <button type="button" onClick={() => setDialog('complete')} className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-xl flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{t('meetings.actions.complete')}</button>}
            {m.status === 'COMPLETED' && data.waReady && <button type="button" disabled={!!busy} onClick={() => run('survey')} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5"><Send className="w-4 h-4" />{t('meetings.actions.survey')}</button>}
            {!['COMPLETED', 'CANCELLED'].includes(m.status) && <button type="button" onClick={() => setDialog('cancel')} className="px-3 py-2 text-sm text-rose-600 border border-rose-200 rounded-xl flex items-center gap-1.5"><XCircle className="w-4 h-4" />{t('meetings.actions.cancel')}</button>}
          </div>
        </div>
        {!data.waReady && m.status !== 'CANCELLED' && <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-2.5 flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{t('meetings.waNotReady')}</p>}
        {m.status === 'CANCELLED' && m.cancelReason && <p className="mt-3 text-sm text-rose-700">{t('meetings.cancelledReason', { reason: m.cancelReason })}</p>}
        {notice && <p className={`mt-3 text-sm rounded-xl p-2.5 ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{notice.text}</p>}
      </div>

      <div className="flex gap-1 overflow-x-auto bg-white border border-slate-200 rounded-2xl p-1">
        {tabs.map(([k, Icon, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 whitespace-nowrap ${tab === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Icon className="w-4 h-4" />{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Stat label={t('meetings.stats.families')} value={s.families || 0} sub={t('meetings.stats.studentsN', { count: s.students || 0 })} />
            <Stat label={t('meetings.stats.sent')} value={s.sent || 0} sub={t('meetings.stats.failedN', { failed: s.failed || 0, noPhone: s.noPhone || 0 })} />
            <Stat label={t('meetings.stats.responded')} value={`${pct(s.responded, s.families)}%`} sub={`${s.responded || 0}`} />
            <Stat label={t('meetings.stats.attend')} value={s.attend || 0} sub={t('meetings.stats.remoteDecline', { remote: s.remote || 0, decline: s.decline || 0 })} tone="text-emerald-700" />
            <Stat label={t('meetings.stats.attended')} value={s.attended || 0} sub={`${pct(s.attended, s.families)}% · ${pct(s.attended, s.attend)}% ${t('meetings.stats.ofConfirmed')}`} tone="text-sky-700" />
            <Stat label={t('meetings.stats.satisfaction')} value={s.avgOverall ? `${s.avgOverall}/5` : '—'} sub={t('meetings.stats.surveysN', { count: s.surveys || 0, low: s.low || 0 })} tone="text-amber-600" />
          </div>
          {m.agenda && <div className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-sm font-bold text-slate-800 mb-1">{t('meetings.form.agenda')}</p><p className="text-sm text-slate-600 whitespace-pre-wrap">{m.agenda}</p></div>}

          {isRequests(m) && m.publicLink && (
            <div className="bg-white border border-primary/30 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Link2 className="w-4 h-4 text-primary" />{t('meetings.publicLink.title')}</p>
              <p className="text-xs text-slate-500">{t('meetings.publicLink.hint')}</p>
              <p className="text-xs text-slate-700 bg-slate-50 rounded-lg p-2 break-all" dir="ltr">{m.publicLink}</p>
              <div className="flex flex-wrap gap-2">
                <CopyBtn text={m.publicLink} label={t('meetings.links.copy')} />
                <CopyBtn text={t('meetings.publicLink.message', { title: m.title, date: m.date, link: m.publicLink })} label={t('meetings.publicLink.copyMessage')} />
                <button type="button" onClick={() => printPoster(m, t, i18n)} className="px-2 py-1 text-xs border border-slate-200 rounded-lg flex items-center gap-1 text-slate-600"><Printer className="w-3.5 h-3.5" />{t('meetings.publicLink.poster')}</button>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-primary" />{t('meetings.links.title')}</p>
              <p className="text-xs text-slate-500">{t('meetings.links.hint')}</p>
            </div>
            <div className="border border-slate-100 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-medium text-slate-800">{t('meetings.links.desk')}</p><p className="text-xs text-slate-500">{t('meetings.links.pin')}: <b dir="ltr">{m.deskPin}</b></p></div>
              <div className="flex gap-2"><CopyBtn text={m.deskLink} label={t('meetings.links.copy')} /><a href={m.deskLink} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-600">{t('meetings.links.open')}</a></div>
            </div>
            {(m.teachers || []).map((tc) => {
              const msg = t('meetings.links.teacherMsg', { name: tc.name, title: m.title, date: m.date, link: tc.link, pin: tc.pin });
              return (
                <div key={tc.id} className="border border-slate-100 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{tc.name} {isRequests(m) && <span className="text-xs text-primary">· {t(`meetings.roles.${tc.role || 'TEACHER'}`)}</span>} {tc.subject && <span className="text-xs text-slate-500">· {tc.subject}</span>} {tc.room && <span className="text-xs text-slate-500">· {tc.room}</span>}</p>
                    <p className="text-xs text-slate-500">{t('meetings.links.pin')}: <b dir="ltr">{tc.pin}</b>{tc.classes?.length ? ` · ${[...new Set(tc.classes.map(classLabel))].join(', ')}` : ` · ${t('meetings.links.allClasses')}`}</p>
                  </div>
                  <div className="flex gap-2">
                    <CopyBtn text={msg} label={t('meetings.links.copy')} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'invites' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('meetings.invites.search')} className={`${inputCls} ps-9`} />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
              {['ALL', 'NO_RESPONSE', 'ATTEND', 'REMOTE', 'DECLINE', 'ATTENDED', 'NOT_ATTENDED', 'FAILED'].map((f) => <option key={f} value={f}>{t(`meetings.invites.filter.${f}`)}</option>)}
            </select>
          </div>
          {!data.invites.length ? <p className="text-sm text-slate-500 text-center py-8">{t('meetings.invites.none')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-500 border-b border-slate-100">
                  {['students', 'phone', 'message', 'response', 'slots', 'attendance', ''].map((h) => <th key={h} className="text-start font-medium p-2">{h && t(`meetings.invites.col.${h === 'slots' && isRequests(m) ? 'requests' : h}`)}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((inv) => (
                    <tr key={inv.id} className="border-b border-slate-50 align-top">
                      <td className="p-2">
                        {(inv.students || []).map((st) => <p key={st.id} className="text-slate-800">{st.name} <span className="text-xs text-slate-500" dir="ltr">{st.grade} {st.className}</span></p>)}
                        {inv.topics && <p className="text-xs text-slate-500 mt-0.5">“{inv.topics}”</p>}
                        {inv.walkIn && <span className="text-[11px] text-amber-700">{t('meetings.invites.walkIn')}</span>}
                      </td>
                      <td className="p-2 text-xs text-slate-500" dir="ltr">{inv.phone || '—'}</td>
                      <td className={`p-2 text-xs ${WA_STATUS_STYLES[inv.wa.status] || ''}`} title={inv.wa.error}>{t(`meetings.wa.${inv.wa.status || 'pending'}`, inv.wa.status)}{inv.wa.count > 1 ? ` ×${inv.wa.count}` : ''}</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded-md text-xs border ${RESPONSE_STYLES[inv.response || '']}`}>{t(`meetings.response.${inv.response || 'NONE'}`)}</span>
                        {inv.response === 'ATTEND' && inv.attendees > 1 && <span className="text-xs text-slate-500"> ×{inv.attendees}</span>}
                        {inv.respondedBy && inv.respondedBy !== 'ولي الأمر' && <p className="text-[11px] text-slate-400">{inv.respondedBy}</p>}
                      </td>
                      <td className="p-2 text-xs text-slate-600">
                        {(inv.slots || []).map((sl) => <p key={sl.teacherId}>{meetingTime(sl.time, lang)} · {teachersById[sl.teacherId]?.name}</p>)}
                        {(requestsBy[inv.id] || []).map((r) => <p key={r.id} title={r.purpose}><span className={`inline-block px-1.5 rounded border text-[10px] ${REQUEST_STATUS_STYLES[r.status]}`}>{t(`meetings.request.${r.status}`)}</span> {r.staffName} <span className="text-slate-400">({r.studentName.split(' ')[0]})</span></p>)}
                        {inv.ticketNo && <p className="text-primary font-medium">{t('meetings.desk.ticketN', { n: inv.ticketNo })}</p>}
                      </td>
                      <td className="p-2 text-xs">{inv.attended ? <span className="text-emerald-700 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" />{t('meetings.invites.came')}</span> : '—'}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {inv.hasPhone && m.status !== 'CANCELLED' && <button type="button" disabled={!!busy} onClick={() => inviteAction(inv, 'send')} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title={t('meetings.invites.send')}>{busy === `${inv.id}:send` ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}</button>}
                          <CopyBtn text={inv.link} label="" />
                          {live && <button type="button" onClick={() => setDialog({ respond: inv })} className="p-1.5 text-slate-500 hover:bg-slate-50 rounded-lg" title={t('meetings.invites.recordResponse')}><Phone className="w-4 h-4" /></button>}
                          {live && (inv.attended
                            ? <button type="button" disabled={!!busy} onClick={() => inviteAction(inv, 'undoCheckin')} className="p-1.5 text-slate-500 hover:bg-slate-50 rounded-lg" title={t('meetings.invites.undoCheckin')}><Undo2 className="w-4 h-4" /></button>
                            : <button type="button" disabled={!!busy} onClick={() => inviteAction(inv, 'checkin')} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg" title={t('meetings.invites.checkin')}><UserCheck className="w-4 h-4" /></button>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead><tr><th className="p-2 text-start text-slate-500 font-medium sticky start-0 bg-white">{t('meetings.schedule.time')}</th>
              {(m.teachers || []).map((tc) => <th key={tc.id} className="p-2 text-start font-medium text-slate-700 min-w-[140px]">{tc.name}<p className="font-normal text-slate-400">{tc.subject}{tc.room ? ` · ${tc.room}` : ''}</p></th>)}</tr></thead>
            <tbody>
              {data.slotTimes.map((time) => (
                <tr key={time} className="border-t border-slate-100">
                  <td className="p-2 text-slate-500 whitespace-nowrap sticky start-0 bg-white">{meetingTime(time, lang)}</td>
                  {(m.teachers || []).map((tc) => {
                    const sl = data.slots.find((x) => x.teacherId === tc.id && x.time === time);
                    const inv = sl && invitesById[sl.inviteId];
                    return (
                      <td key={tc.id} className="p-1">
                        {sl ? (
                          <div className={`rounded-lg p-1.5 border ${sl.doneAt ? 'bg-emerald-50 border-emerald-100' : inv?.attended ? 'bg-sky-50 border-sky-100' : 'bg-slate-50 border-slate-200'}`}>
                            <p className="text-slate-800">{names(inv)}</p>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] text-slate-500">{sl.doneAt ? t('meetings.schedule.done') : inv?.attended ? t('meetings.schedule.arrived') : t('meetings.schedule.booked')}</span>
                              {live && !sl.doneAt && <button type="button" onClick={() => { if (window.confirm(t('meetings.schedule.cancelConfirm'))) inviteAction(inv, 'cancelSlot', { slotId: sl.id }); }} className="text-[10px] text-rose-600 hover:underline">{t('meetings.schedule.cancel')}</button>}
                            </div>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'live' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('meetings.live.confirmed')} value={confirmed.length} sub={t('meetings.live.persons', { count: s.attendees || 0 })} />
            <Stat label={t('meetings.live.arrived')} value={s.attended || 0} tone="text-emerald-700" sub={`${pct(s.attended, confirmed.length)}%`} />
            <Stat label={t('meetings.live.notYet')} value={confirmed.filter((x) => !x.attended).length} tone="text-amber-600" />
            <Stat label={t('meetings.live.meetingsDone')} value={isRequests(m) ? `${s.requestsDone || 0}/${s.requests || 0}` : `${s.done || 0}/${s.booked || 0}`} sub={isRequests(m) && s.requestsActive ? t('meetings.live.activeN', { count: s.requestsActive }) : null} tone="text-sky-700" />
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" />{t('meetings.live.auto')}</p>
          {isRequests(m) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(m.teachers || []).map((tc) => {
                const mine = (data.requests || []).filter((r) => r.staffId === tc.id);
                const cnt = (st) => mine.filter((r) => r.status === st).length;
                const arrivedWaiting = mine.filter((r) => ['REQUESTED', 'DIRECTED'].includes(r.status) && invitesById[r.inviteId]?.attended).length;
                const now = mine.find((r) => r.status === 'IN_PROGRESS');
                return (
                  <div key={tc.id} className={`bg-white border rounded-2xl p-3 ${arrivedWaiting >= 3 ? 'border-amber-300' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between"><p className="font-medium text-slate-800">{tc.name}</p><span className="text-xs text-slate-500">{cnt('DONE')}/{mine.length}</span></div>
                    <p className="text-xs text-slate-500">{t(`meetings.roles.${tc.role || 'TEACHER'}`)}{tc.subject ? ` · ${tc.subject}` : ''}</p>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct(cnt('DONE'), mine.length)}%` }} /></div>
                    <p className="text-xs mt-2 text-slate-600">{now ? t('meetings.live.nowWith', { name: now.studentName }) : t('meetings.live.free')}</p>
                    <p className={`text-xs ${arrivedWaiting >= 3 ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>{t('meetings.live.waiting', { count: arrivedWaiting })}{cnt('DIRECTED') ? ` · ${t('meetings.live.directedN', { count: cnt('DIRECTED') })}` : ''}</p>
                  </div>
                );
              })}
            </div>
          )}
          {isIndividual(m) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {teacherLive.map(({ tc, booked, done, waiting, next }) => (
                <div key={tc.id} className={`bg-white border rounded-2xl p-3 ${waiting.length >= 3 ? 'border-amber-300' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between"><p className="font-medium text-slate-800">{tc.name}</p><span className="text-xs text-slate-500">{done}/{booked}</span></div>
                  <p className="text-xs text-slate-500">{tc.subject}{tc.room ? ` · ${tc.room}` : ''}</p>
                  <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct(done, booked)}%` }} /></div>
                  <p className={`text-xs mt-2 ${waiting.length >= 3 ? 'text-amber-700 font-medium' : 'text-slate-600'}`}>{t('meetings.live.waiting', { count: waiting.length })}</p>
                  {next && <p className="text-xs text-slate-500">{t('meetings.live.next', { time: meetingTime(next.time, lang), name: names(invitesById[next.inviteId]) })}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-slate-800 mb-2">{t('meetings.live.late', { count: late.length })}</p>
            {late.length ? late.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 text-sm">
                <span>{names(inv)} <span className="text-xs text-slate-500">{(inv.slots || []).map((sl) => meetingTime(sl.time, lang)).join('، ')}</span></span>
                {inv.hasPhone && <button type="button" onClick={() => inviteAction(inv, 'send')} className="text-xs text-emerald-700 flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{t('meetings.invites.send')}</button>}
              </div>
            )) : <p className="text-sm text-slate-500">{today ? t('meetings.live.noLate') : t('meetings.live.notToday')}</p>}
          </div>
        </div>
      )}

      {tab === 'report' && <MeetingReport id={id} />}

      {editing && <MeetingForm meeting={m} onClose={() => setEditing(false)} onSaved={(r) => { setEditing(false); setNotice({ ok: true, text: r.dropped ? t('meetings.notice.dropped', { count: r.dropped }) : t('meetings.notice.saved') }); load(); onChanged?.(); }} />}
      {dialog === 'complete' && <CompleteDialog busy={busy === 'complete'} waReady={data.waReady} onClose={() => setDialog(null)} onConfirm={(opts) => run('complete', opts)} />}
      {dialog === 'cancel' && <CancelDialog busy={busy === 'cancel'} onClose={() => setDialog(null)} onConfirm={(opts) => run('cancel', opts)} />}
      {dialog?.respond && <RespondDialog invite={dialog.respond} remote={!!m.teamsLink} busy={!!busy} onClose={() => setDialog(null)} onConfirm={(opts) => inviteAction(dialog.respond, 'respond', opts)} />}
    </div>
  );
}

function CompleteDialog({ busy, waReady, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState('');
  const [survey, setSurvey] = useState(true);
  const [absentMessage, setAbsentMessage] = useState(true);
  const [callAbsent, setCallAbsent] = useState(true);
  return (
    <Dialog title={t('meetings.complete.title')} onClose={onClose}>
      <p className="text-sm text-slate-600">{t('meetings.complete.hint')}</p>
      <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('meetings.complete.summaryPh')} className={inputCls} />
      {waReady && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={survey} onChange={(e) => setSurvey(e.target.checked)} />{t('meetings.complete.survey')}</label>}
      {waReady && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={absentMessage} onChange={(e) => setAbsentMessage(e.target.checked)} />{t('meetings.complete.absentMessage')}</label>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={callAbsent} onChange={(e) => setCallAbsent(e.target.checked)} />{t('meetings.complete.calls')}</label>
      <button type="button" disabled={busy} onClick={() => onConfirm({ summary, survey, absentMessage, callAbsent })} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.complete.confirm')}
      </button>
    </Dialog>
  );
}
function CancelDialog({ busy, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <Dialog title={t('meetings.cancel.title')} onClose={onClose}>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('meetings.cancel.reason')} className={inputCls} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />{t('meetings.cancel.notify')}</label>
      <button type="button" disabled={busy || !reason.trim()} onClick={() => onConfirm({ reason, notify })} className="w-full py-2.5 bg-rose-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.cancel.confirm')}
      </button>
    </Dialog>
  );
}
function RespondDialog({ invite, remote, busy, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [response, setResponse] = useState(invite.response || 'ATTEND');
  const [attendees, setAttendees] = useState(invite.attendees || 1);
  return (
    <Dialog title={t('meetings.invites.recordResponse')} onClose={onClose}>
      <p className="text-sm text-slate-700">{(invite.students || []).map((s) => s.name).join('، ')}</p>
      <div className="grid grid-cols-3 gap-2">
        {['ATTEND', ...(remote ? ['REMOTE'] : []), 'DECLINE'].map((r) => (
          <button key={r} type="button" onClick={() => setResponse(r)} className={`py-2 rounded-xl text-sm border ${response === r ? 'bg-primary text-white border-primary' : 'border-slate-200'}`}>{t(`meetings.response.${r}`)}</button>
        ))}
      </div>
      {response === 'ATTEND' && <label className="text-sm flex items-center gap-2">{t('meetings.parent.attendees')}<input type="number" min={1} max={4} value={attendees} onChange={(e) => setAttendees(e.target.value)} className={`${inputCls} w-20`} /></label>}
      <p className="text-xs text-slate-500">{t('meetings.invites.respondHint')}</p>
      <button type="button" disabled={busy} onClick={() => onConfirm({ response, attendees })} className="w-full py-2.5 bg-primary text-white rounded-xl text-sm">{t('common.save')}</button>
    </Dialog>
  );
}
