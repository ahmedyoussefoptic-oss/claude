import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';
import { branchScopeConstraintValues, userBranches } from '../utils/scope';

const MAIN_FLOW_KEYS = ['RECEIVED', 'IN_PROGRESS', 'WAITING_PARENT_RESPONSE', 'SOLVED', 'CLOSED'];
const EXCEPTION_FLOW_KEYS = [
  { key: 'ESCALATED', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { key: 'REJECTED', color: 'text-red-600 bg-red-50 border-red-200' },
];

export default function FlowMap() {
  const { t, i18n } = useTranslation();
  const listSep = i18n.language === 'ar' ? '، ' : ', ';
  const { userData } = useAuthStore();
  const branches = useBranches();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState('');

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      // Branch-scoped staff only ever see their own branch(es)' flow.
      constraints.unshift(where('branch', 'in', branchScopeConstraintValues(userData)));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComplaints(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.access, userData?.branch, userData?.branches?.join(',')]);

  const scoped = useMemo(() => {
    return complaints.filter((c) => {
      if (branchFilter && c.branch !== branchFilter) return false;
      return true;
    });
  }, [complaints, userData, branchFilter]);

  const countOf = (status) => scoped.filter((c) => c.status === status).length;
  const visibleBranches = userData?.access === 'all' ? branches : branches.filter((b) => userBranches(userData).includes(b.id));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('flowMap.title')}</h1>
          <p className="text-slate-500 mt-1">{t('flowMap.subtitle')}</p>
        </div>
        {visibleBranches.length > 1 && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
          >
            <option value="">{t('common.allBranches')}</option>
            {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-6">{t('flowMap.mainFlowTitle')}</h3>
            <div className="flex items-stretch overflow-x-auto pb-2">
              {MAIN_FLOW_KEYS.map((key, i) => (
                <div key={key} className="flex items-center flex-1 last:flex-none min-w-[140px]">
                  <div className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl p-4 text-center min-w-[130px]">
                    <p className="font-bold text-sm text-slate-800 mb-1">{i + 1}. {t(`statuses.complaint.${key}`, key)}</p>
                    <p className="text-3xl font-extrabold text-primary tabular-nums">{countOf(key)}</p>
                    <p className="text-xs text-slate-400 mt-1">{t(`flowMap.who.${key}`)}</p>
                  </div>
                  {i < MAIN_FLOW_KEYS.length - 1 && (
                    <ChevronLeft className="w-6 h-6 text-slate-300 shrink-0 mx-1" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXCEPTION_FLOW_KEYS.map((step) => (
              <div key={step.key} className={`rounded-2xl border p-5 ${step.color}`}>
                <p className="text-sm font-bold mb-1">{t(`statuses.complaint.${step.key}`, step.key)}</p>
                <p className="text-3xl font-extrabold tabular-nums">{countOf(step.key)}</p>
                <p className="text-xs mt-1 opacity-80">
                  {step.key === 'ESCALATED' ? t('flowMap.escalatedNote') : t('flowMap.rejectedNote')}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-1">{t('flowMap.totalInScope')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {userData?.access === 'all'
                ? t('common.allBranches')
                : `${t('reports.branchShort')} ${visibleBranches.map((b) => b.name).join(listSep) || '—'}`}
              {branchFilter && ` · ${t('flowMap.filteredBy')} ${branches.find((b) => b.id === branchFilter)?.name}`}
            </p>
            <p className="text-4xl font-extrabold text-slate-900 tabular-nums">{scoped.length}</p>
          </div>
        </>
      )}
    </div>
  );
}
