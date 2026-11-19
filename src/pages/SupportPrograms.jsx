import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { BookOpenCheck, Plus, Loader2, CalendarDays, Clock, ArrowRight, Pencil, Lock, Unlock, Trash2, Users, UserCheck, ClipboardList, Layers, LayoutDashboard } from 'lucide-react';
import PageHero from '../components/common/PageHero';
import { useBranches } from '../hooks/useOrgData';
import { callSupport, time12 } from '../config/support';
import CycleEditor from '../components/support/CycleEditor';
import SupportStudents from '../components/support/SupportStudents';
import SupportGroups, { SupportProgramTypes } from '../components/support/SupportGroups';
import SupportGroupPage from '../components/support/SupportGroupPage';
import SupportSupervisors from '../components/support/SupportSupervisors';
import SupportAttendance from '../components/support/SupportAttendance';
import SupportDashboard from '../components/support/SupportDashboard';
import { Pill, btn } from '../components/platform/ui';

export const weekdaysText = (t, list) => (list || []).map((w) => t(`support.weekdays.${w}`)).join(' و');

// «برامج الدعم»: the cycles of remedial / enrichment classes; one opens in
// its follow-up board, students, groups, supervisors and attendance.
export default function SupportPrograms() {
  const { t } = useTranslation();
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b;
  const [params, setParams] = useSearchParams();
  const openId = params.get('openId');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => callSupport('supportList', {}).then(setData).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  if (openId) return <CycleDetails id={openId} branchName={branchName} onBack={() => { setParams({}); load(); }} groupId={params.get('group')} prog={params.get('prog')}
    openProg={(p) => setParams(p ? { openId, prog: p } : { openId })}
    openGroup={(g, p) => setParams({ openId, ...(p ? { prog: p } : {}), ...(g ? { group: g } : {}) })} />;
  const list = data?.cycles || [];
  const total = list.reduce((n, c) => n + (c.counts.total || 0), 0);
  return (
    <div className="space-y-4">
      <PageHero icon={BookOpenCheck} title={t('support.title')} subtitle={t('support.subtitle')}
        facts={[
          { label: t('support.facts.cycles'), value: list.length },
          { label: t('support.facts.students'), value: total, tone: 'amber' },
          { label: t('support.facts.consented'), value: list.reduce((n, c) => n + (c.counts.CONSENTED || 0), 0), tone: 'green' },
        ]}
        actions={data?.canCreate && <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2"><Plus className="w-4 h-4" />{t('support.newCycle')}</button>}
      />
      {error ? <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>
        : !data ? <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          : !list.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('support.empty')}</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map((c) => (
                  <button key={c.id} type="button" onClick={() => setParams({ openId: c.id })} className="text-start bg-white border border-slate-200 rounded-2xl p-4 hover:border-primary/40 hover:shadow-sm transition">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-slate-900">{c.title}</p>
                      <Pill className={c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}>{t(`support.cycleStatus.${c.status}`)}</Pill>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{c.branches.length ? c.branches.map(branchName).join('، ') : t('common.allBranches')}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">
                      <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-primary" /><span dir="ltr">{c.startDay} → {c.endDay}</span></span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-primary" />{weekdaysText(t, c.weekdays)} <span dir="ltr">{time12(c.startTime)}–{time12(c.endTime)}</span></span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
                      <Pill className="bg-amber-50 text-amber-800 border-amber-200">{t('support.types.REMEDIAL')}: {c.counts.REMEDIAL || 0}</Pill>
                      <Pill className="bg-sky-50 text-sky-700 border-sky-200">{t('support.types.ENRICHMENT')}: {c.counts.ENRICHMENT || 0}</Pill>
                      <Pill className="bg-emerald-50 text-emerald-700 border-emerald-200">{t('support.status.CONSENTED')}: {c.counts.CONSENTED || 0}</Pill>
                      {(c.counts.PENDING_CONSENT || 0) > 0 && <Pill className="bg-amber-50 text-amber-800 border-amber-200">{t('support.status.PENDING_CONSENT')}: {c.counts.PENDING_CONSENT}</Pill>}
                    </div>
                  </button>
                ))}
              </div>
            )}
      {creating && <CycleEditor onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setParams({ openId: id }); }} />}
    </div>
  );
}

function CycleDetails({ id, branchName, onBack, groupId, prog, openProg, openGroup }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(groupId || prog ? 'groups' : 'dashboard');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => callSupport('supportGet', { id }).then((r) => { setData(r); setError(null); }).catch((err) => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const groupName = useMemo(() => Object.fromEntries((data?.groups || []).map((g) => [g.id, g.name])), [data]);

  if (error) return <div className="space-y-3"><button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1"><ArrowRight className="w-4 h-4" />{t('support.back')}</button><div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div></div>;
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const c = data.cycle;
  const setStatus = async (action) => { setBusy(true); try { await callSupport('supportAction', { id, action, studentIds: [] }); await load(); } catch (err) { window.alert(err.message); } finally { setBusy(false); } };
  const remove = async () => {
    if (!window.confirm(t('support.deleteConfirm', { title: c.title, n: data.students.length }))) return;
    setBusy(true);
    try { await callSupport('supportDeleteCycle', { id }); onBack(); } catch (err) { window.alert(err.message); setBusy(false); }
  };
  const openedGroup = groupId && data.groups.find((g) => g.id === groupId);
  if (openedGroup) return <SupportGroupPage data={data} group={openedGroup} branchName={branchName} onBack={() => openGroup(null, prog || openedGroup.type)} />;
  const tabs = [['dashboard', LayoutDashboard], ['students', Users], ['groups', Layers], ...(c.canManage ? [['supervisors', UserCheck]] : []), ['attendance', ClipboardList]];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="text-sm text-primary flex items-center gap-1 mb-1"><ArrowRight className="w-4 h-4" />{t('support.back')}</button>
          <h2 className="text-xl font-bold text-slate-900 flex flex-wrap items-center gap-2">{c.title}<Pill className={c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}>{t(`support.cycleStatus.${c.status}`)}</Pill></h2>
          <p className="text-sm text-slate-500"><span dir="ltr">{c.startDay} → {c.endDay}</span> · {weekdaysText(t, c.weekdays)} <span dir="ltr">{time12(c.startTime)}–{time12(c.endTime)}</span> · {t('support.sessionsN', { n: c.sessions.length })} · {c.branches.length ? c.branches.map(branchName).join('، ') : t('common.allBranches')}</p>
        </div>
        {c.canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className={btn.ghost}><Pencil className="w-4 h-4" />{t('support.edit')}</button>
            {c.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => { if (window.confirm(t('support.closeConfirm'))) setStatus('close'); }} className={btn.ghost}><Lock className="w-4 h-4" />{t('support.close')}</button>
              : <button type="button" disabled={busy} onClick={() => setStatus('open')} className={btn.ghost}><Unlock className="w-4 h-4" />{t('support.reopen')}</button>}
            {c.status === 'CLOSED' && <button type="button" disabled={busy} onClick={remove} className={`${btn.ghost} text-rose-700 border-rose-200 hover:bg-rose-50`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{t('support.deleteCycle')}</button>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-1 w-fit max-w-full">
        {tabs.map(([k, Icon]) => <button key={k} type="button" onClick={() => { setTab(k); if (k === 'groups' && prog) openProg(null); }} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${tab === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="w-4 h-4" />{t(`support.tabs.${k}`)}</button>)}
      </div>
      {tab === 'dashboard' && <SupportDashboard data={data} branchName={branchName} groupName={groupName} reload={load} />}
      {tab === 'students' && <SupportStudents data={data} branchName={branchName} groupName={groupName} reload={load} />}
      {tab === 'groups' && (prog
        ? <SupportGroups data={data} type={prog} branchName={branchName} reload={load} onBack={() => openProg(null)} onOpen={(g) => openGroup(g, prog)} />
        : <SupportProgramTypes data={data} onOpen={openProg} branchName={branchName} reload={load} />)}
      {tab === 'supervisors' && c.canManage && <SupportSupervisors data={data} branchName={branchName} reload={load} />}
      {tab === 'attendance' && <SupportAttendance data={data} groupName={groupName} />}
      {editing && <CycleEditor initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}
