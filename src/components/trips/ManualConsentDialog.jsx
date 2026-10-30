import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Loader2, Paperclip, Trash2 } from 'lucide-react';
import { functions } from '../../config/firebase';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from '../../utils/publicSubmission';
import { TRIP_PAY_METHODS, TRIP_DECLINE_REASONS, TRIP_COLLECT_METHODS } from '../../config/trips';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

// A reply that reached the school without the link: by phone, or on paper with
// the student (staffSetTripEnrollment). The signed sheet can be attached, and
// finance can record the money received with it in the same step
// (reviewTripPayment, which also tells the parent).
export default function ManualConsentDialog({ trip, student, current, canCollect, defaultCollector, onCancel, onSaved }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState(current?.decision || 'APPROVED');
  const [declineReason, setDeclineReason] = useState(current?.declineReason || '');
  const [payMethod, setPayMethod] = useState(current?.payMethod || (trip.payMethods || [])[0] || 'RECEPTION');
  const [healthNotes, setHealthNotes] = useState(current?.healthNotes || '');
  const [emergencyPhone, setEmergencyPhone] = useState(current?.emergencyPhone || '');
  const [sheet, setSheet] = useState(null);
  const [received, setReceived] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [collectorName, setCollectorName] = useState(defaultCollector || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const paid = current?.payStatus === 'PAID';
  const showPay = decision === 'APPROVED' && trip.fee > 0;
  const collect = showPay && canCollect && !paid && received;
  const sheetUrl = current?.pledge?.fileUrl || current?.pledgeUrl;

  const pickSheet = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && file.size > MAX_PUBLIC_FILE_BYTES) {
      setError(t('trips.manual.sheetTooBig'));
      e.target.value = '';
      return;
    }
    setError(null);
    setSheet(file);
  };
  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
    try {
      const pledge = sheet && decision === 'APPROVED' && !remove
        ? { fileName: sheet.name, mimeType: sheet.type || 'application/octet-stream', base64Data: await fileToBase64(sheet) }
        : null;
      await call('staffSetTripEnrollment', { id: trip.id, studentId: student.id, decision, declineReason, payMethod: collect ? 'RECEPTION' : payMethod, healthNotes, emergencyPhone, remove, pledge });
      if (collect && !remove) await call('reviewTripPayment', { id: trip.id, studentId: student.id, action: 'collect', method, collectorName: collectorName.trim(), note: note.trim() });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-full overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-3">
        <h3 className="font-bold text-slate-900">{t('trips.manual.title')}</h3>
        <p className="text-sm text-slate-600">{student.name} — <span dir="ltr">{student.grade} {student.className}</span></p>
        <div className="flex gap-2">
          {['APPROVED', 'DECLINED'].map((d) => (
            <button key={d} onClick={() => setDecision(d)} className={`flex-1 py-2 rounded-xl text-sm border ${decision === d ? (d === 'APPROVED' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-600 border-slate-200'}`}>
              {t(`trips.decision.${d}`)}
            </button>
          ))}
        </div>
        {decision === 'DECLINED' && (
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('tripConsent.declineReason')}</label>
            <select value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} className={inputCls}>
              <option value="">{t('common.optional')}</option>
              {TRIP_DECLINE_REASONS.map((r) => <option key={r} value={r}>{t(`trips.declineReason.${r}`)}</option>)}
            </select>
          </div>
        )}
        {showPay && !paid && canCollect && (
          <div className="border border-emerald-100 bg-emerald-50/50 rounded-xl p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} className="w-4 h-4" />
              {t('trips.manual.received', { fee: trip.fee })}
            </label>
            {received && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TRIP_COLLECT_METHODS.map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)} className={`py-1.5 rounded-xl text-xs border ${method === m ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{t(`trips.collectMethod.${m}`)}</button>
                  ))}
                </div>
                <div><label className="block text-xs text-slate-600 mb-1">{t('trips.collect.collector')}</label><input value={collectorName} onChange={(e) => setCollectorName(e.target.value)} className={inputCls} /></div>
                <div><label className="block text-xs text-slate-600 mb-1">{t('trips.collect.ref')}</label><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></div>
                <p className="text-[11px] text-slate-500">{t('trips.collect.confirmerHint')}</p>
              </>
            )}
          </div>
        )}
        {showPay && !paid && !collect && (
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('trips.form.payMethods')}</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
              {TRIP_PAY_METHODS.map((m) => <option key={m} value={m}>{t(`trips.payMethod.${m}`)}</option>)}
            </select>
            {!canCollect && <p className="text-[11px] text-slate-500 mt-1">{t('trips.manual.financeCollects')}</p>}
          </div>
        )}
        {paid && <p className="text-xs text-emerald-800 bg-emerald-50 rounded-xl p-2.5">{t('trips.manual.alreadyPaid')}</p>}
        {decision === 'APPROVED' && (
          <>
            <div>
              <label className="block text-xs text-slate-600 mb-1">{t('trips.manual.sheet')}</label>
              <input type="file" accept="image/*,application/pdf" onChange={pickSheet} className="block w-full text-xs text-slate-600" />
              {sheetUrl && !sheet && <a href={sheetUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 hover:underline flex items-center gap-1 mt-1"><Paperclip className="w-3.5 h-3.5" />{t('trips.viewPledge')}</a>}
            </div>
            <div><label className="block text-xs text-slate-600 mb-1">{t('trips.healthNotes')}</label><input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-xs text-slate-600 mb-1">{t('trips.emergencyPhone')}</label><input dir="ltr" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} /></div>
          </>
        )}
        <p className="text-xs text-slate-400">{t('trips.manual.hint')}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-between gap-2">
          {current && !paid ? <button disabled={busy} onClick={() => save(true)} className="px-3 py-2 text-sm rounded-xl text-rose-600 hover:bg-rose-50 flex items-center gap-1"><Trash2 className="w-4 h-4" />{t('trips.manual.remove')}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded-xl border border-slate-300 bg-white">{t('common.cancel')}</button>
            <button disabled={busy || (collect && !collectorName.trim())} onClick={() => save(false)} className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
