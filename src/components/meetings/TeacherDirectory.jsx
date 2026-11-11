import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { X, Loader2, Download, FileSpreadsheet, Save, AlertTriangle, ChevronDown, ChevronUp, BookUser } from 'lucide-react';
import { useBranches } from '../../hooks/useOrgData';
import { callMeeting } from '../../config/meetings';
import { readTeacherDirectoryFile, DIRECTORY_TEMPLATE_URL } from '../../utils/meetingTeachersExcel';

// «دليل المعلمين»: one Excel file with the teachers of every branch. Saving
// replaces the lists of the branches in the file (other branches are kept).
export default function TeacherDirectory({ onClose }) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [saved, setSaved] = useState(null);
  const [pending, setPending] = useState(null); // parsed file awaiting save
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => callMeeting('getMeetingTeacherDirectory', {}).then((r) => setSaved(r.branches)).catch((err) => setMsg({ ok: false, text: err.message }));
  useEffect(() => { load(); }, []);

  const pick = async (file) => {
    if (!file) return;
    setMsg(null);
    setPending(null);
    try {
      // English names too (as the school's English sheet writes them).
      const en = i18n.getFixedT('en');
      const r = await readTeacherDirectoryFile(file, branches.map((b) => ({ ...b, aliases: [en(`tripConsent.branchNames.${b.id}`, { defaultValue: '' })].filter(Boolean) })));
      if (!Object.keys(r.byBranch).length) { setMsg({ ok: false, text: t('meetings.directory.empty') }); return; }
      setPending(r);
    } catch (err) {
      setMsg({ ok: false, text: err.message === 'branchHeader' ? t('meetings.directory.noBranchColumn') : t('meetings.form.importFailed') });
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await callMeeting('saveMeetingTeacherDirectory', { branches: pending.byBranch });
      setMsg({ ok: true, text: t('meetings.directory.saved', { count: Object.values(r.saved).reduce((a, b) => a + b, 0), branches: Object.keys(r.saved).length }) });
      setPending(null);
      await load();
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  };

  const list = pending
    ? Object.entries(pending.byBranch).map(([branch, teachers]) => ({ branch, teachers, isNew: true }))
    : (saved || []).filter((b) => b.teachers.length);

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 z-[130] flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><BookUser className="w-5 h-5 text-primary" />{t('meetings.directory.title')}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <p className="text-sm text-slate-600">{t('meetings.directory.hint')}</p>
          <div className="flex flex-wrap gap-2">
            <a href={DIRECTORY_TEMPLATE_URL} download="نموذج دليل المعلمين.xlsx" className="px-3 py-2 text-sm border border-slate-200 rounded-xl flex items-center gap-1.5 text-slate-700"><Download className="w-4 h-4" />{t('meetings.directory.template')}</a>
            <label className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-xl flex items-center gap-1.5 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4" />{t('meetings.directory.upload')}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          {msg && <p className={`text-sm rounded-xl p-2.5 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{msg.text}</p>}

          {pending && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1 text-sm text-amber-900">
              <p className="font-medium">{t('meetings.directory.review')}</p>
              {pending.unknownBranches.length > 0 && <p className="flex gap-1"><AlertTriangle className="w-4 h-4 shrink-0" />{t('meetings.directory.unknownBranches', { list: pending.unknownBranches.join('، ') })}</p>}
              {pending.noBranch > 0 && <p>{t('meetings.directory.noBranch', { count: pending.noBranch })}</p>}
              {pending.skipped > 0 && <p>{t('meetings.form.importSkipped', { count: pending.skipped })}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={busy} onClick={save} className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('meetings.directory.save')}</button>
                <button type="button" onClick={() => setPending(null)} className="px-3 py-1.5 text-sm text-slate-600">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {saved === null && !pending ? <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /> : !list.length ? (
            <p className="text-sm text-slate-500 text-center py-6">{t('meetings.directory.none')}</p>
          ) : (
            <div className="space-y-2">
              {list.map((b) => (
                <div key={b.branch} className="border border-slate-200 rounded-xl">
                  <button type="button" onClick={() => setOpen(open === b.branch ? '' : b.branch)} className="w-full flex items-center justify-between p-3 text-start">
                    <span className="text-sm font-medium text-slate-800">{branchName(b.branch)} <span className="text-slate-500 font-normal">· {t('meetings.directory.count', { count: b.teachers.length })}</span></span>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {b.isNew ? <span className="text-amber-700">{t('meetings.directory.notSaved')}</span> : b.updatedAt && `${format(new Date(b.updatedAt), 'yyyy-MM-dd')} · ${b.updatedByName}`}
                      {open === b.branch ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>
                  {open === b.branch && (
                    <div className="border-t border-slate-100 p-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-slate-500">{['teacherName', 'subject', 'classes'].map((k) => <th key={k} className="p-1.5 text-start font-medium">{t(`meetings.form.${k}`)}</th>)}</tr></thead>
                        <tbody>{b.teachers.map((x, i) => <tr key={i} className="border-t border-slate-50"><td className="p-1.5">{x.name}</td><td className="p-1.5">{x.subject}</td><td className="p-1.5" dir="ltr">{x.classes}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
