import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches, useComplaintTypes, useSubTypes } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import { normalizeAssignees } from '../utils/assignees';
import { branchScopeConstraintValues } from '../utils/scope';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import logo from '../assets/logo.png';
import { Printer, FileSpreadsheet, RotateCcw, Star } from 'lucide-react';

// Excel sheet names are capped at 31 chars and can't contain \ / ? * [ ] : —
// our translated labels are short enough in practice, but trim defensively.
function sheetName(label) {
  return label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

const REPORT_TYPE_IDS = ['COMPLAINTS', 'SURVEY'];
const RATING_KEYS = ['resolutionSpeed', 'solutionQuality', 'staffProfessionalism'];

function average(list, getValue) {
  const values = list.map(getValue).filter((v) => typeof v === 'number');
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function Stars({ value }) {
  return (
    <span className="inline-flex items-center gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`w-3.5 h-3.5 ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
      ))}
    </span>
  );
}

const emptyFilters = { from: '', to: '', complaintType: '', subType: '', branch: '', assignedTo: '' };

export default function Reports() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const formatDuration = (ms) => {
    if (ms == null) return '—';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours < 1) return t('reports.lessThanHour');
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (days > 0) return remHours > 0 ? t('reports.daysAndHours', { days, hours: remHours }) : t('reports.daysOnly', { days });
    return t('reports.hoursOnly', { hours });
  };
  const { userData } = useAuthStore();
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const [complaints, setComplaints] = useState([]);
  const [specialists, setSpecialists] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [reportType, setReportType] = useState('COMPLAINTS');
  const [selectedComplaint, setSelectedComplaint] = useState(null);

  // Keeps the open detail drawer's complaint in sync with live Firestore
  // data — otherwise it stays frozen at whatever it was when first opened.
  useEffect(() => {
    if (!selectedComplaint) return;
    const fresh = complaints.find((c) => c.id === selectedComplaint.id);
    setSelectedComplaint(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaints]);

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComplaints(snapshot.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ...data, ...normalizeAssignees(data) };
      }));
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.access, userData?.branch, userData?.branches?.join(',')]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      setSpecialists(
        snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => ['SPECIALIST', 'UPPER_MANAGEMENT', 'ADMIN'].includes(u.role) && u.active !== false)
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
      if (filters.assignedTo && !c.assignedTo?.includes(filters.assignedTo)) return false;
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
    () => complaintTypes.map((ct) => ({ ...ct, count: results.filter((c) => c.complaintType === ct.id).length })).filter((ct) => ct.count > 0),
    [results, complaintTypes]
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

  // Survey report data — anything rated, or reopened by a parent who left
  // feedback without a star rating (still worth surfacing as a signal).
  const surveyed = useMemo(() => results.filter((c) => typeof c.satisfactionRate === 'number'), [results]);
  const reopenedWithoutRating = useMemo(
    () => results.filter((c) => c.parentFeedback && typeof c.satisfactionRate !== 'number'),
    [results]
  );

  const surveyStats = useMemo(() => {
    const resolvedCount = results.filter((c) => c.status === 'SOLVED' || c.status === 'CLOSED').length;
    const distribution = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: surveyed.filter((c) => Math.round(c.satisfactionRate) === star).length,
    }));
    const detailAverages = Object.fromEntries(
      RATING_KEYS.map((key) => [key, average(surveyed, (c) => c.satisfactionDetails?.[key])])
    );
    return {
      count: surveyed.length,
      average: average(surveyed, (c) => c.satisfactionRate),
      responseRate: resolvedCount ? Math.round((surveyed.length / resolvedCount) * 100) : null,
      distribution,
      detailAverages,
      reopenedWithoutRatingCount: reopenedWithoutRating.length,
    };
  }, [results, surveyed, reopenedWithoutRating]);

  const satisfactionByBranch = useMemo(() => {
    return branches
      .map((b) => {
        const list = surveyed.filter((c) => c.branch === b.id);
        return { name: b.name, count: list.length, avg: average(list, (c) => c.satisfactionRate) };
      })
      .filter((b) => b.count > 0)
      .sort((a, b) => b.avg - a.avg);
  }, [surveyed, branches]);

  const satisfactionByEmployee = useMemo(() => {
    const map = {};
    surveyed.forEach((c) => {
      const names = c.assignedToNames?.length ? c.assignedToNames : [t('reports.unassigned')];
      names.forEach((name) => {
        if (!map[name]) map[name] = [];
        map[name].push(c);
      });
    });
    return Object.entries(map)
      .map(([name, list]) => ({ name, count: list.length, avg: average(list, (c) => c.satisfactionRate) }))
      .sort((a, b) => b.avg - a.avg);
  }, [surveyed, t]);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;

  const activeFilterLabels = [];
  if (filters.from) activeFilterLabels.push(`${t('reports.fromShort')} ${filters.from}`);
  if (filters.to) activeFilterLabels.push(`${t('reports.toShort')} ${filters.to}`);
  if (filters.complaintType) activeFilterLabels.push(`${t('reports.typeShort')} ${typeName(filters.complaintType)}`);
  if (filters.subType) activeFilterLabels.push(`${t('complaintForm.subTypeLabel')}: ${filters.subType}`);
  if (filters.branch) activeFilterLabels.push(`${t('reports.branchShort')} ${branchName(filters.branch)}`);
  if (filters.assignedTo) activeFilterLabels.push(`${t('reports.employeeShort')} ${specialists.find((s) => s.id === filters.assignedTo)?.name || ''}`);

  const handlePrint = () => window.print();

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    if (reportType === 'COMPLAINTS') {
      const summarySheet = XLSX.utils.aoa_to_sheet([
        [t('reports.totalComplaints'), summary.total],
        [t('reports.resolvedCount'), summary.resolved],
        [t('statuses.complaint.IN_PROGRESS'), summary.inProgress],
        [t('statuses.complaint.ESCALATED'), summary.escalated],
        [t('reports.avgResolutionTime'), formatDuration(summary.avgResolutionMs)],
        [t('reports.avgSatisfaction', { count: summary.satisfactionCount }), summary.satisfaction != null ? summary.satisfaction.toFixed(1) : '—'],
      ]);
      XLSX.utils.book_append_sheet(wb, summarySheet, sheetName(t('reports.generalSummary')));

      if (byType.length) {
        const typeSheet = XLSX.utils.json_to_sheet(byType.map((ct) => ({
          [t('common.type')]: ct.name,
          [t('reports.countLabel')]: ct.count,
          [t('reports.percentLabel')]: summary.total ? Math.round((ct.count / summary.total) * 100) : 0,
        })));
        XLSX.utils.book_append_sheet(wb, typeSheet, sheetName(t('reports.byComplaintType')));
      }

      if (byBranch.length) {
        const branchSheet = XLSX.utils.json_to_sheet(byBranch.map((b) => ({
          [t('common.branch')]: b.name,
          [t('reports.countLabel')]: b.count,
        })));
        XLSX.utils.book_append_sheet(wb, branchSheet, sheetName(t('reports.byBranch')));
      }

      const detailSheet = XLSX.utils.json_to_sheet(results.map((c) => ({
        [t('reports.complaintNumber')]: c.complaintId,
        [t('common.date')]: c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '',
        [t('common.branch')]: branchName(c.branch),
        [t('common.type')]: typeName(c.complaintType),
        [t('complaintForm.subTypeLabel')]: c.subType || '',
        [t('reports.specialistShort')]: c.assignedToNames?.join(listSep) || '',
        [t('common.status')]: t(`statuses.complaint.${c.status}`, c.status),
        [t('reports.resolutionTime')]: c.solvedAt && c.createdAt ? formatDuration(c.solvedAt.toMillis() - c.createdAt.toMillis()) : '',
        [t('reports.studentNameColumn')]: c.studentName || '',
        [t('reports.studentIdColumn')]: c.studentId || '',
        [t('reports.studentPhoneColumn')]: c.parentPhone || '',
        [t('reports.stageColumn')]: c.stage || '',
      })));
      XLSX.utils.book_append_sheet(wb, detailSheet, sheetName(t('reports.detailsLabel')));
    } else {
      const summarySheet = XLSX.utils.aoa_to_sheet([
        [t('reports.respondentCount'), surveyStats.count],
        [t('reports.overallSatisfactionAvg'), surveyStats.average != null ? surveyStats.average.toFixed(1) : '—'],
        [t('reports.surveyResponseRate'), surveyStats.responseRate != null ? `${surveyStats.responseRate}%` : '—'],
        [t('reports.reopenedWithoutRating'), surveyStats.reopenedWithoutRatingCount],
        ...RATING_KEYS.map((key) => [t(`ratings.${key}`), surveyStats.detailAverages[key] != null ? surveyStats.detailAverages[key].toFixed(1) : '—']),
      ]);
      XLSX.utils.book_append_sheet(wb, summarySheet, sheetName(t('reports.generalSummary')));

      if (satisfactionByBranch.length) {
        const branchSheet = XLSX.utils.json_to_sheet(satisfactionByBranch.map((b) => ({
          [t('common.branch')]: b.name,
          [t('reports.respondentCount')]: b.count,
          [t('reports.satisfactionAvg')]: b.avg.toFixed(1),
        })));
        XLSX.utils.book_append_sheet(wb, branchSheet, sheetName(t('reports.satisfactionByBranch')));
      }

      if (satisfactionByEmployee.length) {
        const employeeSheet = XLSX.utils.json_to_sheet(satisfactionByEmployee.map((e) => ({
          [t('reports.employeeLabel')]: e.name,
          [t('reports.respondentCount')]: e.count,
          [t('reports.satisfactionAvg')]: e.avg.toFixed(1),
        })));
        XLSX.utils.book_append_sheet(wb, employeeSheet, sheetName(t('reports.satisfactionByEmployee')));
      }

      const detailSheet = XLSX.utils.json_to_sheet(surveyed.map((c) => ({
        [t('reports.complaintNumber')]: c.complaintId,
        [t('common.date')]: c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '',
        [t('common.branch')]: branchName(c.branch),
        [t('reports.specialistShort')]: c.assignedToNames?.join(listSep) || '',
        [t('reports.overallRating')]: c.satisfactionRate,
        ...Object.fromEntries(RATING_KEYS.map((key) => [t(`ratings.${key}`), c.satisfactionDetails?.[key] ?? ''])),
        [t('reports.parentFeedbackLabel')]: c.parentFeedback || '',
        [t('reports.studentNameColumn')]: c.studentName || '',
        [t('reports.studentIdColumn')]: c.studentId || '',
        [t('reports.studentPhoneColumn')]: c.parentPhone || '',
        [t('reports.stageColumn')]: c.stage || '',
      })));
      XLSX.utils.book_append_sheet(wb, detailSheet, sheetName(t('reports.surveyDetailsLabel')));

      if (reopenedWithoutRating.length) {
        const reopenedSheet = XLSX.utils.json_to_sheet(reopenedWithoutRating.map((c) => ({
          [t('reports.complaintNumber')]: c.complaintId,
          [t('common.branch')]: branchName(c.branch),
          [t('reports.specialistShort')]: c.assignedToNames?.join(listSep) || '',
          [t('reports.parentFeedbackLabel')]: c.parentFeedback || '',
        })));
        XLSX.utils.book_append_sheet(wb, reopenedSheet, sheetName(t('reports.reopenedWithoutRating')));
      }
    }

    const fileName = `${t('reports.types.' + reportType)} - ${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('nav.reports')}</h1>
          <p className="text-slate-500 mt-1">{t('reports.pageSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportExcel}
            className="px-4 py-2.5 flex items-center gap-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium text-sm transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {t('reports.exportExcel')}
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2.5 flex items-center gap-2 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {t('reports.printSavePdf')}
          </button>
        </div>
      </div>

      {/* Report type */}
      <div className="flex flex-wrap gap-2 no-print">
        {REPORT_TYPE_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setReportType(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
              reportType === id
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t(`reports.types.${id}`)}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 no-print">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700">{t('reports.criteriaTitle')}</h3>
          <button onClick={resetFilters} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" />
            {t('common.reset')}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.fromDate')}</label>
            <input type="date" name="from" value={filters.from} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.toDate')}</label>
            <input type="date" name="to" value={filters.to} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('reports.complaintTypeLabel')}</label>
            <select name="complaintType" value={filters.complaintType} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('common.allTypes')}</option>
              {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subTypeLabel')}</label>
            <select name="subType" value={filters.subType} onChange={handleChange} disabled={!filters.complaintType} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white disabled:text-slate-400 disabled:bg-slate-50">
              <option value="">{t('reports.allSubTypes')}</option>
              {subTypes.filter((s) => s.parentType === filters.complaintType).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')}</label>
            <select name="branch" value={filters.branch} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('reports.specialistLabel')}</label>
            <select name="assignedTo" value={filters.assignedTo} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('reports.allSpecialists')}</option>
              {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Printable report */}
      <div id="report-print-area" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-6">
          <div className="flex items-center gap-4">
            <img src={logo} alt={t('reports.schoolFullName')} className="h-14 w-auto" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('reports.schoolFullName')}</h2>
              <p className="text-sm text-slate-500">{t(`reports.types.${reportType}`)}</p>
            </div>
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-400">{t('reports.issueDate')}</p>
            <p className="text-sm font-medium text-slate-700" dir="ltr">{format(new Date(), 'yyyy-MM-dd HH:mm', { locale: dateLocale })}</p>
          </div>
        </div>

        {activeFilterLabels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeFilterLabels.map((label) => (
              <span key={label} className="text-xs font-medium px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">{label}</span>
            ))}
          </div>
        )}

        {reportType === 'COMPLAINTS' && (
        <>
        {/* Summary */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.generalSummary')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{summary.total}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.totalComplaints')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{summary.resolved}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.resolvedCount')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{summary.inProgress}</p>
              <p className="text-xs text-slate-500 mt-1">{t('statuses.complaint.IN_PROGRESS')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{summary.escalated}</p>
              <p className="text-xs text-slate-500 mt-1">{t('statuses.complaint.ESCALATED')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{formatDuration(summary.avgResolutionMs)}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.avgResolutionTime')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{summary.satisfaction != null ? `${summary.satisfaction.toFixed(1)} / 5` : '—'}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.avgSatisfaction', { count: summary.satisfactionCount })}</p>
            </div>
          </div>
        </div>

        {/* By type */}
        {byType.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.byComplaintType')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('common.type')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.countLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.percentLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((ct) => (
                  <tr key={ct.id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{ct.name}</td>
                    <td className="py-2 text-slate-800 tabular-nums">{ct.count}</td>
                    <td className="py-2 text-slate-500 tabular-nums">{summary.total ? Math.round((ct.count / summary.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By sub-type */}
        {bySubType.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.bySubType')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('complaintForm.subTypeLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.countLabel')}</th>
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
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.byBranch')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.countLabel')}</th>
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
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.detailsLabel')} ({results.length})</h3>
          {results.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t('reports.noMatchingComplaints')}</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('reports.complaintNumber')}</th>
                  <th className="text-right py-2 font-medium">{t('common.date')}</th>
                  <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                  <th className="text-right py-2 font-medium">{t('common.type')}</th>
                  <th className="text-right py-2 font-medium">{t('complaintForm.subTypeLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.specialistShort')}</th>
                  <th className="text-right py-2 font-medium">{t('common.status')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.resolutionTime')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentNameColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentIdColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentPhoneColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.stageColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id} onClick={() => setSelectedComplaint(c)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className="py-2 text-slate-800" dir="ltr">{c.complaintId}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                    <td className="py-2 text-slate-600">{branchName(c.branch)}</td>
                    <td className="py-2 text-slate-600">{typeName(c.complaintType)}</td>
                    <td className="py-2 text-slate-600">{c.subType || '—'}</td>
                    <td className="py-2 text-slate-600">{c.assignedToNames?.join(listSep) || '—'}</td>
                    <td className="py-2 text-slate-600">{t(`statuses.complaint.${c.status}`, c.status)}</td>
                    <td className="py-2 text-slate-600">{c.solvedAt && c.createdAt ? formatDuration(c.solvedAt.toMillis() - c.createdAt.toMillis()) : '—'}</td>
                    <td className="py-2 text-slate-600">{c.studentName || '—'}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.studentId || '—'}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.parentPhone || '—'}</td>
                    <td className="py-2 text-slate-600">{c.stage || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
        )}

        {reportType === 'SURVEY' && (
        <>
        {/* Survey summary */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.generalSummary')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{surveyStats.count}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.respondentCount')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{surveyStats.average != null ? `${surveyStats.average.toFixed(1)} / 5` : '—'}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.overallSatisfactionAvg')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{surveyStats.responseRate != null ? `${surveyStats.responseRate}%` : '—'}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.surveyResponseRate')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{surveyStats.reopenedWithoutRatingCount}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.reopenedWithoutRating')}</p>
            </div>
          </div>
        </div>

        {/* Detail metric averages */}
        {surveyStats.count > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.avgRatingCriteria')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {RATING_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-slate-200 p-4 text-center">
                  <p className="text-2xl font-bold text-slate-900">{surveyStats.detailAverages[key] != null ? surveyStats.detailAverages[key].toFixed(1) : '—'}</p>
                  <p className="text-xs text-slate-500 mt-1">{t(`ratings.${key}`)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Star distribution */}
        {surveyStats.count > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.ratingDistribution')}</h3>
            <div className="space-y-2">
              {surveyStats.distribution.map(({ star, count }) => (
                <div key={star} className="flex items-center gap-3">
                  <span className="flex items-center gap-1 w-16 shrink-0 text-sm text-slate-600" dir="ltr">
                    {star} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                      style={{ width: `${surveyStats.count ? Math.round((count / surveyStats.count) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-sm text-slate-800 tabular-nums text-left">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By branch */}
        {!filters.branch && satisfactionByBranch.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.satisfactionByBranch')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.respondentCount')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.satisfactionAvg')}</th>
                </tr>
              </thead>
              <tbody>
                {satisfactionByBranch.map((b) => (
                  <tr key={b.name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{b.name}</td>
                    <td className="py-2 text-slate-600 tabular-nums">{b.count}</td>
                    <td className="py-2 text-slate-800"><Stars value={b.avg} /> <span className="tabular-nums text-slate-500">({b.avg.toFixed(1)})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By employee */}
        {!filters.assignedTo && satisfactionByEmployee.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.satisfactionByEmployee')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('reports.employeeLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.respondentCount')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.satisfactionAvg')}</th>
                </tr>
              </thead>
              <tbody>
                {satisfactionByEmployee.map((e) => (
                  <tr key={e.name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{e.name}</td>
                    <td className="py-2 text-slate-600 tabular-nums">{e.count}</td>
                    <td className="py-2 text-slate-800"><Stars value={e.avg} /> <span className="tabular-nums text-slate-500">({e.avg.toFixed(1)})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Detailed listing */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.surveyDetailsLabel')} ({surveyed.length})</h3>
          {surveyed.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t('reports.noMatchingSurveys')}</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('reports.complaintNumber')}</th>
                  <th className="text-right py-2 font-medium">{t('common.date')}</th>
                  <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.specialistShort')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.overallRating')}</th>
                  {RATING_KEYS.map((key) => (
                    <th key={key} className="text-right py-2 font-medium">{t(`ratings.${key}`)}</th>
                  ))}
                  <th className="text-right py-2 font-medium">{t('reports.parentFeedbackLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentNameColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentIdColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.studentPhoneColumn')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.stageColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {surveyed.map((c) => (
                  <tr key={c.id} onClick={() => setSelectedComplaint(c)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className="py-2 text-slate-800" dir="ltr">{c.complaintId}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                    <td className="py-2 text-slate-600">{branchName(c.branch)}</td>
                    <td className="py-2 text-slate-600">{c.assignedToNames?.join(listSep) || '—'}</td>
                    <td className="py-2"><Stars value={c.satisfactionRate} /></td>
                    {RATING_KEYS.map((key) => (
                      <td key={key} className="py-2 text-slate-600 tabular-nums">{c.satisfactionDetails?.[key] ?? '—'}</td>
                    ))}
                    <td className="py-2 text-slate-600 max-w-xs truncate">{c.parentFeedback || '—'}</td>
                    <td className="py-2 text-slate-600">{c.studentName || '—'}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.studentId || '—'}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{c.parentPhone || '—'}</td>
                    <td className="py-2 text-slate-600">{c.stage || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reopenedWithoutRating.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
                {t('reports.reopenedWithoutRating')} ({reopenedWithoutRating.length})
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="text-right py-2 font-medium">{t('reports.complaintNumber')}</th>
                    <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                    <th className="text-right py-2 font-medium">{t('reports.specialistShort')}</th>
                    <th className="text-right py-2 font-medium">{t('reports.parentFeedbackLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reopenedWithoutRating.map((c) => (
                    <tr key={c.id} onClick={() => setSelectedComplaint(c)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                      <td className="py-2 text-slate-800" dir="ltr">{c.complaintId}</td>
                      <td className="py-2 text-slate-600">{branchName(c.branch)}</td>
                      <td className="py-2 text-slate-600">{c.assignedToNames?.join(listSep) || '—'}</td>
                      <td className="py-2 text-slate-600">{c.parentFeedback}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {selectedComplaint && (
        <ComplaintDetails complaint={selectedComplaint} onClose={() => setSelectedComplaint(null)} />
      )}
    </div>
  );
}
