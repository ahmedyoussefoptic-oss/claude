import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Clock, AlertTriangle, CheckCircle2, Download, Plus, Star, Gauge, Repeat, Wrench, ShieldAlert, PackageSearch, PackageCheck, GraduationCap, Briefcase, AlertOctagon, Link2, Armchair, Handshake, CalendarDays, UserX } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import StatCard from '../components/dashboard/StatCard';
import { TrendChart, BranchChart } from '../components/dashboard/Charts';
import BranchIndicators from '../components/dashboard/BranchIndicators';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useComplaintTypes } from '../hooks/useOrgData';
import { OPEN_TICKET_STATUSES, isTicketOverdue } from '../config/techSupport';
import ComplaintForm from '../components/complaints/ComplaintForm';
import PublicLinkModal from '../components/common/PublicLinkModal';
import { branchScopeConstraintValues, canAccessTechSupport } from '../utils/scope';
import { isComplaintOverdue, complaintHasType, complaintTypesOf } from '../config/complaintTypes';
import { useSlaSettings, businessMs } from '../utils/businessTime';

// Generic branch-scoped live-count hook shared by the tech-support and
// lost-found KPI cards below — same scoping rule as the complaints query.
function useBranchScopedCollection(collectionName, userData, enabled = true) {
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    if (!userData || !enabled) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, collectionName), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDocs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, userData?.access, userData?.branch, userData?.branches?.join(','), enabled]);
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
  const complaintTypes = useComplaintTypes();
  // Tech Support is restricted to the IT department's own staff (see
  // firestore.rules) — fetching it for anyone else just trips a
  // permission-denied listener, so skip the query entirely for them.
  const canSeeTechSupport = canAccessTechSupport(userData);
  const techTickets = useBranchScopedCollection('techSupportTickets', userData, canSeeTechSupport);
  const lostFoundItems = useBranchScopedCollection('lostFoundItems', userData);
  const techStats = useMemo(() => ({
    open: techTickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length,
    overdue: techTickets.filter(isTicketOverdue).length,
    unassigned: techTickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status) && !(t.assignedTo || []).length).length,
  }), [techTickets]);
  const lostFoundStats = useMemo(() => ({
    unclaimed: lostFoundItems.filter((i) => i.status === 'UNCLAIMED').length,
    returned: lostFoundItems.filter((i) => i.status === 'RETURNED').length,
  }), [lostFoundItems]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
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
    academic: 0,
    administrative: 0,
    behavioral: 0,
  });

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setComplaints(docs);

      const resolved = docs.filter(c => c.solvedAt && c.createdAt);

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
        overdue: docs.filter(isComplaintOverdue).length,
        unassigned: docs.filter(c => !['SOLVED', 'CLOSED', 'REJECTED'].includes(c.status) && !(Array.isArray(c.assignedTo) ? c.assignedTo.length : c.assignedTo)).length,
        solved: docs.filter(c => c.status === 'SOLVED' || c.status === 'CLOSED').length,
        slaCompliance,
        satisfaction,
        satisfactionCount: rated.length,
        reopened: docs.filter(c => c.reopened).length,
        academic: docs.filter(c => complaintHasType(c, 'ACADEMIC')).length,
        administrative: docs.filter(c => complaintHasType(c, 'ADMINISTRATIVE')).length,
        behavioral: docs.filter(c => complaintHasType(c, 'BEHAVIORAL')).length,
      };
      setStats(newStats);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.access, userData?.branch, userData?.branches?.join(',')]);

  // Average resolution time, counting only working time when Settings say so.
  const sla = useSlaSettings();
  const avgResolution = useMemo(() => {
    const resolved = complaints.filter((c) => c.solvedAt && c.createdAt);
    return resolved.length ? resolved.reduce((sum, c) => sum + businessMs(c.createdAt.toMillis(), c.solvedAt.toMillis(), sla), 0) / resolved.length : null;
  }, [complaints, sla]);

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
    csvContent += `${t('dashboard.ticketNumber')},${t('dashboard.parent')},${i18n.language === 'ar' ? 'الطالب' : 'Student'},${t('dashboard.classification')},${t('dashboard.branch')},${t('dashboard.status')}\n`;
    
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

  const typeName = (id) => complaintTypes.find((t) => t.id === id)?.name || id;

  // Branch QR check-ins (BranchVisit.jsx): who's waiting at a branch now,
  // and today's visits / meetings.
  const visitStats = useMemo(() => {
    const visits = complaints.filter((c) => c.viaVisitQr);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = visits.filter((c) => (c.visitArrivedAt?.toMillis?.() || 0) >= start.getTime());
    return {
      waiting: visits.filter((c) => c.visitStatus === 'WAITING').length,
      today: today.length,
      metToday: today.filter((c) => c.visitStatus === 'MET').length,
    };
  }, [complaints]);
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const getStatusName = (status) => t(`statuses.complaint.${status}`, status);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('dashboard.greeting', { name: userData?.name || (i18n.language === 'ar' ? 'مستخدم' : 'User') })}</h1>
          <p className="text-slate-500 mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowLinkModal(true)} className="px-4 py-2.5 flex items-center gap-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm">
            <Link2 className="w-4 h-4" />
            {t('dashboard.reportLink')}
          </button>
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

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
          to="/complaints?filter=ACTIVE"
        />
        <StatCard
          title={t('dashboard.overdue')}
          value={stats.overdue.toString()}
          icon={AlertTriangle}
          gradient="from-red-500 to-rose-600"
          to="/complaints?filter=OVERDUE"
        />
        <StatCard
          title={t('dashboard.solved')}
          value={stats.solved.toString()}
          icon={CheckCircle2}
          gradient="from-emerald-500 to-teal-600"
          to="/complaints?filter=RESOLVED"
        />
        <StatCard
          title={t('dashboard.unassigned')}
          value={(stats.unassigned || 0).toString()}
          sub={t('dashboard.unassignedSub')}
          icon={UserX}
          gradient={stats.unassigned ? 'from-red-600 to-rose-700' : 'from-slate-400 to-slate-500'}
          to="/complaints?filter=UNASSIGNED"
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
          value={avgResolution != null ? formatDuration(avgResolution, i18n.language) : '—'}
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
          to="/complaints?filter=REOPENED"
        />
      </div>

      <div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">{t('dashboard.byType')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title={t('dashboard.academicComplaints')}
            value={stats.academic.toString()}
            icon={GraduationCap}
            gradient="from-indigo-500 to-violet-600"
            to="/complaints?type=ACADEMIC"
          />
          <StatCard
            title={t('dashboard.administrativeComplaints')}
            value={stats.administrative.toString()}
            icon={Briefcase}
            gradient="from-cyan-500 to-teal-600"
            to="/complaints?type=ADMINISTRATIVE"
          />
          <StatCard
            title={t('dashboard.behavioralComplaints')}
            value={stats.behavioral.toString()}
            icon={AlertOctagon}
            gradient="from-rose-500 to-pink-600"
            to="/complaints?type=BEHAVIORAL"
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">{t('dashboard.branchVisitsTitle')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title={t('dashboard.visitsWaiting')}
            value={visitStats.waiting.toString()}
            sub={t('dashboard.visitsWaitingSub')}
            icon={Armchair}
            gradient="from-rose-500 to-red-600"
            to="/visits"
          />
          <StatCard
            title={t('dashboard.visitsToday')}
            value={visitStats.today.toString()}
            icon={CalendarDays}
            gradient="from-sky-500 to-blue-600"
            to="/visits"
          />
          <StatCard
            title={t('dashboard.visitsMetToday')}
            value={visitStats.metToday.toString()}
            icon={Handshake}
            gradient="from-emerald-500 to-teal-600"
            to="/visits"
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">{t('dashboard.systemOverview')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {canSeeTechSupport && (
            <>
              <StatCard
                title={t('dashboard.openTechTickets')}
                value={techStats.open.toString()}
                icon={Wrench}
                gradient="from-violet-500 to-purple-600"
                to="/tech-support?filter=OPEN"
              />
              <StatCard
                title={t('dashboard.unassignedTech')}
                value={techStats.unassigned.toString()}
                icon={UserX}
                gradient={techStats.unassigned ? 'from-red-600 to-rose-700' : 'from-slate-400 to-slate-500'}
                to="/tech-support?filter=UNASSIGNED"
              />
              <StatCard
                title={t('dashboard.overdueTechTickets')}
                value={techStats.overdue.toString()}
                icon={ShieldAlert}
                gradient="from-fuchsia-500 to-pink-600"
                to="/tech-support?filter=OVERDUE"
              />
            </>
          )}
          <StatCard
            title={t('dashboard.unclaimedItems')}
            value={lostFoundStats.unclaimed.toString()}
            icon={PackageSearch}
            gradient="from-teal-500 to-cyan-600"
            to="/lost-found?filter=UNCLAIMED"
          />
          <StatCard
            title={t('dashboard.returnedItems')}
            value={lostFoundStats.returned.toString()}
            icon={PackageCheck}
            gradient="from-lime-500 to-green-600"
            to="/lost-found?filter=RETURNED"
          />
        </div>
      </div>

      <div>
        <TrendChart data={trendChartData} title={t('dashboard.weeklyTrend')} />
      </div>
      <div>
        <BranchChart data={branchChartData} title={t('dashboard.byBranch')} />
      </div>

      <BranchIndicators
        branches={branches}
        complaints={complaints}
        techTickets={techTickets}
        lostFoundItems={lostFoundItems}
        showTechSupport={canSeeTechSupport}
      />

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
                  <td className="px-6 py-4 text-slate-600">{complaintTypesOf(c).map(typeName).join(' + ')}</td>
                  <td className="px-6 py-4 text-slate-600">{branchName(c.branch)}</td>
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
      {showLinkModal && (
        <PublicLinkModal onClose={() => setShowLinkModal(false)} />
      )}
    </div>
  );
}
