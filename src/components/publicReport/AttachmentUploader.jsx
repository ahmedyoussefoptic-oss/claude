import { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { MAX_PUBLIC_FILES, MAX_PUBLIC_FILE_BYTES } from '../../utils/publicSubmission';

export default function AttachmentUploader({ files, onAdd, onRemove, max = MAX_PUBLIC_FILES, label = 'مرفقات (اختياري)', accept = 'image/*,.pdf,.doc,.docx' }) {
  const fileInputRef = useRef(null);

  const handleFiles = (newFiles) => {
    const withinLimit = max === 1 ? newFiles.slice(0, 1) : newFiles;
    onAdd(withinLimit);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
        }}
        className="flex justify-center px-6 py-5 border-2 border-slate-200 border-dashed rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <div className="space-y-1.5 text-center">
          <Upload className="w-6 h-6 mx-auto text-slate-400" />
          <p className="text-sm text-slate-600">
            <span className="font-medium text-primary">اضغط لرفع {max === 1 ? 'صورة' : 'صورة أو ملف'}</span>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              multiple={max > 1}
              accept={accept}
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            {' '}أو اسحبه وأفلته هنا
          </p>
          <p className="text-xs text-slate-400">
            {max === 1 ? 'ملف واحد' : `حتى ${max} ملفات`}، بحد أقصى {(MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0)} ميجابايت لكل ملف
          </p>
        </div>
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li key={i} className="text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg flex items-center justify-between">
              <span dir="ltr" className="truncate">{file.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                {(file.size / 1024 / 1024).toFixed(2)} MB
                <button type="button" onClick={() => onRemove(i)} className="text-slate-400 hover:text-red-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
