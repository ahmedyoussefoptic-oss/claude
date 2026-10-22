import { useTranslation } from 'react-i18next';
import { LayoutDashboard, FileText, Wrench, PackageSearch, Armchair, Bus, GraduationCap, Search, Map, FileBarChart, Eye, UserCheck, Building2, RotateCcw, PhoneCall, Sparkles } from 'lucide-react';
import { MODULE_KEYS, moduleDefault } from '../../utils/scope';

const ICONS = { dashboard: LayoutDashboard, complaints: FileText, techSupport: Wrench, lostFound: PackageSearch, visits: Armchair, trips: Bus, students: GraduationCap, search: Search, flowMap: Map, reports: FileBarChart, calls: PhoneCall, assistant: Sparkles };
const PRESETS = {
  default: null,
  complaintsOnly: ['dashboard', 'complaints'],
  lostFoundOnly: ['lostFound'],
  visitsOnly: ['visits'],
  tripsOnly: ['trips'],
};

// The Users-page block that decides what an employee sees: each section
// (form.modules holds only the choices that differ from the role's
// default — see moduleOverrides) and whether they see every record of
// their branches or only those assigned to them (form.recordScope).
// Trips stay on tripsAccess ('all' | 'none' | 'tripsOnly') so the rules
// and functions that already rely on it keep working.
export function effectiveModule(form, key) {
  if (key === 'trips') return form.tripsAccess !== 'none';
  if (form.tripsAccess === 'tripsOnly') return false;
  const v = form.modules?.[key];
  return typeof v === 'boolean' ? v : moduleDefault(form, key);
}

// What gets saved: only the sections that differ from the default.
export function moduleOverrides(form) {
  return Object.fromEntries(MODULE_KEYS.filter((k) => k !== 'trips' && form.tripsAccess !== 'tripsOnly')
    .map((k) => [k, effectiveModule(form, k)])
    .filter(([k, v]) => v !== moduleDefault(form, k)));
}

export default function ModuleAccessEditor({ form, setForm }) {
  const { t } = useTranslation();
  const set = (key, on) => setForm((p) => {
    if (key === 'trips') {
      return { ...p, tripsAccess: on ? (p.tripsAccess === 'none' ? 'all' : p.tripsAccess) : 'none' };
    }
    // Turning any other section on leaves "trips only".
    const fromTripsOnly = p.tripsAccess === 'tripsOnly';
    const base = fromTripsOnly ? Object.fromEntries(MODULE_KEYS.filter((k) => k !== 'trips').map((k) => [k, false])) : { ...(p.modules || {}) };
    return { ...p, tripsAccess: fromTripsOnly ? 'all' : p.tripsAccess, modules: { ...base, [key]: on } };
  });
  const preset = (name) => setForm((p) => {
    const list = PRESETS[name];
    if (!list) return { ...p, modules: {}, tripsAccess: 'all' };
    if (name === 'tripsOnly') return { ...p, modules: {}, tripsAccess: 'tripsOnly' };
    return { ...p, tripsAccess: 'none', modules: Object.fromEntries(MODULE_KEYS.filter((k) => k !== 'trips').map((k) => [k, list.includes(k)])) };
  });
  const shown = MODULE_KEYS.filter((k) => effectiveModule(form, k));
  const custom = form.tripsAccess !== 'all' || Object.keys(moduleOverrides(form)).length > 0;

  return (
    <div className="md:col-span-2 bg-sky-50 border border-sky-100 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Eye className="w-4 h-4 text-primary" />{t('users.modules.title')}</p>
        <span className={`text-xs px-2 py-0.5 rounded-md ${custom ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-500 border border-slate-200'}`}>{custom ? t('users.modules.custom') : t('users.modules.defaultTag')}</span>
      </div>
      <p className="text-xs text-slate-600">{t('users.modules.hint')}</p>

      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button key={name} type="button" onClick={() => preset(name)} className="px-2.5 py-1 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary flex items-center gap-1">
            {name === 'default' && <RotateCcw className="w-3 h-3" />}{t(`users.modules.presets.${name}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {MODULE_KEYS.map((key) => {
          const Icon = ICONS[key];
          const on = effectiveModule(form, key);
          return (
            <label key={key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer transition ${on ? 'bg-white border-primary/40 text-slate-900' : 'bg-slate-100/60 border-slate-200 text-slate-400'}`}>
              <input type="checkbox" checked={on} onChange={(e) => set(key, e.target.checked)} />
              <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-primary' : ''}`} />
              <span className="leading-tight">{t(`users.modules.keys.${key}`)}</span>
            </label>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-xs text-rose-600">{t('users.modules.noneWarning')}</p>}
      {form.tripsAccess === 'tripsOnly' && <p className="text-xs text-slate-600">{t('users.tripsAccessHint.tripsOnly')}</p>}

      <div className="pt-1">
        <p className="text-sm font-bold text-slate-800 mb-1.5">{t('users.modules.scopeTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {[['branch', Building2], ['assigned', UserCheck]].map(([v, Icon]) => (
            <button key={v} type="button" onClick={() => setForm((p) => ({ ...p, recordScope: v }))} className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5 ${(form.recordScope || 'branch') === v ? 'bg-primary text-white border-primary font-medium' : 'bg-white text-slate-600 border-slate-200'}`}>
              <Icon className="w-4 h-4" />{t(`users.modules.scope.${v}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600 mt-1.5">{t(`users.modules.scopeHint.${form.recordScope || 'branch'}`)}</p>
      </div>
    </div>
  );
}
