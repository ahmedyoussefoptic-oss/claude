import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileText, Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { useComplaintTypes, useSubTypes } from '../../hooks/useOrgData';

const selectCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm bg-white';

// The reverse of ComplaintConvertModal: asks only for what a complaint needs
// beyond the ticket's own data (category, sub-category, a short title,
// priority); the move itself runs server-side in convertTechTicketToComplaint.
export default function TicketConvertModal({ ticket, onClose, onConverted }) {
  const { t } = useTranslation();
  const complaintTypes = useComplaintTypes();
  const subTypes = useSubTypes();
  const firstLine = String(ticket.details || '').split('\n').find((l) => l.trim()) || '';
  const [form, setForm] = useState({ complaintType: '', subType: '', subject: firstLine.slice(0, 120), priority: 'NORMAL' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value, ...(name === 'complaintType' ? { subType: '' } : {}) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await httpsCallable(functions, 'convertTechTicketToComplaint')({ ticketDocId: ticket.id, ...form });
      onConverted(data);
    } catch (err) {
      console.error(err);
      setError(['functions/permission-denied', 'functions/failed-precondition', 'functions/invalid-argument'].includes(err.code) ? err.message : t('ticketConvert.error'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 md:p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {t('ticketConvert.title')}
          </h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl p-3">{t('ticketConvert.description')}</p>
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">{error}</div>}

          <div className="text-sm bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1">
            <p><span className="text-slate-500">{t('common.student')}:</span> <span className="font-medium text-slate-900">{ticket.studentName}</span> <span className="text-slate-500">{[ticket.stage, ticket.grade].filter(Boolean).join(' — ')}</span></p>
            <p><span className="text-slate-500">{t('common.parent')}:</span> <span className="font-medium text-slate-900">{ticket.parentName}</span> <span dir="ltr" className="text-slate-500">{ticket.parentPhone}</span></p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('ticketConvert.typeLabel')} <span className="text-red-500">*</span></label>
              <select name="complaintType" value={form.complaintType} onChange={handleChange} required className={selectCls}>
                <option value="">{t('complaintForm.selectType')}</option>
                {complaintTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subTypeLabel')} <span className="text-red-500">*</span></label>
              <select name="subType" value={form.subType} onChange={handleChange} required disabled={!form.complaintType} className={`${selectCls} disabled:text-slate-400`}>
                <option value="">{t('complaintForm.selectType')}</option>
                {subTypes.filter((s) => s.parentType === form.complaintType).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.subjectLabel')} <span className="text-red-500">*</span></label>
              <input name="subject" value={form.subject} onChange={handleChange} required maxLength={200} className={selectCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('complaintForm.priorityLabel')}</label>
              <select name="priority" value={form.priority} onChange={handleChange} className={selectCls}>
                {['NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{t(`complaintForm.priorities.${p}`)}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={loading} className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {loading ? t('ticketConvert.converting') : t('ticketConvert.confirmBtn')}
          </button>
        </div>
      </form>
    </div>
  );
}
