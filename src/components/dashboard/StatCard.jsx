import { useNavigate } from 'react-router-dom';

export default function StatCard({ title, value, icon: Icon, trend, trendLabel, sub, gradient = 'from-sky-500 to-blue-600', to }) {
  const navigate = useNavigate();
  const clickable = !!to;

  return (
    <div
      onClick={clickable ? () => navigate(to) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(to); } } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`relative overflow-hidden bg-white rounded-2xl p-6 border border-slate-100 shadow-sm transition-all duration-200 ${
        clickable ? 'cursor-pointer hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary/30' : 'hover:shadow-md'
      }`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 mb-1 truncate">{title}</p>
          <h3 className="text-3xl font-bold text-slate-900">{value}</h3>

          {trend != null && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className={`text-sm font-medium ${trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {trend > 0 ? '+' : ''}{trend}%
              </span>
              <span className="text-xs text-slate-400">{trendLabel}</span>
            </div>
          )}
          {sub && !trend && (
            <p className="text-xs text-slate-400 mt-2">{sub}</p>
          )}
        </div>

        <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center bg-gradient-to-br ${gradient} text-white shadow-md shadow-black/10`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
