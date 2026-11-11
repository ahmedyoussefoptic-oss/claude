import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { X, Copy, Check, Printer, Link2 } from 'lucide-react';
import { printPage, escapeHtml } from '../../utils/printPage';

export const PORTAL_PATH = '/parent-meetings';

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}
      className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700">
      {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}{label}
    </button>
  );
}

// «رابط أولياء الأمور العام»: one link (and QR poster) for every branch's
// «interviews on request» meetings.
export default function PortalLink({ onClose }) {
  const { t, i18n } = useTranslation();
  const url = `${window.location.origin}${PORTAL_PATH}`;
  const poster = async () => {
    const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: 'M' });
    printPage({
      title: t('meetings.portal.title'), school: t('trips.print.school'),
      body: `<div style="text-align:center;margin-top:20mm">
        <h2 style="font-size:26pt;color:#0369a1;margin:0 0 6mm">${escapeHtml(t('meetings.portal.title'))}</h2>
        <p style="font-size:14pt;margin:0 0 10mm">${escapeHtml(t('meetings.portal.posterHint'))}</p>
        <img src="${qr}" style="width:120mm;height:120mm" alt="">
        <p style="font-size:10pt;color:#64748b;margin-top:6mm;direction:ltr">${escapeHtml(url)}</p></div>`,
      dir: i18n.dir(), lang: i18n.language,
    });
  };
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" />{t('meetings.portal.linkTitle')}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-600">{t('meetings.portal.linkHint')}</p>
          <p className="text-sm bg-slate-50 rounded-xl p-3 break-all" dir="ltr">{url}</p>
          <div className="flex flex-wrap gap-2">
            <CopyBtn text={url} label={t('meetings.links.copy')} />
            <CopyBtn text={t('meetings.portal.message', { link: url })} label={t('meetings.publicLink.copyMessage')} />
            <button type="button" onClick={poster} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700"><Printer className="w-4 h-4" />{t('meetings.publicLink.poster')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
