import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, setDoc } from 'firebase/firestore';
import { MessageCircle, Save, Copy, Check, Loader2 } from 'lucide-react';
import { db } from '../../config/firebase';
import { useBranches, useDepartments, ensureSeeded } from '../../hooks/useOrgData';
import { useWhatsAppApi, DEFAULT_WA_API } from '../../hooks/useWhatsAppApi';
import { toWhatsAppNumber } from '../../utils/whatsapp';

const TEMPLATE_KEYS = ['complaintReceipt', 'complaintResolution', 'techReceipt', 'techResolution', 'visitMet', 'appointmentConfirmed', 'appointmentRescheduled', 'lostFoundReceipt', 'lostFoundReturned'];

// Suggested template bodies to submit for approval in the Taqnyat portal.
// All four share the same variables (see sendWhatsAppApiMessage):
// {{1}} parent, {{2}} number, {{3}} student, {{4}} branch / resolution,
// {{5}} tracking link — plus a URL button
// https://mis-complaints.web.app/contact/{{1}} (record number).
const NOTICE = 'هذا الرقم مخصص للإشعارات فقط ولا يستقبل الردود، للتواصل مع الفرع اضغط زر "تواصل مع الفرع".';
const SUGGESTED = {
  complaintReceipt: `مرحباً {{1}}،\nتم استلام ملاحظتكم رقم {{2}} الخاصة بالطالب/ة {{3}} في {{4}}، وسيتم التواصل معكم قريباً.\nلمتابعة حالة الملاحظة: {{5}}\n\n${NOTICE}`,
  complaintResolution: `مرحباً {{1}}،\nتمت معالجة ملاحظتكم رقم {{2}} الخاصة بالطالب/ة {{3}}.\nالحل: {{4}}\nنسعد بتقييمكم للخدمة عبر الرابط: {{5}}\n\n${NOTICE}`,
  techReceipt: `مرحباً {{1}}،\nتم استلام بلاغكم التقني رقم {{2}} الخاص بالطالب/ة {{3}} في {{4}}، وسيتم التواصل معكم قريباً.\nلمتابعة حالة البلاغ: {{5}}\n\n${NOTICE}`,
  techResolution: `مرحباً {{1}}،\nبخصوص بلاغكم التقني رقم {{2}} الخاص بالطالب/ة {{3}}:\n{{4}}\nلتأكيد الحل أو تقييم الخدمة: {{5}}\n\n${NOTICE}`,
  visitMet: `مرحباً {{1}}،\nشكراً لزيارتكم {{4}}، وقد تمت مقابلتكم بخصوص الملاحظة رقم {{2}} الخاصة بالطالب/ة {{3}}.\nنسعد بتقييمكم للزيارة ومتابعة الملاحظة عبر الرابط: {{5}}\n\n${NOTICE}`,
  lostFoundReceipt: `مرحباً {{1}}،\nتم تسجيل بلاغكم رقم {{2}} عن ({{3}}) في {{4}}، وسيتم التواصل معكم عند وجود مستجدات.\nلمتابعة حالة البلاغ: {{5}}\n\n${NOTICE}`,
  appointmentConfirmed: `مرحباً {{1}}،\nتم تأكيد موعد زيارتكم للمدرسة بخصوص الملاحظة رقم {{2}} الخاصة بالطالب/ة {{3}}.\nالموعد: {{4}}\nعند وصولكم امسحوا رمز QR في الاستقبال واختاروا «لدي موعد مسبق» وأدخلوا رقم الملاحظة.\nللمتابعة: {{5}}\n\n${NOTICE}`,
  appointmentRescheduled: `مرحباً {{1}}،\nبخصوص طلب زيارتكم للمدرسة (الملاحظة رقم {{2}} للطالب/ة {{3}})، نعتذر عن الموعد المطلوب، وتم تحديد موعد بديل:\n{{4}}\nعند وصولكم امسحوا رمز QR في الاستقبال واختاروا «لدي موعد مسبق» وأدخلوا رقم الملاحظة.\nللمتابعة: {{5}}\n\n${NOTICE}`,
  lostFoundReturned: `مرحباً {{1}}،\nنفيدكم بتسليم الغرض ({{3}}) الخاص ببلاغكم رقم {{2}}.\n{{4}}\nنسعد بتقييمكم للخدمة عبر الرابط: {{5}}\n\n${NOTICE}`,
};

// Per-template meaning of {{3}}/{{4}} shown under each suggested text.
const VAR_HINT = {
  complaintReceipt: 'receiptVars', techReceipt: 'receiptVars',
  complaintResolution: 'resolutionVars', techResolution: 'resolutionVars',
  visitMet: 'visitVars', appointmentConfirmed: 'appointmentVars', appointmentRescheduled: 'appointmentVars', lostFoundReceipt: 'lostReceiptVars', lostFoundReturned: 'lostReturnedVars',
};

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3 pl-10 text-slate-700 font-sans">{text}</pre>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }}
        className="absolute top-2 left-2 p-1.5 text-slate-400 hover:text-primary rounded-md"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function WhatsAppApiSettings() {
  const { t } = useTranslation();
  const config = useWhatsAppApi();
  const branches = useBranches();
  const departments = useDepartments();
  const [deptNumbers, setDeptNumbers] = useState({});
  const [draft, setDraft] = useState(DEFAULT_WA_API);
  const [numbers, setNumbers] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setDraft(config); }, [config]);
  const branchKey = branches.map((b) => `${b.id}:${b.whatsappNumber || ''}`).join('|');
  useEffect(() => {
    setNumbers(Object.fromEntries(branches.map((b) => [b.id, b.whatsappNumber || ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey]);
  const deptKey = departments.map((d) => `${d.id}:${d.whatsappNumber || ''}`).join('|');
  useEffect(() => {
    setDeptNumbers(Object.fromEntries(departments.map((d) => [d.id, d.whatsappNumber || ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptKey]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'settings', 'whatsappApi'), {
        enabled: !!draft.enabled,
        autoSend: draft.autoSend !== false,
        language: (draft.language || 'ar').trim(),
        templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, (draft.templates[k] || '').trim()])),
      });
      // Branches may still be served from the built-in fallback list — seed
      // them first so the merge below doesn't create a lone branch doc.
      await ensureSeeded('branches');
      for (const b of branches) {
        const value = (numbers[b.id] || '').trim();
        if (value !== (b.whatsappNumber || '')) {
          await setDoc(doc(db, 'branches', b.id), { whatsappNumber: value }, { merge: true });
        }
      }
      await ensureSeeded('departments');
      for (const d of departments) {
        const value = (deptNumbers[d.id] || '').trim();
        if (value !== (d.whatsappNumber || '')) {
          await setDoc(doc(db, 'departments', d.id), { whatsappNumber: value }, { merge: true });
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <div>
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-[#25D366]" />
          {t('waApi.title')}
        </h3>
        <p className="text-sm text-slate-500 mt-1">{t('waApi.subtitle')}</p>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{error}</div>}

      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={!!draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
        {t('waApi.enabled')}
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-1" checked={draft.autoSend !== false} onChange={(e) => setDraft((d) => ({ ...d, autoSend: e.target.checked }))} />
        <span>
          {t('waApi.autoSend')}
          <span className="block text-xs text-slate-500 mt-0.5">{t('waApi.autoSendHint')}</span>
        </span>
      </label>

      <div>
        <p className="text-sm font-bold text-slate-700 mb-2">{t('waApi.branchNumbersTitle')}</p>
        <p className="text-xs text-slate-500 mb-3">{t('waApi.branchNumbersHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {branches.map((b) => (
            <div key={b.id}>
              <label className="block text-xs text-slate-600 mb-1">{b.name}</label>
              <input
                type="tel"
                dir="ltr"
                value={numbers[b.id] || ''}
                onChange={(e) => setNumbers((n) => ({ ...n, [b.id]: e.target.value }))}
                placeholder="05XXXXXXXX"
                className={inputCls}
              />
              {numbers[b.id] && <p className="text-[11px] text-slate-400 mt-0.5" dir="ltr">wa.me/{toWhatsAppNumber(numbers[b.id])}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-slate-700 mb-2">{t('waApi.deptNumbersTitle')}</p>
        <p className="text-xs text-slate-500 mb-3">{t('waApi.deptNumbersHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {departments.map((d) => (
            <div key={d.id}>
              <label className="block text-xs text-slate-600 mb-1">{d.name}</label>
              <input
                type="tel"
                dir="ltr"
                value={deptNumbers[d.id] || ''}
                onChange={(e) => setDeptNumbers((n) => ({ ...n, [d.id]: e.target.value }))}
                placeholder={t('waApi.deptNumberPlaceholder')}
                className={inputCls}
              />
              {deptNumbers[d.id] && <p className="text-[11px] text-slate-400 mt-0.5" dir="ltr">wa.me/{toWhatsAppNumber(deptNumbers[d.id])}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-slate-700 mb-2">{t('waApi.templatesTitle')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t('waApi.language')}</label>
            <input dir="ltr" value={draft.language || ''} onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))} className={inputCls} />
          </div>
          {TEMPLATE_KEYS.map((k) => (
            <div key={k}>
              <label className="block text-xs text-slate-600 mb-1">{t(`waApi.templateNames.${k}`)}</label>
              <input dir="ltr" value={draft.templates[k] || ''} onChange={(e) => setDraft((d) => ({ ...d, templates: { ...d.templates, [k]: e.target.value } }))} className={inputCls} />
            </div>
          ))}
        </div>
      </div>

      <details className="bg-sky-50 border border-sky-100 rounded-xl p-4">
        <summary className="text-sm font-bold text-slate-800 cursor-pointer">{t('waApi.guideTitle')}</summary>
        <div className="mt-3 space-y-4 text-sm text-slate-700">
          <p>{t('waApi.guideIntro')}</p>
          <ul className="list-disc pr-5 space-y-1 text-xs">
            <li>{t('waApi.guideCategory')}</li>
            <li>{t('waApi.guideVars')}</li>
            <li>{t('waApi.guideButton')} <code dir="ltr" className="bg-white px-1 rounded">https://mis-complaints.web.app/contact/{'{{1}}'}</code> — {t('waApi.guideButtonExample')} <code dir="ltr" className="bg-white px-1 rounded">COM-2026-1234</code></li>
          </ul>
          {TEMPLATE_KEYS.map((k) => (
            <div key={k}>
              <p className="text-xs font-bold text-slate-600 mb-1">
                {t(`waApi.templateNames.${k}`)} — <span dir="ltr" className="font-mono">{draft.templates[k]}</span>
              </p>
              <CopyBox text={SUGGESTED[k]} />
              <p className="text-[11px] text-slate-500 mt-1">{t(`waApi.${VAR_HINT[k]}`)}</p>
            </div>
          ))}
        </div>
      </details>

      <button
        onClick={save}
        disabled={saving}
        className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark flex items-center gap-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saved ? t('waApi.saved') : t('common.save')}
      </button>
    </div>
  );
}
