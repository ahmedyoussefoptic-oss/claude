import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Plus, ChevronLeft, Download, Loader2, SlidersHorizontal, RotateCcw, Link2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import ComplaintForm from '../components/complaints/ComplaintForm';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useComplaintTypes } from '../hooks/useOrgData';
import MessageStatusIndicators from '../components/common/MessageStatusIndicators';
import { normalizeAssignees } from '../utils/assignees';
import { branchScopeConstraintValues } from '../utils/scope';
import { formatDuration } from '../utils/duration';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const QUICK_FILTER_IDS = ['ALL', 'OPEN', 'OVERDUE', 'ESCALATED', 'CLOSED'];

// Recognized but not shown as a tab — only reachable via a dashboard KPI
// link (?filter=IN_PROGRESS / ?filter=REOPENED), same list underneath.
const LINK_ONLY_FILTERS = ['IN_PROGRESS', 'REOPENED'];

export default function ComplaintsList() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const location = useLocation();
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [publicLinkOnly, setPublicLinkOnly] = useState(false);

  // Dashboard KPI cards deep-link here with ?filter=... and/or ?type=... so
  // each card lands on the slice of the list it actually represents.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const filter = params.get('filter');
    const type = params.get('type');
    if (filter && ([...QUICK_FILTER_IDS, ...LINK_ONLY_FILTERS].includes(filter))) {
      setQuickFilter(filter);
    }
    if (type) setTypeFilter(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Keeps the open detail drawer's complaint in sync with live Firestore
  // data — otherwise it stays frozen at whatever it was when first opened.
  useEffect(() => {
    if (!selectedComplaint) return;
    const fresh = complaints.find((c) => c.id === selectedComplaint.id);
    setSelectedComplaint(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaints]);

  // Opens the shared/linked complaint (?openId=<doc id>, see
  // ComplaintDetails.jsx's "share with staff" button) once it shows up in
  // the branch-scoped live list — a recipient with no access to that
  // branch just never gets a match, same as browsing the list normally.
  // The ref keeps this a one-time thing so closing the drawer afterward
  // doesn't reopen it the next time `complaints` updates.
  const openedFromLinkRef = useRef(false);
  useEffect(() => {
    if (openedFromLinkRef.current) return;
    const openId = new URLSearchParams(location.search).get('openId');
    if (!openId) return;
    const match = complaints.find((c) => c.id === openId);
    if (match) {
      setSelectedComplaint(match);
      openedFromLinkRef.current = true;
    }
  }, [complaints, location.search]);

  useEffect(() => {
    // Wait for the caller's own profile to load before scoping the query —
    // querying before it's known would either leak other branches' data or
    // (once the matching security rule is in place) fail outright.
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      // A branch-scoped account with no branch assigned must see nothing,
      // not everything — branchScopeConstraintValues falls back to
      // '__NONE__', which matches no real branch id.
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, ...data, ...normalizeAssignees(data) };
      });
      setComplaints(docs);
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.access, userData?.branch, userData?.branches?.join(',')]);

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

  const getStatusName = (status) => t(`statuses.complaint.${status}`, status);

  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (quickFilter === 'OPEN' && ['SOLVED', 'CLOSED', 'REJECTED'].includes(c.status)) return false;
      if (quickFilter === 'OVERDUE' && !c.isOverdue) return false;
      if (quickFilter === 'CLOSED' && !['SOLVED', 'CLOSED'].includes(c.status)) return false;
      if (quickFilter === 'ESCALATED' && c.status !== 'ESCALATED') return false;
      if (quickFilter === 'IN_PROGRESS' && !['IN_PROGRESS', 'RECEIVED'].includes(c.status)) return false;
      if (quickFilter === 'REOPENED' && !c.reopened) return false;
      if (typeFilter && c.complaintType !== typeFilter) return false;
      if (branchFilter && c.branch !== branchFilter) return false;
      if (publicLinkOnly && c.source !== 'PARENT_PORTAL') return false;
      if (dateFrom) {
        const createdAt = c.createdAt?.toDate?.();
        if (!createdAt || createdAt < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const createdAt = c.createdAt?.toDate?.();
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (!createdAt || createdAt > to) return false;
      }
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${c.complaintId || ''} ${c.studentName || ''} ${c.parentName || ''} ${c.studentId || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [complaints, search, quickFilter, typeFilter, branchFilter, dateFrom, dateTo, publicLinkOnly, userData]);

  const advancedFiltersActive = typeFilter || branchFilter || dateFrom || dateTo || publicLinkOnly;
  const resetAdvancedFilters = () => {
    setTypeFilter('');
    setBranchFilter('');
    setDateFrom('');
    setDateTo('');
    setPublicLinkOnly(false);
  };

  const handleExportCSV = () => {
    if (filteredComplaints.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,﻿";
    csvContent += `${i18n.language === 'ar' ? 'رقم الملاحظة' : 'Feedback #'},${t('common.student')},${t('common.parent')},${t('common.type')},${t('common.branch')},${t('common.date')},${t('common.status')}\n`;
    filteredComplaints.forEach((c) => {
      const createdAt = c.createdAt?.toDate ? format(c.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : '';
      csvContent += `${c.complaintId},"${c.studentName || ''}","${c.parentName || ''}","${c.complaintType || ''}","${c.branch || ''}","${createdAt}","${getStatusName(c.status)}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `complaints_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('complaintsList.title')}</h1>
          <p className="text-slate-500 mt-1">{t('complaintsList.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExportCSV} disabled={filteredComplaints.length === 0} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
            <Download className="w-4 h-4" />
            {t('common.export')}
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('complaintsList.newComplaint')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-50/50">
          <div className="relative w-full sm:w-96">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('complaintsList.searchPlaceholder')}
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {QUICK_FILTER_IDS.map(id => (
              <button
                key={id}
                onClick={() => { setQuickFilter(id); if (id === 'ALL') setTypeFilter(''); }}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${quickFilter === id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t(`complaintsList.quickFilters.${id}`)}
              </button>
            ))}
            {typeFilter && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap bg-primary/10 text-primary font-medium">
                {typeName(typeFilter)}
                <button onClick={() => setTypeFilter('')} className="hover:text-primary-dark">✕</button>
              </span>
            )}
          </div>
        </div>

        {/* Advanced filters: branch / type / date range */}
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-end bg-white">
          <div className="w-full sm:w-auto flex items-center gap-1.5 text-xs font-medium text-slate-400 sm:pb-2.5">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {t('common.additionalFilters')}
          </div>
          <div className="w-full sm:w-44">
            <label className="block text-xs text-slate-500 mb-1">{t('common.branch')}</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
            >
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-44">
            <label className="block text-xs text-slate-500 mb-1">{t('common.type')}</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
            >
              <option value="">{t('common.allTypes')}</option>
              {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-xs text-slate-500 mb-1">{t('common.fromDate')}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              dir="ltr"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-xs text-slate-500 mb-1">{t('common.toDate')}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              dir="ltr"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">&nbsp;</label>
            <button
              type="button"
              onClick={() => setPublicLinkOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors border ${
                publicLinkOnly ? 'bg-primary text-white border-primary font-medium' : 'text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              {t('common.publicLinkOnly')}
            </button>
          </div>
          {advancedFiltersActive && (
            <button
              onClick={resetAdvancedFilters}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('common.reset')}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="h-full flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{i18n.language === 'ar' ? 'رقم الملاحظة' : 'Feedback #'}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.studentParent')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.type')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.branch')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.date')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.status')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('reports.resolutionTime')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.parentMessages')}</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredComplaints.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedComplaint(c)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">
                      <div className="flex items-center gap-2">
                        {c.complaintId}
                        {c.source === 'PARENT_PORTAL' && (
                          <span title={t('common.submittedViaPublicLink')} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary shrink-0">
                            <Link2 className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{c.studentName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{c.parentName}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{typeName(c.complaintType)}</td>
                    <td className="px-6 py-4 text-slate-600">{branchName(c.branch)}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {c.createdAt ? format(c.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadge(c.status)}`}>
                        {getStatusName(c.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {c.solvedAt && c.createdAt ? formatDuration(c.solvedAt.toMillis() - c.createdAt.toMillis(), t) : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <MessageStatusIndicators
                        receiptSentAt={c.receiptMessageSentAt}
                        resolutionSentAt={c.resolutionMessageSentAt}
                        showResolution={['SOLVED', 'CLOSED'].includes(c.status)}
                      />
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredComplaints.length === 0 && (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center text-slate-500">
                      {t('complaintsList.noResults')}
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

      {showNewForm && (
        <ComplaintForm onClose={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
