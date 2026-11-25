import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X } from 'lucide-react';
import { MAX_PHOTOS } from '../../config/maintenance';

// Up to three photos (camera on a phone), shown as thumbnails.
export default function PhotoPicker({ files, setFiles, label }) {
  const { t } = useTranslation();
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const add = (list) => setFiles((prev) => [...prev, ...[...list].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))].slice(0, MAX_PHOTOS));
  return (
    <div>
      <p className="text-xs font-medium text-slate-600 mb-1">{label || t('mnt.photos')}</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            <img src={u} alt="" className="w-full h-full object-cover" />
            <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="absolute top-1 end-1 bg-white/90 rounded-full p-0.5 text-slate-600"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        {files.length < MAX_PHOTOS && (
          <label className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-primary hover:text-primary flex flex-col items-center justify-center gap-1 cursor-pointer text-[11px]">
            <Camera className="w-5 h-5" />{t('mnt.addPhoto')}
            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
          </label>
        )}
      </div>
    </div>
  );
}

export function PhotoStrip({ photos }) {
  if (!photos?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <a key={p.fileUrl} href={p.fileUrl} target="_blank" rel="noreferrer" className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 block">
          <img src={p.fileUrl} alt={p.fileName || ''} className="w-full h-full object-cover" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
