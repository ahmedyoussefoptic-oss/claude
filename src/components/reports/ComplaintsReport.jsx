import { useTranslation } from 'react-i18next';
import { FileText, Clock, AlertTriangle, CheckCircle2, Star, Gauge, Repeat, TrendingUp, ShieldCheck, Ban, Percent, Wrench, ShieldAlert, GraduationCap, Briefcase, AlertOctagon, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatDuration } from '../../utils/duration';
import { isEscalatedResolved, complaintStatusLabel, complaintHasType, complaintTypesLabel } from '../../config/complaintTypes';
import { isTicketEscalatedResolved } from '../../config/techSupport';
import { complaintMetrics, ticketMetrics } from '../../utils/reportMetrics';

const TYPE_ICONS = { ACADEMIC: GraduationCap, ADMINISTRATIVE: Briefcase, BEHAVIORAL: AlertOctagon };
const TYPE_GRADIENTS = { ACADEMIC: 'from-indigo-500 to-violet-600', ADMINISTRATIVE: 'from-cyan-500 to-teal-600', BEHAVIORAL: 'from-rose-500 to-pink-600' };

function Box({ title, value, sub, icon: Icon, gradient }) {
  return (
    <div className="relative overflow-hidden bg-white rounded-xl p-4 border border-slate-200 break-inside-avoid">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-gradient-to-br ${gradient} text-white`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div className="mb-3 border-r-4 border-primary pr-3">
      <h3 className="text-base font-bold text-slate-900">{children}</h3>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

const pct = (v) => (v == null ? '—' : `${v}%`);
const num = (v) => (v ? v : <span className="text-slate-300">0</span>);

export default function ComplaintsReport({
  complaints, tickets, includeTech, showDetails, branches, complaintTypes, singleBranch,
  onOpenComplaint, onOpenTicket, problemTypeName,
}) {
  const { t } = useTranslation();
  const listSep = t('publicReport.listSeparator');
  const m = complaintMetrics(complaints);
  const tm = ticketMetrics(tickets);
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;
  const dur = (ms) => formatDuration(ms, t);
  const sat = (v) => (v == null ? '—' : `${v.toFixed(1)} / 5`);

  const branchRows = branches
    .map((b) => {
      const bc = complaints.filter((c) => c.branch === b.id);
      const bt = includeTech ? tickets.filter((tk) => tk.branch === b.id) : [];
      return {
        id: b.id,
        name: b.name,
        m: complaintMetrics(bc),
        tm: ticketMetrics(bt),
        types: complaintTypes.map((ct) => ({ ...ct, m: complaintMetrics(bc.filter((c) => complaintHasType(c, ct.id))) })),
      };
    })
    .filter((r) => r.m.total + r.tm.total > 0)
    .sort((a, b) => (b.m.total + b.tm.total) - (a.m.total + a.tm.total));
  const maxBranchTotal = Math.max(1, ...branchRows.map((r) => r.m.total));

  const byType = complaintTypes.map((ct) => ({ ...ct, m: complaintMetrics(complaints.filter((c) => complaintHasType(c, ct.id))) })).filter((ct) => ct.m.total > 0);
  const subTypeCounts = {};
  complaints.forEach((c) => {
    [{ type: c.complaintType, subType: c.subType }, ...(c.extraTypes || [])].forEach((r) => {
      if (r?.type && r.subType) subTypeCounts[`${r.type}|${r.subType}`] = (subTypeCounts[`${r.type}|${r.subType}`] || 0) + 1;
    });
  });
  const multiCategoryCount = complaints.filter((c) => (c.extraTypes || []).length > 0).length;
  const bySubType = Object.entries(subTypeCounts).map(([k, count]) => { const [type, name] = k.split('|'); return { type, name, count }; }).sort((a, b) => b.count - a.count);

  const statusCols = [
    { key: 'total', label: t('reports.full.colTotal'), cls: 'font-bold text-slate-900' },
    { key: 'resolved', label: t('reports.resolvedCount'), cls: 'text-emerald-700' },
    { key: 'inProgress', label: t('statuses.complaint.IN_PROGRESS'), cls: 'text-amber-700' },
    { key: 'escalatedOpen', label: t('reports.full.escalatedOpen'), cls: 'text-orange-700' },
    { key: 'escalatedResolved', label: t('statuses.complaint.ESCALATED_RESOLVED'), cls: 'text-teal-700' },
    { key: 'overdue', label: t('reports.full.overdue'), cls: 'text-red-700' },
    { key: 'rejected', label: t('statuses.complaint.REJECTED'), cls: 'text-slate-600' },
  ];

  const th = 'text-right py-2 px-2 font-medium text-slate-500 text-xs whitespace-nowrap';
  const td = 'py-2 px-2 tabular-nums';
  // Comparison table has up to 14 columns — headers wrap and cells are
  // tighter so it fits an A4 page width.
  const thWrap = 'text-right py-2 px-1.5 font-medium text-slate-500 text-[11px] leading-tight align-bottom';
  const tdc = 'py-1.5 px-1.5 tabular-nums';

  return (
    <>
      {/* 1. Summary boxes — same indicators as the dashboard */}
      <section>
        <SectionTitle>{t('reports.generalSummary')}</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4">
          <Box title={t('dashboard.totalComplaints')} value={m.total} icon={FileText} gradient="from-sky-500 to-blue-600" />
          <Box title={t('dashboard.inProgress')} value={m.inProgress} icon={Clock} gradient="from-amber-400 to-orange-500" />
          <Box title={t('dashboard.overdue')} value={m.overdue} icon={AlertTriangle} gradient="from-red-500 to-rose-600" />
          <Box title={t('dashboard.solved')} value={m.resolved} sub={t('reports.full.ofTotal', { rate: pct(m.resolutionRate) })} icon={CheckCircle2} gradient="from-emerald-500 to-teal-600" />
          <Box title={t('dashboard.satisfaction')} value={sat(m.satisfaction)} sub={m.satisfactionCount ? t('dashboard.basedOnSurveys', { count: m.satisfactionCount }) : t('dashboard.noSurveys')} icon={Star} gradient="from-amber-400 to-yellow-500" />
          <Box title={t('dashboard.avgResolution')} value={dur(m.avgResolutionMs)} sub={t('dashboard.sinceReceipt')} icon={Clock} gradient="from-cyan-500 to-sky-600" />
          <Box title={t('dashboard.slaCompliance')} value={pct(m.slaCompliance)} sub={t('dashboard.slaSub')} icon={Gauge} gradient="from-green-500 to-emerald-600" />
          <Box title={t('dashboard.reopened')} value={m.reopened} sub={t('dashboard.reopenedSub')} icon={Repeat} gradient="from-orange-500 to-red-500" />
          <Box title={t('reports.full.escalatedOpen')} value={m.escalatedOpen} sub={t('reports.full.escalatedOpenSub')} icon={TrendingUp} gradient="from-orange-500 to-amber-600" />
          <Box title={t('statuses.complaint.ESCALATED_RESOLVED')} value={m.escalatedResolved} icon={ShieldCheck} gradient="from-teal-500 to-emerald-600" />
          <Box title={t('statuses.complaint.REJECTED')} value={m.rejected} icon={Ban} gradient="from-slate-400 to-slate-600" />
          <Box title={t('reports.full.resolutionRate')} value={pct(m.resolutionRate)} icon={Percent} gradient="from-blue-500 to-indigo-600" />
        </div>

        <p className="text-xs font-bold text-slate-400 mt-5 mb-2">
          {t('dashboard.byType')}
          {multiCategoryCount > 0 && <span className="font-normal"> — {t('reports.full.multiCategoryNote', { count: multiCategoryCount })}</span>}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {complaintTypes.map((ct) => (
            <Box
              key={ct.id}
              title={typeName(ct.id)}
              value={complaints.filter((c) => complaintHasType(c, ct.id)).length}
              icon={TYPE_ICONS[ct.id] || FileText}
              gradient={TYPE_GRADIENTS[ct.id] || 'from-slate-400 to-slate-600'}
            />
          ))}
        </div>

        {includeTech && (
          <>
            <p className="text-xs font-bold text-slate-400 mt-5 mb-2">{t('reports.full.techSection')}</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 print:grid-cols-5">
              <Box title={t('reports.totalTickets')} value={tm.total} icon={Wrench} gradient="from-violet-500 to-purple-600" />
              <Box title={t('reports.resolvedCount')} value={tm.resolved} sub={t('reports.full.ofTotal', { rate: pct(tm.resolutionRate) })} icon={CheckCircle2} gradient="from-emerald-500 to-teal-600" />
              <Box title={t('statuses.techSupport.IN_PROGRESS')} value={tm.inProgress} icon={Clock} gradient="from-amber-400 to-orange-500" />
              <Box title={t('dashboard.overdueTechTickets')} value={tm.overdue} icon={ShieldAlert} gradient="from-fuchsia-500 to-pink-600" />
              <Box title={t('reports.avgResolutionTime')} value={dur(tm.avgResolutionMs)} icon={Clock} gradient="from-cyan-500 to-sky-600" />
            </div>
          </>
        )}
      </section>

      {/* 2. Per-branch detailed counters */}
      {branchRows.length > 0 && (
        <section>
          <SectionTitle sub={t('reports.full.perBranchSub')}>{t('reports.full.perBranchTitle')}</SectionTitle>
          <div className="space-y-4">
            {branchRows.map((r) => {
              const rows = [
                ...r.types.map((ct) => ({ key: ct.id, label: typeName(ct.id), m: ct.m })),
                ...(includeTech ? [{ key: 'TECH', label: t('dashboard.categories.techSupport'), m: r.tm }] : []),
              ];
              const totalRow = {
                total: r.m.total + r.tm.total,
                resolved: r.m.resolved + r.tm.resolved,
                inProgress: r.m.inProgress + r.tm.inProgress,
                escalatedOpen: r.m.escalatedOpen + r.tm.escalatedOpen,
                escalatedResolved: r.m.escalatedResolved + r.tm.escalatedResolved,
                overdue: r.m.overdue + r.tm.overdue,
                rejected: r.m.rejected,
              };
              return (
                <div key={r.id} className="rounded-xl border border-slate-200 overflow-hidden break-inside-avoid">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                    <p className="font-bold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary" />
                      {r.name}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>{t('reports.full.resolutionRate')}: <b className="text-slate-900">{pct(r.m.resolutionRate)}</b></span>
                      <span>{t('dashboard.avgResolution')}: <b className="text-slate-900">{dur(r.m.avgResolutionMs)}</b></span>
                      <span>{t('dashboard.slaCompliance')}: <b className="text-slate-900">{pct(r.m.slaCompliance)}</b></span>
                      <span>{t('dashboard.satisfaction')}: <b className="text-slate-900">{sat(r.m.satisfaction)}</b></span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className={th}>{t('reports.full.category')}</th>
                          {statusCols.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.key} className="border-b border-slate-100">
                            <td className="py-2 px-2 text-slate-800 whitespace-nowrap">{row.label}</td>
                            {statusCols.map((c) => <td key={c.key} className={`${td} ${c.cls}`}>{num(row.m[c.key])}</td>)}
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold">
                          <td className="py-2 px-2 text-slate-900">{t('reports.full.totalRow')}</td>
                          {statusCols.map((c) => <td key={c.key} className={`${td} ${c.cls}`}>{num(totalRow[c.key])}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Branch comparison */}
      {!singleBranch && branchRows.length > 1 && (
        <section className="break-inside-avoid">
          <SectionTitle sub={t('reports.full.comparisonSub')}>{t('reports.full.comparisonTitle')}</SectionTitle>
          <div className="space-y-2 mb-5">
            {branchRows.map((r) => {
              const { total, resolved } = r.m;
              return (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 truncate text-slate-700">{r.name}</span>
                  <div className="flex-1">
                    <div className="h-5 rounded-md overflow-hidden flex" style={{ width: `${Math.max(2, (total / maxBranchTotal) * 100)}%` }}>
                      <div className="h-full bg-emerald-500" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
                      <div className="h-full bg-amber-400 flex-1" />
                    </div>
                  </div>
                  <span className="w-24 shrink-0 text-xs text-slate-600 tabular-nums">{t('reports.full.resolvedOfTotal', { resolved, total })}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500" />{t('reports.resolvedCount')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400" />{t('reports.full.notResolved')}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={thWrap}>{t('common.branch')}</th>
                  <th className={thWrap}>{t('reports.full.colTotal')}</th>
                  <th className={thWrap}>{t('reports.full.sharePct')}</th>
                  <th className={thWrap}>{t('reports.resolvedCount')}</th>
                  <th className={thWrap}>{t('reports.full.resolutionRate')}</th>
                  <th className={thWrap}>{t('statuses.complaint.IN_PROGRESS')}</th>
                  <th className={thWrap}>{t('reports.full.escalatedOpen')}</th>
                  <th className={thWrap}>{t('statuses.complaint.ESCALATED_RESOLVED')}</th>
                  <th className={thWrap}>{t('reports.full.overdue')}</th>
                  <th className={thWrap}>{t('reports.avgResolutionTime')}</th>
                  <th className={thWrap}>{t('dashboard.slaCompliance')}</th>
                  <th className={thWrap}>{t('reports.satisfactionAvg')}</th>
                  {includeTech && <th className={thWrap}>{t('reports.full.techTotalCol')}</th>}
                  {includeTech && <th className={thWrap}>{t('reports.full.techResolvedCol')}</th>}
                </tr>
              </thead>
              <tbody>
                {branchRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 px-2 text-slate-800 whitespace-nowrap font-medium">{r.name}</td>
                    <td className={`${tdc} font-bold`}>{r.m.total}</td>
                    <td className={`${tdc} text-slate-500`}>{m.total ? `${Math.round((r.m.total / m.total) * 100)}%` : '—'}</td>
                    <td className={`${tdc} text-emerald-700`}>{num(r.m.resolved)}</td>
                    <td className={`${tdc} font-bold`}>{pct(r.m.resolutionRate)}</td>
                    <td className={`${tdc} text-amber-700`}>{num(r.m.inProgress)}</td>
                    <td className={`${tdc} text-orange-700`}>{num(r.m.escalatedOpen)}</td>
                    <td className={`${tdc} text-teal-700`}>{num(r.m.escalatedResolved)}</td>
                    <td className={`${tdc} text-red-700`}>{num(r.m.overdue)}</td>
                    <td className={`${tdc} text-slate-600 whitespace-nowrap`}>{dur(r.m.avgResolutionMs)}</td>
                    <td className={`${tdc} text-slate-600`}>{pct(r.m.slaCompliance)}</td>
                    <td className={`${tdc} text-slate-600 whitespace-nowrap`}>{sat(r.m.satisfaction)}</td>
                    {includeTech && <td className={`${tdc} text-violet-700`}>{num(r.tm.total)}</td>}
                    {includeTech && <td className={`${tdc} text-emerald-700`}>{num(r.tm.resolved)}</td>}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className="py-2 px-2 text-slate-900">{t('reports.full.totalRow')}</td>
                  <td className={tdc}>{m.total}</td>
                  <td className={tdc}>100%</td>
                  <td className={`${tdc} text-emerald-700`}>{m.resolved}</td>
                  <td className={tdc}>{pct(m.resolutionRate)}</td>
                  <td className={`${tdc} text-amber-700`}>{m.inProgress}</td>
                  <td className={`${tdc} text-orange-700`}>{m.escalatedOpen}</td>
                  <td className={`${tdc} text-teal-700`}>{m.escalatedResolved}</td>
                  <td className={`${tdc} text-red-700`}>{m.overdue}</td>
                  <td className={`${tdc} whitespace-nowrap`}>{dur(m.avgResolutionMs)}</td>
                  <td className={tdc}>{pct(m.slaCompliance)}</td>
                  <td className={`${tdc} whitespace-nowrap`}>{sat(m.satisfaction)}</td>
                  {includeTech && <td className={`${tdc} text-violet-700`}>{tm.total}</td>}
                  {includeTech && <td className={`${tdc} text-emerald-700`}>{tm.resolved}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. By type / sub-type */}
      {byType.length > 0 && (
        <section className="break-inside-avoid">
          <SectionTitle>{t('reports.byComplaintType')}</SectionTitle>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('common.type')}</th>
                {statusCols.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
                <th className={th}>{t('reports.percentLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((ct) => (
                <tr key={ct.id} className="border-b border-slate-100">
                  <td className="py-2 px-2 text-slate-800">{ct.name}</td>
                  {statusCols.map((c) => <td key={c.key} className={`${td} ${c.cls}`}>{num(ct.m[c.key])}</td>)}
                  <td className={`${td} text-slate-500`}>{m.total ? Math.round((ct.m.total / m.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bySubType.length > 0 && (
        <section className="break-inside-avoid">
          <SectionTitle>{t('reports.bySubType')}</SectionTitle>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('complaintForm.subTypeLabel')}</th>
                <th className={th}>{t('common.type')}</th>
                <th className={th}>{t('reports.countLabel')}</th>
                <th className={th}>{t('reports.percentLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {bySubType.map((s) => (
                <tr key={`${s.type}|${s.name}`} className="border-b border-slate-100">
                  <td className="py-2 px-2 text-slate-800">{s.name}</td>
                  <td className="py-2 px-2 text-slate-500">{typeName(s.type)}</td>
                  <td className={`${td} text-slate-800`}>{s.count}</td>
                  <td className={`${td} text-slate-500`}>{m.total ? Math.round((s.count / m.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 5. Optional detailed listing */}
      {showDetails && (
        <section>
          <SectionTitle>{t('reports.detailsLabel')} ({complaints.length + (includeTech ? tickets.length : 0)})</SectionTitle>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t('reports.full.recordNumber')}</th>
                <th className={th}>{t('common.date')}</th>
                <th className={th}>{t('common.branch')}</th>
                <th className={th}>{t('common.type')}</th>
                <th className={th}>{t('reports.specialistShort')}</th>
                <th className={th}>{t('common.status')}</th>
                <th className={th}>{t('reports.resolutionTime')}</th>
                <th className={th}>{t('reports.studentNameColumn')}</th>
                <th className={th}>{t('reports.stageColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id} onClick={() => onOpenComplaint(c)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50">
                  <td className="py-1.5 px-2 text-slate-800" dir="ltr">{c.complaintId}</td>
                  <td className="py-1.5 px-2 text-slate-600" dir="ltr">{c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{branchName(c.branch)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{complaintTypesLabel(c, typeName, listSep)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{c.assignedToNames?.join(listSep) || '—'}</td>
                  <td className={`py-1.5 px-2 ${isEscalatedResolved(c) ? 'text-teal-700 font-medium' : 'text-slate-600'}`}>{complaintStatusLabel(c, t)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{c.solvedAt && c.createdAt ? dur(c.solvedAt.toMillis() - c.createdAt.toMillis()) : '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{c.studentName || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{c.stage || '—'}</td>
                </tr>
              ))}
              {includeTech && tickets.map((tk) => (
                <tr key={tk.id} onClick={() => onOpenTicket(tk)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50">
                  <td className="py-1.5 px-2 text-slate-800" dir="ltr">{tk.ticketId}</td>
                  <td className="py-1.5 px-2 text-slate-600" dir="ltr">{tk.createdAt?.toDate ? format(tk.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{branchName(tk.branch)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{t('dashboard.categories.techSupport')} — {problemTypeName(tk.problemType)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{tk.assignedToNames?.join(listSep) || '—'}</td>
                  <td className={`py-1.5 px-2 ${isTicketEscalatedResolved(tk) ? 'text-teal-700 font-medium' : 'text-slate-600'}`}>
                    {isTicketEscalatedResolved(tk) ? t('statuses.complaint.ESCALATED_RESOLVED') : t(`statuses.techSupport.${tk.status}`, tk.status)}
                  </td>
                  <td className="py-1.5 px-2 text-slate-600">{tk.resolutionMessageSentAt && tk.createdAt ? dur(tk.resolutionMessageSentAt.toMillis() - tk.createdAt.toMillis()) : '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{tk.studentName || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{tk.stage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
