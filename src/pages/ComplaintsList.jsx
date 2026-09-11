import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Plus, ChevronLeft, Download, Loader2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import ComplaintForm from '../components/complaints/ComplaintForm';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { COMPLAINT_TYPES } from '../config/complaintTypes';
import MessageStatusIndicators from '../components/common/MessageStatusIndicators';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const QUICK_FILTERS = [
  { id: 'ALL', name: 'الكل' },
  { id: 'OPEN', name: 'مفتوحة' },
  { id: 'OVERDUE', name: 'متأخرة' },
  { id: 'CLOSED', name: 'مغلقة' },
];

// Recognized but not shown as a tab — only reachable via a dashboard KPI
// link (?filter=IN_PROGRESS / ?filter=REOPENED), same list underneath.
const LINK_ONLY_FILTERS = ['IN_PROGRESS', 'REOPENED'];

export default function ComplaintsList() {
  const { userData } = useAuthStore();
  const branches = useBranches();
  const location = useLocation();
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('');

  // Dashboard KPI cards deep-link here with ?filter=... and/or ?type=... so
  // each card lands on the slice of the list it actually represents.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const filter = params.get('filter');
    const type = params.get('type');
    if (filter && ([...QUICK_FILTERS.map((f) => f.id), ...LINK_ONLY_FILTERS].includes(filter))) {
      setQuickFilter(filter);
    }
    if (type) setTypeFilter(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    // Wait for the caller's own profile to load before scoping the query —
    // querying before it's known would either leak other branches' data or
    // (once the matching security rule is in place) fail outright.
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      // A branch-scoped account with no branch assigned must see nothing,
      // not everything — '__NONE__' matches no real branch id.
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setComplaints(docs);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

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

  const typeName = (id) => COMPLAINT_TYPES.find((t) => t.id === id)?.name || id;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (quickFilter === 'OPEN' && ['SOLVED', 'CLOSED', 'REJECTED'].includes(c.status)) return false;
      if (quickFilter === 'OVERDUE' && !c.isOverdue) return false;
      if (quickFilter === 'CLOSED' && !['SOLVED', 'CLOSED'].includes(c.status)) return false;
      if (quickFilter === 'IN_PROGRESS' && !['IN_PROGRESS', 'RECEIVED'].includes(c.status)) return false;
      if (quickFilter === 'REOPENED' && !c.reopened) return false;
      if (typeFilter && c.complaintType !== typeFilter) return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${c.complaintId || ''} ${c.studentName || ''} ${c.parentName || ''} ${c.studentId || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [complaints, search, quickFilter, typeFilter, userData]);

  const handleExportCSV = () => {
    if (filteredComplaints.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,﻿";
    csvContent += "رقم الملاحظة,الطالب,ولي الأمر,التصنيف,الفرع,التاريخ,الحالة\n";
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
          <h1 className="text-2xl font-bold text-slate-900">سجل الملاحظات</h1>
          <p className="text-slate-500 mt-1">إدارة ومتابعة جميع ملاحظات أولياء الأمور</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExportCSV} disabled={filteredComplaints.length === 0} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
            <Download className="w-4 h-4" />
            تصدير
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            ملاحظة جديدة
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
              placeholder="ابحث برقم الملاحظة، اسم الطالب..."
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {QUICK_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => { setQuickFilter(f.id); if (f.id === 'ALL') setTypeFilter(''); }}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${quickFilter === f.id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {f.name}
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
                  <th className="px-6 py-4 font-medium whitespace-nowrap">رقم الملاحظة</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الطالب / ولي الأمر</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">التصنيف</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الفرع</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">التاريخ</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الحالة</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">رسائل ولي الأمر</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredComplaints.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedComplaint(c)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{c.complaintId}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{c.studentName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{c.parentName}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{typeName(c.complaintType)}</td>
                    <td className="px-6 py-4 text-slate-600">{branchName(c.branch)}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {c.createdAt ? format(c.createdAt.toDate(), 'PP p', { locale: ar }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadge(c.status)}`}>
                        {getStatusName(c.status)}
                      </span>
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
                    <td colSpan="8" className="px-6 py-12 text-center text-slate-500">
                      لا يوجد ملاحظات مطابقة
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
