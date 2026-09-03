import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, ChevronLeft, Loader2, Wrench } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import TechSupportDetails from '../components/techSupport/TechSupportDetails';
import TechSupportForm from '../components/techSupport/TechSupportForm';
import { PROBLEM_TYPES, TICKET_STATUS_LABELS, TICKET_STATUS_BADGE } from '../config/techSupport';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const FILTERS = [
  { id: 'ALL', name: 'الكل' },
  { id: 'ASSIGNED', name: 'مُسندة' },
  { id: 'IN_PROGRESS', name: 'قيد المعالجة' },
  { id: 'WAITING_CONFIRMATION', name: 'بانتظار التأكيد' },
  { id: 'CLOSED', name: 'مغلقة' },
];

export default function TechSupport() {
  const { userData } = useAuthStore();
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'techSupportTickets'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTickets(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${t.ticketId} ${t.studentName || ''} ${t.parentName || ''} ${t.nationalId || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, userData]);

  const problemTypeName = (id) => PROBLEM_TYPES.find((t) => t.id === id)?.name || id;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">حل المشكلات التقنية</h1>
          <p className="text-slate-500 mt-1">بلاغات تعذّر الوصول إلى المنصات التعليمية وحسابات الطلاب</p>
        </div>
        <button onClick={() => setShowNewForm(true)} className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
          <Plus className="w-4 h-4" />
          بلاغ تقني جديد
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-50/50">
          <div className="relative w-full sm:w-96">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم البلاغ، اسم الطالب، رقم الهوية..."
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${statusFilter === f.id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="h-full flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">رقم البلاغ</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الطالب / ولي الأمر</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">نوع المشكلة</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الفرع</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">المختص</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">التاريخ</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الحالة</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedTicket(t)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{t.ticketId}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{t.studentName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{t.parentName}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-slate-400" />
                      {problemTypeName(t.problemType)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{t.branch}</td>
                    <td className="px-6 py-4 text-slate-600">{t.assignedToName || '—'}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {t.createdAt ? format(t.createdAt.toDate(), 'PP p', { locale: ar }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${TICKET_STATUS_BADGE[t.status]}`}>
                        {TICKET_STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTickets.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-slate-500">لا يوجد بلاغات مطابقة</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedTicket && (
        <TechSupportDetails ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      )}
      {showNewForm && (
        <TechSupportForm onClose={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
