import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Palette, Check, Loader2 } from 'lucide-react';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';

// The design of every public link (complaint form, tracking, trips, leave,
// visits…): one choice for all of them (settings/publicDesign). The parents'
// meeting pages keep their navy look either way.
export default function PublicDesignSettings() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const [design, setDesign] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'publicDesign')).then((s) => setDesign(s.data()?.design === 'navy' ? 'navy' : 'classic')).catch(() => setDesign('classic'));
  }, []);

  const choose = async (d) => {
    if (d === design) return;
    setBusy(d);
    setMsg(null);
    try {
      await setDoc(doc(db, 'settings', 'publicDesign'), { design: d, updatedAt: serverTimestamp(), updatedByName: userData?.name || '' });
      setDesign(d);
      setMsg({ ok: true, text: t('publicDesign.saved') });
    } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(''); }
  };

  const options = [
    ['classic', 'bg-white border-slate-200', 'bg-primary'],
    ['navy', 'bg-[#1b345a] border-[#1b345a]', 'bg-[#ffffff]'],
  ];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Palette className="w-5 h-5 text-primary" />{t('publicDesign.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">{t('publicDesign.hint')}</p>
      </div>
      {design === null ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map(([key, swatch, bar]) => (
            <button key={key} type="button" disabled={!!busy} onClick={() => choose(key)}
              className={`text-start rounded-2xl border-2 p-3 transition ${design === key ? 'border-primary ring-4 ring-primary/10' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className={`h-16 rounded-xl border ${swatch} p-2 flex flex-col gap-1.5`}>
                <span className={`h-2 w-1/2 rounded ${bar}`} />
                <span className={`h-2 w-1/3 rounded ${bar} opacity-60`} />
              </div>
              <p className="mt-2 text-sm font-bold text-slate-800 flex items-center gap-1.5">
                {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : design === key && <Check className="w-4 h-4 text-primary" />}
                {t(`design.name.${key}`)}
              </p>
            </button>
          ))}
        </div>
      )}
      {msg && <p className={`text-sm rounded-xl p-2.5 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{msg.text}</p>}
    </div>
  );
}
