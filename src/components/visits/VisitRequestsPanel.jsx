import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { CalendarClock, CalendarCheck, Copy, Check, Link2, Loader2, MessageCircle, UserPlus, Users as UsersIcon, X } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { userBranches } from '../../utils/scope';
import AppointmentPicker, { formatAppointment } from '../appointments/AppointmentPicker';

export const schoolVisitLink = (branchId) => `${window.location.origin}/school-visit${branchId ? `?branch=${encodeURIComponent(branchId)}` : ''}`;
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const waUrl = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '').replace(/^0/, '966')}?text=${encodeURIComponent(text)}`;

// «زيارات الفروع»: the school visit request link to send to parents, and the
// visit requests of the coming days — parents of current students (feedback
// records with a slot; confirmed with decideAppointment) and families
// visiting for a new registration (decideVisitRequest).
export default function VisitRequestsPanel() {
  const { t, i18n } = useTranslation();
  const { userData } = useAuthStore();
  const branches = useBranches();
  const all = userData?.role === 'ADMIN' || userData?.access === 'all';
  const mine = all ? null : userBranches(userData);
  const [linkBranch, setLinkBranch] = useState(() => (mine?.length === 1 ? mine[0] : ''));
  const [copied, setCopied] = useState(false);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [moving, setMoving] = useState(null); // appointment id being moved
  const [slot, setSlot] = useState(null);
  const [msg, setMsg] = useState(null);
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const canManage = (branch) => userData?.role === 'ADMIN' || ((all || mine?.includes(branch)) && (userData?.isPrincipal === true || userData?.perms?.edit === true));
  const canMark = (branch) => canManage(branch) || ((all || mine?.includes(branch)) && (userData?.role === 'RECEPTIONIST' || userData?.isQuality === true));

  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return onSnapshot(query(collection(db, 'appointments'), where('start', '>=', Timestamp.fromDate(start))), (snap) => {
      setList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setList([]));
  }, []);

  const rows = useMemo(() => (list || [])
    .filter((a) => ['REQUESTED', 'CONFIRMED'].includes(a.status) && (all || mine?.includes(a.branch)))
    .sort((a, b) => (a.status === 'REQUESTED' ? 0 : 1) - (b.status === 'REQUESTED' ? 0 : 1) || a.start.toMillis() - b.start.toMillis()), [list, all, mine]);

  const link = schoolVisitLink(linkBranch);
  const shareText = t('visitRequests.shareText', { link });
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };

  const act = async (a, action, extra = {}) => {
    setBusy(`${a.id}-${action}`);
    setMsg(null);
    try {
      const res = a.kind === 'NEW_STUDENT'
        ? await call('decideVisitRequest', { appointmentId: a.id, action, ...extra })
        : await call('decideAppointment', { complaintDocId: a.complaintDocId, action, ...extra });
      setMoving(null);
      setSlot(null);
      if (['confirm', 'reschedule'].includes(action)) setMsg({ id: a.id, sent: res.sent, when: res.when, phone: res.phone || a.phone, kind: a.kind });
    } catch (err) {
      setMsg({ id: a.id, error: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-l from-sky-50 to-white rounded-2xl border border-sky-100 shadow-sm p-4 space-y-2">
        <p className="font-bold text-slate-900 flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" />{t('visitRequests.linkTitle')}</p>
        <p className="text-xs text-slate-500">{t('visitRequests.linkHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={linkBranch} onChange={(e) => setLinkBranch(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
            {all && <option value="">{t('visitRequests.anyBranch')}</option>}
            {branches.filter((b) => all || mine?.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <code dir="ltr" className="flex-1 min-w-0 truncate text-xs bg-white border border-slate-200 rounded-lg px-3 py-2">{link}</code>
          <button onClick={copy} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white flex items-center gap-1.5">{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}{t('visitRequests.copy')}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl text-sm bg-[#25D366] text-white flex items-center gap-1.5"><MessageCircle className="w-4 h-4" />{t('visitRequests.share')}</a>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <p className="font-bold text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" />{t('visitRequests.title')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{t('visitRequests.hint')}</p>
        </div>
        {list === null ? <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          : rows.length === 0 ? <p className="p-6 text-sm text-slate-400 text-center">{t('visitRequests.empty')}</p> : (
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => {
                const isNew = a.kind === 'NEW_STUDENT';
                const when = formatAppointment(a.start.toMillis(), i18n.language);
                const today = new Date(a.start.toMillis()).toDateString() === new Date().toDateString();
                return (
                  <li key={a.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isNew ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{isNew ? <UserPlus className="w-5 h-5" /> : <UsersIcon className="w-5 h-5" />}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900">{when}</p>
                        <p className="text-sm text-slate-700">
                          {isNew ? <>{t('visitRequests.newFamily')}: <b>{a.parentName}</b> — {a.students} <span className="text-xs text-slate-500">({t(`schoolVisit.type.${a.visitType || 'VISIT_TOUR'}`)})</span></>
                            : <>{t('visitRequests.currentParent')} — <Link to={`/complaints?openId=${a.complaintDocId}`} className="text-primary hover:underline font-mono" dir="ltr">{a.complaintId}</Link></>}
                        </p>
                        <p className="text-xs text-slate-500">{branchName(a.branch)}{isNew && a.leadCode ? <> · <span dir="ltr">{a.leadCode}</span></> : null}{a.decidedByName ? ` · ${t('visitRequests.confirmedBy', { name: a.decidedByName })}` : ''}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${a.status === 'REQUESTED' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{t(`visitRequests.status.${a.status}`)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canManage(a.branch) && a.status === 'REQUESTED' && (
                        <button disabled={!!busy} onClick={() => act(a, 'confirm')} className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-white flex items-center gap-1.5 disabled:opacity-50">{busy === `${a.id}-confirm` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}{t('visitRequests.confirm')}</button>
                      )}
                      {canManage(a.branch) && (
                        <button disabled={!!busy} onClick={() => { setMoving(moving === a.id ? null : a.id); setSlot(null); }} className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 bg-white text-slate-700">{t('visitRequests.otherSlot')}</button>
                      )}
                      {isNew && canManage(a.branch) && (
                        <button disabled={!!busy} onClick={() => { const reason = window.prompt(t('visitRequests.cancelReason')); if (reason !== null) act(a, 'cancel', { reason }); }} className="px-3 py-1.5 rounded-lg text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-1"><X className="w-4 h-4" />{t('visitRequests.cancel')}</button>
                      )}
                      {isNew && a.status === 'CONFIRMED' && today && canMark(a.branch) && (
                        <>
                          <button disabled={!!busy} onClick={() => act(a, 'attended')} className="px-3 py-1.5 rounded-lg text-sm bg-sky-600 text-white">{t('visitRequests.attended')}</button>
                          <button disabled={!!busy} onClick={() => act(a, 'noShow')} className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 bg-white text-slate-600">{t('visitRequests.noShow')}</button>
                        </>
                      )}
                    </div>
                    {moving === a.id && (
                      <div className="space-y-2">
                        <AppointmentPicker branch={a.branch} value={slot} onChange={setSlot} required={false} />
                        <button disabled={!!busy || !slot} onClick={() => act(a, 'reschedule', { slot })} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">{busy === `${a.id}-reschedule` && <Loader2 className="w-4 h-4 animate-spin" />}{t('visitRequests.saveSlot')}</button>
                      </div>
                    )}
                    {msg?.id === a.id && (msg.error ? <p className="text-sm text-rose-600">{msg.error}</p> : (
                      <div className="text-sm text-emerald-700 flex flex-wrap items-center gap-2">
                        {msg.kind !== 'NEW_STUDENT' ? t('visitRequests.doneComplaint', { when: msg.when || when }) : msg.sent ? t('visitRequests.sentAuto', { when: msg.when || when }) : t('visitRequests.savedManual', { when: msg.when || when })}
                        {!msg.sent && msg.kind === 'NEW_STUDENT' && msg.phone && (
                          <a href={waUrl(msg.phone, t('visitRequests.parentMessage', { parent: a.parentName, when: msg.when || when, branch: branchName(a.branch) }))} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-[#25D366] text-white text-sm flex items-center gap-1"><MessageCircle className="w-4 h-4" />{t('visitRequests.sendWa')}</a>
                        )}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </div>
  );
}
