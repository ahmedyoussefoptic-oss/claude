import { useTranslation } from 'react-i18next';
import { Paperclip, X, FileText } from 'lucide-react';

// Up to three files (photos, or PDFs when `pdf`).
export default function FilePicker({ files, setFiles, label, pdf = false, camera = false }) {
  const { t } = useTranslation();
  const add = (list) => setFiles((prev) => [...prev, ...[...list].filter((f) => f.type.startsWith('image/') || (pdf && f.type === 'application/pdf'))].slice(0, 3));
  return (
    <div>
      {label && <p className="text-xs font-medium text-slate-600 mb-1">{label}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 max-w-56">
            <FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{f.name}</span>
            <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
        {files.length < 3 && (
          <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-primary hover:text-primary cursor-pointer">
            <Paperclip className="w-3.5 h-3.5" />{t('proc.attach')}
            <input type="file" accept={pdf ? 'image/*,application/pdf' : 'image/*'} {...(camera ? { capture: 'environment' } : {})} multiple className="hidden" onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
          </label>
        )}
      </div>
    </div>
  );
}

export function FileLinks({ files }) {
  if (!files?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => (
        f.mimeType === 'application/pdf'
          ? <a key={f.fileUrl} href={f.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-xs text-primary"><FileText className="w-3.5 h-3.5" />{f.fileName}</a>
          : <a key={f.fileUrl} href={f.fileUrl} target="_blank" rel="noreferrer" className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200 block"><img src={f.fileUrl} alt={f.fileName || ''} className="w-full h-full object-cover" loading="lazy" /></a>
      ))}
    </div>
  );
}
