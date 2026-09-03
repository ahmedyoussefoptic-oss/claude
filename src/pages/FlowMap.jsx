import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { db } from '../config/firebase';
import useAuthStore from '../stores/useAuthStore';
import { useBranches } from '../hooks/useOrgData';

const MAIN_FLOW = [
  { key: 'RECEIVED', label: 'استلام الشكوى', who: 'موظف خدمة العملاء' },
  { key: 'IN_PROGRESS', label: 'قيد المعالجة', who: 'المختص المسند إليه' },
  { key: 'WAITING_PARENT_RESPONSE', label: 'بانتظار ولي الأمر', who: 'رد ولي الأمر' },
  { key: 'SOLVED', label: 'تم الحل', who: 'بانتظار الإغلاق' },
  { key: 'CLOSED', label: 'الإغلاق', who: 'مغلقة نهائياً' },
];

const EXCEPTION_FLOW = [
  { key: 'ESCALATED', label: 'مصعّدة', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { key: 'REJECTED', label: 'مرفوضة', color: 'text-red-600 bg-red-50 border-red-200' },
];

export default function FlowMap() {
  const { userData } = useAuthStore();
  const branches = useBranches();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState('');

  useEffect(() => {
    if (!userData) return;
    const constraints = [orderBy('createdAt', 'desc')];
    if (userData.access !== 'all') {
      // Branch-scoped staff only ever see their own branch's flow.
      constraints.unshift(where('branch', '==', userData.branch || '__NONE__'));
    }
    const q = query(collection(db, 'complaints'), ...constraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComplaints(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [userData?.access, userData?.branch]);

  const scoped = useMemo(() => {
    return complaints.filter((c) => {
      if (branchFilter && c.branch !== branchFilter) return false;
      return true;
    });
  }, [complaints, userData, branchFilter]);

  const countOf = (status) => scoped.filter((c) => c.status === status).length;
  const visibleBranches = userData?.access === 'all' ? branches : branches.filter((b) => b.id === userData?.branch);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">خريطة مسار الشكاوى</h1>
          <p className="text-slate-500 mt-1">نظرة عامة حية على عدد الشكاوى في كل مرحلة من مراحل المعالجة</p>
        </div>
        {visibleBranches.length > 1 && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
          >
            <option value="">كل الفروع</option>
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
            <h3 className="font-bold text-slate-900 mb-6">المسار الأساسي</h3>
            <div className="flex items-stretch overflow-x-auto pb-2">
              {MAIN_FLOW.map((step, i) => (
                <div key={step.key} className="flex items-center flex-1 last:flex-none min-w-[140px]">
                  <div className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl p-4 text-center min-w-[130px]">
                    <p className="font-bold text-sm text-slate-800 mb-1">{i + 1}. {step.label}</p>
                    <p className="text-3xl font-extrabold text-primary tabular-nums">{countOf(step.key)}</p>
                    <p className="text-xs text-slate-400 mt-1">{step.who}</p>
                  </div>
                  {i < MAIN_FLOW.length - 1 && (
                    <ChevronLeft className="w-6 h-6 text-slate-300 shrink-0 mx-1" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXCEPTION_FLOW.map((step) => (
              <div key={step.key} className={`rounded-2xl border p-5 ${step.color}`}>
                <p className="text-sm font-bold mb-1">{step.label}</p>
                <p className="text-3xl font-extrabold tabular-nums">{countOf(step.key)}</p>
                <p className="text-xs mt-1 opacity-80">
                  {step.key === 'ESCALATED' ? 'تجاوزت مدة الحل المعتمدة (SLA) — تحتاج متابعة فورية' : 'شكاوى رُفضت لعدم اكتمال البيانات'}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-1">إجمالي الشكاوى ضمن النطاق الحالي</h3>
            <p className="text-sm text-slate-500 mb-4">
              {userData?.access === 'all' ? 'كل الفروع' : `فرع: ${branches.find((b) => b.id === userData?.branch)?.name || userData?.branch || '—'}`}
              {branchFilter && ` · مُصفّى على: ${branches.find((b) => b.id === branchFilter)?.name}`}
            </p>
            <p className="text-4xl font-extrabold text-slate-900 tabular-nums">{scoped.length}</p>
          </div>
        </>
      )}
    </div>
  );
}
