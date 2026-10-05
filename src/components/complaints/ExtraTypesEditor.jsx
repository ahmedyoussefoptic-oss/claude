import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';

export const MAX_EXTRA_TYPES = 3;

// Extra categories for a complaint that touches more than one area
// (e.g. academic + behavioral). Each row is { type, subType }; the primary
// category stays in complaintType/subType. Auto-assignment routes the record
// to every category's specialists (see findAutoAssignees in functions).
export default function ExtraTypesEditor({ value, onChange, primaryType, complaintTypes, subTypes, typeLabel = (ct) => ct.name, subTypeLabel = (s) => s.name, selectCls }) {
  const { t } = useTranslation();
  const rows = value || [];
  const used = new Set([primaryType, ...rows.map((r) => r.type)]);

  const update = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, { type: '', subType: '' }]);

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const options = subTypes.filter((s) => s.parentType === row.type);
        return (
          <div key={i} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={row.type} onChange={(e) => update(i, { type: e.target.value, subType: '' })} required className={selectCls}>
                <option value="">{t('complaintForm.extraTypeSelect')}</option>
                {complaintTypes.filter((ct) => ct.id === row.type || !used.has(ct.id)).map((ct) => <option key={ct.id} value={ct.id}>{typeLabel(ct)}</option>)}
              </select>
              <select value={row.subType} onChange={(e) => update(i, { subType: e.target.value })} required={options.length > 0} disabled={!row.type} className={`${selectCls} disabled:text-slate-400 disabled:bg-slate-50`}>
                <option value="">{t('complaintForm.subTypeLabel')}</option>
                {row.subType && !options.some((s) => s.name === row.subType) && <option value={row.subType}>{row.subType}</option>}
                {options.map((s) => <option key={s.id} value={s.name}>{subTypeLabel(s)}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => remove(i)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title={t('common.delete')}>
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      {rows.length < MAX_EXTRA_TYPES && primaryType && complaintTypes.some((ct) => !used.has(ct.id)) && (
        <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:bg-primary/5 px-3 py-1.5 rounded-lg border border-dashed border-primary/40">
          <Plus className="w-4 h-4" />
          {t('complaintForm.addExtraType')}
        </button>
      )}
    </div>
  );
}

// Drops incomplete rows and duplicates of the primary category before saving.
export function cleanExtraTypes(rows, primaryType) {
  const seen = new Set([primaryType]);
  return (rows || []).filter((r) => r.type && !seen.has(r.type) && seen.add(r.type)).map((r) => ({ type: r.type, subType: r.subType || '' }));
}
