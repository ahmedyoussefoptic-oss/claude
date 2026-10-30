import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { PhoneCall, Loader2, Check, RefreshCw, Webhook, Copy } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

// Owner only: the Bevatel API key, which queue belongs to which branch, and
// a manual sync (calls are otherwise pulled every 15 minutes).
export default function BevatelSettings() {
  const { t } = useTranslation();
  const branches = useBranches();
  const [cfg, setCfg] = useState({});
  const [apiKey, setApiKey] = useState('');
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [webhook, setWebhook] = useState(null); // { url, header, key }: the key is shown once

  useEffect(() => onSnapshot(doc(db, 'settings', 'bevatel'), (snap) => {
    const d = snap.data() || {};
    setCfg(d);
    setMap(d.queueBranch || {});
  }, () => {}), []);

  const run = async (key, fn, ok) => {
    setBusy(key);
    setMsg(null);
    try {
      const result = await fn();
      setMsg({ ok: typeof ok === 'function' ? ok(result) : ok });
    } catch (err) {
      setMsg({ error: err.message });
    } finally {
      setBusy(null);
    }
  };
  const saveKey = (remove) => run('key', async () => { await call('setBevatelKey', { apiKey: remove ? '' : apiKey }); setApiKey(''); }, remove ? t('bevatel.removed') : t('bevatel.connectedOk'));
  const saveMap = () => run('map', () => call('saveBevatelQueues', { queueBranch: map }), t('bevatel.mapSaved'));
  const syncNow = (days) => run(`sync${days}`, () => call('bevatelSyncNow', { days }), (r) => t('bevatel.synced', { inbound: r.inbound || 0, outbound: r.outbound || 0 }));
  const makeWebhookKey = () => {
    if (cfg.webhookKeyAt && !window.confirm(t('bevatel.webhook.replaceConfirm'))) return;
    run('webhook', async () => setWebhook(await call('createBevatelWebhookKey')), t('bevatel.webhook.created'));
  };
  const queues = cfg.queues || [];
  const copyRow = (label, value) => (
    <div>
      <p className="text-xs text-slate-600 mb-1">{label}</p>
      <div className="flex gap-2">
        <input readOnly dir="ltr" value={value} className={inputCls} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={() => navigator.clipboard.writeText(value)} className="px-3 rounded-xl border border-slate-300 bg-white text-slate-600 shrink-0"><Copy className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <section>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2"><PhoneCall className="w-4 h-4 text-primary" />{t('bevatel.title')}</p>
      <p className="text-xs text-slate-500 mb-3">{cfg.connected ? t('bevatel.onHint') : t('bevatel.offHint')}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72"><label className="block text-xs text-slate-600 mb-1">{cfg.connected ? t('bevatel.newKey') : t('bevatel.key')}</label><input type="password" autoComplete="off" dir="ltr" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputCls} /></div>
        <button disabled={!apiKey || busy === 'key'} onClick={() => saveKey(false)} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
          {busy === 'key' && <Loader2 className="w-4 h-4 animate-spin" />}{t('bevatel.connect')}
        </button>
        {cfg.connected && <button disabled={!!busy} onClick={() => saveKey(true)} className="px-4 py-2 rounded-xl text-sm text-rose-600 border border-rose-200 bg-white">{t('bevatel.disconnect')}</button>}
      </div>

      <div className="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Webhook className="w-4 h-4 text-primary" />{t('bevatel.webhook.title')}</p>
        <p className="text-xs text-slate-500">{t('bevatel.webhook.hint')}</p>
        <button disabled={!!busy} onClick={makeWebhookKey} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
          {busy === 'webhook' && <Loader2 className="w-4 h-4 animate-spin" />}{t(cfg.webhookKeyAt ? 'bevatel.webhook.replace' : 'bevatel.webhook.create')}
        </button>
        {webhook && (
          <div className="space-y-2">
            {copyRow(t('bevatel.webhook.url'), webhook.url)}
            {copyRow(t('bevatel.webhook.headerKey'), webhook.header)}
            {copyRow(t('bevatel.webhook.headerValue'), webhook.key)}
            <p className="text-xs text-amber-700">{t('bevatel.webhook.once')}</p>
          </div>
        )}
        {cfg.webhookKeyAt && !cfg.webhookLastAt && <p className="text-xs text-slate-500">{t('bevatel.webhook.waiting')}</p>}
        {cfg.webhookLastAt && (
          <div className="text-xs text-slate-600 space-y-0.5">
            <p>{t('bevatel.webhook.last', { time: format(cfg.webhookLastAt.toDate(), 'yyyy-MM-dd HH:mm'), count: cfg.webhookCount || 0 })}</p>
            <p dir="ltr" className="text-start text-slate-400">{Object.entries(cfg.webhookEvents || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
            {[...(cfg.webhookDirections || []), ...(cfg.webhookDialStatuses || [])].length > 0 && <p dir="ltr" className="text-start text-slate-400">{[...(cfg.webhookDirections || []), ...(cfg.webhookDialStatuses || [])].join(' · ')}</p>}
          </div>
        )}
      </div>

      {(cfg.connected || queues.length > 0) && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">{t('bevatel.queuesTitle')}</p>
          {queues.length === 0 ? <p className="text-xs text-slate-500">{t('bevatel.noQueues')}</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {queues.map((q) => (
                <label key={q.number} className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl p-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">{q.name} <span className="text-xs text-slate-400" dir="ltr">{q.number}{q.type ? ` · ${q.type}` : ''}</span></span>
                  <select value={map[q.number] || ''} onChange={(e) => setMap((m) => ({ ...m, [q.number]: e.target.value }))} className="px-2 py-1 border border-slate-200 rounded-lg text-sm">
                    <option value="">{t('bevatel.pickBranch')}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {queues.length > 0 && <button disabled={!!busy} onClick={saveMap} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">{busy === 'map' && <Loader2 className="w-4 h-4 animate-spin" />}{t('bevatel.saveMap')}</button>}
            {cfg.connected && [7, 30].map((d) => (
              <button key={d} disabled={!!busy} onClick={() => syncNow(d)} className="px-4 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-2 disabled:opacity-50">
                {busy === `sync${d}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{t('bevatel.syncDays', { days: d })}
              </button>
            ))}
          </div>
          {cfg.lastSyncAt && <p className="text-xs text-slate-500">{t('bevatel.lastSync', { time: format(cfg.lastSyncAt.toDate(), 'yyyy-MM-dd HH:mm'), count: cfg.lastSyncCount || 0 })}</p>}
          {cfg.lastSyncError && <p className="text-xs text-rose-600">{cfg.lastSyncError}</p>}
        </div>
      )}
      {msg?.error && <p className="text-sm text-red-600 mt-2">{msg.error}</p>}
      {msg?.ok && <p className="text-sm text-emerald-700 mt-2 flex items-center gap-1"><Check className="w-4 h-4" />{msg.ok}</p>}
    </section>
  );
}
