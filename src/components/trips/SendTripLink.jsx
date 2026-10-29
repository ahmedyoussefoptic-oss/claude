import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { MessageCircle, Loader2, Check } from 'lucide-react';
import { functions } from '../../config/firebase';

// «إرسال الرابط»: the trip link to one student's parent (sendTripLink). With
// the WhatsApp API the template goes out from the server; without it the
// message opens in WhatsApp (wa.me) for the staff member to send. `waApi`
// comes from the page (useWhatsAppApi) so rows don't each open a listener.
export default function SendTripLink({ tripId, studentId, waApi }) {
  const { t } = useTranslation();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const viaApi = !!(waApi?.enabled && waApi?.templates?.tripNotice);

  const send = async (e) => {
    e.stopPropagation();
    setState('busy');
    setError(null);
    // Opened before the call, or the browser blocks it as a popup.
    const win = viaApi ? null : window.open('', '_blank');
    try {
      const { data } = await httpsCallable(functions, 'sendTripLink')({ tripId, studentId });
      if (data.sent) {
        win?.close();
        setState('sent');
      } else {
        const url = `https://wa.me/${data.phone}?text=${encodeURIComponent(data.text)}`;
        if (win) win.location.href = url;
        else window.open(url, '_blank');
        setState('opened');
      }
    } catch (err) {
      win?.close();
      setError(err.message);
      setState(null);
    }
  };

  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={state === 'busy'} onClick={send} title={t(viaApi ? 'trips.sendLink.hintApi' : 'trips.sendLink.hintManual')}
        className={`px-2 py-1 rounded-lg text-xs border flex items-center gap-1 whitespace-nowrap disabled:opacity-50 ${state === 'sent' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#25D366] bg-white text-[#128C7E] hover:bg-[#25D366]/10'}`}>
        {state === 'busy' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : state === 'sent' ? <Check className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5" />}
        {t(state === 'sent' ? 'trips.sendLink.sent' : 'trips.sendLink.button')}
      </button>
      {error && <span className="text-[11px] text-rose-600 mt-0.5 max-w-[180px]">{error}</span>}
    </span>
  );
}
