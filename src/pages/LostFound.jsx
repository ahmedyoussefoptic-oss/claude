import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Plus, ChevronLeft, Loader2, Package, Link2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import LostFoundDetails from '../components/lostFound/LostFoundDetails';
import LostFoundForm from '../components/lostFound/LostFoundForm';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useItemCategories } from '../hooks/useOrgData';
import { ITEM_STATUS_LABELS, ITEM_STATUS_BADGE, REPORT_TYPES } from '../config/lostFound';
import MessageStatusIndicators from '../components/common/MessageStatusIndicators';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const FILTERS = [
  { id: 'ALL', name: 'الكل' },
  { id: 'UNCLAIMED', name: 'بانتظار المطالبة' },
  { id: 'MATCHED', name: 'تمت المطابقة' },
  { id: 'RETURNED', name: 'تم التسليم' },
];

export default function LostFound() {
  const { userData } = useAuthStore();
  const branches = useBranches();
  const itemCategories = useItemCategories();
  const location = useLocation();
  const [selectedItem, setSelectedItem] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [publicLinkOnly, setPublicLinkOnly] = useState(false);

  // Dashboard KPI cards deep-link here with ?filter=UNCLAIMED / ?filter=RETURNED.
  useEffect(() => {
    const filter = new URLSearchParams(location.search).get('filter');
    if (filter) setStatusFilter(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'lostFoundItems'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (publicLinkOnly && item.source !== 'PARENT_PORTAL') return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${item.itemCode} ${item.itemName} ${item.reporterName || ''} ${item.studentName || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [items, search, statusFilter, publicLinkOnly, userData]);

  const reportTypeName = (id) => REPORT_TYPES.find((t) => t.id === id)?.name || id;
  const categoryName = (id) => itemCategories.find((c) => c.id === id)?.name || id;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">المفقودات</h1>
          <p className="text-slate-500 mt-1">إدارة الأغراض المفقودة والمعثور عليها ومطابقتها بأصحابها</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            تسجيل جديد
          </button>
        </div>
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
              placeholder="ابحث برقم السجل، اسم الغرض، اسم الطالب..."
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
            <button
              type="button"
              onClick={() => setPublicLinkOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors border ${
                publicLinkOnly ? 'bg-primary text-white border-primary font-medium' : 'text-slate-600 border-transparent hover:bg-slate-100'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              عبر الرابط العام فقط
            </button>
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
                  <th className="px-6 py-4 font-medium whitespace-nowrap">رقم السجل</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">النوع</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الغرض</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الفرع</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">التاريخ</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">الحالة</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">رسائل ولي الأمر</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedItem(item)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">
                      <div className="flex items-center gap-2">
                        {item.itemCode}
                        {item.source === 'PARENT_PORTAL' && (
                          <span title="مُقدَّم عبر الرابط العام" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary shrink-0">
                            <Link2 className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 flex items-center gap-2">
                      <Package className="w-4 h-4 text-slate-400" />
                      {reportTypeName(item.reportType)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{item.itemName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{categoryName(item.category)}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{branchName(item.branch)}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {item.createdAt ? format(item.createdAt.toDate(), 'PP p', { locale: ar }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${ITEM_STATUS_BADGE[item.status]}`}>
                        {ITEM_STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <MessageStatusIndicators
                        receiptSentAt={item.receiptMessageSentAt}
                        resolutionSentAt={item.resolutionMessageSentAt}
                        showResolution={item.status === 'RETURNED'}
                      />
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-slate-500">
                      لا يوجد سجلات مطابقة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedItem && (
        <LostFoundDetails item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {showNewForm && (
        <LostFoundForm onClose={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
