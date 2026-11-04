import { useTranslation } from 'react-i18next';

// Under a record in the report's detailed list: what the parent wrote and
// the reply that solved it (src/utils/reportContent.js).
export default function RecordContentRow({ colSpan, content, reply }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-slate-200 break-inside-avoid">
      <td colSpan={colSpan} className="px-2 pb-2.5 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-2 text-[11px] leading-relaxed">
          <p className="bg-slate-50 rounded-lg px-2.5 py-1.5 text-slate-700 whitespace-pre-line"><b className="text-slate-500">{t('reports.content.complaint')}: </b>{content || '—'}</p>
          <p className={`rounded-lg px-2.5 py-1.5 whitespace-pre-line ${reply ? 'bg-emerald-50 text-slate-700' : 'bg-slate-50 text-slate-400'}`}><b className="text-slate-500">{t('reports.content.reply')}: </b>{reply || t('reports.content.noReply')}</p>
        </div>
      </td>
    </tr>
  );
}
