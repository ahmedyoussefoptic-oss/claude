import { useTranslation } from 'react-i18next';

// Shown (and required) only when the chosen problem type / platform is
// about the parent's own account — see isParentRelated().
export default function ParentNationalIdField({ value, onChange, inputCls, name = 'parentNationalId' }) {
  const { t } = useTranslation();
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {t('techSupportForm.parentNationalIdLabel')} <span className="text-red-500">*</span>
      </label>
      <input type="text" name={name} value={value || ''} onChange={onChange} required dir="ltr" inputMode="numeric" className={inputCls} />
      <p className="text-xs text-slate-500 mt-1">{t('techSupportForm.parentNationalIdHint')}</p>
    </div>
  );
}
