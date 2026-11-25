import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, MapPin, Send, CheckCircle2 } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import PhotoPicker from '../components/maintenance/PhotoPicker';
import { callMntPublic, photoPayload, MNT_CATEGORIES, CATEGORY_ICON } from '../config/maintenance';

const card = 'w-full max-w-lg bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200';
const input = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-primary';

// «/fix/:token» — the QR label in a room: a staff member reports a fault
// there without signing in. Their phone must be the one on their account.
export default function MaintenanceReport() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState({ phone: '', category: '', title: '', description: '', urgent: false });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { callMntPublic('placePeek', { token }).then((r) => { setInfo(r); if (r.category) setF((p) => ({ ...p, category: p.category || r.category })); }).catch((err) => setError(err.message)); }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const photos = await Promise.all(files.map(photoPayload));
      const priority = f.urgent ? (f.category === 'SAFETY' ? 'URGENT' : 'HIGH') : 'NORMAL';
      setDone(await callMntPublic('placeReport', { token, phone: f.phone, category: f.category || 'OTHER', title: f.title, description: f.description, priority, photos }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-lg" title={t('mnt.public.title')} />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {!info ? (
          <div className={`${card} text-center`}>{error ? <p className="text-sm text-rose-700">{error}</p> : <Loader2 className="w-7 h-7 animate-spin text-primary mx-auto" />}</div>
        ) : done ? (
          <div className={`${card} text-center space-y-2`}>
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <p className="font-bold text-slate-900">{t('mnt.public.thanks', { name: done.name })}</p>
            <p className="text-sm text-slate-600">{t('mnt.public.number')} <b dir="ltr">{done.number}</b></p>
            <p className="text-xs text-slate-500">{t('mnt.public.follow')}</p>
            <button type="button" onClick={() => { setDone(null); setF((p) => ({ ...p, title: '', description: '', category: '', urgent: false })); setFiles([]); }} className="text-sm text-primary">{t('mnt.public.another')}</button>
          </div>
        ) : (
          <form onSubmit={submit} className={`${card} space-y-3`}>
            <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-xl p-3">
              <MapPin className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div><p className="font-bold text-slate-900">{info.place}</p><p className="text-xs text-slate-500">{info.branchName}</p></div>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">{t('mnt.category')}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {MNT_CATEGORIES.map((c) => <button key={c} type="button" onClick={() => set('category', c)} className={`px-3 py-2 rounded-xl border text-sm text-start ${f.category === c ? 'bg-primary text-white border-primary' : 'bg-white text-slate-700 border-slate-200'}`}>{CATEGORY_ICON[c]} {t(`mnt.categories.${c}`)}</button>)}
              </div>
            </div>
            <input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={140} placeholder={t('mnt.titleHint')} className={input} required />
            <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={3000} placeholder={t('mnt.description')} className={input} />
            <label className="flex items-center gap-2 text-sm text-rose-700"><input type="checkbox" checked={f.urgent} onChange={(e) => set('urgent', e.target.checked)} />{t('mnt.public.urgent')}</label>
            <PhotoPicker files={files} setFiles={setFiles} />
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">{t('mnt.public.phone')}</p>
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" className={input} required />
              <p className="text-[11px] text-slate-400 mt-1">{t('mnt.public.phoneHint')}</p>
            </div>
            {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
            <button disabled={busy || !f.category || !f.title.trim() || f.phone.replace(/\D/g, '').length < 9} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('mnt.send')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
