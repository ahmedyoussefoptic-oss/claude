import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpenCheck, Loader2, ChevronDown, Printer, FileText, Phone, MessageCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { callSupport, STATUS_STYLE, TYPE_STYLE, MARK_STYLE, RATING_STYLE, FINAL_STYLE, attRate } from '../../config/support';
import { printPage, escapeHtml as esc } from '../../utils/printPage';
import { Pill } from '../platform/ui';

const day = (ms) => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(0, 10) : '');
const time = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '');

// «برامج الدعم» in the student record: each nomination and its reason, the
// parent's answer, the pledge (printable as PDF), the group and teacher, the
// attendance rate, every class and its mark, the teacher's rating at each
// class (with its topic) and final evaluation, and how the parent was reached
// on each absence (WhatsApp, the call team's calls and their results), and
// the notes opened on the case. Hidden when there are none (or the user
// can't see the section).
export default function StudentSupport({ studentId, className = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4' }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState('');
  useEffect(() => {
    let alive = true;
    setItems(null);
    callSupport('supportForStudent', { studentId }).then((r) => { if (alive) { setItems(r.items || []); setOpen(r.items?.[0]?.cycleId || ''); } }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [studentId]);
  if (items && !items.length) return null;

  const callText = (x) => `${t(`support.callKind.${x.kind}`)}${x.day ? ` (\u2066${x.day}\u2069)` : ''}: ${x.status === 'PENDING' ? `${t('callTasks.taskStatus.PENDING')}${x.attempts ? ` — ${t('support.student.attempts', { n: x.attempts })}` : ''}` : `${x.result ? t(`callTasks.results.${x.result}`) : t(`callTasks.taskStatus.${x.status}`)}${x.outcome ? ` — ${x.outcome}` : ''}`}${x.assignedName ? ` · ${x.assignedName}` : ''}${x.note ? ` · ${x.note}` : ''}`;

  const printPledge = (x) => printPage({
    title: t('support.student.pledgeTitle'), subtitle: `${x.cycle} · ${t(`support.types.${x.type}`)}`, school: t('trips.print.school'), dir: i18n.dir(), lang: i18n.language,
    css: '.box{border:1px solid #cbd5e1;border-radius:8px;padding:14px;margin-top:10px;line-height:2;font-size:11pt}table{width:100%;border-collapse:collapse;margin-top:12px}td{border:1px solid #cbd5e1;padding:6px 8px;font-size:10pt}td:first-child{background:#f8fafc;width:28%;font-weight:bold}',
    body: `<table>
<tr><td>${esc(t('support.col.student'))}</td><td>${esc(x.name)} — ${esc(`${x.grade} ${x.className}`)}</td></tr>
<tr><td>${esc(t('support.col.type'))}</td><td>${esc(t(`support.types.${x.type}`))}${x.subjects.length ? ` — ${esc(x.subjects.join('، '))}` : ''}</td></tr>
<tr><td>${esc(t('support.col.reason'))}</td><td>${esc(x.reason || '—')}</td></tr>
${x.decline ? `<tr><td>${esc(t('support.student.declinedOn'))}</td><td>${esc(x.decline.name)} · <span dir="ltr">${day(x.decline.at)}</span>${x.decline.reason ? ` — ${esc(x.decline.reason)}` : ''}</td></tr>` : ''}
</table>
<div class="box">${esc(x.pledgeText || x.pledge?.text || '')}</div>
<table>
<tr><td>${esc(t('support.student.signedBy'))}</td><td>${esc(x.pledge?.name || '')}${x.pledge?.relation ? ` (${esc(x.pledge.relation)})` : ''}</td></tr>
<tr><td>${esc(t('support.student.signedAt'))}</td><td><span dir="ltr">${day(x.pledge?.at)} ${time(x.pledge?.at)}</span></td></tr>
<tr><td>${esc(t('support.student.signedVia'))}</td><td>${esc(t('support.student.viaLink'))}</td></tr>
</table>`,
  });

  return (
    <div className={className}>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><BookOpenCheck className="w-4 h-4 text-primary" />{t('support.student.title')}</p>
      {!items ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : (
        <div className="space-y-2">
          {items.map((x) => {
            const rate = attRate(x.att);
            const isOpen = open === x.cycleId;
            const absences = x.sessions.filter((s) => s.s === 'A');
            return (
              <div key={x.cycleId} className="border border-slate-100 rounded-lg text-sm">
                <button type="button" onClick={() => setOpen(isOpen ? '' : x.cycleId)} className="w-full text-start p-2.5 hover:bg-slate-50 rounded-lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{x.cycle}</span>
                    <Pill className={TYPE_STYLE[x.type]}>{t(`support.types.${x.type}`)}</Pill>
                    <Pill className={STATUS_STYLE[x.status]}>{t(`support.status.${x.status}`)}</Pill>
                    {rate != null && <span className={`text-xs ${rate < 75 ? 'text-rose-700 font-bold' : 'text-emerald-700'}`}>{t('support.student.attendance', { rate, absent: x.att.A || 0 })}</span>}
                    {x.absenceAlert && <Pill className="bg-rose-50 text-rose-700 border-rose-200"><AlertTriangle className="w-3 h-3 me-1" />{t('support.student.alert')}</Pill>}
                    <ChevronDown className={`w-4 h-4 text-slate-400 ms-auto transition ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {[x.subjects.join('، '), x.group && `${t('support.col.group')}: ${x.group.name}${x.group.teacher ? ` (${x.group.teacher})` : ''}${x.group.room ? ` · ${x.group.room}` : ''}`].filter(Boolean).join(' · ')}
                  </p>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-2.5 space-y-2 border-t border-slate-100 pt-2">
                    <div className="text-xs space-y-0.5">
                      <p className="text-slate-600">{t('support.student.nominated', { by: x.nominatedByName || '—', day: day(x.nominatedAt) })}{x.reason ? ` — ${x.reason}` : ''}</p>
                      {x.sentAt > 0 && <p className="text-slate-600">{t('support.student.sent', { day: day(x.sentAt) })}</p>}
                      {x.consent && <p className="text-emerald-700">✓ {t('support.student.consent', { name: x.consent.name, day: day(x.consent.at) })}{x.consent.via === 'CALL' || x.consent.via === 'STAFF' ? ` (${x.consent.byName || ''})` : ''}</p>}
                      {x.decline && <p className="text-rose-700">✗ {t('support.student.decline', { name: x.decline.name, day: day(x.decline.at) })}{x.decline.reason ? ` — ${x.decline.reason}` : ''}</p>}
                      {x.pledgeSentAt > 0 && !x.pledge && <p className="text-orange-700">{t('support.student.pledgeSent', { day: day(x.pledgeSentAt) })}</p>}
                      {x.pledge && (
                        <p className="text-violet-700 flex flex-wrap items-center gap-2">✍ {t('support.pledgeSigned', { name: x.pledge.name, day: day(x.pledge.at) })}
                          <button type="button" onClick={() => printPledge(x)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-200 bg-violet-50 hover:bg-violet-100"><Printer className="w-3 h-3" />{t('support.student.pledgePdf')}</button>
                        </p>
                      )}
                      {x.status === 'WITHDRAWN' && <p className="text-slate-500">{t('support.status.WITHDRAWN')}{x.withdrawNote ? ` — ${x.withdrawNote}` : ''}</p>}
                      {x.status === 'CONSENTED' && x.remaining > 0 && <p className="text-slate-500">{t('support.student.remaining', { n: x.remaining, when: x.when })}</p>}
                    </div>

                    {x.sessions.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-700 mb-1">{t('support.student.classes', { n: x.sessions.length, absent: absences.length })}</p>
                        <div className="flex flex-wrap gap-1">
                          {x.sessions.map((s) => (
                            <span key={s.day} title={[s.group, s.note].filter(Boolean).join(' — ')} className={`px-1.5 py-0.5 rounded-md border text-[11px] ${MARK_STYLE[s.s]?.on || ''}`}>
                              <span dir="ltr">{s.day.slice(5)}</span> {t(`support.marks.${s.s}`)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {(x.ratings?.length > 0 || x.final) && (
                      <div className="space-y-1">
                        {x.final && (
                          <p className="text-xs flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-700">{t('support.groups.final')}:</span>
                            <span className={`px-2 py-0.5 rounded-full border ${FINAL_STYLE[x.final.r]?.pill || ''}`}>{t(`support.finals.${x.final.r}`)}</span>
                            {x.final.note && <span className="text-slate-600">{x.final.note}</span>}
                            {x.final.byName && <span className="text-slate-400">· {x.final.byName}</span>}
                          </p>
                        )}
                        {x.ratings?.length > 0 && (
                          <>
                            <p className="text-xs font-bold text-slate-700">{t('support.student.ratings', { n: x.ratings.length })}</p>
                            <ul className="text-xs space-y-0.5">
                              {x.ratings.map((r) => (
                                <li key={r.day} className="flex flex-wrap items-center gap-1.5 text-slate-600">
                                  <span dir="ltr" className="text-slate-500">{r.day}</span>
                                  <span className={`px-1.5 py-0.5 rounded-md border text-[11px] ${RATING_STYLE[r.r]?.on || ''}`}>{t(`support.ratings.${r.r}`)}</span>
                                  {r.subject && <span className="text-slate-500">{r.subject}:</span>}
                                  {r.topic && <span>{r.topic}</span>}
                                  {r.note && <span className="text-slate-400">— {r.note}</span>}
                                  {r.by && <span className="text-slate-400">· {r.by}</span>}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}

                    {(absences.length > 0 || x.callList.length > 0) && (
                      <div>
                        <p className="text-xs font-bold text-slate-700 mb-1">{t('support.student.contact')}</p>
                        <ul className="text-xs space-y-0.5">
                          {absences.map((s) => (
                            <li key={s.day} className="flex flex-wrap items-center gap-1.5 text-slate-600">
                              <span dir="ltr" className="text-slate-500">{s.day}</span>
                              <MessageCircle className="w-3 h-3" />{s.notified ? t(`support.waState.${s.notified.wa || 'none'}`) : t('support.waState.waiting')}
                              {s.note && <span className="text-slate-400">— {s.note}</span>}
                            </li>
                          ))}
                          {x.callList.map((k) => (
                            <li key={k.id} className={`flex items-center gap-1.5 ${k.status === 'PENDING' ? 'text-amber-700' : k.status === 'DONE' ? 'text-emerald-700' : 'text-rose-700'}`}>
                              <Phone className="w-3 h-3" />{callText(k)}{k.lastAt > 0 && <span className="text-slate-400" dir="ltr">{day(k.lastAt)}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {x.notes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        <span className="text-slate-600">{t('support.dash.notes')}:</span>
                        {x.notes.map((n) => <Link key={n.id} to={`/complaints?openId=${n.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-slate-50 text-primary border-slate-200 font-mono" dir="ltr"><FileText className="w-3 h-3" />{n.no || n.id}</Link>)}
                      </div>
                    )}

                    <button type="button" onClick={() => navigate(`/support-programs?openId=${x.cycleId}`)} className="text-xs text-primary flex items-center gap-1"><ExternalLink className="w-3 h-3" />{t('support.student.openCycle')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
