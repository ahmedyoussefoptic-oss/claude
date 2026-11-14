import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { X, Copy, Check, Printer, Link2, ExternalLink } from 'lucide-react';
import { printPage, escapeHtml } from '../../utils/printPage';
import { useBranches } from '../../hooks/useOrgData';
import { surveyUrl, surveyBranchList, pick } from '../../config/surveys';

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}
      className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700">
      {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}{label}
    </button>
  );
}

// The form's link for parents: one for all its branches, or one per branch
// (the branch is then filled in), with a WhatsApp message and a QR poster.
export default function SurveyShare({ form, onClose }) {
  const { t, i18n } = useTranslation();
  const orgBranches = useBranches();
  const list = surveyBranchList(orgBranches).filter((b) => (form.branches.length ? form.branches.includes(b.id) : orgBranches.some((o) => o.id === b.id)));
  const [branch, setBranch] = useState(list.length === 1 ? list[0].id : '');
  const url = surveyUrl(form.code, branch);
  const message = t('surveys.share.message', { title: form.title, link: url });
  const poster = async () => {
    const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: 'M' });
    const b = list.find((x) => x.id === branch);
    printPage({
      title: form.title, school: t('trips.print.school'),
      body: `<div style="text-align:center;margin-top:16mm">
        <h2 style="font-size:24pt;color:#0369a1;margin:0 0 4mm">${escapeHtml(form.title)}</h2>
        ${b ? `<p style="font-size:15pt;margin:0 0 4mm">${escapeHtml(b.ar)} · ${escapeHtml(b.en)}</p>` : ''}
        <p style="font-size:14pt;margin:0 0 8mm">${escapeHtml(t('surveys.share.posterHint'))}<br><span dir="ltr" style="font-size:12pt;color:#475569">Scan the code to share your feedback</span></p>
        <img src="${qr}" style="width:120mm;height:120mm" alt="">
        <p style="font-size:10pt;color:#64748b;margin-top:6mm;direction:ltr">${escapeHtml(url)}</p></div>`,
      dir: i18n.dir(), lang: i18n.language,
    });
  };
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" />{t('surveys.share.title')}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-600">{t('surveys.share.hint')}</p>
          {list.length > 1 && (
            <label className="block text-sm">
              <span className="text-slate-600">{t('surveys.share.branch')}</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                <option value="">{t('surveys.share.allBranches')}</option>
                {list.map((b) => <option key={b.id} value={b.id}>{pick(b, i18n.language)}</option>)}
              </select>
            </label>
          )}
          <p className="text-sm bg-slate-50 rounded-xl p-3 break-all" dir="ltr">{url}</p>
          {form.status !== 'OPEN' && <p className="text-xs text-amber-700">{t('surveys.share.closedNote')}</p>}
          <div className="flex flex-wrap gap-2">
            <CopyBtn text={url} label={t('surveys.share.copyLink')} />
            <CopyBtn text={message} label={t('surveys.share.copyMessage')} />
            <button type="button" onClick={poster} className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700"><Printer className="w-4 h-4" />{t('surveys.share.poster')}</button>
            <a href={url} target="_blank" rel="noreferrer" className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700"><ExternalLink className="w-4 h-4" />{t('surveys.share.open')}</a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
