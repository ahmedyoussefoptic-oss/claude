import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Small shared building blocks for the منصة المكتشف pages.
export const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

export function Modal({ title, subtitle, onClose, children, footer, size = 'max-w-3xl', z = 'z-[110]' }) {
  return createPortal(
    <div className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm ${z} flex items-center justify-center p-0 md:p-6`}>
      <div className={`w-full ${size} bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full md:h-auto md:max-h-full`}>
        <div className="px-5 md:px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <div className="text-sm text-slate-500 mt-1">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 space-y-4">{children}</div>
        {footer && <div className="px-5 md:px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tile({ label, value, sub, icon: Icon, tone = 'text-slate-900', onClick, active }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`text-start bg-white border rounded-2xl p-4 shadow-sm transition ${active ? 'border-primary ring-2 ring-primary/20' : 'border-slate-100'} ${onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
      <p className="text-xs text-slate-500 flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4" />}{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </button>
  );
}

export function Field({ label, children, hint, required, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>{children}</span>;
}

export const btn = {
  primary: 'px-4 py-2 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary-dark disabled:opacity-50 flex items-center gap-1.5',
  ghost: 'px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5',
  danger: 'px-4 py-2 rounded-xl text-sm font-medium text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1.5',
  small: 'px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1',
};
