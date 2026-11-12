import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, UserCog, Pencil } from 'lucide-react';
import { PublicShell } from './MeetingParent';
import { PinGate, RequestsBoard } from './MeetingTeacher';
import { callMeeting, savedPin, savePin, positionLabel } from '../config/meetings';

const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const card = 'w-full max-w-2xl bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-100';

// Who is using this phone: name, position and office (kept in the browser).
const idKey = (token) => `meeting:mgrId:${token}`;
const readId = (token) => { try { return JSON.parse(localStorage.getItem(idKey(token)) || 'null'); } catch { return null; } };
const writeId = (token, v) => { try { if (v) localStorage.setItem(idKey(token), JSON.stringify(v)); else localStorage.removeItem(idKey(token)); } catch { /* storage unavailable */ } };

// The managers' link (/meeting-manager/<token>) of an «interviews on
// request» meeting: parents ask for a position (academic director, vice
// principal, a subject supervisor…); whoever holds it today opens this link,
// writes their name and job title, and gets that position's requests.
export default function MeetingManager() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [pin, setPin] = useState(() => savedPin('manager', token));
  const [me, setMe] = useState(() => readId(token));
  const [positions, setPositions] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Code → the list of job titles; with an identity → that position's board.
  const load = useCallback(async (p = pin, who = me, quiet = false) => {
    if (!p) return;
    if (!quiet) setBusy(true);
    try {
      if (!who) {
        const r = await callMeeting('meetingManager', { token, pin: p });
        setPositions(r.positions);
        setData(null);
      } else {
        setData(await callMeeting('meetingManager', { token, pin: p, ...who }));
      }
      savePin('manager', token, p);
      setError(null);
    } catch (err) {
      setError(err.message);
      if (/رمز الدخول|code/i.test(err.message)) { setPin(''); setPositions(null); setData(null); }
    } finally { setBusy(false); }
  }, [token, pin, me]);
  useEffect(() => { if (pin) load(pin); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return undefined;
    const timer = setInterval(() => load(pin, me, true), 30000);
    return () => clearInterval(timer);
  }, [data, load, pin, me]);

  const act = async (payload) => {
    const r = await callMeeting('meetingManagerAction', { token, pin, ...me, ...payload });
    setData(r);
    return r;
  };
  const signIn = (who) => { writeId(token, who); setMe(who); load(pin, who); };
  const change = () => { writeId(token, null); setMe(null); setData(null); load(pin, null); };

  if (!pin || (!positions && !data)) {
    return <PublicShell>{busy && pin ? <Loader2 className="w-8 h-8 animate-spin text-primary mt-16" /> : <PinGate title={t('meetings.manager.title')} busy={busy} error={error} onSubmit={(p) => { setPin(p); load(p); }} />}</PublicShell>;
  }
  if (!me || !data) {
    return <PublicShell><WhoAmI positions={positions || []} initial={me} busy={busy} error={error} onSubmit={signIn} /></PublicShell>;
  }
  return (
    <PublicShell>
      <div className={card}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">{data.meeting.title} · {data.meeting.date}</p>
            <h1 className="text-lg font-bold text-slate-900">{data.teacher.name}</h1>
            <p className="text-sm text-slate-500">{positionLabel(t, data.teacher) || data.teacher.subject}{data.teacher.room ? ` · ${data.teacher.room}` : ''}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={change} className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg flex items-center gap-1 text-slate-600 hover:text-primary"><Pencil className="w-3.5 h-3.5" />{t('meetings.manager.change')}</button>
            <button type="button" onClick={() => load(pin, me)} className="p-2 text-slate-500 hover:text-primary" aria-label={t('common.refresh')}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}</button>
          </div>
        </div>
      </div>
      <RequestsBoard requests={data.requests} act={act} onError={setError} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </PublicShell>
  );
}

// «من أنت؟»: the name, the job title (the position parents chose) and the office.
function WhoAmI({ positions, initial, busy, error, onSubmit }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name || '');
  const [slot, setSlot] = useState(initial?.slot || '');
  const [room, setRoom] = useState(initial?.room || '');
  const groups = [['ADMIN', positions.filter((p) => p.role === 'ADMIN')], ['ACADEMIC', positions.filter((p) => p.role === 'ACADEMIC')]];
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), slot, room: room.trim() }); }} className={`${card} max-w-md mt-8 space-y-4`}>
      <div className="text-center">
        <UserCog className="w-9 h-9 text-primary mx-auto" />
        <h1 className="font-bold text-slate-900 mt-1">{t('meetings.manager.whoTitle')}</h1>
        <p className="text-sm text-slate-500">{t('meetings.manager.whoHint')}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.manager.name')}</label>
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('meetings.manager.namePh')} className={inputCls} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.manager.jobTitle')}</label>
        <select required value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
          <option value="">{t('meetings.form.positionPick')}</option>
          {groups.map(([role, list]) => (
            <optgroup key={role} label={t(`meetings.family.listOf.${role}`)}>
              {list.map((p) => <option key={p.id} value={p.id}>{positionLabel(t, p)}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{t('meetings.manager.room')}</label>
        <input maxLength={60} value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('meetings.manager.roomPh')} className={inputCls} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy || name.trim().length < 2 || !slot} className="w-full py-2.5 bg-primary text-white rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('meetings.manager.start')}</button>
    </form>
  );
}
