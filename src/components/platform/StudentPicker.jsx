import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X } from 'lucide-react';
import { lookupStudentById, searchStudentsByName, studentDisplayName } from '../../utils/students';
import { inputCls } from './ui';
import { rosterGrade } from '../../config/platform';

// Finds a current student by national ID or name (student roster).
export default function StudentPicker({ value, onChange, branchName }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const search = (q) => {
    setTerm(q);
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const digits = q.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\s/g, '');
        if (/^\d{6,}$/.test(digits)) {
          const s = await lookupStudentById(digits);
          setResults(s ? [s] : []);
        } else {
          setResults(await searchStudentsByName(q.trim(), 8));
        }
      } finally {
        setBusy(false);
      }
    }, 300);
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
        <div className="text-sm">
          <p className="font-medium text-slate-900">{studentDisplayName(value)}</p>
          <p className="text-xs text-slate-500"><span dir="ltr">{value.nationalId}</span> · {branchName?.(value.branch) || value.branchName} · <span dir="ltr">{rosterGrade(value)} {value.className}</span></p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" />
      <input value={term} onChange={(e) => search(e.target.value)} placeholder={t('platform.studentPicker.placeholder')} className={`${inputCls} pr-9`} />
      {busy && <Loader2 className="w-4 h-4 animate-spin text-primary absolute top-1/2 -translate-y-1/2 left-3" />}
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {results.map((s) => (
            <li key={s.nationalId}>
              <button type="button" onClick={() => { onChange(s); setResults([]); setTerm(''); }} className="w-full text-start px-3 py-2 hover:bg-slate-50 text-sm">
                <span className="font-medium text-slate-900">{studentDisplayName(s)}</span>
                <span className="text-xs text-slate-500 block"><span dir="ltr">{s.nationalId}</span> · {branchName?.(s.branch) || s.branchName} · <span dir="ltr">{rosterGrade(s)} {s.className}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
