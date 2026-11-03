import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { Loader2, PlugZap, Save, RefreshCw, ShieldCheck, Unplug, AlertTriangle } from 'lucide-react';
import { functions } from '../../config/firebase';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const riyadhDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';

function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      <p className="font-bold text-slate-900 flex items-center gap-2"><Icon className="w-5 h-5 text-primary" />{title}</p>
      {children}
    </div>
  );
}
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

// «الحضور الافتراضي» › الإعدادات (admins): the Teams connection (owner only,
// from the IT setup sheet), the attendance rules, the parent notices and a
// manual read of a day.
export default function AttendanceSettings({ cfg, onSaved }) {
  const { t } = useTranslation();
  const [conn, setConn] = useState({ tenantId: '', clientId: '', clientSecret: '', secretExpires: '', teacherGroup: 'MIS-Attendance-Teachers' });
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [syncDay, setSyncDay] = useState(riyadhDay);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    if (!cfg) return;
    setConn((c) => ({ ...c, tenantId: cfg.tenantId || '', clientId: cfg.clientId || '', secretExpires: cfg.secretExpires || '', teacherGroup: cfg.teacherGroup || c.teacherGroup }));
    setRules({ presentPct: cfg.presentPct, lateMin: cfg.lateMin, autoNotify: cfg.autoNotify, notifyTime: cfg.notifyTime, template: cfg.template, studentDomain: cfg.studentDomain });
  }, [cfg]);
  if (!cfg || !rules) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;

  const run = async (key, fn, okText) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof okText === 'function' ? okText(r) : okText });
      onSaved();
      return r;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      return null;
    } finally {
      setBusy('');
    }
  };
  const saveConnection = () => run('conn', () => call('vcSaveConnection', conn), (r) => t('vc.settings.connectedOk', { count: r.teacherCount }))
    .then((r) => r && setConn((c) => ({ ...c, clientSecret: '' })));
  const disconnect = () => window.confirm(t('vc.settings.disconnectConfirm')) && run('conn', () => call('vcSaveConnection', { disconnect: true }), t('vc.settings.disconnected'));
  const saveRules = () => run('rules', () => call('vcSaveSettings', rules), t('vc.settings.saved'));
  const syncNow = async () => {
    setSyncResult(null);
    const r = await run('sync', () => call('vcSyncNow', { day: syncDay, force: true }), t('vc.settings.syncDone'));
    if (r) setSyncResult(r);
  };
  const expiresSoon = cfg.secretExpires && (new Date(cfg.secretExpires) - Date.now()) < 21 * 86400e3;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {msg && <div className={`lg:col-span-2 text-sm rounded-xl p-3 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{msg.text}</div>}

      <Card title={t('vc.settings.connection')} icon={PlugZap}>
        <p className={`text-sm flex items-center gap-2 ${cfg.connected ? 'text-emerald-700' : 'text-amber-700'}`}>
          <ShieldCheck className="w-4 h-4" />
          {cfg.connected ? t('vc.settings.connectedStatus', { group: cfg.teacherGroup, count: cfg.teacherCount }) : t('vc.settings.notConnectedStatus')}
        </p>
        {expiresSoon && <p className="text-xs text-rose-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('vc.settings.secretExpiring', { date: cfg.secretExpires })}</p>}
        {cfg.isOwner ? (
          <>
            <p className="text-xs text-slate-500">{t('vc.settings.connectionHint')}</p>
            <Field label="Directory (tenant) ID"><input dir="ltr" className={inputCls} value={conn.tenantId} onChange={(e) => setConn({ ...conn, tenantId: e.target.value })} /></Field>
            <Field label="Application (client) ID"><input dir="ltr" className={inputCls} value={conn.clientId} onChange={(e) => setConn({ ...conn, clientId: e.target.value })} /></Field>
            <Field label="Client secret (Value)" hint={cfg.hasSecret ? t('vc.settings.secretKept') : t('vc.settings.secretHint')}>
              <input dir="ltr" type="password" autoComplete="off" className={inputCls} value={conn.clientSecret} onChange={(e) => setConn({ ...conn, clientSecret: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('vc.settings.secretExpires')}><input type="date" dir="ltr" className={inputCls} value={conn.secretExpires} onChange={(e) => setConn({ ...conn, secretExpires: e.target.value })} /></Field>
              <Field label={t('vc.settings.teacherGroup')}><input dir="ltr" className={inputCls} value={conn.teacherGroup} onChange={(e) => setConn({ ...conn, teacherGroup: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveConnection} disabled={!!busy} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {busy === 'conn' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}{t('vc.settings.testSave')}
              </button>
              {cfg.connected && <button onClick={disconnect} disabled={!!busy} className="px-4 py-2 rounded-xl border border-rose-200 text-rose-700 text-sm flex items-center gap-2"><Unplug className="w-4 h-4" />{t('vc.settings.disconnect')}</button>}
            </div>
          </>
        ) : <p className="text-xs text-slate-500">{t('vc.settings.ownerOnly')}</p>}
      </Card>

      <Card title={t('vc.settings.rules')} icon={Save}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('vc.settings.presentPct')} hint={t('vc.settings.presentPctHint')}>
            <input type="number" min="10" max="100" className={inputCls} value={rules.presentPct} onChange={(e) => setRules({ ...rules, presentPct: e.target.value })} />
          </Field>
          <Field label={t('vc.settings.lateMin')} hint={t('vc.settings.lateMinHint')}>
            <input type="number" min="0" max="60" className={inputCls} value={rules.lateMin} onChange={(e) => setRules({ ...rules, lateMin: e.target.value })} />
          </Field>
        </div>
        <Field label={t('vc.settings.studentDomain')} hint={t('vc.settings.studentDomainHint')}>
          <input dir="ltr" className={inputCls} value={rules.studentDomain} onChange={(e) => setRules({ ...rules, studentDomain: e.target.value })} />
        </Field>
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">{t('vc.settings.notices')}</p>
          <Field label={t('vc.settings.template')} hint={t('vc.settings.templateHint', { v1: '{{1}}', v2: '{{2}}', v3: '{{3}}' })}>
            <input dir="ltr" className={inputCls} value={rules.template} onChange={(e) => setRules({ ...rules, template: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={rules.autoNotify} onChange={(e) => setRules({ ...rules, autoNotify: e.target.checked })} />
            <span>{t('vc.settings.autoNotify')}<span className="block text-xs text-slate-500">{t('vc.settings.autoNotifyHint')}</span></span>
          </label>
          <Field label={t('vc.settings.notifyTime')}>
            <input type="time" dir="ltr" className={`${inputCls} max-w-40`} value={rules.notifyTime} disabled={!rules.autoNotify} onChange={(e) => setRules({ ...rules, notifyTime: e.target.value })} />
          </Field>
          {!cfg.waReady && <p className="text-xs text-amber-700">{t('vc.waOff')}</p>}
          {cfg.waReady && !cfg.waAutoSend && rules.autoNotify && <p className="text-xs text-amber-700">{t('vc.settings.waAutoSendOff')}</p>}
          {cfg.lastAutoNotify && <p className="text-xs text-slate-500">{cfg.lastAutoNotify.error ? t('vc.settings.lastAutoError', cfg.lastAutoNotify) : t('vc.settings.lastAuto', cfg.lastAutoNotify)}</p>}
        </div>
        <button onClick={saveRules} disabled={!!busy} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
          {busy === 'rules' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('common.save')}
        </button>
      </Card>

      <Card title={t('vc.settings.sync')} icon={RefreshCw}>
        <p className="text-xs text-slate-500">{t('vc.settings.syncHint')}</p>
        {cfg.lastSyncAt && <p className="text-sm text-slate-600">{t('vc.settings.lastSync', { at: format(cfg.lastSyncAt, 'yyyy-MM-dd HH:mm'), ...(cfg.lastSyncStats || {}) })}</p>}
        {cfg.lastSyncError && <p className="text-xs text-rose-700">{cfg.lastSyncError}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('vc.settings.syncDay')}><input type="date" dir="ltr" max={riyadhDay()} className={inputCls} value={syncDay} onChange={(e) => setSyncDay(e.target.value)} /></Field>
          <button onClick={syncNow} disabled={!!busy || !cfg.connected} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm flex items-center gap-2 disabled:opacity-50">
            {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{t('vc.settings.syncNow')}
          </button>
        </div>
        {syncResult && <p className="text-sm text-slate-700">{t('vc.settings.syncStats', syncResult)}</p>}
        {(syncResult?.errorList || cfg.lastSyncErrors || []).length > 0 && (
          <ul className="text-[11px] text-rose-700 bg-rose-50 rounded-lg p-2 space-y-0.5 max-h-40 overflow-y-auto" dir="auto">
            {(syncResult?.errorList || cfg.lastSyncErrors).map((e, k) => <li key={k}>{e}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
