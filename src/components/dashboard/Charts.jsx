import { useTranslation } from 'react-i18next';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const DUMMY_DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const DUMMY_VALUES = [12, 19, 15, 22, 18, 25, 10];

export function TrendChart({ data, title }) {
  const { t } = useTranslation();
  const dummyData = DUMMY_DAY_KEYS.map((key, i) => ({ name: t(`charts.days.${key}`), value: DUMMY_VALUES[i] }));
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900 mb-6">{title ?? t('charts.weeklyComplaintRate')}</h3>
      <div className="h-72 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data ?? dummyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
            />
            <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Rank-tinted styling for the top 3 branches — everything past that falls
// back to a plain numbered chip and a neutral blue bar.
const RANK_STYLES = [
  { badge: '🥇', bar: 'from-amber-400 to-orange-500', chip: 'bg-amber-100 text-amber-700 border-amber-200', row: 'bg-amber-50/70 ring-1 ring-amber-200' },
  { badge: '🥈', bar: 'from-slate-300 to-slate-400', chip: 'bg-slate-100 text-slate-600 border-slate-200', row: '' },
  { badge: '🥉', bar: 'from-orange-300 to-amber-500', chip: 'bg-orange-100 text-orange-700 border-orange-200', row: '' },
];
const DEFAULT_BAR = 'from-sky-400 to-blue-500';

export function BranchChart({ data, title }) {
  const { t } = useTranslation();
  const defaultData = [
    { name: t('charts.defaultBranches.boysGeneral'), value: 45 },
    { name: t('charts.defaultBranches.girlsGeneral'), value: 30 },
    { name: t('charts.defaultBranches.boysInternational'), value: 25 },
    { name: t('charts.defaultBranches.girlsInternational'), value: 20 },
  ];
  const rows = data && data.length ? data : defaultData;
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const maxValue = Math.max(...rows.map((r) => r.value), 1);
  const hasSpread = total > 0 && rows.length > 1 && rows[0].value > 0;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-900">{title ?? t('charts.complaintsByBranch')}</h3>
        {total > 0 && <span className="text-xs text-slate-400">{t('dashboard.totalSuffix', { count: total })}</span>}
      </div>

      {total === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">{t('charts.notEnoughData')}</p>
      ) : (
        <div className="space-y-3.5">
          {rows.map((row, i) => {
            const pct = Math.round((row.value / total) * 100);
            const widthPct = Math.max(4, Math.round((row.value / maxValue) * 100));
            const style = RANK_STYLES[i];
            const isTop = i === 0 && hasSpread;
            return (
              <div key={row.name} className={`rounded-xl p-2.5 transition-colors ${isTop ? RANK_STYLES[0].row : 'hover:bg-slate-50'}`}>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {style ? (
                      <span className="text-base leading-none shrink-0">{style.badge}</span>
                    ) : (
                      <span className="w-5 h-5 shrink-0 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                    )}
                    <span className="text-sm font-medium text-slate-800 truncate">{row.name}</span>
                    {isTop && (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                        {t('charts.mostComplaints')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{row.value}</span>
                    <span className="text-xs text-slate-400 tabular-nums">({pct}%)</span>
                  </div>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${style ? style.bar : DEFAULT_BAR} transition-all duration-700 ease-out`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
