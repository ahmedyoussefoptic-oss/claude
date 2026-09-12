import { useState } from 'react';
import { X, Copy, Check, ExternalLink, MessageCircle, FileText, PackageSearch, Wrench, Link2 } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';

const TYPES = [
  { id: 'COMPLAINT', name: 'ملاحظة', icon: FileText },
  { id: 'LOST_FOUND', name: 'مفقودات', icon: PackageSearch },
  { id: 'TECH_SUPPORT', name: 'مشكلة تقنية', icon: Wrench },
];

export default function PublicLinkModal({ onClose }) {
  const branches = useBranches();
  const [type, setType] = useState('COMPLAINT');
  const [branch, setBranch] = useState('');
  const [copied, setCopied] = useState(false);

  const params = new URLSearchParams();
  if (type !== 'COMPLAINT') params.set('type', type);
  if (branch) params.set('branch', branch);
  const query = params.toString();
  const link = `${window.location.origin}/report${query ? `?${query}` : ''}`;

  const typeName = TYPES.find((t) => t.id === type)?.name;
  const shareMessage = [
    'مدارس المكتشف العالمية',
    `يمكنكم تقديم ${type === 'COMPLAINT' ? 'ملاحظتكم' : 'بلاغكم'} مباشرة عبر الرابط التالي:`,
    link,
  ].join('\n');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is still shown as selectable text.
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            رابط تقديم بلاغ لولي الأمر
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-500">
            حدد نوع البلاغ والفرع (اختياري) لتوليد رابط جاهز يمكن إرساله مباشرة لولي الأمر — يفتح له نموذجاً إلكترونياً يظهر بلاغه في النظام فور إرساله.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">نوع البلاغ</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                    type === t.id ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <t.icon className="w-5 h-5" />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الفرع (اختياري)</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              <option value="">كل الفروع (يختار ولي الأمر الفرع بنفسه)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الرابط الجاهز — {typeName}</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
              <span className="flex-1 text-xs text-slate-600 truncate text-left" dir="ltr">{link}</span>
              <button onClick={copyLink} className="shrink-0 p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="نسخ الرابط">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-medium hover:brightness-95 transition-all flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              مشاركة عبر واتساب
            </a>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              title="فتح الرابط"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
