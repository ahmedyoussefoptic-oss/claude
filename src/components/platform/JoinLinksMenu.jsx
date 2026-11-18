import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Link2, Copy, Check, QrCode, ChevronDown } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';
import { btn } from './ui';

export const joinLink = (branchId, src) => {
  const q = new URLSearchParams();
  if (branchId) q.set('branch', branchId);
  if (src) q.set('src', src);
  const s = q.toString();
  return `${window.location.origin}/join${s ? `?${s}` : ''}`;
};

// «روابط التسجيل»: the registration link for all branches and one per branch
// (the branch is fixed on the parent's form), each to copy or as a QR code.
export default function JoinLinksMenu() {
  const { t } = useTranslation();
  const branches = useBranches();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const copy = async (k, text) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ } };
  const qr = async (name, link) => {
    const url = await QRCode.toDataURL(link, { width: 480, margin: 1 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `join-${name}.png`;
    a.click();
  };
  const rows = [['', t('platform.leads.links.all')], ...branches.map((b) => [b.id, b.name])];

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={btn.ghost}><Link2 className="w-4 h-4" />{t('platform.leads.links.title')}<ChevronDown className="w-3.5 h-3.5" /></button>
      {open && (
        <div className="absolute z-30 mt-1 end-0 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-lg p-2 space-y-1">
          <p className="text-[11px] text-slate-500 px-2 py-1">{t('platform.leads.links.hint')}</p>
          {rows.map(([id, name]) => {
            const link = joinLink(id);
            return (
              <div key={id || 'all'} className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <span className="flex-1 min-w-0 text-sm text-slate-800 truncate" title={link}>{name}</span>
                <button type="button" onClick={() => copy(id || 'all', link)} title={t('platform.leads.links.copy')} className="p-1.5 text-slate-500 hover:text-primary">{copied === (id || 'all') ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>
                <button type="button" onClick={() => qr(id || 'all', link)} title={t('platform.leads.links.qr')} className="p-1.5 text-slate-500 hover:text-primary"><QrCode className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
