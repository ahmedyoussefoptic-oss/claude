import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches, useComplaintTypes, useSubTypes, useProblemTypes } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import TechSupportDetails from '../components/techSupport/TechSupportDetails';
import { normalizeAssignees } from '../utils/assignees';
import { branchScopeConstraintValues } from '../utils/scope';
import { formatDuration } from '../utils/duration';
import { RESOLVED_TICKET_STATUSES, isTicketOverdue } from '../config/techSupport';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import logo from '../assets/logo.png';
import { Printer, FileSpreadsheet, RotateCcw, Star } from 'lucide-react';
import VisitsReport from '../components/reports/VisitsReport';
import ComplaintsReport from '../components/reports/ComplaintsReport';
import { complaintMetrics, ticketMetrics } from '../utils/reportMetrics';
import { useSlaSettings, elapsedMs, businessMs } from '../utils/businessTime';
import { canAccessTechSupport } from '../utils/scope';
import { complaintStatusLabel, complaintHasType, complaintTypesLabel } from '../config/complaintTypes';

// Excel sheet names are capped at 31 chars and can't contain \ / ? * [ ] : —
// our translated labels are short enough in practice, but trim defensively.
function sheetName(label) {
  return label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

const REPORT_TYPE_IDS = ['COMPLAINTS', 'TECH_SUPPORT', 'VISITS', 'SURVEY'];
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
  const { userData } = useAuthStore();
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const problemTypes = useProblemTypes();
  const [complaints, setComplaints] = useState([]);
  const [techTickets, setTechTickets] = useState([]);
  const [specialists, setSpecialists] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [reportType, setReportType] = useState('COMPLAINTS');
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  // Complaints-report options: merging tech tickets in, and the full
  // per-record listing at the end, are both opt-in (the default report is
  // numbers only).
  const canSeeTech = canAccessTechSupport(userData);
  const [includeTech, setIncludeTech] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [includeVisits, setIncludeVisits] = useState(false);
  const mergeTech = includeTech && canSeeTech;
  const sla = useSlaSettings();

  // Keeps the open detail drawer's complaint in sync with live Firestore
  // data — otherwise it stays frozen at whatever it was when first opened.
  useEffect(() => {
    if (!selectedComplaint) return;
    const fresh = complaints.find((c) => c.id === selectedComplaint.id);
    setSelectedComplaint(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaints]);

  useEffect(() => {
    if (!selectedTicket) return;
    const fresh = techTickets.find((tk) => tk.id === selectedTicket.id);
    setSelectedTicket(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techTickets]);

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
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'techSupportTickets'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTechTickets(snapshot.docs.map((d) => {
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
      if (filters.complaintType && !complaintHasType(c, filters.complaintType)) return false;
      if (filters.subType && c.subType !== filters.subType && !(c.extraTypes || []).some((x) => x.subType === filters.subType)) return false;
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

  // Sub-type counts, including the sub-types of a complaint's extra categories.
  const bySubType = useMemo(() => {
    const map = {};
    results.forEach((c) => {
      [c.subType, ...(c.extraTypes || []).map((x) => x.subType)].filter(Boolean).forEach((st) => {
        map[st] = (map[st] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [results]);

  // Tech-support report data — a separate filtered set since tickets don't
  // have complaintType/subType fields, only date range/branch/assignedTo
  // from the shared filters panel apply.
  const ticketResults = useMemo(() => {
    return techTickets.filter((tk) => {
      if (filters.branch && tk.branch !== filters.branch) return false;
      if (filters.assignedTo && !tk.assignedTo?.includes(filters.assignedTo)) return false;
      if (filters.from) {
        const createdAt = tk.createdAt?.toDate?.();
        if (!createdAt || createdAt < new Date(filters.from)) return false;
      }
      if (filters.to) {
        const createdAt = tk.createdAt?.toDate?.();
        const to = new Date(filters.to);
        to.setHours(23, 59, 59, 999);
        if (!createdAt || createdAt > to) return false;
      }
      return true;
    });
  }, [techTickets, filters]);

  const ticketSummary = useMemo(() => {
    const total = ticketResults.length;
    // Resolved/overdue use the shared definitions so the three buckets
    // always add up to `total` with no double-counting.
    const resolved = ticketResults.filter((tk) => RESOLVED_TICKET_STATUSES.includes(tk.status)).length;
    const overdue = ticketResults.filter(isTicketOverdue).length;
    const inProgress = total - resolved - overdue;
    // resolutionMessageSentAt (not solvedAt/closedAt) marks when the team
    // actually finished their part — set the moment the resolution message
    // is sent, independent of whether/when the parent later confirms it.
    const resolvedDocs = ticketResults.filter((tk) => tk.resolutionMessageSentAt && tk.createdAt);
    const avgResolutionMs = resolvedDocs.length
      ? resolvedDocs.reduce((sum, tk) => sum + businessMs(tk.createdAt.toMillis(), tk.resolutionMessageSentAt.toMillis(), sla), 0) / resolvedDocs.length
      : null;
    return { total, resolved, inProgress, overdue, avgResolutionMs };
  }, [ticketResults, sla]);

  const byProblemType = useMemo(
    () => problemTypes.map((pt) => ({ ...pt, count: ticketResults.filter((tk) => tk.problemType === pt.id).length })).filter((pt) => pt.count > 0),
    [ticketResults, problemTypes]
  );

  const ticketsByBranch = useMemo(() => {
    return branches
      .map((b) => ({ name: b.name, count: ticketResults.filter((tk) => tk.branch === b.id).length }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [ticketResults, branches]);

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
  const problemTypeName = (id) => problemTypes.find((pt) => pt.id === id)?.name || id;

  const activeFilterLabels = [];
  if (filters.from) activeFilterLabels.push(`${t('reports.fromShort')} ${filters.from}`);
  if (filters.to) activeFilterLabels.push(`${t('reports.toShort')} ${filters.to}`);
  if (reportType !== 'TECH_SUPPORT' && filters.complaintType) activeFilterLabels.push(`${t('reports.typeShort')} ${typeName(filters.complaintType)}`);
  if (reportType !== 'TECH_SUPPORT' && filters.subType) activeFilterLabels.push(`${t('complaintForm.subTypeLabel')}: ${filters.subType}`);
  if (filters.branch) activeFilterLabels.push(`${t('reports.branchShort')} ${branchName(filters.branch)}`);
  if (filters.assignedTo) activeFilterLabels.push(`${t('reports.employeeShort')} ${specialists.find((s) => s.id === filters.assignedTo)?.name || ''}`);

  const handlePrint = () => window.print();

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    if (reportType === 'COMPLAINTS') {
      const m = complaintMetrics(results, sla);
      const tm = ticketMetrics(mergeTech ? ticketResults : [], sla);
      const pctText = (v) => (v == null ? '—' : `${v}%`);
      const satText = (v) => (v == null ? '—' : v.toFixed(1));
      const summaryRows = [
        [t('dashboard.totalComplaints'), m.total],
        [t('dashboard.inProgress'), m.inProgress],
        [t('dashboard.overdue'), m.overdue],
        [t('dashboard.solved'), m.resolved],
        [t('reports.full.resolutionRate'), pctText(m.resolutionRate)],
        [t('reports.full.escalatedOpen'), m.escalatedOpen],
        [t('statuses.complaint.ESCALATED_RESOLVED'), m.escalatedResolved],
        [t('statuses.complaint.REJECTED'), m.rejected],
        [t('dashboard.reopened'), m.reopened],
        [t('dashboard.avgResolution'), formatDuration(m.avgResolutionMs, t)],
        [t('dashboard.slaCompliance'), pctText(m.slaCompliance)],
        [t('dashboard.satisfaction'), satText(m.satisfaction)],
        ...complaintTypes.map((ct) => [ct.name, results.filter((c) => complaintHasType(c, ct.id)).length]),
      ];
      if (mergeTech) {
        summaryRows.push(
          [t('reports.totalTickets'), tm.total],
          [`${t('dashboard.categories.techSupport')} — ${t('reports.resolvedCount')}`, tm.resolved],
          [t('dashboard.overdueTechTickets'), tm.overdue],
          [`${t('dashboard.categories.techSupport')} — ${t('reports.avgResolutionTime')}`, formatDuration(tm.avgResolutionMs, t)],
        );
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), sheetName(t('reports.generalSummary')));

      // One row per branch × category with every status count.
      const perBranch = [];
      const comparison = [];
      branches.forEach((b) => {
        const bc = results.filter((c) => c.branch === b.id);
        const bt = mergeTech ? ticketResults.filter((tk) => tk.branch === b.id) : [];
        if (!bc.length && !bt.length) return;
        const row = (label, mm) => ({
          [t('common.branch')]: b.name,
          [t('reports.full.category')]: label,
          [t('reports.full.colTotal')]: mm.total,
          [t('reports.resolvedCount')]: mm.resolved,
          [t('statuses.complaint.IN_PROGRESS')]: mm.inProgress,
          [t('reports.full.escalatedOpen')]: mm.escalatedOpen,
          [t('statuses.complaint.ESCALATED_RESOLVED')]: mm.escalatedResolved,
          [t('reports.full.overdue')]: mm.overdue,
          [t('statuses.complaint.REJECTED')]: mm.rejected,
        });
        complaintTypes.forEach((ct) => perBranch.push(row(ct.name, complaintMetrics(bc.filter((c) => complaintHasType(c, ct.id)), sla))));
        if (mergeTech) perBranch.push(row(t('dashboard.categories.techSupport'), ticketMetrics(bt, sla)));
        const bm = complaintMetrics(bc, sla);
        comparison.push({
          [t('common.branch')]: b.name,
          [t('reports.full.colTotal')]: bm.total,
          [t('reports.resolvedCount')]: bm.resolved,
          [t('reports.full.resolutionRate')]: pctText(bm.resolutionRate),
          [t('statuses.complaint.IN_PROGRESS')]: bm.inProgress,
          [t('reports.full.escalatedOpen')]: bm.escalatedOpen,
          [t('statuses.complaint.ESCALATED_RESOLVED')]: bm.escalatedResolved,
          [t('reports.full.overdue')]: bm.overdue,
          [t('reports.avgResolutionTime')]: formatDuration(bm.avgResolutionMs, t),
          [t('dashboard.slaCompliance')]: pctText(bm.slaCompliance),
          [t('reports.satisfactionAvg')]: satText(bm.satisfaction),
          ...(mergeTech ? { [t('reports.full.techTotalCol')]: bt.length, [t('reports.full.techResolvedCol')]: ticketMetrics(bt, sla).resolved } : {}),
        });
      });
      if (perBranch.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perBranch), sheetName(t('reports.full.perBranchTitle')));
      if (comparison.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comparison), sheetName(t('reports.full.comparisonTitle')));

      if (bySubType.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bySubType.map(([name, count]) => ({
          [t('complaintForm.subTypeLabel')]: name,
          [t('reports.countLabel')]: count,
        }))), sheetName(t('reports.bySubType')));
      }

      if (showDetails) {
        const detailSheet = XLSX.utils.json_to_sheet([
          ...results.map((c) => ({
            [t('reports.full.recordNumber')]: c.complaintId,
            [t('common.date')]: c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd') : '',
            [t('common.branch')]: branchName(c.branch),
            [t('common.type')]: complaintTypesLabel(c, typeName, listSep),
            [t('complaintForm.subTypeLabel')]: c.subType || '',
            [t('reports.specialistShort')]: c.assignedToNames?.join(listSep) || '',
            [t('common.status')]: complaintStatusLabel(c, t),
            [t('reports.resolutionTime')]: c.solvedAt && c.createdAt ? formatDuration(elapsedMs(c.createdAt, c.solvedAt, sla), t) : '',
            [t('reports.studentNameColumn')]: c.studentName || '',
            [t('reports.stageColumn')]: c.stage || '',
          })),
          ...(mergeTech ? ticketResults.map((tk) => ({
            [t('reports.full.recordNumber')]: tk.ticketId,
            [t('common.date')]: tk.createdAt?.toDate ? format(tk.createdAt.toDate(), 'yyyy-MM-dd') : '',
            [t('common.branch')]: branchName(tk.branch),
            [t('common.type')]: t('dashboard.categories.techSupport'),
            [t('complaintForm.subTypeLabel')]: problemTypeName(tk.problemType),
            [t('reports.specialistShort')]: tk.assignedToNames?.join(listSep) || '',
            [t('common.status')]: t(`statuses.techSupport.${tk.status}`, tk.status),
            [t('reports.resolutionTime')]: tk.resolutionMessageSentAt && tk.createdAt ? formatDuration(elapsedMs(tk.createdAt, tk.resolutionMessageSentAt, sla), t) : '',
            [t('reports.studentNameColumn')]: tk.studentName || '',
            [t('reports.stageColumn')]: tk.stage || '',
          })) : []),
        ]);
        XLSX.utils.book_append_sheet(wb, detailSheet, sheetName(t('reports.detailsLabel')));
      }
    } else if (reportType === 'TECH_SUPPORT') {
      const summarySheet = XLSX.utils.aoa_to_sheet([
        [t('reports.totalTickets'), ticketSummary.total],
        [t('reports.resolvedCount'), ticketSummary.resolved],
        [t('statuses.techSupport.IN_PROGRESS'), ticketSummary.inProgress],
        [t('dashboard.overdueTechTickets'), ticketSummary.overdue],
        [t('reports.avgResolutionTime'), formatDuration(ticketSummary.avgResolutionMs, t)],
      ]);
      XLSX.utils.book_append_sheet(wb, summarySheet, sheetName(t('reports.generalSummary')));

      if (byProblemType.length) {
        const typeSheet = XLSX.utils.json_to_sheet(byProblemType.map((pt) => ({
          [t('techSupportList.problemType')]: pt.name,
          [t('reports.countLabel')]: pt.count,
          [t('reports.percentLabel')]: ticketSummary.total ? Math.round((pt.count / ticketSummary.total) * 100) : 0,
        })));
        XLSX.utils.book_append_sheet(wb, typeSheet, sheetName(t('reports.byProblemType')));
      }

      if (ticketsByBranch.length) {
        const branchSheet = XLSX.utils.json_to_sheet(ticketsByBranch.map((b) => ({
          [t('common.branch')]: b.name,
          [t('reports.countLabel')]: b.count,
        })));
        XLSX.utils.book_append_sheet(wb, branchSheet, sheetName(t('reports.byBranch')));
      }

      const detailSheet = XLSX.utils.json_to_sheet(ticketResults.map((tk) => ({
        [t('techSupportList.ticketNumber')]: tk.ticketId,
        [t('common.date')]: tk.createdAt?.toDate ? format(tk.createdAt.toDate(), 'yyyy-MM-dd') : '',
        [t('common.branch')]: branchName(tk.branch),
        [t('techSupportList.problemType')]: problemTypeName(tk.problemType),
        [t('reports.specialistShort')]: tk.assignedToNames?.join(listSep) || '',
        [t('common.status')]: t(`statuses.techSupport.${tk.status}`, tk.status),
        [t('reports.resolutionTime')]: tk.resolutionMessageSentAt && tk.createdAt ? formatDuration(elapsedMs(tk.createdAt, tk.resolutionMessageSentAt, sla), t) : '',
        [t('techSupportDetails.student')]: tk.studentName || '',
        [t('reports.stageColumn')]: tk.stage || '',
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
          {!['TECH_SUPPORT', 'VISITS'].includes(reportType) && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('reports.complaintTypeLabel')}</label>
              <select name="complaintType" value={filters.complaintType} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
                <option value="">{t('common.allTypes')}</option>
                {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
              </select>
            </div>
          )}
          {!['TECH_SUPPORT', 'VISITS'].includes(reportType) && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subTypeLabel')}</label>
              <select name="subType" value={filters.subType} onChange={handleChange} disabled={!filters.complaintType} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white disabled:text-slate-400 disabled:bg-slate-50">
                <option value="">{t('reports.allSubTypes')}</option>
                {subTypes.filter((s) => s.parentType === filters.complaintType).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')}</label>
            <select name="branch" value={filters.branch} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {reportType !== 'VISITS' && <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('reports.specialistLabel')}</label>
            <select name="assignedTo" value={filters.assignedTo} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('reports.allSpecialists')}</option>
              {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>}
        </div>
        {reportType === 'COMPLAINTS' && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-slate-100">
            {canSeeTech && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={includeTech} onChange={(e) => setIncludeTech(e.target.checked)} />
                {t('reports.full.optIncludeTech')}
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={includeVisits} onChange={(e) => setIncludeVisits(e.target.checked)} />
              {t('visitsReport.optInclude')}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
              {t('reports.full.optShowDetails')}
            </label>
          </div>
        )}

      </div>

      {/* Printable report */}
      <div id="report-print-area" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-6">
          <div className="flex items-center gap-4">
            <img src={logo} alt={t('reports.schoolFullName')} className="h-14 w-auto" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('reports.schoolFullName')}</h2>
              <p className="text-sm text-slate-500">
                {reportType === 'COMPLAINTS' && mergeTech ? t('reports.full.mergedTitle') : t(`reports.types.${reportType}`)}
                {reportType === 'COMPLAINTS' && includeVisits && ` + ${t('reports.types.VISITS')}`}
              </p>
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
          <ComplaintsReport
            complaints={results}
            tickets={ticketResults}
            includeTech={mergeTech}
            showDetails={showDetails}
            branches={branches}
            complaintTypes={complaintTypes}
            singleBranch={filters.branch}
            onOpenComplaint={setSelectedComplaint}
            onOpenTicket={setSelectedTicket}
            problemTypeName={problemTypeName}
          />
        )}

        {(reportType === 'VISITS' || (reportType === 'COMPLAINTS' && includeVisits)) && (
          <VisitsReport
            complaints={complaints}
            filters={filters}
            branches={branches}
            complaintTypes={complaintTypes}
            showDetails={showDetails}
            onOpenComplaint={setSelectedComplaint}
            merged={reportType === 'COMPLAINTS'}
          />
        )}

        {reportType === 'TECH_SUPPORT' && (
        <>
        {/* Summary */}
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.generalSummary')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{ticketSummary.total}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.totalTickets')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{ticketSummary.resolved}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.resolvedCount')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{ticketSummary.inProgress}</p>
              <p className="text-xs text-slate-500 mt-1">{t('statuses.techSupport.IN_PROGRESS')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{ticketSummary.overdue}</p>
              <p className="text-xs text-slate-500 mt-1">{t('dashboard.overdueTechTickets')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{formatDuration(ticketSummary.avgResolutionMs, t)}</p>
              <p className="text-xs text-slate-500 mt-1">{t('reports.avgResolutionTime')}</p>
            </div>
          </div>
        </div>

        {/* By problem type */}
        {byProblemType.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.byProblemType')}</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('techSupportList.problemType')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.countLabel')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.percentLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {byProblemType.map((pt) => (
                  <tr key={pt.id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{pt.name}</td>
                    <td className="py-2 text-slate-800 tabular-nums">{pt.count}</td>
                    <td className="py-2 text-slate-500 tabular-nums">{ticketSummary.total ? Math.round((pt.count / ticketSummary.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By branch */}
        {!filters.branch && ticketsByBranch.length > 0 && (
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
                {ticketsByBranch.map((b) => (
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
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">{t('reports.detailsLabel')} ({ticketResults.length})</h3>
          {ticketResults.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t('reports.noMatchingTickets')}</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-right py-2 font-medium">{t('techSupportList.ticketNumber')}</th>
                  <th className="text-right py-2 font-medium">{t('common.date')}</th>
                  <th className="text-right py-2 font-medium">{t('common.branch')}</th>
                  <th className="text-right py-2 font-medium">{t('techSupportList.problemType')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.specialistShort')}</th>
                  <th className="text-right py-2 font-medium">{t('common.status')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.resolutionTime')}</th>
                  <th className="text-right py-2 font-medium">{t('techSupportDetails.student')}</th>
                  <th className="text-right py-2 font-medium">{t('reports.stageColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {ticketResults.map((tk) => (
                  <tr key={tk.id} onClick={() => setSelectedTicket(tk)} className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className="py-2 text-slate-800" dir="ltr">{tk.ticketId}</td>
                    <td className="py-2 text-slate-600" dir="ltr">{tk.createdAt?.toDate ? format(tk.createdAt.toDate(), 'yyyy-MM-dd') : '—'}</td>
                    <td className="py-2 text-slate-600">{branchName(tk.branch)}</td>
                    <td className="py-2 text-slate-600">{problemTypeName(tk.problemType)}</td>
                    <td className="py-2 text-slate-600">{tk.assignedToNames?.join(listSep) || '—'}</td>
                    <td className="py-2 text-slate-600">{t(`statuses.techSupport.${tk.status}`, tk.status)}</td>
                    <td className="py-2 text-slate-600">{tk.resolutionMessageSentAt && tk.createdAt ? formatDuration(elapsedMs(tk.createdAt, tk.resolutionMessageSentAt, sla), t) : '—'}</td>
                    <td className="py-2 text-slate-600">{tk.studentName || '—'}</td>
                    <td className="py-2 text-slate-600">{tk.stage || '—'}</td>
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
      {selectedTicket && (
        <TechSupportDetails ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      )}
    </div>
  );
}
