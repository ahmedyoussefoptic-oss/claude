import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, KeyRound, HardHat, Play, PackageOpen, CheckCircle2, Camera, RefreshCw, MapPin, AlarmClock } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import PhotoPicker, { PhotoStrip } from '../components/maintenance/PhotoPicker';
import { callMntPublic, photoPayload, STATUS_STYLE, PRIORITY_STYLE, CATEGORY_ICON, fmtDateTime, isOverdue } from '../config/maintenance';

const card = 'w-full max-w-2xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';
const input = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
const pill = 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border';

// «/tech/:token» — a technician's (or contractor's) work after the PIN:
// the open work orders, start / waiting for parts / done with a note,
// the parts and before-and-after photos; the last finished ones below.
export default function MaintenanceTech() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null);
  const [note, setNote] = useState('');
  const [parts, setParts] = useState('');
  const [files, setFiles] = useState([]);

  const load = async () => {
    setBusy('load');
    setError(null);
    try { setState(await callMntPublic('techOpen', { token, pin })); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const act = async () => {
    setBusy(panel.id);
    setError(null);
    try {
      const photos = await Promise.all(files.map(photoPayload));
      setState(await callMntPublic('techUpdate', { token, pin, id: panel.id, to: panel.to, note, parts, photos }));
      setPanel(null); setNote(''); setParts(''); setFiles([]);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const branchName = (b) => state?.branchNames?.[b] || b;

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-2xl" title={t('mnt.tech.title')} />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!state ? (
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className={`${card} max-w-sm text-center space-y-3 mt-6`}>
            <KeyRound className="w-10 h-10 text-primary mx-auto" />
            <p className="font-bold text-slate-900">{t('mnt.tech.title')}</p>
            <p className="text-sm text-slate-500">{t('mnt.tech.pinPrompt')}</p>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} dir="ltr" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono" />
            {error && <p className="text-sm text-rose-700">{error}</p>}
            <button disabled={busy === 'load' || pin.length < 4} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy === 'load' && <Loader2 className="w-4 h-4 animate-spin" />}{t('mnt.tech.enter')}</button>
          </form>
        ) : (
          <>
            <div className={`${card} flex items-center justify-between gap-2`}>
              <p className="font-bold text-slate-900 flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />{state.name}{state.company ? ` · ${state.company}` : ''}</p>
              <button type="button" onClick={load} disabled={busy === 'load'} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${busy === 'load' ? 'animate-spin' : ''}`} />{t('mnt.tech.refresh')}</button>
            </div>
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 w-full max-w-2xl">{error}</p>}
            <p className="w-full max-w-2xl text-sm font-bold text-slate-700">{t('mnt.tech.openN', { n: state.open.length })}</p>
            {!state.open.length && <div className={`${card} text-center text-slate-500`}>{t('mnt.tech.noOpen')}</div>}
            {state.open.map((x) => {
              const late = isOverdue(x);
              const mine = panel?.id === x.id;
              const buttons = [
                x.status !== 'IN_PROGRESS' && ['IN_PROGRESS', Play, t('mnt.toInProgress')],
                x.status !== 'WAITING_PARTS' && ['WAITING_PARTS', PackageOpen, t('mnt.toWaitingParts')],
                ['DONE', CheckCircle2, t('mnt.toDone')],
                ['PHOTOS', Camera, t('mnt.tech.addPhotos')],
              ].filter(Boolean);
              return (
                <section key={x.id} className={`${card} space-y-2`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{CATEGORY_ICON[x.category]} {x.title}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{branchName(x.branch)}{x.place ? ` · ${x.place}` : ''} · <span dir="ltr">{x.number}</span></p>
                    </div>
                    <span className="flex flex-wrap gap-1">
                      {x.priority !== 'NORMAL' && <span className={`${pill} ${PRIORITY_STYLE[x.priority]}`}>{t(`mnt.priorities.${x.priority}`)}</span>}
                      <span className={`${pill} ${STATUS_STYLE[x.status]}`}>{t(`mnt.status.${x.status}`)}</span>
                    </span>
                  </div>
                  {x.description && <p className="text-sm text-slate-700 whitespace-pre-wrap">{x.description}</p>}
                  <PhotoStrip photos={x.photos} />
                  <p className={`text-xs flex items-center gap-1 ${late ? 'text-rose-700 font-bold' : 'text-slate-500'}`}><AlarmClock className="w-3.5 h-3.5" />{t('mnt.dueAt')}: <span dir="ltr">{fmtDateTime(x.dueAt)}</span>{late ? ` · ${t('mnt.overdue')}` : ''}</p>
                  {x.workPhotos.length > 0 && <PhotoStrip photos={x.workPhotos} />}
                  <div className="flex flex-wrap gap-1.5">
                    {buttons.map(([to, Icon, label]) => (
                      <button key={to} type="button" onClick={() => setPanel(mine && panel.to === to ? null : { id: x.id, to })} className={`px-3 py-2 rounded-xl border text-sm flex items-center gap-1.5 ${mine && panel.to === to ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}><Icon className="w-4 h-4" />{label}</button>
                    ))}
                  </div>
                  {mine && (
                    <div className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50">
                      {['WAITING_PARTS', 'DONE'].includes(panel.to) && <input value={parts} onChange={(e) => setParts(e.target.value)} placeholder={panel.to === 'WAITING_PARTS' ? t('mnt.partsNeeded') : t('mnt.partsUsed')} className={input} />}
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={panel.to === 'DONE' ? t('mnt.noteFor.DONE') : t('mnt.note')} className={input} />
                      <PhotoPicker files={files} setFiles={setFiles} label={t('mnt.workPhotos')} />
                      <button type="button" disabled={busy === x.id || (panel.to === 'DONE' && !note.trim()) || (panel.to === 'PHOTOS' && !files.length && !note.trim())} onClick={act} className="w-full py-2.5 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy === x.id && <Loader2 className="w-4 h-4 animate-spin" />}{t('mnt.confirm')}</button>
                    </div>
                  )}
                </section>
              );
            })}
            {state.done.length > 0 && (
              <section className={`${card} space-y-1`}>
                <p className="text-sm font-bold text-slate-700 mb-1">{t('mnt.tech.recentDone')}</p>
                {state.done.map((x) => (
                  <p key={x.id} className="text-sm text-slate-600 flex flex-wrap justify-between gap-2"><span>{CATEGORY_ICON[x.category]} {x.title} <span className="text-xs text-slate-400">{x.place}</span></span><span className="text-xs text-slate-400" dir="ltr">{fmtDateTime(x.doneAt)}</span></p>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
