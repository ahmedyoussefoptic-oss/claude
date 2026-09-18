import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Archive, Search, Loader2, ChevronLeft, X, Clock, CheckCircle2 } from 'lucide-react';
import { db } from '../config/firebase';
import { useBranches, useComplaintTypes } from '../hooks/useOrgData';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const asDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

const TYPE_IDS = ['ALL', 'COMPLAINT', 'LOST_FOUND', 'TECH_SUPPORT'];

// Each archive collection stores the deleted record under a different field
// name (complaint / item / ticket) and uses its own tracking-number/name
// fields — these helpers read the right one for a normalized entry
// {type, record, ...}.
const recordNumber = (entry) => {
  if (entry.type === 'LOST_FOUND') return entry.record?.itemCode;
  if (entry.type === 'TECH_SUPPORT') return entry.record?.ticketId;
  return entry.record?.complaintId;
};
const primaryName = (entry) => (entry.type === 'LOST_FOUND' ? entry.record?.itemName : entry.record?.studentName);
const secondaryName = (entry) => (entry.type === 'LOST_FOUND' ? entry.record?.reporterName : entry.record?.parentName);
const actionNamespace = (type) => (type === 'LOST_FOUND' ? 'lostFound' : type === 'TECH_SUPPORT' ? 'techSupport' : 'complaint');

export default function DeletedComplaints() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const [complaintEntries, setComplaintEntries] = useState([]);
  const [lostFoundEntries, setLostFoundEntries] = useState([]);
  const [techSupportEntries, setTechSupportEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);

  // Three independent archive collections, kept in separate state and only
  // merged at render time — a shared array here would let whichever
  // listener resolves last silently wipe out the other two's entries.
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'deletedComplaints'), orderBy('deletedAt', 'desc')), (snap) => {
        setComplaintEntries(snap.docs.map((d) => ({ id: d.id, type: 'COMPLAINT', record: d.data().complaint, ...d.data() })));
        setLoading(false);
      }),
      onSnapshot(query(collection(db, 'deletedLostFoundItems'), orderBy('deletedAt', 'desc')), (snap) => {
        setLostFoundEntries(snap.docs.map((d) => ({ id: d.id, type: 'LOST_FOUND', record: d.data().item, ...d.data() })));
      }),
      onSnapshot(query(collection(db, 'deletedTechSupportTickets'), orderBy('deletedAt', 'desc')), (snap) => {
        setTechSupportEntries(snap.docs.map((d) => ({ id: d.id, type: 'TECH_SUPPORT', record: d.data().ticket, ...d.data() })));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const allEntries = useMemo(() => {
    return [...complaintEntries, ...lostFoundEntries, ...techSupportEntries].sort((a, b) => {
      const aMs = asDate(a.deletedAt)?.getTime() ?? 0;
      const bMs = asDate(b.deletedAt)?.getTime() ?? 0;
      return bMs - aMs;
    });
  }, [complaintEntries, lostFoundEntries, techSupportEntries]);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;
  const getActionName = (entry) => (action) => t(`actions.${actionNamespace(entry.type)}.${action}`, action);

  const filtered = allEntries.filter((e) => {
    if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
    if (!search) return true;
    const term = search.toLowerCase();
    const haystack = `${recordNumber(e) || ''} ${primaryName(e) || ''} ${secondaryName(e) || ''} ${e.deletedByName || ''} ${e.reason || ''}`.toLowerCase();
    return haystack.includes(term);
  });

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Archive className="w-6 h-6 text-primary" />
          {t('deletedComplaints.title')}
        </h1>
        <p className="text-slate-500 mt-1">{t('deletedComplaints.subtitle')}</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('deletedComplaints.searchPlaceholder')}
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {TYPE_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setTypeFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${typeFilter === id ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t(`deletedComplaints.types.${id}`)}
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
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('deletedComplaints.types.ALL_HEADER')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('reports.complaintNumber')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('complaintsList.studentParent')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('common.branch')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('deletedComplaints.deletedAtHeader')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('deletedComplaints.deletedByHeader')}</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">{t('deletedComplaints.deleteReasonHeader')}</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((e) => (
                  <tr key={`${e.type}-${e.id}`} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelected(e)}>
                    <td className="px-6 py-4">
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">{t(`deletedComplaints.types.${e.type}`)}</span>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{recordNumber(e) || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{primaryName(e)}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{secondaryName(e)}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{branchName(e.record?.branch)}</td>
                    <td className="px-6 py-4 text-slate-600" dir="ltr">
                      {asDate(e.deletedAt) ? format(asDate(e.deletedAt), 'PP p', { locale: dateLocale }) : ''}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{e.deletedByName || '—'}</td>
                    <td className="px-6 py-4 text-slate-600 max-w-xs truncate">{e.reason || '—'}</td>
                    <td className="px-6 py-4 text-left">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-slate-500">
                      {t('deletedComplaints.noDeletedComplaints')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
          <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600">{t(`deletedComplaints.types.${selected.type}`)}</span>
                  <h2 className="text-xl font-bold text-slate-900">{t('deletedComplaints.complaintHash')}{recordNumber(selected)}</h2>
                </div>
                <p className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                  <Clock className="w-4 h-4" />
                  {t('deletedComplaints.deletedAtBy', {
                    date: asDate(selected.deletedAt) ? format(asDate(selected.deletedAt), 'PP p', { locale: dateLocale }) : '',
                    name: selected.deletedByName,
                  })}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="bg-red-50 border border-red-100 text-red-800 rounded-xl p-4 text-sm">
                <p className="font-bold mb-1">{t('deletedComplaints.deleteReasonHeader')}</p>
                <p>{selected.reason}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                  <p className="text-xs text-slate-500 mb-0.5">{selected.type === 'LOST_FOUND' ? t('lostFoundDetails.contact') : t('common.parent')}</p>
                  <p className="font-medium text-slate-900">{secondaryName(selected)}</p>
                  <p className="text-sm text-slate-500 mt-1" dir="ltr">{selected.record?.parentPhone || selected.record?.reporterPhone}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                  <p className="text-xs text-slate-500 mb-0.5">{t('deletedComplaints.branchAndStudent')}</p>
                  <p className="font-medium text-slate-900">{primaryName(selected)}</p>
                  <p className="text-sm text-slate-500 mt-1">{branchName(selected.record?.branch)} {selected.record?.grade ? `- ${selected.record.grade}` : ''}</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h3 className="font-bold text-slate-900 text-lg">
                    {selected.type === 'LOST_FOUND' ? primaryName(selected) : (selected.record?.subject || t('deletedComplaints.basicDetails'))}
                  </h3>
                  {selected.type === 'COMPLAINT' && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded whitespace-nowrap">{typeName(selected.record?.complaintType)}</span>
                  )}
                </div>
                <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{selected.record?.details || selected.record?.description}</p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-lg mb-4">{t('deletedComplaints.activityLogBeforeDeletion')}</h3>
                <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
                  {(selected.activityLog || []).map((log, i) => (
                    <div key={i} className="relative flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-slate-50">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                        <div className="flex justify-between mb-2">
                          <p className="font-medium text-slate-900">{getActionName(selected)(log.action)}</p>
                          <p className="text-xs text-slate-400" dir="ltr">
                            {asDate(log.createdAt) ? format(asDate(log.createdAt), 'p', { locale: dateLocale }) : ''}
                          </p>
                        </div>
                        <p className="text-sm text-slate-600 mb-1">{t('complaintDetails.by')} {log.actorName || t('complaintDetails.system')}</p>
                        {log.metadata?.solutionDetails && (
                          <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                            <strong>{t('deletedComplaints.solutionLabel')}</strong> {log.metadata.solutionDetails}
                          </div>
                        )}
                        {log.metadata?.returnedTo && (
                          <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                            <strong>{t('lostFoundDetails.returnedToLabel')}</strong> {log.metadata.returnedTo}
                          </div>
                        )}
                        {log.metadata?.reason && (
                          <div className="mt-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100">
                            <strong>{t('techSupportDetails.reasonLabel')}</strong> {log.metadata.reason}
                          </div>
                        )}
                        {log.metadata?.note && <p className="text-sm text-slate-600 mt-1">{log.metadata.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
