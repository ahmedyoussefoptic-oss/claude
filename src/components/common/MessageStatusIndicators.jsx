import { useTranslation } from 'react-i18next';
import { MessageCircle, CheckCheck } from 'lucide-react';

// Small pair of badges shown next to each record in a list, so staff can
// see at a glance whether the parent was actually messaged (WhatsApp
// receipt / resolution) without opening the record — green+filled once
// sent, gray+outline while still pending.
export default function MessageStatusIndicators({ receiptSentAt, resolutionSentAt, showResolution = true }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <span
        title={receiptSentAt ? t('messageStatus.receiptSent') : t('messageStatus.receiptNotSent')}
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${receiptSentAt ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'}`}
      >
        <MessageCircle className="w-3.5 h-3.5" />
      </span>
      {showResolution && (
        <span
          title={resolutionSentAt ? t('messageStatus.resolutionSent') : t('messageStatus.resolutionNotSent')}
          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${resolutionSentAt ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'}`}
        >
          <CheckCheck className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  );
}
