import { useTranslation } from 'react-i18next';
import { useHeardFromOptions } from '../../config/platform';

// «كيف تعرفت على المدرسة» on the public registration links: a dropdown, and
// a second one when the chosen option has a sub-list (e.g. the groups).
export default function HeardFromField({ value, sub, onChange, inputCls, required = false }) {
  const { t } = useTranslation();
  const options = useHeardFromOptions();
  const subs = options.find((o) => o.label === value)?.subs || [];
  if (!options.length) return null;
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{t('join.heardFrom')}{required && ' *'}</label>
        <select required={required} value={value} onChange={(e) => onChange(e.target.value, '')} className={inputCls}>
          <option value="">—</option>
          {options.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>
      </div>
      {subs.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('join.heardFromSub', { name: value })} *</label>
          <select required value={sub} onChange={(e) => onChange(value, e.target.value)} className={inputCls}>
            <option value="">—</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
    </>
  );
}
