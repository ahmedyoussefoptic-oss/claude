import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Plus, ChevronLeft, Loader2, Wrench, Link2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useProblemTypes } from '../hooks/useOrgData';
import TechSupportDetails from '../components/techSupport/TechSupportDetails';
import TechSupportForm from '../components/techSupport/TechSupportForm';
import { TICKET_STATUS_BADGE, OPEN_TICKET_STATUSES } from '../config/techSupport';
import MessageStatusIndicators from '../components/common/MessageStatusIndicators';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const FILTER_IDS = ['ALL', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CONFIRMATION', 'CLOSED'];

export default function TechSupport() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const problemTypes = useProblemTypes();
  const location = useLocation();
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [publicLinkOnly, setPublicLinkOnly] = useState(false);

  // Dashboard KPI cards deep-link here with ?filter=OPEN / ?filter=OVERDUE
  // (combined states not covered by the visible tabs above).
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
    const q = query(collection(db, 'techSupportTickets'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTickets(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((tk) => {
      if (statusFilter === 'OPEN' && !OPEN_TICKET_STATUSES.includes(tk.status)) return false;
      if (statusFilter === 'OVERDUE' && !tk.isOverdue) return false;
      if (!['ALL', 'OPEN', 'OVERDUE'].includes(statusFilter) && tk.status !== statusFilter) return false;
      if (publicLinkOnly && tk.source !== 'PARENT_PORTAL') return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${tk.ticketId} ${tk.studentName || ''} ${tk.parentName || ''} ${tk.nationalId || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, publicLinkOnly, userData]);

  const problemTypeName = (id) => problemTypes.find((pt) => pt.id === id)?.name || id;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('techSupportList.title')}</h1>
          <p className="text-slate-500 mt-1">{t('techSupportList.subtitle')}</p>
        </div>
        <button onClick={() => setShowNewForm(true)} className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {t('techSupportList.newTicket')}
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
              placeholder={t('techSupportList.searchPlaceholder')}
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {FILTER_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${statusFilter === id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t(`techSupportList.filters.${id}`)}
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
              {t('common.publicLinkOnly')}
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
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('techSupportList.ticketNumber')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.studentParent')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('techSupportList.problemType')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.branch')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('techSupportList.specialist')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.date')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.status')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.parentMessages')}</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredTickets.map((tk) => (
                  <tr key={tk.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedTicket(tk)}>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">
                      <div className="flex items-center gap-2">
                        {tk.ticketId}
                        {tk.source === 'PARENT_PORTAL' && (
                          <span title={t('techSupportList.submittedViaPublicLink')} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary shrink-0">
                            <Link2 className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{tk.studentName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{tk.parentName}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-slate-400" />
                      {problemTypeName(tk.problemType)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{branchName(tk.branch)}</td>
                    <td className="px-6 py-4 text-slate-600">{tk.assignedToName || '—'}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {tk.createdAt ? format(tk.createdAt.toDate(), 'PP p', { locale: dateLocale }) : ''}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${TICKET_STATUS_BADGE[tk.status]}`}>
                        {t(`statuses.techSupport.${tk.status}`, tk.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <MessageStatusIndicators
                        receiptSentAt={tk.receiptMessageSentAt}
                        resolutionSentAt={tk.resolutionMessageSentAt}
                        showResolution={['WAITING_CONFIRMATION', 'CLOSED', 'REOPENED'].includes(tk.status)}
                      />
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
                    <td colSpan="9" className="px-6 py-12 text-center text-slate-500">{t('techSupportList.noResults')}</td>
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
