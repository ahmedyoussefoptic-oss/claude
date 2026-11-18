import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsers } from '../../hooks/useUsers';
import { userBranches } from '../../utils/scope';

// The staff a visit can be met by: its assignees first, then the others
// covering its branch (never reception accounts).
function useVisitStaff(visit) {
  const users = useUsers();
  const assigned = (visit.assignedTo || []).map((id, i) => ({ id, name: users.find((u) => u.id === id)?.name || visit.assignedToNames?.[i] || id }));
  const others = users
    .filter((u) => u.active !== false && u.role !== 'RECEPTIONIST' && u.tripsAccess !== 'tripsOnly' && !(visit.assignedTo || []).includes(u.id)
      && (u.access === 'all' || userBranches(u).includes(visit.branch)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
    .map((u) => ({ id: u.id, name: u.name || u.email }));
  return { assigned, others };
}

export default function StaffPicker({ visit, value, onChange, label }) {
  const { t } = useTranslation();
  const { assigned, others } = useVisitStaff(visit);
  const [q, setQ] = useState('');
  const match = (u) => !q.trim() || (u.name || '').includes(q.trim());
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label || t('branchVisits.metWith')}</label>
      {others.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('branchVisits.searchStaff')} className="w-full mb-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm" />}
      <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-2">
        {[[t('branchVisits.assignedGroup'), assigned], [t('branchVisits.otherStaff'), others]].map(([label, list]) => list.filter(match).length > 0 && (
          <div key={label}>
            <p className="text-[11px] font-bold text-slate-400 mb-1">{label}</p>
            {list.filter(match).map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm text-slate-700 py-0.5 cursor-pointer">
                <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        ))}
      </div>
      {value.length > 1 && <p className="text-xs text-teal-700 mt-1">{t('branchVisits.selectedCount', { n: value.length })}</p>}
    </div>
  );
}
