import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2, Pencil, Trash2, PlayCircle, CalendarClock, ListChecks } from 'lucide-react';
import { Modal, Field, Pill, inputCls, btn } from '../platform/ui';
import { callMnt, MNT_CATEGORIES, MNT_PRIORITIES, PLAN_FREQS, CATEGORY_ICON, ASSET_ICON, daysFromToday, riyadhToday } from '../../config/maintenance';

// Preventive maintenance: what is done how often (AC filters monthly,
// extinguishers every quarter…). On its day each plan makes a work order
// with its checklist, given to its technician; the next day moves on.
export default function MntPlans({ branchName, manageBranches, tickets, onOpenTicket }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => Promise.all([callMnt('plans'), callMnt('assets'), callMnt('techs'), callMnt('places')])
    .then(([p, a, x, pl]) => setData({ plans: p.plans, assets: a.assets, techs: x.techs, places: pl.places })).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const runNow = async (p) => {
    if (!window.confirm(t('mnt.plans.runConfirm', { title: p.title }))) return;
    setBusy(p.id);
    try { const r = await callMnt('runPlan', { id: p.id }); await load(); onOpenTicket(r.id); } catch (err) { window.alert(err.message); } finally { setBusy(''); }
  };
  const remove = async (p) => {
    if (!window.confirm(t('mnt.plans.deleteConfirm', { title: p.title }))) return;
    try { await callMnt('deletePlan', { id: p.id }); load(); } catch (err) { window.alert(err.message); }
  };
  if (error) return <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>;
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  const assetName = Object.fromEntries(data.assets.map((a) => [a.id, a]));
  const techName = Object.fromEntries(data.techs.map((x) => [x.id, x.name]));
  // Done on time: preventive work orders finished by their deadline.
  const pm = tickets.filter((x) => x.source === 'PM' && ['DONE', 'CLOSED'].includes(x.status));
  const onTime = pm.length ? Math.round((pm.filter((x) => !x.dueAt || x.doneAt <= x.dueAt).length / pm.length) * 100) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({})} className={btn.primary}><Plus className="w-4 h-4" />{t('mnt.plans.add')}</button>
        <p className="text-xs text-slate-500">{t('mnt.plans.hint')}</p>
        {onTime != null && <Pill className="bg-emerald-50 text-emerald-700 border-emerald-200">{t('mnt.plans.onTime', { n: onTime, total: pm.length })}</Pill>}
      </div>
      {!data.plans.length ? <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">{t('mnt.plans.empty')}</div> : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
          {data.plans.map((p) => {
            const d = daysFromToday(p.nextDue);
            const open = tickets.filter((x) => x.planId === p.id && ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(x.status));
            return (
              <div key={p.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
                <span className="text-lg">{CATEGORY_ICON[p.category]}</span>
                <span className="flex-1 min-w-56 text-sm">
                  <span className="font-medium text-slate-900">{p.title}</span>
                  <span className="block text-xs text-slate-500">
                    {branchName(p.branch)} · {t(`mnt.freqs.${p.freq}`)}{p.techId ? ` · ${techName[p.techId] || ''}` : ''}
                    {p.assetIds.length ? ` · ${p.assetIds.map((id) => assetName[id] ? `${ASSET_ICON[assetName[id].type]} ${assetName[id].name}` : '').filter(Boolean).join('، ')}` : ''}
                    {p.checklist.length ? <> · <ListChecks className="inline w-3 h-3" /> {p.checklist.length}</> : null}
                  </span>
                </span>
                <Pill className={d < 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : d <= 7 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}>
                  <CalendarClock className="w-3 h-3 me-1" /><span className="me-1">{t('mnt.plans.next')}</span><span dir="ltr">{p.nextDue}</span>
                </Pill>
                {open.map((x) => <button key={x.id} type="button" onClick={() => onOpenTicket(x.id)} className="text-xs text-primary" dir="ltr">{x.number}</button>)}
                <button type="button" disabled={busy === p.id} onClick={() => runNow(p)} className={`${btn.small} border border-slate-200 text-slate-600 px-2.5 py-1.5`}>{busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}{t('mnt.plans.runNow')}</button>
                <button type="button" onClick={() => setEditing(p)} className="p-1.5 text-slate-500 hover:text-primary"><Pencil className="w-4 h-4" /></button>
                <button type="button" onClick={() => remove(p)} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      )}
      {editing && <PlanEditor initial={editing} data={data} branchName={branchName} manageBranches={manageBranches} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function PlanEditor({ initial, data, branchName, manageBranches, onClose, onSaved }) {
  const { t } = useTranslation();
  const branches = [...new Set([...manageBranches.filter((b) => b !== '*'), ...data.assets.map((a) => a.branch), ...data.places.map((p) => p.branch)])];
  const [f, setF] = useState({ branch: branches[0] || '', title: '', category: 'AC', priority: 'NORMAL', freq: 'MONTHLY', nextDue: riyadhToday(), assetIds: [], placeId: '', techId: '', ...initial, checklistText: (initial.checklist || []).join('\n') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await callMnt('savePlan', { ...f, id: initial.id || '', checklist: f.checklistText.split('\n').map((x) => x.trim()).filter(Boolean) }); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };
  const assets = data.assets.filter((a) => a.branch === f.branch);
  return (
    <Modal title={initial.id ? t('mnt.plans.edit') : t('mnt.plans.add')} onClose={onClose} size="max-w-2xl"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>{t('common.cancel')}</button><button type="button" disabled={busy || !f.title.trim() || !f.nextDue || !f.branch} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('mnt.plans.title')} required className="sm:col-span-2"><input value={f.title} onChange={(ev) => set('title', ev.target.value)} placeholder={t('mnt.plans.titleHint')} className={inputCls} /></Field>
        {!initial.id && branches.length > 1 && <Field label={t('mnt.branch')}><select value={f.branch} onChange={(ev) => setF((p) => ({ ...p, branch: ev.target.value, assetIds: [], placeId: '' }))} className={inputCls}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></Field>}
        <Field label={t('mnt.category')}><select value={f.category} onChange={(ev) => set('category', ev.target.value)} className={inputCls}>{MNT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {t(`mnt.categories.${c}`)}</option>)}</select></Field>
        <Field label={t('mnt.plans.freq')}><select value={f.freq} onChange={(ev) => set('freq', ev.target.value)} className={inputCls}>{PLAN_FREQS.map((k) => <option key={k} value={k}>{t(`mnt.freqs.${k}`)}</option>)}</select></Field>
        <Field label={t('mnt.plans.nextDue')} required><input type="date" dir="ltr" value={f.nextDue} onChange={(ev) => set('nextDue', ev.target.value)} className={inputCls} /></Field>
        <Field label={t('mnt.priority')}><select value={f.priority} onChange={(ev) => set('priority', ev.target.value)} className={inputCls}>{MNT_PRIORITIES.map((p) => <option key={p} value={p}>{t(`mnt.priorities.${p}`)}</option>)}</select></Field>
        <Field label={t('mnt.plans.tech')}><select value={f.techId} onChange={(ev) => set('techId', ev.target.value)} className={inputCls}><option value="">{t('mnt.plans.noTech')}</option>{data.techs.filter((x) => !x.branches.length || x.branches.includes(f.branch)).map((x) => <option key={x.id} value={x.id}>{x.name}{x.company ? ` — ${x.company}` : ''}</option>)}</select></Field>
        <Field label={t('mnt.place')}><select value={f.placeId} onChange={(ev) => set('placeId', ev.target.value)} className={inputCls}><option value="">—</option>{data.places.filter((p) => p.branch === f.branch).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      </div>
      <Field label={t('mnt.plans.assets')}>
        {!assets.length ? <p className="text-xs text-slate-400">{t('mnt.plans.noAssets')}</p> : (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">{assets.map((a) => <button key={a.id} type="button" onClick={() => set('assetIds', f.assetIds.includes(a.id) ? f.assetIds.filter((x) => x !== a.id) : [...f.assetIds, a.id])} className={`px-2.5 py-1 rounded-lg border text-xs ${f.assetIds.includes(a.id) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'}`}>{ASSET_ICON[a.type]} {a.name}</button>)}</div>
        )}
      </Field>
      <Field label={t('mnt.plans.checklist')} hint={t('mnt.plans.checklistHint')}><textarea value={f.checklistText} onChange={(ev) => set('checklistText', ev.target.value)} rows={4} className={inputCls} placeholder={t('mnt.plans.checklistExample')} /></Field>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </Modal>
  );
}
