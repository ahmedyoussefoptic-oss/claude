import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

const ROLE_TAGS = {
  ADMIN: 'مدير النظام',
  UPPER_MANAGEMENT: 'إدارة عليا',
};

// Staff eligible to be assigned a complaint: specialists (the usual case),
// plus upper management and the system admin so a complaint can be routed
// to them directly when it needs executive attention.
export function eligibleAssignees(staff, { branch, complaintType } = {}) {
  return staff
    .filter((u) =>
      ['SPECIALIST', 'UPPER_MANAGEMENT', 'ADMIN'].includes(u.role) &&
      u.active !== false &&
      (u.access === 'all' || !branch || u.branch === branch)
    )
    .sort((a, b) => {
      const aMatch = a.department === complaintType ? 0 : 1;
      const bMatch = b.department === complaintType ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return (a.name || '').localeCompare(b.name || '', 'ar');
    });
}

// Checkbox-list multi-select with removable chips for the selected staff —
// shared between ComplaintForm (initial assignment) and ComplaintDetails
// (editing assignment later) so both stay in sync automatically.
export default function AssigneeMultiSelect({ options, selected, onChange, placeholder = 'اختر...' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const selectedItems = options.filter((o) => selected.includes(o.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-right"
      >
        <span className={selected.length ? 'text-slate-800' : 'text-slate-400'}>
          {selected.length === 0 ? placeholder : `${selected.length} ${selected.length === 1 ? 'شخص مختار' : 'أشخاص مختارون'}`}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto p-1.5">
          {options.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-3">لا يوجد موظفون مؤهلون للإسناد</p>
          ) : (
            options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  className="rounded border-slate-300 text-primary focus:ring-primary/30"
                />
                <span className="flex-1 text-slate-800">{o.name}{o.jobTitle ? ` — ${o.jobTitle}` : ''}</span>
                {ROLE_TAGS[o.role] && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                    {ROLE_TAGS[o.role]}
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      )}

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedItems.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
              {o.name}
              <button type="button" onClick={() => toggle(o.id)} className="hover:text-primary-dark">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
