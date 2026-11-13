import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Presentation, Plus, Loader2, CalendarDays, Clock, MapPin, Users as UsersIcon, Star, BookUser, Link2, KeyRound } from 'lucide-react';
import { printAdminAccess } from '../components/meetings/printAdminAccess';
import PortalLink from '../components/meetings/PortalLink';
import TeacherDirectory from '../components/meetings/TeacherDirectory';
import { useBranches } from '../hooks/useOrgData';
import MeetingForm from '../components/meetings/MeetingForm';
import MeetingDetails from '../components/meetings/MeetingDetails';
import { MEETING_STATUSES, MEETING_STATUS_STYLES, callMeeting, meetingTime, pct } from '../config/meetings';
import PageHero from '../components/common/PageHero';
import MeetingsDashboard from '../components/meetings/MeetingsDashboard';

// «اجتماعات أولياء الأمور»: the meetings of the user's branches; one opens
// in its details (invitations, schedule, the day, the report).
export default function Meetings() {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('openId');
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [directory, setDirectory] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [status, setStatus] = useState('ACTIVE');
  const [printing, setPrinting] = useState('');

  // The administration's links of every current meeting, in one PDF.
  const printAdmin = async (group) => {
    const current = meetings.filter((m) => ['DRAFT', 'OPEN', 'CLOSED'].includes(m.status));
    if (!current.length) { window.alert(t('meetings.adminAccess.none')); return; }
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<p style="font-family:Tahoma;padding:24px">${t('meetings.adminAccess.preparing')}</p>`);
    setPrinting(group);
    try {
      if (!(await printAdminAccess(current, { t, i18n, branchName, win, group }))) { win.close(); window.alert(t('meetings.adminAccess.noneManagers')); }
    } catch (err) {
      win.close();
      window.alert(err.message);
    } finally { setPrinting(''); }
  };

  const load = useCallback(async () => {
    try {
      const r = await callMeeting('listMeetings', {});
      setMeetings(r.meetings || []);
      setError(null);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => meetings.filter((m) => (status === 'ALL' ? true : status === 'ACTIVE' ? ['DRAFT', 'OPEN', 'CLOSED'].includes(m.status) : m.status === status)), [meetings, status]);

  if (openId) return <MeetingDetails id={openId} onBack={() => { setSearchParams({}); load(); }} onChanged={load} />;

  return (
    <div className="space-y-4">
      <PageHero
        icon={Presentation}
        title={t('meetings.title')}
        subtitle={t('meetings.subtitle')}
        facts={[
          { label: t('hero.total'), value: meetings.length },
          { label: t('meetings.filterActive'), value: meetings.filter((m) => ['DRAFT', 'OPEN', 'CLOSED'].includes(m.status)).length, tone: 'amber' },
          { label: t('meetings.status.COMPLETED'), value: meetings.filter((m) => m.status === 'COMPLETED').length, tone: 'green' },
        ]}
        actions={(
          <>
            <button type="button" onClick={() => setPortalOpen(true)} className="px-4 py-2 border border-primary/40 bg-white text-primary rounded-xl text-sm flex items-center gap-2"><Link2 className="w-4 h-4" />{t('meetings.portal.linkTitle')}</button>
            {[['managers', 'border-violet-300 text-violet-700'], ['desk', 'border-sky-300 text-sky-700']].map(([g, tone]) => (
              <button key={g} type="button" disabled={!!printing} onClick={() => printAdmin(g)} className={`px-4 py-2 border bg-white rounded-xl text-sm flex items-center gap-2 disabled:opacity-60 ${tone}`}>{printing === g ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}{t(`meetings.adminAccess.${g}Button`)}</button>
            ))}
            <button type="button" onClick={() => setDirectory(true)} className="px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm flex items-center gap-2"><BookUser className="w-4 h-4" />{t('meetings.directory.title')}</button>
            <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2"><Plus className="w-4 h-4" />{t('meetings.new')}</button>
          </>
        )}
      />

      {!loading && !error && <MeetingsDashboard meetings={meetings} branchName={branchName} />}

      <div className="flex gap-1 overflow-x-auto">
        {['ACTIVE', ...MEETING_STATUSES, 'ALL'].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-xl text-sm whitespace-nowrap border ${status === s ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>
            {s === 'ACTIVE' ? t('meetings.filterActive') : s === 'ALL' ? t('meetings.filterAll') : t(`meetings.status.${s}`)}
          </button>
        ))}
      </div>

      {loading ? <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        : error ? <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>
          : !shown.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('meetings.empty')}</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {shown.map((m) => {
                  const s = m.stats || {};
                  return (
                    <button key={m.id} type="button" onClick={() => setSearchParams({ openId: m.id })} className="text-start bg-white border border-slate-200 rounded-2xl p-4 hover:border-primary/40 hover:shadow-sm transition">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-slate-900">{m.title}</p>
                        <span className={`px-2 py-0.5 rounded-md text-xs border shrink-0 ${MEETING_STATUS_STYLES[m.status]}`}>{t(`meetings.status.${m.status}`)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{t(`meetings.type.${m.type}`)} · {m.branches.map(branchName).join('، ')}{m.stages.length ? ` · ${m.stages.join(', ')}` : ''}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">
                        <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-primary" />{m.date}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-primary" />{meetingTime(m.startTime, i18n.language)}</span>
                        {m.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-primary" />{m.location}</span>}
                      </div>
                      {m.status !== 'DRAFT' && (
                        <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                          {[[t('meetings.stats.families'), s.families || 0], [t('meetings.stats.responded'), `${pct(s.responded, s.families)}%`], [t('meetings.stats.attend'), s.attend || 0], [t('meetings.stats.attended'), s.attended || 0]].map(([k, v]) => (
                            <div key={k} className="bg-slate-50 rounded-lg py-1.5"><p className="text-sm font-bold text-slate-800">{v}</p><p className="text-[10px] text-slate-500">{k}</p></div>
                          ))}
                        </div>
                      )}
                      {s.avgOverall > 0 && <p className="text-xs text-amber-600 mt-2 flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{s.avgOverall}/5 · {t('meetings.stats.surveysN', { count: s.surveys, low: s.low || 0 })}</p>}
                      {m.status === 'DRAFT' && <p className="text-xs text-slate-500 mt-3 flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" />{t('meetings.draftHint')}</p>}
                    </button>
                  );
                })}
              </div>
            )}

      {portalOpen && <PortalLink onClose={() => setPortalOpen(false)} />}
      {directory && <TeacherDirectory onClose={() => setDirectory(false)} />}
      {creating && <MeetingForm onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); load(); setSearchParams({ openId: r.id }); }} />}
    </div>
  );
}
