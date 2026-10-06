import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import { userBranches } from '../../utils/scope';

// Staff eligible to be assigned a complaint/ticket/item: specialists (the
// usual case), plus upper management and the system admin so a record can be
// routed to them directly when it needs executive attention. `complaintType`
// is optional and only affects sort priority (department match first) —
// callers with no natural "type" concept (lost & found) can omit it.
// `stage` (the student's grade) and `curriculum` (the record's department —
// AMERICAN, BRITISH, ...) are optional too: within each group, staff whose
// grade/curriculum limits (see Users.jsx) both cover the record come first —
// those explicitly responsible for it ahead of those with no limit — and
// staff whose limits exclude it come last. Options explicitly responsible
// are flagged `coversGrade` / `coversCurriculum` for visible tags.
export function eligibleAssignees(staff, { branch, complaintType, stage, curriculum } = {}) {
  // 0 = explicitly listed, 1 = no limit (or nothing to match), 2 = excluded.
  const match = (list, value) => {
    if (!value || !Array.isArray(list) || !list.length) return 1;
    return list.includes(value) ? 0 : 2;
  };
  const stageRank = (u) => {
    const s = match(u.stages, stage);
    const c = match(u.curricula, curriculum);
    if (s === 2 || c === 2) return 9;
    return s + c;
  };
  return staff
    .filter((u) =>
      (['SPECIALIST', 'UPPER_MANAGEMENT', 'ADMIN'].includes(u.role) || u.isPrincipal === true || u.isQuality === true) &&
      u.active !== false && u.tripsAccess !== 'tripsOnly' &&
      (u.access === 'all' || !branch || userBranches(u).includes(branch))
    )
    .sort((a, b) => {
      const types = Array.isArray(complaintType) ? complaintType : [complaintType];
      const aMatch = types.includes(a.department) ? 0 : 1;
      const bMatch = types.includes(b.department) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (stageRank(a) !== stageRank(b)) return stageRank(a) - stageRank(b);
      return (a.name || '').localeCompare(b.name || '', 'ar');
    })
    .map((u) => {
      if (stageRank(u) === 9) return u;
      const coversGrade = match(u.stages, stage) === 0;
      const coversCurriculum = match(u.curricula, curriculum) === 0;
      return coversGrade || coversCurriculum ? { ...u, coversGrade, coversCurriculum } : u;
    });
}

// Checkbox-list multi-select with removable chips for the selected staff —
// shared across every module that assigns multiple people to a record
// (complaints, tech support, lost & found) so they all stay in sync.
export default function AssigneeMultiSelect({ options, selected, onChange, placeholder }) {
  const { t } = useTranslation();
  const ROLE_TAGS = { ADMIN: t('assigneeSelect.roleTagAdmin'), UPPER_MANAGEMENT: t('assigneeSelect.roleTagUpperManagement') };
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
          {selected.length === 0 ? (placeholder ?? t('common.select')) : t('assigneeSelect.peopleSelected', { count: selected.length })}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto p-1.5">
          {options.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-3">{t('assigneeSelect.noEligibleStaff')}</p>
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
                {o.coversGrade && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">
                    {t('assigneeSelect.gradeTag')}
                  </span>
                )}
                {o.coversCurriculum && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 shrink-0">
                    {t('assigneeSelect.curriculumTag')}
                  </span>
                )}
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
