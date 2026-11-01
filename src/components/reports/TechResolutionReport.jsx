import { useTranslation } from 'react-i18next';
import { KeyRound, Wrench } from 'lucide-react';
import { formatDuration } from '../../utils/duration';
import { ticketChannelRows, ticketChannelByEmployee } from '../../utils/reportMetrics';

const CHANNEL_STYLE = {
  ACCOUNTS: { icon: KeyRound, color: 'text-emerald-600' },
  ASSIGNED: { icon: Wrench, color: 'text-violet-600' },
};

// Tech report: tickets solved straight from «حسابات الطلاب» against those
// solved by the people they were assigned to. The same helpers feed Excel.
export default function TechResolutionReport({ tickets, sla }) {
  const { t } = useTranslation();
  const rows = ticketChannelRows(tickets, sla);
  const employees = ticketChannelByEmployee(tickets, t('reports.unassigned'));
  const th = 'text-right py-2 px-2 font-medium';
  const td = 'py-2 px-2 text-slate-800 tabular-nums';

  return (
    <div className="space-y-6">
      <div className="break-inside-avoid">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-1">{t('reports.channels.title')}</h3>
        <p className="text-xs text-slate-500 mb-3">{t('reports.channels.sub')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {rows.map((r) => {
            const { icon: Icon, color } = CHANNEL_STYLE[r.id];
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 p-4 flex items-center gap-4">
                <Icon className={`w-6 h-6 shrink-0 ${color}`} />
                <div>
                  <p className={`text-2xl font-bold ${color}`}>{r.resolved}</p>
                  <p className="text-xs text-slate-500 mt-1">{t(`reports.channels.${r.id}`)}</p>
                  {r.share != null && <p className="text-xs text-slate-400 mt-0.5">{t('reports.channels.shareOfResolved', { pct: r.share })}</p>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className={th}>{t('reports.channels.method')}</th>
                <th className={th}>{t('reports.full.colTotal')}</th>
                <th className={th}>{t('reports.resolvedCount')}</th>
                <th className={th}>{t('reports.channels.notSent')}</th>
                <th className={th}>{t('statuses.techSupport.IN_PROGRESS')}</th>
                <th className={th}>{t('dashboard.overdueTechTickets')}</th>
                <th className={th}>{t('reports.avgResolutionTime')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 px-2 text-slate-800">{t(`reports.channels.${r.id}`)}</td>
                  <td className={td}>{r.total}</td>
                  <td className={td}>{r.resolved}</td>
                  <td className={`${td} ${r.notSent > 0 ? 'text-amber-600 font-bold' : ''}`}>{r.notSent}</td>
                  <td className={td}>{r.inProgress}</td>
                  <td className={td}>{r.overdue}</td>
                  <td className="py-2 px-2 text-slate-800">{formatDuration(r.avgResolutionMs, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {employees.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-1">{t('reports.channels.byEmployee')}</h3>
          <p className="text-xs text-slate-500 mb-3">{t('reports.channels.byEmployeeSub')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className={th}>{t('reports.employeeLabel')}</th>
                  <th className={th}>{t('reports.channels.short.ACCOUNTS')}</th>
                  <th className={th}>{t('reports.channels.short.ASSIGNED')}</th>
                  <th className={th}>{t('reports.full.colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.name} className="border-b border-slate-100">
                    <td className="py-2 px-2 text-slate-800">{e.name}</td>
                    <td className={td}>{e.ACCOUNTS}</td>
                    <td className={td}>{e.ASSIGNED}</td>
                    <td className={`${td} font-bold`}>{e.ACCOUNTS + e.ASSIGNED}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
