import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Loader2, ChevronLeft, Download, Star } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBranches, useComplaintTypes } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import { normalizeAssignees } from '../utils/assignees';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const STATUS_IDS = ['', 'RECEIVED', 'IN_PROGRESS', 'WAITING_PARENT_RESPONSE', 'SOLVED', 'ESCALATED', 'REJECTED', 'CLOSED'];
const PRIORITY_IDS = ['', 'NORMAL', 'HIGH', 'URGENT'];

const getStatusBadge = (status) => {
  switch (status) {
    case 'RECEIVED': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'IN_PROGRESS': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'WAITING_PARENT_RESPONSE': return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'SOLVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'CLOSED': return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
    case 'ESCALATED': return 'bg-orange-100 text-orange-800 border-orange-200';
    default: return 'bg-slate-100 text-slate-800 border-slate-200';
  }
};

export default function Search() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedComplaint, setSelectedComplaint] = useState(null);

  const [filters, setFilters] = useState({
    complaintId: '',
    studentName: '',
    studentId: '',
    parentName: '',
    branch: '',
    status: '',
    priority: '',
    complaintType: '',
    from: '',
    to: '',
  });

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComplaints(snapshot.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ...data, ...normalizeAssignees(data) };
      }));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const results = useMemo(() => {
    return complaints.filter((c) => {
      if (filters.complaintId && !c.complaintId?.toLowerCase().includes(filters.complaintId.toLowerCase())) return false;
      if (filters.studentName && !c.studentName?.toLowerCase().includes(filters.studentName.toLowerCase())) return false;
      if (filters.studentId && !c.studentId?.toLowerCase().includes(filters.studentId.toLowerCase())) return false;
      if (filters.parentName && !c.parentName?.toLowerCase().includes(filters.parentName.toLowerCase())) return false;
      if (filters.branch && c.branch !== filters.branch) return false;
      if (filters.status && c.status !== filters.status) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      if (filters.complaintType && c.complaintType !== filters.complaintType) return false;
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
  }, [complaints, filters, userData]);

  const anyFilterActive = Object.values(filters).some((v) => v !== '');

  const handleExportCSV = () => {
    if (results.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,﻿";
    csvContent += [
      t('reports.complaintNumber'), t('common.student'), t('common.parent'), t('common.type'),
      t('complaintForm.priorityLabel'), t('common.branch'), t('common.status'), t('search.createdDateCsv'),
    ].join(',') + '\n';
    results.forEach((c) => {
      const createdAt = c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : '';
      csvContent += `${c.complaintId},"${c.studentName || ''}","${c.parentName || ''}","${c.complaintType || ''}","${c.priority || ''}","${c.branch || ''}","${c.status || ''}","${createdAt}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `complaints_search_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('nav.advancedSearch')}</h1>
        <p className="text-slate-500 mt-1">{t('search.pageSubtitle')}</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('reports.complaintNumber')}</label>
            <input type="text" name="complaintId" value={filters.complaintId} onChange={handleFilterChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('search.studentNameLabel')}</label>
            <input type="text" name="studentName" value={filters.studentName} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('search.studentIdLabel')}</label>
            <input type="text" name="studentId" value={filters.studentId} onChange={handleFilterChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('search.parentNameLabel')}</label>
            <input type="text" name="parentName" value={filters.parentName} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.branch')}</label>
            <select name="branch" value={filters.branch} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.status')}</label>
            <select name="status" value={filters.status} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              {STATUS_IDS.map((id) => <option key={id} value={id}>{id ? t(`statuses.complaint.${id}`, id) : t('search.allStatuses')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.priorityLabel')}</label>
            <select name="priority" value={filters.priority} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              {PRIORITY_IDS.map((id) => <option key={id} value={id}>{id ? t(`complaintForm.priorities.${id}`, id) : t('search.allPriorities')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.type')}</label>
            <select name="complaintType" value={filters.complaintType} onChange={handleFilterChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">{t('common.allTypes')}</option>
              {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.fromDate')}</label>
            <input type="date" name="from" value={filters.from} onChange={handleFilterChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('common.toDate')}</label>
            <input type="date" name="to" value={filters.to} onChange={handleFilterChange} dir="ltr" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <p className="text-sm text-slate-600 flex items-center gap-2">
            <SearchIcon className="w-4 h-4" />
            {anyFilterActive ? t('search.resultsCount', { count: results.length }) : t('search.totalCount', { count: complaints.length })}
          </p>
          <button onClick={handleExportCSV} disabled={results.length === 0} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
            <Download className="w-4 h-4" />
            {t('search.exportResults')}
          </button>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('reports.complaintNumber')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.studentParent')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.branch')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.date')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.status')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('search.parentSurveyLabel')}</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {results.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedComplaint(c)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{c.complaintId}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{c.studentName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{c.parentName}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{c.branch}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {c.createdAt ? format(c.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadge(c.status)}`}>
                        {t(`statuses.complaint.${c.status}`, c.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {typeof c.satisfactionRate === 'number' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          {c.satisfactionRate.toFixed(1)} / 5
                        </span>
                      ) : c.reopened ? (
                        <span className="text-xs text-red-500">{t('search.reopenedWithoutRatingShort')}</span>
                      ) : (
                        <span className="text-xs text-slate-300">{t('search.notSurveyed')}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                      {t('search.noResults')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedComplaint && (
        <ComplaintDetails complaint={selectedComplaint} onClose={() => setSelectedComplaint(null)} />
      )}
    </div>
  );
}
