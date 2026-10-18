import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Send, Loader2, Copy, Check, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { db, functions, firebaseConfig, FUNCTIONS_REGION } from '../../config/firebase';

const CALLBACK_URL = `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/waDeliveryReport`;
const STATUS_STYLES = {
  accepted: 'bg-slate-100 text-slate-600', queued: 'bg-slate-100 text-slate-600', dispatched: 'bg-sky-100 text-sky-700', sent: 'bg-sky-100 text-sky-700',
  delivered: 'bg-emerald-100 text-emerald-700', read: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700', no_opt_in: 'bg-rose-100 text-rose-700', no_capability: 'bg-rose-100 text-rose-700', deleted: 'bg-rose-100 text-rose-700',
};

// WhatsApp API settings → diagnostics: send one template to your own phone
// and see Taqnyat's raw reply (testWhatsAppTemplate), the delivery-report
// URL to set in the Taqnyat portal, and the latest messages with the status
// those reports gave them (waMessages).
export default function WhatsAppDiagnostics({ templates, language }) {
  const { t } = useTranslation();
  const names = [...new Set(Object.values(templates || {}).filter(Boolean))];
  const [phone, setPhone] = useState('');
  const [template, setTemplate] = useState(names[0] || '');
  const [withButton, setWithButton] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState([]);

  useEffect(() => onSnapshot(query(collection(db, 'waMessages'), orderBy('sentAt', 'desc'), limit(40)), (snap) => {
    setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => setMessages([])), []);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await httpsCallable(functions, 'testWhatsAppTemplate')({ phone, template, language, button: withButton });
      setResult(data);
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };
  const counts = messages.reduce((o, m) => ({ ...o, [m.status]: (o[m.status] || 0) + 1 }), {});

  return (
    <div className="border border-slate-200 rounded-2xl p-4 space-y-4 bg-white">
      <p className="font-bold text-slate-900 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" />{t('waDiag.title')}</p>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">{t('waDiag.callbackTitle')}</p>
        <p className="text-xs text-slate-500">{t('waDiag.callbackHint')}</p>
        <div className="flex gap-2">
          <input readOnly value={CALLBACK_URL} dir="ltr" className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono bg-slate-50" />
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(CALLBACK_URL); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }} className="px-3 rounded-xl border border-slate-200">{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">{t('waDiag.testTitle')}</p>
        <p className="text-xs text-slate-500">{t('waDiag.testHint')}</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" dir="ltr" className="w-40 px-3 py-2 border border-slate-200 rounded-xl text-sm" />
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white" dir="ltr">
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={withButton} onChange={(e) => setWithButton(e.target.checked)} />{t('waDiag.withButton')}</label>
          <button type="button" disabled={busy || !phone.trim() || !template} onClick={test} className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('waDiag.testBtn')}
          </button>
        </div>
        {result && (
          <div className={`text-xs rounded-xl p-3 space-y-1 ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            <p className="font-bold">{result.ok ? t('waDiag.accepted') : t('waDiag.rejected')}</p>
            {result.message && <p>{result.message}</p>}
            {result.raw && <pre dir="ltr" className="whitespace-pre-wrap break-all bg-white/70 rounded-lg p-2 text-[11px] text-slate-700">{result.raw}</pre>}
            {result.ok && <p>{t('waDiag.acceptedHint')}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">{t('waDiag.logTitle')}</p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {Object.entries(counts).map(([k, n]) => <span key={k} className={`px-2 py-0.5 rounded-md ${STATUS_STYLES[k] || 'bg-slate-100 text-slate-600'}`}>{t(`waDiag.status.${k}`, k)}: <b>{n}</b></span>)}
        </div>
        {messages.length === 0 ? <p className="text-xs text-slate-400">{t('waDiag.logEmpty')}</p> : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-100 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="text-start px-2 py-1.5">{t('waDiag.colTime')}</th><th className="text-start px-2 py-1.5">{t('waDiag.colTemplate')}</th><th className="text-start px-2 py-1.5">{t('waDiag.colTo')}</th><th className="text-start px-2 py-1.5">{t('waDiag.colStatus')}</th><th className="text-start px-2 py-1.5">{t('waDiag.colDetails')}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 py-1.5 whitespace-nowrap" dir="ltr">{m.sentAt?.toDate ? format(m.sentAt.toDate(), 'MM-dd HH:mm') : ''}</td>
                    <td className="px-2 py-1.5 font-mono" dir="ltr">{m.template}{m.recordNumber ? ` · ${m.recordNumber}` : ''}</td>
                    <td className="px-2 py-1.5" dir="ltr">…{String(m.to || '').slice(-4)}</td>
                    <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded ${STATUS_STYLES[m.status] || 'bg-slate-100 text-slate-600'}`}>{t(`waDiag.status.${m.status}`, m.status)}</span></td>
                    <td className="px-2 py-1.5 text-slate-500 max-w-xs truncate" title={m.errors || m.details || ''}>{m.details || m.errors || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400">{t('waDiag.logHint')}</p>
      </div>
    </div>
  );
}
