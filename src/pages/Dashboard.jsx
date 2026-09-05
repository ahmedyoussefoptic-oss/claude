import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Clock, AlertTriangle, CheckCircle2, Download, Plus, Star, Gauge, Repeat, Wrench, ShieldAlert, PackageSearch, PackageCheck } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import StatCard from '../components/dashboard/StatCard';
import { TrendChart, BranchChart } from '../components/dashboard/Charts';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { OPEN_TICKET_STATUSES } from '../config/techSupport';
import ComplaintForm from '../components/complaints/ComplaintForm';

// Generic branch-scoped live-count hook shared by the tech-support and
// lost-found KPI cards below — same scoping rule as the complaints query.
function useBranchScopedCollection(collectionName, userData) {
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, collectionName), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDocs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, userData?.access, userData?.branch]);
  return docs;
}

const WEEKDAY_LABELS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Formats a millisecond duration as a short localized string, e.g.
// "يومان و3 ساعات" (ar) or "2d 3h" (en).
function formatDuration(ms, lang) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const isAr = lang === 'ar';
  if (hours < 1) return isAr ? 'أقل من ساعة' : 'Less than an hour';
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (isAr) {
    if (days > 0) return remHours > 0 ? `${days} يوم و${remHours} ساعة` : `${days} يوم`;
    return `${hours} ساعة`;
  }
  if (days > 0) return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  return `${hours}h`;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { userData } = useAuthStore();
  const branches = useBranches();
  const techTickets = useBranchScopedCollection('techSupportTickets', userData);
  const lostFoundItems = useBranchScopedCollection('lostFoundItems', userData);
  const techStats = useMemo(() => ({
    open: techTickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length,
    overdue: techTickets.filter((t) => t.isOverdue).length,
  }), [techTickets]);
  const lostFoundStats = useMemo(() => ({
    unclaimed: lostFoundItems.filter((i) => i.status === 'UNCLAIMED').length,
    returned: lostFoundItems.filter((i) => i.status === 'RETURNED').length,
  }), [lostFoundItems]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    inProgress: 0,
    overdue: 0,
    solved: 0,
    avgResolution: null,
    slaCompliance: null,
    satisfaction: null,
    satisfactionCount: 0,
    reopened: 0,
  });

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setComplaints(docs);

      const resolved = docs.filter(c => c.solvedAt && c.createdAt);
      const avgResolutionMs = resolved.length
        ? resolved.reduce((sum, c) => sum + (c.solvedAt.toMillis() - c.createdAt.toMillis()), 0) / resolved.length
        : null;

      const withDueDate = resolved.filter(c => c.dueDate);
      const withinSla = withDueDate.filter(c => c.solvedAt.toMillis() <= c.dueDate.toMillis());
      const slaCompliance = withDueDate.length ? Math.round((withinSla.length / withDueDate.length) * 100) : null;

      const rated = docs.filter(c => typeof c.satisfactionRate === 'number');
      const satisfaction = rated.length
        ? (rated.reduce((sum, c) => sum + c.satisfactionRate, 0) / rated.length)
        : null;

      const newStats = {
        total: docs.length,
        inProgress: docs.filter(c => c.status === 'IN_PROGRESS' || c.status === 'RECEIVED').length,
        overdue: docs.filter(c => c.isOverdue).length,
        solved: docs.filter(c => c.status === 'SOLVED' || c.status === 'CLOSED').length,
        avgResolution: avgResolutionMs,
        slaCompliance,
        satisfaction,
        satisfactionCount: rated.length,
        reopened: docs.filter(c => c.reopened).length,
      };
      setStats(newStats);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const branchChartData = useMemo(() => {
    return branches
      .map((b) => ({
        name: b.name.replace('فرع ', ''),
        value: complaints.filter((c) => c.branch === b.id).length,
      }))
      .sort((a, b) => b.value - a.value);
  }, [complaints, branches]);

  const trendChartData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const weekdayLabels = i18n.language === 'ar' ? WEEKDAY_LABELS_AR : WEEKDAY_LABELS_EN;
    return days.map((day) => {
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const value = complaints.filter((c) => {
        if (!c.createdAt) return false;
        const ts = c.createdAt.toDate().getTime();
        return ts >= day.getTime() && ts < next.getTime();
      }).length;
      return { name: weekdayLabels[day.getDay()], value };
    });
  }, [complaints, i18n.language]);

  const handleExportCSV = () => {
    if (complaints.length === 0) return;
    
    // CSV Header
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "رقم التذكرة,ولي الأمر,الطالب,التصنيف,الفرع,الحالة\n";
    
    complaints.forEach(c => {
      const row = `${c.complaintId},"${c.parentName}","${c.studentName}","${c.complaintType}","${c.branch}","${c.status}"`;
      csvContent += row + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `complaints_report_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'RECEIVED': return 'bg-blue-100 text-blue-800';
      case 'IN_PROGRESS': return 'bg-amber-100 text-amber-800';
      case 'WAITING_PARENT_RESPONSE': return 'bg-purple-100 text-purple-800';
      case 'SOLVED': return 'bg-emerald-100 text-emerald-800';
      case 'CLOSED': return 'bg-slate-100 text-slate-800';
      case 'REJECTED': return 'bg-red-100 text-red-800';
      case 'ESCALATED': return 'bg-orange-100 text-orange-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getStatusName = (status) => {
    switch (status) {
      case 'RECEIVED': return 'مستلمة';
      case 'IN_PROGRESS': return 'قيد المعالجة';
      case 'WAITING_PARENT_RESPONSE': return 'بانتظار الرد';
      case 'SOLVED': return 'تم الحل';
      case 'CLOSED': return 'مغلقة';
      case 'REJECTED': return 'مرفوضة';
      case 'ESCALATED': return 'مصعدة';
      default: return status;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('dashboard.greeting', { name: userData?.name || (i18n.language === 'ar' ? 'مستخدم' : 'User') })}</h1>
          <p className="text-slate-500 mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExportCSV} className="px-4 py-2.5 flex items-center gap-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            <Download className="w-4 h-4" />
            {t('dashboard.exportReport')}
          </button>
          <button onClick={() => setShowNewForm(true)} className="px-4 py-2.5 flex items-center gap-2 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm">
            <Plus className="w-4 h-4" />
            {t('dashboard.newComplaint')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('dashboard.totalComplaints')}
          value={stats.total.toString()}
          icon={FileText}
          gradient="from-sky-500 to-blue-600"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.inProgress')}
          value={stats.inProgress.toString()}
          icon={Clock}
          gradient="from-amber-400 to-orange-500"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.overdue')}
          value={stats.overdue.toString()}
          icon={AlertTriangle}
          gradient="from-red-500 to-rose-600"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.solved')}
          value={stats.solved.toString()}
          icon={CheckCircle2}
          gradient="from-emerald-500 to-teal-600"
          to="/complaints"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('dashboard.satisfaction')}
          value={stats.satisfaction != null ? `${stats.satisfaction.toFixed(1)} / 5` : '—'}
          sub={stats.satisfactionCount > 0 ? t('dashboard.basedOnSurveys', { count: stats.satisfactionCount }) : t('dashboard.noSurveys')}
          icon={Star}
          gradient="from-amber-400 to-yellow-500"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.avgResolution')}
          value={stats.avgResolution != null ? formatDuration(stats.avgResolution, i18n.language) : '—'}
          sub={t('dashboard.sinceReceipt')}
          icon={Clock}
          gradient="from-cyan-500 to-sky-600"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.slaCompliance')}
          value={stats.slaCompliance != null ? `${stats.slaCompliance}%` : '—'}
          sub={t('dashboard.slaSub')}
          icon={Gauge}
          gradient="from-green-500 to-emerald-600"
          to="/complaints"
        />
        <StatCard
          title={t('dashboard.reopened')}
          value={stats.reopened.toString()}
          sub={t('dashboard.reopenedSub')}
          icon={Repeat}
          gradient="from-orange-500 to-red-500"
          to="/complaints"
        />
      </div>

      <div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">نظرة شاملة على النظام</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="بلاغات الدعم الفني المفتوحة"
            value={techStats.open.toString()}
            icon={Wrench}
            gradient="from-violet-500 to-purple-600"
            to="/tech-support"
          />
          <StatCard
            title="بلاغات دعم فني متأخرة"
            value={techStats.overdue.toString()}
            icon={ShieldAlert}
            gradient="from-fuchsia-500 to-pink-600"
            to="/tech-support"
          />
          <StatCard
            title="مفقودات بانتظار المطالبة"
            value={lostFoundStats.unclaimed.toString()}
            icon={PackageSearch}
            gradient="from-teal-500 to-cyan-600"
            to="/lost-found"
          />
          <StatCard
            title="مفقودات تم تسليمها"
            value={lostFoundStats.returned.toString()}
            icon={PackageCheck}
            gradient="from-lime-500 to-green-600"
            to="/lost-found"
          />
        </div>
      </div>

      <div>
        <TrendChart data={trendChartData} title={t('dashboard.weeklyTrend')} />
      </div>
      <div>
        <BranchChart data={branchChartData} title={t('dashboard.byBranch')} />
      </div>

      {/* Recent Activity Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{t('dashboard.recentComplaints')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 text-slate-500 text-sm">
              <tr>
                <th className="px-6 py-4 font-medium">{t('dashboard.ticketNumber')}</th>
                <th className="px-6 py-4 font-medium">{t('dashboard.parent')}</th>
                <th className="px-6 py-4 font-medium">{t('dashboard.classification')}</th>
                <th className="px-6 py-4 font-medium">{t('dashboard.branch')}</th>
                <th className="px-6 py-4 font-medium">{t('dashboard.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {complaints.slice(0, 5).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{c.complaintId}</td>
                  <td className="px-6 py-4 text-slate-600">{c.parentName}</td>
                  <td className="px-6 py-4 text-slate-600">{c.complaintType}</td>
                  <td className="px-6 py-4 text-slate-600">{c.branch}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(c.status)}`}>
                      {getStatusName(c.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {complaints.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-slate-500">
                    {t('dashboard.noComplaints')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNewForm && (
        <ComplaintForm onClose={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
