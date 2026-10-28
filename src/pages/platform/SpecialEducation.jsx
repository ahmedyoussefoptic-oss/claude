import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, Timestamp } from 'firebase/firestore';
import { HeartHandshake, Upload, Copy, Check, FileSpreadsheet, Loader2, Search, Trash2, Eye, Power } from 'lucide-react';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { Modal, Tile, Field, Pill, btn, inputCls } from '../../components/platform/ui';
import { parseSpedTemplate, fillSpedTemplate, SPED_COLUMNS, SPED_MAX_ROWS } from '../../utils/spedTemplate';

const ms = (v) => v?.toMillis?.() || 0;
const fmt = (v) => (v ? new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ms(v)) : '');
// "YYYY-MM-DD" → "dd-MM-yyyy", as the ministry file shows it.
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// بيانات التربية الخاصة — the ministry's special-education import templates
// uploaded as forms. Each has a parent link (/sped/<id>); the entries are
// listed here and downloaded written into the same template.
export default function SpecialEducation() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const branches = useBranches();
  const [forms, setForms] = useState(null);
  const [entries, setEntries] = useState([]);
  const [formId, setFormId] = useState('');
  const [term, setTerm] = useState('');
  const [pending, setPending] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState('');
  const fileRef = useRef(null);

  useEffect(() => onSnapshot(query(collection(db, 'spedForms'), orderBy('createdAt', 'desc')), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setForms(list);
    setFormId((cur) => (list.some((f) => f.id === cur) ? cur : list[0]?.id || ''));
  }, () => setForms([])), []);
  useEffect(() => onSnapshot(collection(db, 'spedSubmissions'), (snap) => setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setEntries([])), []);

  const counts = useMemo(() => entries.reduce((m, e) => ({ ...m, [e.formId]: (m[e.formId] || 0) + 1 }), {}), [entries]);
  const form = forms?.find((f) => f.id === formId);
  const rows = useMemo(() => entries.filter((e) => e.formId === formId).sort((a, b) => ms(a.createdAt) - ms(b.createdAt)), [entries, formId]);
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? rows.filter((e) => `${e.studentName} ${e.studentId} ${e.guardianName} ${e.guardianId} ${e.phone}`.toLowerCase().includes(q)) : rows;
  }, [rows, term]);
  const link = (id) => `${window.location.origin}/sped/${id}`;
  const branchName = (id) => branches.find((b) => b.id === id)?.name || '';

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseSpedTemplate(file);
      setPending({ ...parsed, title: t('platform.sped.defaultTitle', { stage: parsed.meta.stageName, year: parsed.meta.year }) });
    } catch (err) {
      setError(err.message);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const { meta, lists, template, fileName, title } = pending;
      const ref = await addDoc(collection(db, 'spedForms'), { ...meta, lists, template, fileName, title: title.trim() || meta.stageName, active: true, createdAt: Timestamp.now(), createdBy: user.uid });
      setFormId(ref.id);
      setPending(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = (id) => navigator.clipboard.writeText(link(id)).then(() => { setCopied(id); setTimeout(() => setCopied(''), 1500); });
  const exportFile = async () => {
    setBusy(true);
    try {
      download(await fillSpedTemplate(form.template, rows), form.fileName || `SpecialEducationImport_${form.stageId}_${form.yearId}.xlsx`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const removeEntry = async (e) => {
    if (!window.confirm(t('platform.sped.deleteConfirm', { name: e.studentName }))) return;
    await deleteDoc(doc(db, 'spedSubmissions', e.id)).catch((err) => setError(err.message));
    setView(null);
  };
  const removeForm = async () => {
    if (!window.confirm(t('platform.sped.deleteFormConfirm'))) return;
    await deleteDoc(doc(db, 'spedForms', form.id)).catch((err) => setError(err.message));
  };

  if (!forms) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><HeartHandshake className="w-7 h-7 text-primary" />{t('platform.sped.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('platform.sped.subtitle')}</p>
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} className={btn.primary}><Upload className="w-4 h-4" />{t('platform.sped.upload')}</button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={pick} />
      </div>
      {error && <p className="text-sm bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3">{error}</p>}

      {!forms.length ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-500">{t('platform.sped.empty')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {forms.map((f) => (
              <button type="button" key={f.id} onClick={() => setFormId(f.id)} className={`text-start bg-white border rounded-2xl p-4 shadow-sm space-y-2 ${f.id === formId ? 'border-primary ring-2 ring-primary/20' : 'border-slate-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">{f.title}</p>
                  <Pill className={f.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}>{t(f.active === false ? 'platform.sped.closed' : 'platform.sped.open')}</Pill>
                </div>
                <p className="text-xs text-slate-500">{f.stageName} · {f.year} · <span dir="ltr">ID {f.stageId}</span></p>
                <p className="text-sm"><span className="font-bold tabular-nums">{counts[f.id] || 0}</span> <span className="text-slate-500">{t('platform.sped.entries')}</span></p>
              </button>
            ))}
          </div>

          {form && (
            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 md:p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  <span className="truncate font-mono text-slate-600" dir="ltr">{link(form.id)}</span>
                  <button type="button" onClick={() => copy(form.id)} className="text-primary shrink-0 flex items-center gap-1">{copied === form.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{t(copied === form.id ? 'platform.sped.copied' : 'platform.sped.copy')}</button>
                </div>
                <button type="button" disabled={busy || !rows.length} onClick={exportFile} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}{t('platform.sped.download')}</button>
                <button type="button" onClick={() => updateDoc(doc(db, 'spedForms', form.id), { active: form.active === false })} className={btn.ghost}><Power className="w-4 h-4" />{t(form.active === false ? 'platform.sped.reopen' : 'platform.sped.close')}</button>
                {!rows.length && <button type="button" onClick={removeForm} className={btn.danger}><Trash2 className="w-4 h-4" />{t('platform.sped.deleteForm')}</button>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile label={t('platform.sped.entries')} value={rows.length} sub={t('platform.sped.max', { n: SPED_MAX_ROWS })} />
                <Tile label={t('platform.sped.inRoster')} value={rows.filter((e) => e.inRoster).length} />
                <Tile label={t('platform.sped.notInRoster')} value={rows.filter((e) => !e.inRoster).length} tone="text-amber-600" />
                <Tile label={t('platform.sped.edited')} value={rows.filter((e) => e.editCount > 0).length} />
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('platform.sped.search')} className={`${inputCls} ps-9`} />
              </div>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>{['#', 'studentName', 'studentId', 'guardianName', 'phone', 'grade', 'inclusionType', 'disability', 'sentAt', ''].map((k) => <th key={k} className="px-3 py-2 text-start font-medium whitespace-nowrap">{k && k !== '#' ? t(`platform.sped.cols.${k}`) : k}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((e, i) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">{e.studentName}{!e.inRoster && <span className="block text-[11px] text-amber-600">{t('platform.sped.notInRosterShort')}</span>}</td>
                        <td className="px-3 py-2 font-mono" dir="ltr">{e.studentId}</td>
                        <td className="px-3 py-2">{e.guardianName}<span className="block text-[11px] text-slate-400">{e.relation}</span></td>
                        <td className="px-3 py-2 font-mono" dir="ltr">{e.phone}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{e.grade}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{e.inclusionType}</td>
                        <td className="px-3 py-2">{e.disability}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{fmt(e.updatedAt)}{e.editCount > 0 && <span className="block text-amber-600">{t('platform.sped.editedN', { n: e.editCount })}</span>}</td>
                        <td className="px-3 py-2"><button type="button" onClick={() => setView(e)} className={`${btn.small} text-primary hover:bg-primary/5`}><Eye className="w-3.5 h-3.5" />{t('platform.sped.view')}</button></td>
                      </tr>
                    ))}
                    {!shown.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{t('platform.sped.noEntries')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {pending && (
        <Modal title={t('platform.sped.newForm')} subtitle={pending.fileName} onClose={() => setPending(null)} size="max-w-xl"
          footer={<>
            <button type="button" onClick={() => setPending(null)} className={btn.ghost}>{t('common.cancel')}</button>
            <button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('platform.sped.create')}</button>
          </>}>
          <Field label={t('platform.sped.formTitle')} hint={t('platform.sped.formTitleHint')}><input value={pending.title} onChange={(e) => setPending((p) => ({ ...p, title: e.target.value }))} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 rounded-xl p-3">
            <p><span className="text-slate-500">{t('platform.sped.stage')}: </span>{pending.meta.stageName}</p>
            <p><span className="text-slate-500">{t('platform.sped.year')}: </span>{pending.meta.year}</p>
            <p><span className="text-slate-500">Branch Stage ID: </span><span dir="ltr">{pending.meta.stageId}</span></p>
            <p><span className="text-slate-500">{t('platform.sped.version')}: </span><span dir="ltr">{pending.meta.version}</span></p>
          </div>
          {Object.entries(pending.lists).map(([k, values]) => (
            <div key={k}>
              <p className="text-xs font-medium text-slate-600 mb-1">{t(`platform.sped.lists.${k}`)}</p>
              <div className="flex flex-wrap gap-1.5">{values.map((v) => <Pill key={v} className="bg-slate-100 text-slate-700">{v}</Pill>)}</div>
            </div>
          ))}
        </Modal>
      )}

      {view && (
        <Modal title={view.studentName} subtitle={view.inRoster ? `${t('platform.sped.inRoster')}${view.rosterBranch ? ` — ${branchName(view.rosterBranch)}` : ''}` : t('platform.sped.notInRoster')} onClose={() => setView(null)} size="max-w-xl"
          footer={<>
            <button type="button" onClick={() => removeEntry(view)} className={btn.danger}><Trash2 className="w-4 h-4" />{t('common.delete')}</button>
            <button type="button" onClick={() => setView(null)} className={btn.ghost}>{t('common.close')}</button>
          </>}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {SPED_COLUMNS.slice(1).map(([k]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{t(`spedForm.${k}`)}</dt>
                <dd className="font-medium text-slate-900 break-words" dir={/Id$|Dob$|phone|Phone|email/.test(k) ? 'ltr' : undefined}>{(/Dob$/.test(k) ? dmy(view[k]) : view[k]) || '—'}</dd>
              </div>
            ))}
            <div><dt className="text-xs text-slate-500">{t('platform.sped.cols.sentAt')}</dt><dd>{fmt(view.createdAt)}{view.editCount > 0 && ` · ${t('platform.sped.editedN', { n: view.editCount })} (${fmt(view.updatedAt)})`}</dd></div>
          </dl>
        </Modal>
      )}
    </div>
  );
}
