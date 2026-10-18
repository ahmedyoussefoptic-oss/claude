import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, setDoc } from 'firebase/firestore';
import QRCode from 'qrcode';
import { Settings2, Save, Check, Loader2, Link2, Copy, QrCode } from 'lucide-react';
import { db } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { LEAD_STAGES, LEAD_SOURCES, usePlatformSettings } from '../../config/platform';
import { STAGES } from '../../config/complaintTypes';
import { Field, inputCls, btn } from '../../components/platform/ui';

// Suggested WhatsApp template for visit confirmations / reminders
// (sendLeadVisitReminders fills the five variables and the button).
const VISIT_TEMPLATE = 'مرحباً {{1}}،\nموعد {{2}} في مدارس المكتشف العالمية\nالموعد: {{3}}\n{{4}}\nللتواصل مع الفرع: {{5}}\n\nهذا الرقم مخصص للإشعارات فقط ولا يستقبل الردود، للتواصل مع الفرع اضغط زر "تواصل مع الفرع".';
const VISIT_TEMPLATE_VARS = '{{1}} ولي الأمر · {{2}} نوع الموعد · {{3}} التاريخ والوقت · {{4}} نص التأكيد أو التذكير · {{5}} رابط التواصل مع الفرع — زر الرابط: ' + window.location.origin + '/contact/{{1}}';

// إعدادات المنصة — limits and deadlines for the platform modules, seats per
// grade, and the public links/QR codes for parents.
export default function PlatformSettings() {
  const { t } = useTranslation();
  const settings = usePlatformSettings();
  const branches = useBranches();
  const [draft, setDraft] = useState(settings);
  const [capBranch, setCapBranch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState('');
  const [qr, setQr] = useState({});
  const [linkSource, setLinkSource] = useState('WEBSITE');

  useEffect(() => { setDraft(settings); }, [settings]);
  const joinLink = `${window.location.origin}/join?src=${linkSource}`;
  const leaveLink = `${window.location.origin}/leave`;
  useEffect(() => {
    Promise.all([QRCode.toDataURL(joinLink, { width: 320, margin: 1 }), QRCode.toDataURL(leaveLink, { width: 320, margin: 1 })]).then(([j, l]) => setQr({ join: j, leave: l }));
  }, [joinLink, leaveLink]);

  const save = async () => {
    setSaving(true);
    await setDoc(doc(db, 'platformSettings', 'main'), {
      leaveMonthlyLimit: Math.max(1, Number(draft.leaveMonthlyLimit) || 3),
      leaveUrgentMinutes: Math.max(1, Number(draft.leaveUrgentMinutes) || 15),
      academicYear: String(draft.academicYear || '').trim(),
      stageSla: Object.fromEntries(LEAD_STAGES.map((s) => [s, Math.max(0, Number(draft.stageSla[s]) || 0)])),
      capacity: draft.capacity || {},
      leadVisitTemplate: String(draft.leadVisitTemplate || '').trim(),
      leadVisitAutoRemind: draft.leadVisitAutoRemind === true,
    }, { merge: true });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const copy = async (k, text) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ } };
  const setCap = (g, v) => setDraft((d) => ({ ...d, capacity: { ...(d.capacity || {}), [capBranch]: { ...((d.capacity || {})[capBranch] || {}), [g]: Number(v) || 0 } } }));
  const card = 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Settings2 className="w-6 h-6 text-primary" />{t('platform.settings.title')}</h1>
        <p className="text-slate-500 mt-1">{t('platform.settings.subtitle')}</p>
      </div>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.settings.links')}</h3>
        {[['join', t('platform.settings.joinLink'), joinLink, t('platform.settings.joinHint')], ['leave', t('platform.settings.leaveLink'), leaveLink, t('platform.settings.leaveHint')]].map(([k, label, link, hint]) => (
          <div key={k} className="flex flex-col sm:flex-row gap-4 items-start">
            {qr[k] && <img src={qr[k]} alt="" className="w-28 h-28 border border-slate-200 rounded-xl" />}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-slate-800">{label}</p>
              <p className="text-xs text-slate-500">{hint}</p>
              {k === 'join' && (
                <select value={linkSource} onChange={(e) => setLinkSource(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">{LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`platform.leads.sources.${s}`)}</option>)}</select>
              )}
              <div className="flex gap-2">
                <input readOnly value={link} dir="ltr" className={`${inputCls} font-mono text-xs`} />
                <button onClick={() => copy(k, link)} className={btn.ghost}>{copied === k ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>
                {qr[k] && <a href={qr[k]} download={`${k}-qr.png`} className={btn.ghost}><QrCode className="w-4 h-4" /></a>}
              </div>
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-400 flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />{t('platform.settings.referralHint')}</p>
      </section>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.settings.leaves')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('platform.settings.leaveMonthlyLimit')} hint={t('platform.settings.leaveMonthlyLimitHint')}><input type="number" min="1" value={draft.leaveMonthlyLimit} onChange={(e) => setDraft((d) => ({ ...d, leaveMonthlyLimit: e.target.value }))} className={inputCls} /></Field>
          <Field label={t('platform.settings.leaveUrgentMinutes')} hint={t('platform.settings.leaveUrgentHint')}><input type="number" min="1" value={draft.leaveUrgentMinutes} onChange={(e) => setDraft((d) => ({ ...d, leaveUrgentMinutes: e.target.value }))} className={inputCls} /></Field>
        </div>
      </section>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.settings.leadSla')}</h3>
        <p className="text-xs text-slate-500">{t('platform.settings.leadSlaHint')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {LEAD_STAGES.map((s) => (
            <Field key={s} label={t(`platform.leads.stages.${s}`)}><input type="number" min="0" step="0.5" value={draft.stageSla?.[s] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, stageSla: { ...d.stageSla, [s]: e.target.value } }))} className={inputCls} /></Field>
          ))}
        </div>
      </section>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.visits.settingsTitle')}</h3>
        <Field label={t('platform.visits.templateName')} hint={t('platform.visits.templateHint')}><input value={draft.leadVisitTemplate || ''} onChange={(e) => setDraft((d) => ({ ...d, leadVisitTemplate: e.target.value }))} className={`${inputCls} max-w-sm font-mono`} dir="ltr" placeholder="lead_visit_reminder" /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.leadVisitAutoRemind === true} onChange={(e) => setDraft((d) => ({ ...d, leadVisitAutoRemind: e.target.checked }))} />{t('platform.visits.autoRemind')}</label>
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500">{t('platform.visits.suggested')}</p>
          <div className="relative">
            <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3 pl-10 text-slate-700 font-sans">{VISIT_TEMPLATE}</pre>
            <button onClick={() => copy('tpl', VISIT_TEMPLATE)} className="absolute top-2 left-2 p-1.5 text-slate-400 hover:text-primary">{copied === 'tpl' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>
          </div>
          <p className="text-[11px] text-slate-400" dir="rtl">{VISIT_TEMPLATE_VARS}</p>
        </div>
      </section>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.settings.capacity')}</h3>
        <p className="text-xs text-slate-500">{t('platform.settings.capacityHint')}</p>
        <select value={capBranch} onChange={(e) => setCapBranch(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
          <option value="">{t('platform.settings.pickBranch')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {capBranch && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {STAGES.map((g) => <Field key={g} label={g}><input type="number" min="0" value={(draft.capacity?.[capBranch] || {})[g] || ''} onChange={(e) => setCap(g, e.target.value)} className={inputCls} /></Field>)}
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="font-bold text-slate-900">{t('platform.settings.reenroll')}</h3>
        <Field label={t('platform.settings.academicYear')} hint={t('platform.settings.academicYearHint')}><input value={draft.academicYear} onChange={(e) => setDraft((d) => ({ ...d, academicYear: e.target.value }))} className={`${inputCls} max-w-xs`} dir="ltr" /></Field>
      </section>

      <button onClick={save} disabled={saving} className={btn.primary}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}{saved ? t('platform.settings.saved') : t('common.save')}</button>
    </div>
  );
}
