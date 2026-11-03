import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { X, Loader2, Link2, UserRoundX, Pencil } from 'lucide-react';
import { functions } from '../../config/firebase';
import { VC_STATUSES, VC_STATUS_STYLES } from '../../config/attendance';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const ORDER = { ABSENT: 0, PARTIAL: 1, LATE: 2, EXCUSED: 3, PRESENT: 4 };

// One class: each student's status, minutes and join time. A reviewer can
// change a status (an excuse needs a reason), and link a class whose invite
// did not name its students, which marks the rest of that class absent.
export default function SessionDetails({ id, onClose, onChanged, branchName }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? ar : enUS;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { nationalId, status, note }
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState(null);
  const [linkTo, setLinkTo] = useState('');

  const load = useCallback(() => call('vcSession', { id }).then(setData).catch((err) => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const s = data?.session;
  const rows = [...(data?.rows || [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.studentName.localeCompare(b.studentName, 'ar'));
  const time = (ms) => (ms ? format(ms, 'h:mm a', { locale }) : '—');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('vcSetStatus', { sessionId: id, ...editing });
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const openLink = async () => {
    setClasses([]);
    try { setClasses((await call('vcClasses')).classes); } catch (err) { setError(err.message); setClasses(null); }
  };
  const link = async () => {
    const [branch, className] = linkTo.split('|');
    setBusy(true);
    setError(null);
    try {
      await call('vcSetSessionClass', { sessionId: id, branch, className });
      setClasses(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-900 truncate">{s?.subject || t('vc.class')}</p>
            {s && <p className="text-xs text-slate-500 mt-0.5">{[`${time(s.startAt)} – ${time(s.endAt)}`, s.teacherName, s.className && `${s.className} · ${branchName(s.branch)}`].filter(Boolean).join(' · ')}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}
          {!data ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {VC_STATUSES.map((k) => <span key={k} className={`px-2 py-1 rounded-md text-xs border ${VC_STATUS_STYLES[k]}`}>{t(`vc.status.${k}`)}: <b>{s.counts[k] || 0}</b></span>)}
              </div>

              {s.status === 'DONE' && s.rosterSource === 'NONE' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 space-y-2">
                  <p className="flex items-start gap-2"><Link2 className="w-4 h-4 mt-0.5 shrink-0" />{t('vc.linkHint')}</p>
                  {classes === null ? (
                    <button onClick={openLink} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 text-xs font-medium">{t('vc.linkClass')}</button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} className="px-2 py-1.5 border border-amber-300 rounded-lg text-sm bg-white min-w-56" disabled={!classes.length}>
                        <option value="">{classes.length ? t('vc.chooseClass') : t('common.loading')}</option>
                        {classes.map((c) => <option key={`${c.branch}|${c.className}`} value={`${c.branch}|${c.className}`}>{`${c.className} · ${branchName(c.branch)} (${c.count})`}</option>)}
                      </select>
                      <button onClick={link} disabled={!linkTo || busy} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-50">{t('vc.linkSave')}</button>
                    </div>
                  )}
                </div>
              )}

              {rows.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">{s.status === 'NO_REPORT' ? t('vc.noReportLong') : t('vc.noStudents')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-slate-500 text-xs border-b border-slate-100">
                      {['student', 'status', 'joined', 'minutes', 'note'].map((k) => <th key={k} className="text-start py-2 px-2 font-medium">{t(`vc.col.${k}`)}</th>)}
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.nationalId} className="border-b border-slate-50 align-top">
                          <td className="py-2 px-2">
                            <p className="font-medium text-slate-900">{r.studentName || r.nationalId}</p>
                            {!r.expected && <p className="text-[11px] text-slate-400">{t('vc.notExpected')}</p>}
                          </td>
                          <td className="py-2 px-2">
                            {editing?.nationalId === r.nationalId ? (
                              <div className="space-y-1.5 min-w-40">
                                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs">
                                  {VC_STATUSES.map((k) => <option key={k} value={k}>{t(`vc.status.${k}`)}</option>)}
                                </select>
                                <input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder={editing.status === 'EXCUSED' ? t('vc.excuseReason') : t('vc.noteOptional')} className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs" />
                                <div className="flex gap-1.5">
                                  <button onClick={save} disabled={busy || (editing.status === 'EXCUSED' && !editing.note.trim())} className="px-2 py-1 rounded-md bg-primary text-white text-xs disabled:opacity-50">{t('common.save')}</button>
                                  <button onClick={() => setEditing(null)} className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs">{t('common.cancel')}</button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setEditing({ nationalId: r.nationalId, status: r.status, note: r.note })} className={`px-2 py-0.5 rounded-md text-xs border inline-flex items-center gap-1 ${VC_STATUS_STYLES[r.status]}`}>
                                {t(`vc.status.${r.status}`)}{r.status === 'LATE' && ` · ${t('vc.lateBy', { n: r.lateMin })}`}<Pencil className="w-3 h-3 opacity-60" />
                              </button>
                            )}
                            {r.editedByName && r.status !== r.autoStatus && <p className="text-[11px] text-slate-400 mt-0.5">{t('vc.changedFrom', { from: t(`vc.status.${r.autoStatus}`), by: r.editedByName })}</p>}
                          </td>
                          <td className="py-2 px-2 text-slate-600 tabular-nums whitespace-nowrap">{time(r.joinedAt)}</td>
                          <td className="py-2 px-2 text-slate-600 tabular-nums whitespace-nowrap">{r.minutes ? `${r.minutes} · ${r.pct}%` : '—'}</td>
                          <td className="py-2 px-2 text-xs text-slate-500">{r.note || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {s.unmatched?.length > 0 && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5"><UserRoundX className="w-3.5 h-3.5" />{t('vc.unmatched', { count: s.unmatched.length })}</p>
                  <p className="text-[11px] text-slate-500 mb-2">{t('vc.unmatchedHint')}</p>
                  <ul className="text-xs text-slate-600 space-y-0.5">
                    {s.unmatched.map((u, k) => <li key={k}>{u.name || u.email || '—'}{u.email && u.name ? <span className="text-slate-400" dir="ltr"> · {u.email}</span> : ''} · {t('vc.minutesN', { n: u.minutes })}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
