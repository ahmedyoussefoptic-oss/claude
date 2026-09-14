import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Archive, Search, Loader2, ChevronLeft, X, Clock, CheckCircle2 } from 'lucide-react';
import { db } from '../config/firebase';
import { useBranches, useComplaintTypes } from '../hooks/useOrgData';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const asDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

export default function DeletedComplaints() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const getActionName = (action) => t(`actions.complaint.${action}`, action);
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'deletedComplaints'), orderBy('deletedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const c = e.complaint || {};
    const haystack = `${c.complaintId || ''} ${c.studentName || ''} ${c.parentName || ''} ${e.deletedByName || ''} ${e.reason || ''}`.toLowerCase();
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
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
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
                {filtered.map((e) => {
                  const c = e.complaint || {};
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelected(e)}>
                      <td className="px-6 py-4 font-medium text-slate-900" dir="ltr">{c.complaintId || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{c.studentName}</div>
                        <div className="text-slate-500 text-xs mt-0.5">{c.parentName}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{branchName(c.branch)}</td>
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
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
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
                <h2 className="text-xl font-bold text-slate-900">{t('deletedComplaints.complaintHash')}{selected.complaint?.complaintId}</h2>
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
                  <p className="text-xs text-slate-500 mb-0.5">{t('common.parent')}</p>
                  <p className="font-medium text-slate-900">{selected.complaint?.parentName}</p>
                  <p className="text-sm text-slate-500 mt-1" dir="ltr">{selected.complaint?.parentPhone}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                  <p className="text-xs text-slate-500 mb-0.5">{t('deletedComplaints.branchAndStudent')}</p>
                  <p className="font-medium text-slate-900">{selected.complaint?.studentName}</p>
                  <p className="text-sm text-slate-500 mt-1">{branchName(selected.complaint?.branch)} - {selected.complaint?.grade}</p>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h3 className="font-bold text-slate-900 text-lg">{selected.complaint?.subject || t('deletedComplaints.basicDetails')}</h3>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded whitespace-nowrap">{typeName(selected.complaint?.complaintType)}</span>
                </div>
                <p className="text-slate-600 leading-relaxed text-sm whitespace-pre-wrap">{selected.complaint?.details}</p>
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
                          <p className="font-medium text-slate-900">{getActionName(log.action)}</p>
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
                        {log.metadata?.reason && (
                          <div className="mt-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100">
                            <strong>{t('techSupportDetails.reasonLabel')}</strong> {log.metadata.reason}
                          </div>
                        )}
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
