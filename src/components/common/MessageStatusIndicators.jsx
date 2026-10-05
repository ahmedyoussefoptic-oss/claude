import { useTranslation } from 'react-i18next';
import { MessageCircle, CheckCheck } from 'lucide-react';

// Shown next to each record in a list, so staff can see at a glance whether
// the parent was actually messaged (WhatsApp receipt / resolution) and by
// whom, without opening the record — green once sent, gray while pending.
// Records messaged before the sender was tracked just show the badge.
export default function MessageStatusIndicators({ record, showResolution = true }) {
  const { t } = useTranslation();
  const rows = [
    { key: 'receipt', Icon: MessageCircle, sentAt: record.receiptMessageSentAt, by: record.receiptMessageSentByName },
    ...(showResolution ? [{ key: 'resolution', Icon: CheckCheck, sentAt: record.resolutionMessageSentAt, by: record.resolutionMessageSentByName }] : []),
  ];
  return (
    <div className="flex flex-col gap-1">
      {rows.map(({ key, Icon, sentAt, by }) => (
        <div key={key} className="flex items-center gap-1.5">
          <span
            title={sentAt ? t(`messageStatus.${key}Sent`) : t(`messageStatus.${key}NotSent`)}
            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${sentAt ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
          {sentAt && by && <span className="text-xs text-slate-600 whitespace-nowrap" title={t(`messageStatus.${key}SentBy`, { name: by })}>{by}</span>}
        </div>
      ))}
    </div>
  );
}
