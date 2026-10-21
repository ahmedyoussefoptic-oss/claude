import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Bot, Loader2, Copy, Check, Ban, Plus } from 'lucide-react';
import { functions } from '../../config/firebase';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
// The MCP endpoint, served through Hosting (firebase.json rewrites /mcp).
const MCP_URL = `${window.location.origin}/mcp`;

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="flex items-stretch gap-2">
      <code dir="ltr" className="flex-1 min-w-0 break-all text-xs bg-slate-900 text-slate-100 rounded-lg px-3 py-2">{text}</code>
      <button type="button" onClick={copy} className="px-2 rounded-lg border border-slate-200 bg-white text-slate-600 shrink-0">{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>
    </div>
  );
}

// Owner only: API keys for the MCP server, so Claude can read the CRM.
export default function ApiKeysSettings() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('Claude');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // { key } — shown once

  const load = useCallback(() => call('listApiKeys').then((d) => setKeys(d.keys)).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      setCreated(await call('createApiKey', { name }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (k) => {
    if (!window.confirm(t('apiKeys.revokeConfirm', { name: k.name }))) return;
    setBusy(k.id);
    try {
      await call('revokeApiKey', { id: k.id });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2"><Bot className="w-4 h-4 text-primary" />{t('apiKeys.title')}</p>
      <p className="text-xs text-slate-500 mb-3">{t('apiKeys.hint')}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56"><label className="block text-xs text-slate-600 mb-1">{t('apiKeys.name')}</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
        <button disabled={busy === 'create'} onClick={create} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">
          {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{t('apiKeys.create')}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {created && (
        <div className="mt-3 bg-white border border-emerald-200 rounded-xl p-3 space-y-2">
          <p className="text-sm font-bold text-emerald-700">{t('apiKeys.createdOnce')}</p>
          <p className="text-xs text-slate-600">{t('apiKeys.keyLabel')}</p>
          <CopyBox text={created.key} />
          <p className="text-xs text-slate-600">{t('apiKeys.urlLabel')}</p>
          <CopyBox text={MCP_URL} />
          <p className="text-xs text-slate-600">{t('apiKeys.claudeCode')}</p>
          <CopyBox text={`claude mcp add --transport http mis-crm ${MCP_URL} --header "Authorization: Bearer ${created.key}"`} />
          <p className="text-xs text-slate-600">{t('apiKeys.claudeAi')}</p>
          <CopyBox text={`${MCP_URL}/${created.key}`} />
          <button onClick={() => setCreated(null)} className="text-xs text-slate-500 underline">{t('common.close')}</button>
        </div>
      )}

      {keys && keys.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 bg-white border border-slate-100 rounded-xl">
          {keys.map((k) => (
            <li key={k.id} className="p-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`font-medium ${k.revoked ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{k.name}</span>
              <code dir="ltr" className="text-xs text-slate-400">{k.hint}</code>
              <span className="text-xs text-slate-500 flex-1">
                {k.createdAt && t('apiKeys.createdAt', { date: format(k.createdAt, 'yyyy-MM-dd') })}
                {' · '}{k.lastUsedAt ? t('apiKeys.lastUsed', { date: format(k.lastUsedAt, 'yyyy-MM-dd HH:mm'), calls: k.calls }) : t('apiKeys.neverUsed')}
              </span>
              {k.revoked ? <span className="text-xs text-rose-600">{t('apiKeys.revoked')}</span> : (
                <button disabled={busy === k.id} onClick={() => revoke(k)} className="px-2 py-1 rounded-lg text-xs text-rose-600 border border-rose-200 flex items-center gap-1">
                  {busy === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}{t('apiKeys.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
