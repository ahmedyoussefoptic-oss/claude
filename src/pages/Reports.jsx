import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import { COMPLAINT_TYPES, SUB_TYPES } from '../config/complaintTypes';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import logo from '../assets/logo.png';
import { Printer, RotateCcw } from 'lucide-react';

const STATUS_NAME = {
  RECEIVED: 'مستلمة',
  IN_PROGRESS: 'قيد المعالجة',
  WAITING_PARENT_RESPONSE: 'بانتظار الرد',
  SOLVED: 'تم الحل',
  CLOSED: 'مغلقة',
  REJECTED: 'مرفوضة',
  ESCALATED: 'مصعدة',
};

function formatDuration(ms) {
  if (ms == null) return '—';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return 'أقل من ساعة';
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return remHours > 0 ? `${days} يوم و${remHours} ساعة` : `${days} يوم`;
  return `${hours} ساعة`;
}

const emptyFilters = { from: '', to: '', complaintType: '', subType: '', branch: '', assignedTo: '' };

export default function Reports() {
  const { userData } = useAuthStore();
  const branches = useBranches();
  const [complaints, setComplaints] = useState([]);
  const [specialists, setSpecialists] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComplaints(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      setSpecialists(
        snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.role === 'SPECIALIST' && u.active !== false)
      );
    });
    return () => unsubscribe();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value, ...(name === 'complaintType' ? { subType: '' } : {}) }));
  };

  const resetFilters = () => setFilters(emptyFilters);

  const results = useMemo(() => {
    return complaints.filter((c) => {
      if (filters.branch && c.branch !== filters.branch) return false;
      if (filters.complaintType && c.complaintType !== filters.complaintType) return false;
      if (filters.subType && c.subType !== filters.subType) return false;
      if (filters.assignedTo && c.assignedTo !== filters.assignedTo) return false;
      if (filters.from) {
        const createdAt = c.createdAt?.toDate?.();
        if (!createdAt || createdAt < new Date(filters.from)) return false;
      }
      if (filters.to) {
        const createdAt = c.createdAt?.toDate?.();
        const to = new Date(filters.to);
        to.setHours(23, 59, 59, 999);
        if (!createdAt || createdAt > to) return false;
      }
      return true;
    });
  }, [complaints, filters]);

  const summary = useMemo(() => {
    const total = results.length;
    const resolved = results.filter((c) => c.status === 'SOLVED' || c.status === 'CLOSED').length;
    const escalated = results.filter((c) => c.status === 'ESCALATED').length;
    const rejected = results.filter((c) => c.status === 'REJECTED').length;
    const inProgress = total - resolved - escalated - rejected;
    const resolvedDocs = results.filter((c) => c.solvedAt && c.createdAt);
    const avgResolutionMs = resolvedDocs.length
      ? resolvedDocs.reduce((sum, c) => sum + (c.solvedAt.toMillis() - c.createdAt.toMillis()), 0) / resolvedDocs.length
      : null;
    const rated = results.filter((c) => typeof c.satisfactionRate === 'number');
    const satisfaction = rated.length ? rated.reduce((s, c) => s + c.satisfactionRate, 0) / rated.length : null;
    return { total, resolved, escalated, inProgress, avgResolutionMs, satisfaction, satisfactionCount: rated.length };
  }, [results]);

  const byType = useMemo(
    () => COMPLAINT_TYPES.map((t) => ({ ...t, count: results.filter((c) => c.complaintType === t.id).length })).filter((t) => t.count > 0),
    [results]
  );

  const bySubType = useMemo(() => {
    const map = {};
    results.forEach((c) => {
      if (!c.subType) return;
      map[c.subType] = (map[c.subType] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [results]);

  const byBranch = useMemo(() => {
    return branches
      .map((b) => ({ name: b.name, count: results.filter((c) => c.branch === b.id).length }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [results, branches]);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => COMPLAINT_TYPES.find((t) => t.id === id)?.name || id;

  const activeFilterLabels = [];
  if (filters.from) activeFilterLabels.push(`من ${filters.from}`);
  if (filters.to) activeFilterLabels.push(`إلى ${filters.to}`);
  if (filters.complaintType) activeFilterLabels.push(`النوع: ${typeName(filters.complaintType)}`);
  if (filters.subType) activeFilterLabels.push(`التصنيف الفرعي: ${filters.subType}`);
  if (filters.branch) activeFilterLabels.push(`الفرع: ${branchName(filters.branch)}`);
  if (filters.assignedTo) activeFilterLabels.push(`الموظف: ${specialists.find((s) => s.id === filters.assignedTo)?.name || ''}`);

  const handlePrint = () => window.print();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">التقارير</h1>
          <p className="text-slate-500 mt-1">حدد معايير التقرير ثم اطبعه أو احفظه كملف PDF</p>
        </div>
        <button
          onClick={handlePrint}
          className="px-4 py-2.5 flex items-center gap-2 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm shrink-0"
        >
          <Printer className="w-4 h-4" />
          طباعة / حفظ PDF
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 no-print">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700">معايير التقرير</h3>
          <button onClick={resetFilters} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة تعيين
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">من تاريخ</label>
            <input type="date" name="from" value={filters.from} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">إلى تاريخ</label>
            <input type="date" name="to" value={filters.to} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">نوع الملاحظة</label>
            <select name="complaintType" value={filters.complaintType} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">كل الأنواع</option>
              {COMPLAINT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">التصنيف الفرعي</label>
            <select name="subType" value={filters.subType} onChange={handleChange} disabled={!filters.complaintType} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white disabled:text-slate-400 disabled:bg-slate-50">
              <option value="">الكل</option>
              {(SUB_TYPES[filters.complaintType] || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع</label>
            <select name="branch" value={filters.branch} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الموظف المختص</label>
            <select name="assignedTo" value={filters.assignedTo} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">كل الموظفين</option>
              {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Printable report */}
      <div id="report-print-area" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-6">
          <div className="flex items-center gap-4">
            <img src={logo} alt="مدارس المكتشف العالمية" className="h-14 w-auto" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">مدارس المكتشف العالمية</h2>
              <p className="text-sm text-slate-500">تقرير الملاحظات</p>
            </div>
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-400">تاريخ الإصدار</p>
            <p className="text-sm font-medium text-slate-700" dir="ltr">{format(new Date(), 'yyyy-MM-dd HH:mm', { locale: ar })}</p>
          </div>
        </div>

        {activeFilterLabels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeFilterLabels.map((label) => (
              <span key={label} className="text-xs font-medium px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">{label}</span>
            ))}
          </div>
        )}

        {/* Summary */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">الملخص العام</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{summary.total}</p>
              <p className="text-xs text-slate-500 mt-1">إجمالي الملاحظات</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{summary.resolved}</p>
              <p className="text-xs text-slate-500 mt-1">تم حلها</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{summary.inProgress}</p>
              <p className="text-xs text-slate-500 mt-1">قيد المعالجة</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{summary.escalated}</p>
              <p className="text-xs text-slate-500 mt-1">مصعدة</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{formatDuration(summary.avgResolutionMs)}</p>
              <p className="text-xs text-slate-500 mt-1">متوسط زمن الحل</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{summary.satisfaction != null ? `${summary.satisfaction.toFixed(1)} / 5` : '—'}</p>
              <p className="text-xs text-slate-500 mt-1">متوسط رضا أولياء الأمور ({summary.satisfactionCount})</p>
            </div>
          </div>
        </div>

        {/* By type */}
        {byType.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">حسب نوع الملاحظة</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">النوع</th>
                  <th className="text-right py-2 font-medium">العدد</th>
                  <th className="text-right py-2 font-medium">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{t.name}</td>
                    <td className="py-2 text-slate-800 tabular-nums">{t.count}</td>
                    <td className="py-2 text-slate-500 tabular-nums">{summary.total ? Math.round((t.count / summary.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By sub-type */}
        {bySubType.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">حسب التصنيف الفرعي</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">التصنيف الفرعي</th>
                  <th className="text-right py-2 font-medium">العدد</th>
                </tr>
              </thead>
              <tbody>
                {bySubType.map(([name, count]) => (
                  <tr key={name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{name}</td>
                    <td className="py-2 text-slate-800 tabular-nums">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By branch */}
        {!filters.branch && byBranch.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">حسب الفرع</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">الفرع</th>
                  <th className="text-right py-2 font-medium">العدد</th>
                </tr>
              </thead>
              <tbody>
                {byBranch.map((b) => (
                  <tr key={b.name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{b.name}</td>
                    <td className="py-2 text-slate-800 tabular-nums">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Detailed listing */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">التفاصيل ({results.length})</h3>
          {results.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">لا توجد ملاحظات مطابقة لمعايير التقرير</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">رقم الملاحظة</th>
                  <th className="text-right py-2 font-medium">التاريخ</th>
                  <th className="text-right py-2 font-medium">الفرع</th>
                  <th className="text-right py-2 font-medium">النوع</th>
                  <th className="text-right py-2 font-medium">التصنيف الفرعي</th>
                  <th className="text-right py-2 font-medium">المختص</th>
                  <th className="text-right py-2 font-medium">الحالة</th>
                  <th className="text-right py-2 font-medium">زمن الحل</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800" dir="ltr">{c.complaintId}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                    <td className="py-2 text-slate-600">{branchName(c.branch)}</td>
                    <td className="py-2 text-slate-600">{typeName(c.complaintType)}</td>
                    <td className="py-2 text-slate-600">{c.subType || '—'}</td>
                    <td className="py-2 text-slate-600">{c.assignedToName || '—'}</td>
                    <td className="py-2 text-slate-600">{STATUS_NAME[c.status] || c.status}</td>
                    <td className="py-2 text-slate-600">{c.solvedAt && c.createdAt ? formatDuration(c.solvedAt.toMillis() - c.createdAt.toMillis()) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
