import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Plus, ChevronLeft, Loader2, Wrench, Link2, MessageSquare } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useDepartments, useProblemTypes } from '../hooks/useOrgData';
import TechSupportDetails from '../components/techSupport/TechSupportDetails';
import TechSupportForm from '../components/techSupport/TechSupportForm';
import { TICKET_STATUS_BADGE, OPEN_TICKET_STATUSES, isTicketOverdue } from '../config/techSupport';
import ReminderButton from '../components/common/ReminderButton';
import MessageStatusIndicators from '../components/common/MessageStatusIndicators';
import { branchScopeConstraintValues } from '../utils/scope';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const FILTER_IDS = ['ALL', 'OPEN', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'OVERDUE', 'SOLVED', 'CLOSED'];
const matchesStatus = (tk, id) => (id === 'ALL' ? true : id === 'OPEN' ? OPEN_TICKET_STATUSES.includes(tk.status) : id === 'UNASSIGNED' ? OPEN_TICKET_STATUSES.includes(tk.status) && !(tk.assignedTo || []).length : id === 'OVERDUE' ? isTicketOverdue(tk) : tk.status === id);

export default function TechSupport() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const { userData } = useAuthStore();
  const branches = useBranches();
  const departments = useDepartments();
  const problemTypes = useProblemTypes();
  const location = useLocation();
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('');
  // Curriculum/section (the ticket's `department`); '__NONE__' = not set.
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [publicLinkOnly, setPublicLinkOnly] = useState(false);

  // Keeps the open detail drawer's ticket in sync with live Firestore data —
  // without this, actions taken inside the drawer (solve, send, etc.) would
  // update the real record but the drawer's own status badge would stay
  // frozen at whatever it was when the drawer was first opened, since
  // selectedTicket is otherwise just a one-time snapshot from the row click.
  useEffect(() => {
    if (!selectedTicket) return;
    const fresh = tickets.find((tk) => tk.id === selectedTicket.id);
    setSelectedTicket(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  // Opens the shared/linked ticket (?openId=<doc id>, see
  // TechSupportDetails.jsx's "share with staff" button) once it shows up in
  // the branch-scoped live list. One-time via the ref so closing the drawer
  // afterward doesn't reopen it the next time `tickets` updates.
  const openedFromLinkRef = useRef(false);
  useEffect(() => {
    if (openedFromLinkRef.current) return;
    const openId = new URLSearchParams(location.search).get('openId');
    if (!openId) return;
    const match = tickets.find((tk) => tk.id === openId);
    if (match) {
      setSelectedTicket(match);
      openedFromLinkRef.current = true;
    }
  }, [tickets, location.search]);

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
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'techSupportTickets'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Normalizes tickets created before assignedTo became an array
      // (legacy docs stored a single scalar uid/name) so every consumer of
      // `tickets` can treat assignedTo/assignedToNames as arrays uniformly.
      setTickets(snapshot.docs.map((d) => {
        const data = d.data();
        const assignedTo = Array.isArray(data.assignedTo) ? data.assignedTo : (data.assignedTo ? [data.assignedTo] : []);
        const assignedToNames = data.assignedToNames || (data.assignedToName ? [data.assignedToName] : []);
        return { id: d.id, ...data, assignedTo, assignedToNames };
      }));
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.access, userData?.branch, userData?.branches?.join(',')]);

  // Everything except the status chip — chips count within this set.
  const baseTickets = useMemo(() => {
    return tickets.filter((tk) => {
      if (branchFilter && tk.branch !== branchFilter) return false;
      if (departmentFilter && (tk.department || '__NONE__') !== departmentFilter) return false;
      if (publicLinkOnly && tk.source !== 'PARENT_PORTAL') return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = `${tk.ticketId} ${tk.studentName || ''} ${tk.parentName || ''} ${tk.nationalId || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [tickets, search, branchFilter, departmentFilter, publicLinkOnly]);
  const statusCounts = useMemo(() => Object.fromEntries(FILTER_IDS.map((id) => [id, baseTickets.filter((tk) => matchesStatus(tk, id)).length])), [baseTickets]);
  const filteredTickets = useMemo(() => {
    return baseTickets.filter((tk) => matchesStatus(tk, statusFilter));
  }, [baseTickets, statusFilter]);

  const problemTypeName = (id) => problemTypes.find((pt) => pt.id === id)?.name || id;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const departmentName = (id) => departments.find((d) => d.id === id)?.name || id;

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
                <span className={`mr-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums ${statusFilter === id ? 'bg-white/25 text-white' : id === 'UNASSIGNED' && statusCounts[id] > 0 ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{statusCounts[id]}</span>
              </button>
            ))}
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-600 shrink-0"
            >
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-600 shrink-0"
            >
              <option value="">{t('common.allDepartments')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="__NONE__">{t('common.noDepartment')}</option>
            </select>
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
                        {tk.hasInternalComment && (
                          <span title={t('common.hasInternalComment')} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 shrink-0">
                            <MessageSquare className="w-3 h-3" />
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
                    <td className="px-6 py-4 text-slate-600">
                      {branchName(tk.branch)}
                      {tk.department && <div className="text-xs text-slate-400 mt-0.5">{departmentName(tk.department)}</div>}
                      {(tk.stage || tk.grade) && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded" dir="ltr">
                          {[tk.stage, tk.grade].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{tk.assignedToNames?.join(listSep) || '—'}</td>
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
                        record={tk}
                        showResolution={['WAITING_CONFIRMATION', 'CLOSED', 'REOPENED'].includes(tk.status)}
                      />
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="flex items-center justify-end gap-1">
                        <ReminderButton kind="techSupport" record={tk} />
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                          <ChevronLeft className="w-5 h-5" />
                        </div>
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
