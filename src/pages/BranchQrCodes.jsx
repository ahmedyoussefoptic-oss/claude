import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { QrCode, Printer, Download, Copy, Check } from 'lucide-react';
import { useBranches } from '../hooks/useOrgData';
import useAuthStore from '../stores/useAuthStore';
import { userBranches } from '../utils/scope';
import logo from '../assets/logo.png';
import { schoolVisitLink } from '../components/visits/VisitRequestsPanel';

// The link a branch's QR code points to — the branch check-in page
// (BranchVisit.jsx) with that branch preselected.
export const visitLink = (branchId) => `${window.location.origin}/visit?branch=${encodeURIComponent(branchId)}`;
// Two kinds of code per branch: reception check-in, and the school visit
// request link (/school-visit) for parents to book a visit.
const LINKS = { checkin: visitLink, request: schoolVisitLink };
const POSTER_KEYS = { checkin: 'branchQr', request: 'branchQr.request' };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One printable A4 poster per branch, to post at reception: scanning it
// opens the check-in form for that branch.
function printPoster({ branchName, qr, t, kind = 'checkin' }) {
  const k = POSTER_KEYS[kind];
  const win = window.open('', '_blank');
  if (!win) return;
  const logoUrl = new URL(logo, window.location.origin).href;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(branchName)}</title>
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; font-family: Tahoma, Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .page { width: 210mm; height: 297mm; padding: 22mm 18mm; display: flex; flex-direction: column; align-items: center; text-align: center; border: 10mm solid #1e3a8a }
  img.logo { height: 26mm }
  h1 { font-size: 30pt; margin: 10mm 0 3mm }
  .branch { font-size: 18pt; color: #1e3a8a; font-weight: bold; margin-bottom: 8mm }
  img.qr { width: 120mm; height: 120mm; border: 2mm solid #e2e8f0; border-radius: 6mm; padding: 4mm }
  ol { font-size: 15pt; text-align: right; line-height: 1.9; margin: 9mm 0 0; padding-right: 8mm }
</style></head><body><div class="page">
  <img class="logo" src="${logoUrl}" alt="">
  <h1>${escapeHtml(t(`${k}.posterTitle`))}</h1>
  <div class="branch">${escapeHtml(branchName)}</div>
  <img class="qr" src="${qr}" alt="">
  <ol>
    <li>${escapeHtml(t(`${k}.posterStep1`))}</li>
    <li>${escapeHtml(t(`${k}.posterStep2`))}</li>
    <li>${escapeHtml(t(`${k}.posterStep3`))}</li>
  </ol>
</div><script>window.onload = () => { window.print(); }</script></body></html>`);
  win.document.close();
}

export default function BranchQrCodes() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const allBranches = useBranches();
  const branches = userData?.role === 'ADMIN' || userData?.access === 'all'
    ? allBranches
    : allBranches.filter((b) => userBranches(userData).includes(b.id));
  const [codes, setCodes] = useState({});
  const [copied, setCopied] = useState(null);
  const [kind, setKind] = useState(() => (new URLSearchParams(window.location.search).get('kind') === 'request' ? 'request' : 'checkin'));
  const linkOf = LINKS[kind];

  const branchKey = branches.map((b) => b.id).join('|');
  useEffect(() => {
    let cancelled = false;
    setCodes({});
    Promise.all(branches.map(async (b) => [b.id, await QRCode.toDataURL(LINKS[kind](b.id), { width: 640, margin: 1, errorCorrectionLevel: 'M' })]))
      .then((pairs) => { if (!cancelled) setCodes(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey, kind]);

  const copy = async (id) => {
    try {
      await navigator.clipboard.writeText(linkOf(id));
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable — the link is shown as text anyway.
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <QrCode className="w-6 h-6 text-primary" />
          {t('branchQr.title')}
        </h1>
        <p className="text-slate-500 mt-1">{kind === 'request' ? t('branchQr.request.subtitle') : t('branchQr.subtitle')}</p>
        <div className="flex gap-2 mt-3">
          {['checkin', 'request'].map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`px-4 py-2 rounded-xl text-sm font-medium border ${kind === k ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{t(`branchQr.kinds.${k}`)}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((b) => (
          <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center text-center">
            <p className="font-bold text-slate-900 mb-3">{b.name}</p>
            {codes[b.id]
              ? <img src={codes[b.id]} alt={b.name} className="w-48 h-48 rounded-xl border border-slate-100" />
              : <div className="w-48 h-48 rounded-xl bg-slate-100 animate-pulse" />}
            <div className="flex items-center gap-1 mt-3 w-full bg-slate-50 border border-slate-100 rounded-lg p-1.5">
              <span className="flex-1 text-[11px] text-slate-500 truncate text-left" dir="ltr">{linkOf(b.id)}</span>
              <button onClick={() => copy(b.id)} className="p-1.5 text-slate-500 hover:text-primary rounded-md" title={t('publicReport.copyLink')}>
                {copied === b.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex gap-2 mt-3 w-full">
              <button
                disabled={!codes[b.id]}
                onClick={() => printPoster({ branchName: b.name, qr: codes[b.id], t, kind })}
                className="flex-1 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                {t('branchQr.printPoster')}
              </button>
              <a
                href={codes[b.id] || undefined}
                download={`QR-${kind === 'request' ? 'visit-request' : 'checkin'}-${b.id}.png`}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                title={t('branchQr.downloadPng')}
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
