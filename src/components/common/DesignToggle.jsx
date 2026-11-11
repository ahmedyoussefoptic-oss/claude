import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import useDesignStore from '../../stores/useDesignStore';
import useAuthStore from '../../stores/useAuthStore';

// Switches the system between the classic and the navy design.
export default function DesignToggle({ withLabel = false, className = '' }) {
  const { t } = useTranslation();
  const { design, setDesign } = useDesignStore();
  const uid = useAuthStore((s) => s.user?.uid);
  const next = design === 'navy' ? 'classic' : 'navy';
  const label = t(`design.switchTo.${next}`);
  return (
    <button type="button" onClick={() => setDesign(next, uid)} title={label} aria-label={label}
      className={`p-2 flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors ${className}`}>
      <Palette className="w-4 h-4" />
      {withLabel && <span>{t(`design.name.${design}`)}</span>}
    </button>
  );
}
