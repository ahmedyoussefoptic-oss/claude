import { FileText, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import StatCard from '../components/dashboard/StatCard';
import { TrendChart, BranchChart } from '../components/dashboard/Charts';
import useAuthStore from '../stores/useAuthStore';

export default function Dashboard() {
  const { userData } = useAuthStore();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">مرحباً {userData?.name || 'مستخدم'} 👋</h1>
          <p className="text-slate-500 mt-1">إليك ملخص سريع لحالة الشكاوى اليوم</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors">
            تصدير التقرير
          </button>
          <button className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm">
            شكوى جديدة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي الشكاوى"
          value="1,284"
          icon={FileText}
          trend={12}
          trendLabel="عن الشهر الماضي"
          colorClass="text-sky-600"
          bgClass="bg-sky-50"
        />
        <StatCard
          title="قيد المعالجة"
          value="45"
          icon={Clock}
          colorClass="text-amber-600"
          bgClass="bg-amber-50"
        />
        <StatCard
          title="متأخرة (SLA)"
          value="12"
          icon={AlertTriangle}
          trend={-5}
          trendLabel="أقل من الأسبوع الماضي"
          colorClass="text-red-600"
          bgClass="bg-red-50"
        />
        <StatCard
          title="تم الحل"
          value="1,227"
          icon={CheckCircle2}
          trend={8}
          trendLabel="ارتفاع في نسبة الحل"
          colorClass="text-emerald-600"
          bgClass="bg-emerald-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <TrendChart />
        </div>
        <div className="lg:col-span-1">
          <BranchChart />
        </div>
      </div>
      
      {/* Recent Activity Table Placeholder */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">أحدث الشكاوى</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 text-slate-500 text-sm">
              <tr>
                <th className="px-6 py-4 font-medium">رقم التذكرة</th>
                <th className="px-6 py-4 font-medium">ولي الأمر</th>
                <th className="px-6 py-4 font-medium">التصنيف</th>
                <th className="px-6 py-4 font-medium">الفرع</th>
                <th className="px-6 py-4 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">#CMP-{2024000 + i}</td>
                  <td className="px-6 py-4 text-slate-600">أحمد يوسف</td>
                  <td className="px-6 py-4 text-slate-600">رسوم دراسية</td>
                  <td className="px-6 py-4 text-slate-600">بنين عام</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      قيد المعالجة
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
