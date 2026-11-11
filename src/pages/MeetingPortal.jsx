import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, CalendarDays, Clock, MapPin, LogOut, Info } from 'lucide-react';
import { PublicShell } from './MeetingParent';
import { FamilyPanel, SignIn } from './MeetingFamily';
import { callMeeting, meetingTime } from '../config/meetings';

// The family's sessions on this device (one per branch meeting).
const KEY = 'meeting:portal';
const readPortal = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const writePortal = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

// «رابط أولياء الأمور العام» (/parent-meetings): one link for every branch.
// The parent signs in once and sees each current meeting their children are
// invited to — usually one per branch — with its own requests and its own
// ticket at that branch's reception.
export default function MeetingPortal() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [portal, setPortal] = useState(() => readPortal());
  const [fresh, setFresh] = useState({}); // familyToken → state from the sign-in

  useEffect(() => {
    const prev = document.title;
    document.title = t('meetings.portal.title');
    return () => { document.title = prev; };
  }, [t]);

  const signOut = useCallback(() => { writePortal(null); setPortal(null); setFresh({}); }, []);
  const onSignedIn = (r) => {
    const v = {
      sessions: r.sessions.map((x) => ({ familyToken: x.familyToken, session: x.session, meeting: x.meeting })),
      others: r.others || [],
    };
    writePortal(v);
    setFresh(Object.fromEntries(r.sessions.map((x) => [x.familyToken, x])));
    setPortal(v);
  };

  return (
    <PublicShell>
      <h1 className="w-full max-w-2xl text-center text-2xl font-bold text-primary mt-2">{t('meetings.portal.title')}</h1>
      {!portal ? (
        <SignIn title={t('meetings.portal.signInTitle')} hint={t('meetings.portal.signInHint')} onSubmit={(v) => callMeeting('meetingPortalVerify', v)} onDone={onSignedIn} />
      ) : (
        <>
          <div className="w-full max-w-2xl flex justify-end text-xs text-slate-500">
            <button type="button" onClick={signOut} className="flex items-center gap-1 hover:text-primary"><LogOut className="w-3.5 h-3.5" />{t('meetings.family.signOut')}</button>
          </div>
          {portal.sessions.length === 0 && (
            <div className="w-full max-w-2xl bg-white p-6 rounded-2xl border border-slate-100 text-center text-slate-600">{t('meetings.portal.none')}</div>
          )}
          {portal.sessions.length > 1 && <p className="w-full max-w-2xl text-sm text-slate-600 flex gap-1.5"><Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />{t('meetings.portal.several', { count: portal.sessions.length })}</p>}
          {portal.sessions.map((sx) => {
            const m = sx.meeting;
            return (
              <section key={sx.familyToken} className="w-full max-w-2xl flex flex-col items-center gap-3">
                <div className="w-full bg-primary text-white rounded-2xl p-4">
                  <p className="text-lg font-bold flex items-center gap-2"><Building2 className="w-5 h-5" />{(m.branchNames || []).join('، ')}</p>
                  <p className="text-sm opacity-90">{m.title}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1 opacity-90">
                    <span className="flex items-center gap-1"><CalendarDays className="w-4 h-4" />{lang === 'ar' ? m.dateLabel : m.date}</span>
                    <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{meetingTime(m.startTime, lang)} – {meetingTime(m.endTime, lang)}</span>
                    {m.location && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{m.location}</span>}
                  </div>
                </div>
                <FamilyPanel sess={sx} initial={fresh[sx.familyToken] || null} onExpired={signOut} />
              </section>
            );
          })}
          {portal.others.length > 0 && (
            <p className="w-full max-w-2xl text-xs text-slate-500">{t('meetings.portal.others', { list: portal.others.map((o) => `${o.name} (${o.branchName})`).join('، ') })}</p>
          )}
        </>
      )}
    </PublicShell>
  );
}
