import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Wallet, Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useSubTypes } from '../../hooks/useOrgData';
import { FINANCE_TYPE } from '../../config/complaintTypes';

const selectCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white';

// A complaint that is really about money becomes a financial note (same
// record and number) and moves to the finance section — server-side in
// convertComplaintToFinance.
export default function FinanceConvertModal({ complaint, onClose, onConverted }) {
  const { t } = useTranslation();
  const subTypes = useSubTypes().filter((s) => s.parentType === FINANCE_TYPE);
  const [subType, setSubType] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await httpsCallable(functions, 'convertComplaintToFinance')({ complaintDocId: complaint.id, subType, note: note.trim() });
      onConverted(data);
    } catch (err) {
      setError(err.message || t('financeConvert.error'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" />{t('financeConvert.title')}</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl p-3">{t('financeConvert.description', { id: complaint.complaintId })}</p>
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">{error}</div>}
          <div className="text-sm bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1">
            <p><span className="text-slate-500">{t('common.student')}:</span> <span className="font-medium text-slate-900">{complaint.studentName}</span></p>
            <p><span className="text-slate-500">{t('complaintForm.subjectLabel')}:</span> <span className="text-slate-900">{complaint.subject}</span></p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('financeConvert.subType')} <span className="text-red-500">*</span></label>
            <select value={subType} onChange={(e) => setSubType(e.target.value)} required className={selectCls}>
              <option value="">{t('complaintForm.selectType')}</option>
              {subTypes.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('financeConvert.note')}</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={selectCls} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}{t('financeConvert.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
