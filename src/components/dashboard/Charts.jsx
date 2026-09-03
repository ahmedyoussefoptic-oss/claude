import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const dummyData = [
  { name: 'السبت', value: 12 },
  { name: 'الأحد', value: 19 },
  { name: 'الإثنين', value: 15 },
  { name: 'الثلاثاء', value: 22 },
  { name: 'الأربعاء', value: 18 },
  { name: 'الخميس', value: 25 },
  { name: 'الجمعة', value: 10 },
];

export function TrendChart({ data = dummyData, title = 'معدل الشكاوى هذا الأسبوع' }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900 mb-6">{title}</h3>
      <div className="h-72 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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

export function BranchChart({ data, title = 'الشكاوى حسب الفرع' }) {
  const defaultData = [
    { name: 'بنين عام', value: 45 },
    { name: 'بنات عام', value: 30 },
    { name: 'بنين دولي', value: 25 },
    { name: 'بنات دولي', value: 20 },
  ];
  const rows = data && data.length ? data : defaultData;
  // Horizontal bars scale with the number of branches, and give the label
  // column enough width to show full branch names without truncation.
  const chartHeight = Math.max(280, rows.length * 56);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900 mb-6">{title}</h3>
      <div style={{ height: chartHeight }} className="w-full" dir="rtl">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              width={170}
              tick={{ fill: '#334155', fontSize: 13 }}
              orientation="right"
            />
            <Tooltip
              cursor={{ fill: '#f8fafc' }}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
            />
            <Bar dataKey="value" fill="#38bdf8" radius={[0, 6, 6, 0]} barSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
