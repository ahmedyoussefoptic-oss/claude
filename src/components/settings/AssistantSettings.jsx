import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { db, functions } from '../../config/firebase';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

// Owner only: the Anthropic API key for «المساعد الذكي», on/off, and this
// month's use with an estimated cost.
export default function AssistantSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState({});
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => onSnapshot(doc(db, 'settings', 'assistant'), (snap) => setCfg(snap.data() || {}), () => {}), []);
  useEffect(() => { if (cfg.configured) call('assistantUsageSummary').then(setUsage).catch(() => {}); }, [cfg.configured]);

  const run = async (key, fn, ok) => {
    setBusy(key);
    setMsg(null);
    try { await fn(); setMsg({ ok }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(null); }
  };

  return (
    <section>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-primary" />{t('assistant.settingsTitle')}</p>
      <p className="text-xs text-slate-500 mb-3">{t('assistant.settingsHint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72"><label className="block text-xs text-slate-600 mb-1">{cfg.configured ? t('assistant.newKey') : t('assistant.key')}</label><input type="password" autoComplete="off" dir="ltr" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputCls} placeholder="sk-ant-..." /></div>
        <button disabled={!apiKey || !!busy} onClick={() => run('key', async () => { await call('setAssistantKey', { apiKey }); setApiKey(''); }, t('assistant.keySaved'))} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
          {busy === 'key' && <Loader2 className="w-4 h-4 animate-spin" />}{t('assistant.saveKey')}
        </button>
        {cfg.configured && (
          <button disabled={!!busy} onClick={() => run('toggle', () => call('setAssistantEnabled', { enabled: !cfg.enabled }), cfg.enabled ? t('assistant.turnedOff') : t('assistant.turnedOn'))} className={`px-4 py-2 rounded-xl text-sm border ${cfg.enabled ? 'text-rose-600 border-rose-200 bg-white' : 'text-emerald-700 border-emerald-200 bg-white'}`}>
            {cfg.enabled ? t('assistant.turnOff') : t('assistant.turnOn')}
          </button>
        )}
      </div>
      {cfg.configured && <p className="text-xs mt-2 text-slate-600">{cfg.enabled ? t('assistant.statusOn', { limit: cfg.dailyLimit || 40 }) : t('assistant.statusOff')}</p>}
      {usage && <p className="text-xs mt-1 text-slate-500">{t('assistant.usage', { month: usage.month, messages: usage.messages, usd: usage.estimatedUsd })}</p>}
      {msg?.error && <p className="text-sm text-red-600 mt-2">{msg.error}</p>}
      {msg?.ok && <p className="text-sm text-emerald-700 mt-2 flex items-center gap-1"><Check className="w-4 h-4" />{msg.ok}</p>}
    </section>
  );
}
