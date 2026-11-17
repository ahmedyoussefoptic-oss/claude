import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { callSupport, WEEKDAYS } from '../../config/support';
import { Modal, Field, inputCls, btn } from '../platform/ui';

const DEFAULT_PLEDGE = 'أقرّ أنا ولي أمر الطالب/ة {student} بأنني اطّلعت على ترشيح المدرسة لابني/ابنتي لحصص {program}، وأنني لا أرغب في التحاقه/ا بها، وأتحمّل مسؤولية ذلك وما قد يترتب عليه من أثر على مستواه/ا الدراسي، وأتعهد بمتابعة مستواه/ا الدراسي في المنزل والتواصل مع المدرسة عند الحاجة.';

// Creating / editing a cycle: name, dates, class days and time, branches,
// days off, whether a coordinator approves nominations, absence messages
// and the pledge text.
export default function CycleEditor({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const all = userData?.role === 'ADMIN' || userData?.access === 'all';
  const branches = useBranches().filter((b) => all || (userData?.branches || []).includes(b.id) || userData?.branch === b.id);
  const [f, setF] = useState(() => ({
    title: initial?.title || '', startDay: initial?.startDay || '', endDay: initial?.endDay || '', weekdays: initial?.weekdays || [1, 4],
    startTime: initial?.startTime || '13:15', endTime: initial?.endTime || '14:15', branches: initial?.branches || [], holidays: initial?.holidays || [],
    requireApproval: initial ? initial.requireApproval : true, absentWa: initial ? initial.absentWa : true, pledgeText: initial?.pledgeText || DEFAULT_PLEDGE,
  }));
  const [holiday, setHoliday] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const chip = (on) => `px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`;

  const save = async () => {
    setError(null);
    if (!f.title.trim() || !f.startDay || !f.endDay) { setError(t('support.editor.required')); return; }
    setBusy(true);
    try {
      const r = await callSupport('supportSaveCycle', { ...f, id: initial?.id });
      onSaved(r.id);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={initial ? t('support.editor.editTitle') : t('support.editor.newTitle')} onClose={onClose} size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      <Field label={t('support.editor.name')} required><input value={f.title} onChange={set('title')} placeholder={t('support.editor.namePh')} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('support.editor.start')} required><input type="date" value={f.startDay} onChange={set('startDay')} className={inputCls} /></Field>
        <Field label={t('support.editor.end')} required><input type="date" value={f.endDay} min={f.startDay} onChange={set('endDay')} className={inputCls} /></Field>
      </div>
      <Field label={t('support.editor.days')}>
        <div className="flex flex-wrap gap-1.5">{WEEKDAYS.map((w) => <button key={w} type="button" onClick={() => toggle('weekdays', w)} className={chip(f.weekdays.includes(w))}>{t(`support.weekdays.${w}`)}</button>)}</div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('support.editor.from')}><input type="time" value={f.startTime} onChange={set('startTime')} className={inputCls} /></Field>
        <Field label={t('support.editor.to')}><input type="time" value={f.endTime} onChange={set('endTime')} className={inputCls} /></Field>
      </div>
      <Field label={t('support.editor.branches')} hint={t('support.editor.branchesHint')}>
        <div className="flex flex-wrap gap-1.5">{branches.map((b) => <button key={b.id} type="button" onClick={() => toggle('branches', b.id)} className={chip(f.branches.includes(b.id))}>{b.name}</button>)}</div>
      </Field>
      <Field label={t('support.editor.holidays')} hint={t('support.editor.holidaysHint')}>
        <div className="flex gap-2">
          <input type="date" value={holiday} min={f.startDay} max={f.endDay} onChange={(e) => setHoliday(e.target.value)} className={`${inputCls} max-w-xs`} />
          <button type="button" disabled={!holiday} onClick={() => { setF((x) => ({ ...x, holidays: [...new Set([...x.holidays, holiday])].sort() })); setHoliday(''); }} className={btn.ghost}>{t('support.editor.addDay')}</button>
        </div>
        {f.holidays.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{f.holidays.map((h) => <span key={h} className="px-2 py-0.5 rounded-lg bg-slate-100 text-xs flex items-center gap-1" dir="ltr">{h}<button type="button" onClick={() => toggle('holidays', h)}><X className="w-3 h-3" /></button></span>)}</div>}
      </Field>
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={f.requireApproval} onChange={(e) => setF((x) => ({ ...x, requireApproval: e.target.checked }))} /><span>{t('support.editor.approval')}<span className="block text-xs text-slate-500">{t('support.editor.approvalHint')}</span></span></label>
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={f.absentWa} onChange={(e) => setF((x) => ({ ...x, absentWa: e.target.checked }))} /><span>{t('support.editor.absentWa')}<span className="block text-xs text-slate-500">{t('support.editor.absentWaHint')}</span></span></label>
      <Field label={t('support.editor.pledge')} hint={t('support.editor.pledgeHint')}><textarea rows={5} value={f.pledgeText} onChange={set('pledgeText')} className={inputCls} /></Field>
    </Modal>
  );
}
