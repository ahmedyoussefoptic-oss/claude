import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, GraduationCap, Briefcase, AlertOctagon, PackageSearch, Wrench } from 'lucide-react';

const CATEGORY_META = [
  { key: 'academic', icon: GraduationCap, color: 'text-indigo-600 bg-indigo-100' },
  { key: 'administrative', icon: Briefcase, color: 'text-cyan-600 bg-cyan-100' },
  { key: 'behavioral', icon: AlertOctagon, color: 'text-rose-600 bg-rose-100' },
  { key: 'lostFound', icon: PackageSearch, color: 'text-teal-600 bg-teal-100' },
  { key: 'techSupport', icon: Wrench, color: 'text-violet-600 bg-violet-100' },
];

// SOLVED/CLOSED count as resolved, ESCALATED as escalated, REJECTED is
// excluded from all three buckets (neither solved nor "in progress").
function complaintBreakdown(list) {
  const resolved = list.filter((c) => c.status === 'SOLVED' || c.status === 'CLOSED').length;
  const escalated = list.filter((c) => c.status === 'ESCALATED').length;
  const rejected = list.filter((c) => c.status === 'REJECTED').length;
  return { total: list.length, resolved, escalated, inProgress: list.length - resolved - escalated - rejected };
}

// Tech tickets have no dedicated ESCALATED status — an SLA breach just flips
// isOverdue (see functions/index.js), so that flag stands in for "escalated".
function techBreakdown(list) {
  const resolved = list.filter((t) => t.status === 'CLOSED').length;
  const escalated = list.filter((t) => t.isOverdue && t.status !== 'CLOSED').length;
  return { total: list.length, resolved, escalated, inProgress: list.length - resolved - escalated };
}

// Lost & found has no SLA/escalation concept at all.
function lostFoundBreakdown(list) {
  const resolved = list.filter((i) => i.status === 'RETURNED').length;
  return { total: list.length, resolved, escalated: 0, inProgress: list.length - resolved };
}

export default function BranchIndicators({ branches, complaints, techTickets, lostFoundItems, showTechSupport = true }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(null);
  const categoryMeta = showTechSupport ? CATEGORY_META : CATEGORY_META.filter((c) => c.key !== 'techSupport');

  const rows = branches
    .map((b) => {
      const branchComplaints = complaints.filter((c) => c.branch === b.id);
      const branchLostFound = lostFoundItems.filter((i) => i.branch === b.id);
      const categories = {
        academic: complaintBreakdown(branchComplaints.filter((c) => c.complaintType === 'ACADEMIC')),
        administrative: complaintBreakdown(branchComplaints.filter((c) => c.complaintType === 'ADMINISTRATIVE')),
        behavioral: complaintBreakdown(branchComplaints.filter((c) => c.complaintType === 'BEHAVIORAL')),
        lostFound: lostFoundBreakdown(branchLostFound),
      };
      let total = branchComplaints.length + branchLostFound.length;
      if (showTechSupport) {
        const branchTech = techTickets.filter((t) => t.branch === b.id);
        categories.techSupport = techBreakdown(branchTech);
        total += branchTech.length;
      }
      return { id: b.id, name: b.name, total, categories };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  if (rows.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h3 className="text-lg font-bold text-slate-900">{t('dashboard.branchIndicatorsTitle')}</h3>
        <p className="text-sm text-slate-500 mt-1">{t('dashboard.branchIndicatorsSubtitle')}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => {
          const isOpen = expanded === row.id;
          return (
            <div key={row.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : row.id)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors text-right"
              >
                <div className="flex items-center gap-3">
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  <span className="font-medium text-slate-800">{row.name}</span>
                </div>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{t('dashboard.totalSuffix', { count: row.total })}</span>
              </button>
              {isOpen && (
                <div className="px-6 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {categoryMeta.map(({ key, icon: Icon, color }) => {
                    const c = row.categories[key];
                    return (
                      <div key={key} className="rounded-xl border border-slate-100 p-3.5 bg-slate-50/60">
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${color}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <span className="text-sm font-medium text-slate-700 truncate">{t(`dashboard.categories.${key}`)}</span>
                          <span className="text-xs text-slate-400 mr-auto tabular-nums shrink-0">{c.total}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-center">
                          <div>
                            <p className="text-sm font-bold text-emerald-600 tabular-nums">{c.resolved}</p>
                            <p className="text-[10px] text-slate-400">{t('reports.resolvedCount')}</p>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-amber-600 tabular-nums">{c.inProgress}</p>
                            <p className="text-[10px] text-slate-400">{t('statuses.complaint.IN_PROGRESS')}</p>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-orange-600 tabular-nums">{c.escalated}</p>
                            <p className="text-[10px] text-slate-400">{t('statuses.complaint.ESCALATED')}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
