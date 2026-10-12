import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { UserPlus, Plus, Loader2, Search, LayoutGrid, List, FileBarChart, AlertTriangle, CalendarClock, Link2, Copy, Check, GraduationCap, TrendingUp } from 'lucide-react';
import { format, isThisWeek, isThisMonth } from 'date-fns';
import { db } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { useSlaSettings } from '../../utils/businessTime';
import { LEAD_STAGES, LEAD_SOURCES, STAGE_COLORS, SIDE_STYLES, usePlatformSettings } from '../../config/platform';
import { Tile, Pill, btn } from '../../components/platform/ui';
import LeadForm from '../../components/platform/LeadForm';
import LeadDetails from '../../components/platform/LeadDetails';
import LeadsReport from '../../components/platform/LeadsReport';
import { leadOpen, stageOverdue, followUpOverdue, tsMs } from '../../components/platform/leadUtils';

// العملاء الجدد — every enquiry about enrolling becomes a file that moves
// through nine stages until the student is enrolled (or is closed with a
// documented reason), with a mandatory next follow-up.
export default function Leads() {
  const { t } = useTranslation();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const settings = usePlatformSettings();
  const slaCfg = useSlaSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState(null);
  const [view, setView] = useState('board');
  const [branch, setBranch] = useState('');
  const [source, setSource] = useState('');
  const [assignee, setAssignee] = useState('');
  const [term, setTerm] = useState('');
  const [quick, setQuick] = useState('OPEN'); // OPEN | OVERDUE | FOLLOWUP_TODAY | CLOSED | ALL
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState(false);
  const openId = searchParams.get('openId');
  const setOpenId = (id) => setSearchParams(id ? { openId: id } : {});

  useEffect(() => onSnapshot(query(collection(db, 'leads'), orderBy('createdAt', 'desc')), (snap) => {
    setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => setLeads([])), []);

  const now = Date.now();
  const isLate = (l) => stageOverdue(l, settings, slaCfg, now) || followUpOverdue(l, now);
  const dueToday = (l) => leadOpen(l) && tsMs(l.nextFollowUp) && new Date(tsMs(l.nextFollowUp)).toDateString() === new Date().toDateString();
  const assignees = useMemo(() => [...new Set((leads || []).map((l) => l.assignedToName).filter(Boolean))].sort(), [leads]);

  const filtered = useMemo(() => (leads || []).filter((l) => {
    if (branch && l.branch !== branch) return false;
    if (source && l.source !== source) return false;
    if (assignee && l.assignedToName !== assignee) return false;
    const q = term.trim();
    if (q && !`${l.parentName} ${l.phone} 0${String(l.phone).slice(3)} ${l.code} ${(l.students || []).map((s) => s.name).join(' ')}`.includes(q)) return false;
    return true;
  }), [leads, branch, source, assignee, term]);

  const shown = filtered.filter((l) => ({
    OPEN: leadOpen(l), OVERDUE: leadOpen(l) && isLate(l), FOLLOWUP_TODAY: dueToday(l), CLOSED: !leadOpen(l), ALL: true,
  }[quick]));

  const stats = {
    open: filtered.filter(leadOpen).length,
    overdue: filtered.filter((l) => leadOpen(l) && isLate(l)).length,
    today: filtered.filter(dueToday).length,
    newWeek: filtered.filter((l) => l.createdAt?.toDate && isThisWeek(l.createdAt.toDate(), { weekStartsOn: 0 })).length,
    enrolledMonth: filtered.filter((l) => l.stage === 'ENROLLED' && l.enrolledAt?.toDate && isThisMonth(l.enrolledAt.toDate())).length,
  };
  const selected = (leads || []).find((l) => l.id === openId);
  const link = `${window.location.origin}/join`;
  const select = (value, onChange, options, all) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
      <option value="">{all}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  const card = (l) => {
    const late = isLate(l);
    return (
      <button key={l.id} onClick={() => setOpenId(l.id)} className={`w-full text-start bg-white border rounded-xl p-3 shadow-sm hover:shadow-md transition ${late ? 'border-rose-200' : 'border-slate-100'}`}>
        <p className="font-medium text-slate-900 text-sm flex items-center gap-1.5">{l.parentName}{late && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}</p>
        <p className="text-xs text-slate-500 mt-0.5" dir="ltr">{(l.students || []).map((s) => s.grade).filter(Boolean).join(' · ') || '—'}</p>
        <p className="text-[11px] text-slate-400 mt-1">{branchName(l.branch)} · {t(`platform.leads.sources.${l.source}`, l.source)}</p>
        {l.sideStatus && <Pill className={`${SIDE_STYLES[l.sideStatus]} border-transparent mt-1`}>{t(`platform.leads.side.${l.sideStatus}`)}</Pill>}
        {l.nextFollowUp?.toDate && leadOpen(l) && <p className={`text-[11px] mt-1 flex items-center gap-1 ${followUpOverdue(l, now) ? 'text-rose-600' : 'text-slate-500'}`}><CalendarClock className="w-3 h-3" /><span dir="ltr">{format(l.nextFollowUp.toDate(), 'dd/MM HH:mm')}</span></p>}
      </button>
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><UserPlus className="w-6 h-6 text-primary" />{t('platform.leads.title')}</h1>
          <p className="text-slate-500 mt-1">{t('platform.leads.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }} className={btn.ghost}>{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Link2 className="w-4 h-4" />}{t('platform.leads.copyFormLink')}</button>
          <button onClick={() => setShowForm(true)} className={btn.primary}><Plus className="w-4 h-4" />{t('platform.leads.new')}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label={t('platform.leads.statOpen')} value={stats.open} icon={UserPlus} onClick={() => setQuick('OPEN')} active={quick === 'OPEN'} />
        <Tile label={t('platform.leads.statOverdue')} value={stats.overdue} icon={AlertTriangle} tone="text-rose-600" onClick={() => setQuick('OVERDUE')} active={quick === 'OVERDUE'} />
        <Tile label={t('platform.leads.statToday')} value={stats.today} icon={CalendarClock} tone="text-amber-600" onClick={() => setQuick('FOLLOWUP_TODAY')} active={quick === 'FOLLOWUP_TODAY'} />
        <Tile label={t('platform.leads.statNewWeek')} value={stats.newWeek} icon={TrendingUp} tone="text-sky-700" />
        <Tile label={t('platform.leads.statEnrolledMonth')} value={stats.enrolledMonth} icon={GraduationCap} tone="text-emerald-700" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {[['board', LayoutGrid], ['list', List], ['report', FileBarChart]].map(([v, Icon]) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view === v ? 'bg-white shadow-sm text-primary font-medium' : 'text-slate-600'}`}><Icon className="w-4 h-4" />{t(`platform.leads.view.${v}`)}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-2.5" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('platform.leads.search')} className="pr-8 pl-3 py-1.5 border border-slate-200 rounded-lg text-sm w-52" />
          </div>
          {select(branch, setBranch, branches.map((b) => [b.id, b.name]), t('common.allBranches'))}
          {select(source, setSource, LEAD_SOURCES.map((s) => [s, t(`platform.leads.sources.${s}`)]), t('platform.leads.allSources'))}
          {select(assignee, setAssignee, assignees.map((a) => [a, a]), t('platform.leads.allAssignees'))}
          {view !== 'report' && select(quick === 'OPEN' ? '' : quick, (v) => setQuick(v || 'OPEN'), [['OVERDUE', t('platform.leads.statOverdue')], ['FOLLOWUP_TODAY', t('platform.leads.statToday')], ['CLOSED', t('platform.leads.closed')], ['ALL', t('platform.leads.all')]], t('platform.leads.statOpen'))}
        </div>

        {!leads ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          : view === 'report' ? <div className="p-4"><LeadsReport leads={filtered} settings={settings} slaCfg={slaCfg} branchName={branchName} /></div>
            : view === 'board' ? (
              <div className="p-4 overflow-x-auto">
                <div className="flex gap-3 min-w-max">
                  {LEAD_STAGES.map((s) => {
                    const col = shown.filter((l) => l.stage === s);
                    return (
                      <div key={s} className="w-56 shrink-0 bg-slate-50 rounded-2xl p-2">
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5 px-1 mb-2"><span className={`w-2 h-2 rounded-full ${STAGE_COLORS[s]}`} />{t(`platform.leads.stages.${s}`)}<span className="text-slate-400 font-normal">({col.length})</span></p>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">{col.map(card)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : shown.length === 0 ? <p className="py-16 text-center text-slate-400 text-sm">{t('platform.leads.empty')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
                    {[t('platform.code'), t('platform.leads.form.parentName'), t('platform.leads.form.students'), t('common.branch'), t('platform.leads.stage'), t('platform.leads.form.source'), t('platform.leads.form.assignedTo'), t('platform.leads.nextFollowUp')].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((l) => (
                      <tr key={l.id} onClick={() => setOpenId(l.id)} className={`cursor-pointer hover:bg-slate-50 ${isLate(l) ? 'bg-rose-50/40' : ''}`}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500" dir="ltr">{l.code}</td>
                        <td className="px-3 py-2"><p className="font-medium text-slate-900">{l.parentName}</p><p className="text-xs text-slate-400" dir="ltr">0{String(l.phone).slice(3)}</p></td>
                        <td className="px-3 py-2 text-slate-600">{(l.students || []).map((s) => `${s.name || ''} ${s.grade || ''}`.trim()).join('، ')}</td>
                        <td className="px-3 py-2 text-slate-600">{branchName(l.branch)}</td>
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-xs"><span className={`w-2 h-2 rounded-full ${STAGE_COLORS[l.stage]}`} />{t(`platform.leads.stages.${l.stage}`)}</span>{l.sideStatus && <Pill className={`${SIDE_STYLES[l.sideStatus]} border-transparent mr-1`}>{t(`platform.leads.side.${l.sideStatus}`)}</Pill>}</td>
                        <td className="px-3 py-2 text-slate-600">{t(`platform.leads.sources.${l.source}`, l.source)}</td>
                        <td className="px-3 py-2 text-slate-600">{l.assignedToName || '—'}</td>
                        <td className={`px-3 py-2 text-xs ${followUpOverdue(l, now) ? 'text-rose-600 font-medium' : 'text-slate-500'}`} dir="ltr">{l.nextFollowUp?.toDate ? format(l.nextFollowUp.toDate(), 'yyyy-MM-dd HH:mm') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      {showForm && <LeadForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); setOpenId(id); }} />}
      {selected && <LeadDetails lead={selected} onClose={() => setOpenId(null)} />}
    </div>
  );
}
