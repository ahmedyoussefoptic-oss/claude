import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Hammer, Plus, Loader2, LayoutDashboard, ListChecks, MapPin, HardHat, Settings2, Save } from 'lucide-react';
import PageHero from '../components/common/PageHero';
import { Field, inputCls, btn } from '../components/platform/ui';
import { useBranches } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import { callMnt, MNT_OPEN, isOverdue } from '../config/maintenance';
import MntDashboard from '../components/maintenance/MntDashboard';
import MntTickets from '../components/maintenance/MntTickets';
import MntPlaces from '../components/maintenance/MntPlaces';
import MntTechs from '../components/maintenance/MntTechs';
import TicketForm from '../components/maintenance/TicketForm';
import TicketDetails from '../components/maintenance/TicketDetails';

// «صيانة المرافق»: every employee reports faults and follows theirs; the
// maintenance managers (facilities, principals, mntManage) see their
// branches' work orders, assign them, and keep the places and technicians.
export default function Maintenance() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b;
  const [params, setParams] = useSearchParams();
  const openId = params.get('openId');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState({});

  const load = useCallback(() => callMnt('list').then((r) => { setData(r); setError(null); }).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  const viewer = !!data && (data.canManage || userData?.role === 'UPPER_MANAGEMENT' || userData?.isQuality === true);
  const isAdmin = userData?.role === 'ADMIN' || userData?.isOwner === true;
  const tabs = !data ? [] : [
    ...(viewer ? [['dashboard', LayoutDashboard]] : []), ['tickets', ListChecks],
    ...(data.canManage ? [['places', MapPin], ['techs', HardHat]] : []), ...(isAdmin ? [['settings', Settings2]] : []),
  ];
  const current = tab || (viewer ? 'dashboard' : 'tickets');
  const list = data?.tickets || [];
  const now = data?.now || 0;

  return (
    <div className="space-y-4">
      <PageHero icon={Hammer} title={t('mnt.title')} subtitle={viewer ? t('mnt.subtitleManager') : t('mnt.subtitle')}
        facts={data ? [
          { label: t('mnt.dash.open'), value: list.filter((x) => MNT_OPEN.includes(x.status)).length },
          { label: t('mnt.dash.late'), value: list.filter((x) => isOverdue(x, now)).length, tone: 'amber' },
          { label: t('mnt.dash.doneTotal'), value: list.filter((x) => ['DONE', 'CLOSED'].includes(x.status)).length, tone: 'green' },
        ] : []}
        actions={<button type="button" onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2"><Plus className="w-4 h-4" />{t('mnt.newTicket')}</button>}
      />
      {error ? <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>
        : !data ? <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          : (
            <>
              {tabs.length > 1 && (
                <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-1 w-fit max-w-full">
                  {tabs.map(([k, Icon]) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${current === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="w-4 h-4" />{t(`mnt.tabs.${k}`)}</button>)}
                </div>
              )}
              {current === 'dashboard' && <MntDashboard tickets={list} now={now} branchName={branchName} onFilter={(f) => { setFilter(f); setTab('tickets'); }} />}
              {current === 'tickets' && <MntTickets tickets={list} now={now} branchName={branchName} filter={filter} setFilter={setFilter} onOpen={(id) => setParams({ openId: id })} />}
              {current === 'places' && <MntPlaces branchName={branchName} manageBranches={data.manageBranches} />}
              {current === 'techs' && <MntTechs branchName={branchName} tickets={list} />}
              {current === 'settings' && <MntSettings />}
            </>
          )}
      {creating && <TicketForm canManage={!!data?.canManage} onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); load(); setParams({ openId: r.id }); }} />}
      {openId && <TicketDetails id={openId} branchName={branchName} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
}

// Deadlines per priority: urgent in working hours, the rest in working days
// (the working week and hours are those of Settings → SLA).
function MntSettings() {
  const { t } = useTranslation();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { callMnt('settings').then((r) => setS(r.settings)).catch((err) => setMsg(err.message)); }, []);
  if (!s) return msg ? <p className="text-sm text-rose-700">{msg}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" />;
  const save = async () => {
    setBusy(true);
    try { const r = await callMnt('saveSettings', s); setS(r.settings); setMsg(t('mnt.settings.saved')); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  const num = (k) => <input type="number" step="0.5" min="0.5" value={s[k]} onChange={(e) => setS((p) => ({ ...p, [k]: e.target.value }))} className={inputCls} dir="ltr" />;
  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4 max-w-2xl">
      <p className="font-bold text-slate-800">{t('mnt.settings.title')}</p>
      <p className="text-xs text-slate-500">{t('mnt.settings.hint')}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label={t('mnt.settings.urgentHours')}>{num('urgentHours')}</Field>
        <Field label={t('mnt.settings.highDays')}>{num('highDays')}</Field>
        <Field label={t('mnt.settings.normalDays')}>{num('normalDays')}</Field>
        <Field label={t('mnt.settings.lowDays')}>{num('lowDays')}</Field>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('common.save')}</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </section>
  );
}
