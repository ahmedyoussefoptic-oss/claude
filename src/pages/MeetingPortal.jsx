import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, CalendarDays, Clock, MapPin, Info } from 'lucide-react';
import { PublicShell } from './MeetingParent';
import { FamilyPanel, SignIn, Steps, SignOutBar } from './MeetingFamily';
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
    <PublicShell festive>
      <h1 className="w-full max-w-2xl text-center text-2xl md:text-3xl font-extrabold bg-gradient-to-l from-[#1f3c64] via-violet-600 to-fuchsia-500 bg-clip-text text-transparent pb-1">{t('meetings.portal.title')}</h1>
      {!portal ? (
        <>
        <Steps at={0} />
        <SignIn title={t('meetings.portal.signInTitle')} hint={t('meetings.portal.signInHint')} onSubmit={(v) => callMeeting('meetingPortalVerify', v)} onDone={onSignedIn} />
        </>
      ) : (
        <>
          <SignOutBar onClick={signOut} />
          {portal.sessions.length === 0 && (
            <div className="w-full max-w-2xl bg-white p-6 rounded-[28px] border border-slate-100 shadow-lg shadow-slate-200/70 text-center text-[15px] text-slate-600">{t('meetings.portal.none')}</div>
          )}
          {portal.sessions.length > 1 && <p className="w-full max-w-2xl text-[15px] text-violet-900 bg-violet-50 border border-violet-100 rounded-2xl p-3 flex gap-2"><Info className="w-5 h-5 shrink-0 mt-0.5 text-violet-600" />{t('meetings.portal.several', { count: portal.sessions.length })}</p>}
          {portal.sessions.map((sx) => {
            const m = sx.meeting;
            return (
              <section key={sx.familyToken} className="w-full max-w-2xl flex flex-col items-center gap-4">
                <div className="w-full bg-white rounded-[28px] border border-slate-100 shadow-lg shadow-slate-200/70 p-4 flex items-start gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shrink-0"><Building2 className="w-6 h-6" /></span>
                  <div className="min-w-0">
                    <p className="text-xl font-extrabold text-[#1b345a]">{(m.branchNames || []).join('، ')}</p>
                    <p className="text-[15px] text-slate-600">{m.title}</p>
                    <div className="flex flex-wrap gap-2 text-sm mt-2">
                      <span className="flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-900 px-3 py-1"><CalendarDays className="w-4 h-4 text-blue-600" />{lang === 'ar' ? m.dateLabel : m.date}</span>
                      <span className="flex items-center gap-1.5 rounded-full bg-violet-50 text-violet-900 px-3 py-1"><Clock className="w-4 h-4 text-violet-600" />{meetingTime(m.startTime, lang)} – {meetingTime(m.endTime, lang)}</span>
                      {m.location && <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-900 px-3 py-1"><MapPin className="w-4 h-4 text-emerald-600" />{m.location}</span>}
                    </div>
                  </div>
                </div>
                <FamilyPanel sess={sx} initial={fresh[sx.familyToken] || null} onExpired={signOut} showSteps={portal.sessions.length === 1} />
              </section>
            );
          })}
          {portal.others.length > 0 && (
            <p className="w-full max-w-2xl text-sm text-slate-500">{t('meetings.portal.others', { list: portal.others.map((o) => `${o.name} (${o.branchName})`).join('، ') })}</p>
          )}
        </>
      )}
    </PublicShell>
  );
}
