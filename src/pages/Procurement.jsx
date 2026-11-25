import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ShoppingCart, Plus, Loader2, LayoutDashboard, ListChecks, Building2, Settings2, Save, PiggyBank } from 'lucide-react';
import PageHero from '../components/common/PageHero';
import { Field, inputCls, btn } from '../components/platform/ui';
import { useBranches } from '../hooks/useOrgData';
import { callProc, money } from '../config/procurement';
import ProcDashboard from '../components/procurement/ProcDashboard';
import ProcRequests from '../components/procurement/ProcRequests';
import Suppliers from '../components/procurement/Suppliers';
import Budgets from '../components/procurement/Budgets';
import RequestForm from '../components/procurement/RequestForm';
import RequestDetails from '../components/procurement/RequestDetails';

// «المشتريات»: purchase requests and their approvals by amount, purchase
// orders, receiving, invoices and the payment status; the suppliers.
export default function Procurement() {
  const { t } = useTranslation();
  const branches = useBranches();
  const branchName = (b) => branches.find((x) => x.id === b)?.name || b;
  const [params, setParams] = useSearchParams();
  const openId = params.get('openId');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState({});

  const load = useCallback(() => callProc('list').then((r) => { setData(r); setError(null); }).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);
  const roles = data?.roles || {};
  const tabs = !data ? [] : [['dashboard', LayoutDashboard], ['requests', ListChecks], ...(roles.officer || roles.finance || roles.exec ? [['suppliers', Building2]] : []), ...(roles.viewer || roles.exec ? [['budgets', PiggyBank]] : []), ...(roles.admin ? [['settings', Settings2]] : [])];
  const current = tab || 'dashboard';
  const list = data?.requests || [];

  return (
    <div className="space-y-4">
      <PageHero icon={ShoppingCart} title={t('proc.title')} subtitle={t('proc.subtitle')}
        facts={data ? [
          { label: t('proc.status.PENDING_APPROVAL'), value: list.filter((r) => r.status === 'PENDING_APPROVAL').length, tone: 'amber' },
          { label: t('proc.dash.incoming'), value: list.filter((r) => ['ORDERED', 'PARTIAL'].includes(r.status)).length },
          { label: t('proc.dash.mineShort'), value: list.filter((r) => r.can.approve || r.can.edit || r.can.order || r.can.receive || r.can.invoice || r.can.pay).length, tone: 'green' },
        ] : []}
        actions={<button type="button" onClick={() => setCreating(true)} className="px-4 py-2 bg-primary text-white rounded-xl text-sm flex items-center gap-2"><Plus className="w-4 h-4" />{t('proc.newRequest')}</button>}
      />
      {error ? <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-rose-600">{error}</div>
        : !data ? <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          : (
            <>
              <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-1 w-fit max-w-full">
                {tabs.map(([k, Icon]) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${current === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="w-4 h-4" />{t(`proc.tabs.${k}`)}</button>)}
              </div>
              {current === 'dashboard' && <ProcDashboard requests={list} now={data.now} branchName={branchName} onOpen={(id) => setParams({ openId: id })} onFilter={(f) => { setFilter(f); setTab('requests'); }} />}
              {current === 'requests' && <ProcRequests requests={list} branchName={branchName} filter={filter} setFilter={setFilter} onOpen={(id) => setParams({ openId: id })} />}
              {current === 'suppliers' && <Suppliers />}
              {current === 'budgets' && <Budgets />}
              {current === 'settings' && <ProcSettings initial={data.settings} onSaved={load} />}
            </>
          )}
      {creating && <RequestForm settings={data?.settings} onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); load(); setParams({ openId: r.id }); }} />}
      {openId && <RequestDetails id={openId} settings={data?.settings} branchName={branchName} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
}

// Approval limits (totals with VAT), the VAT rate, the overrun a purchase
// order may have over the approved amount, and the default order terms.
function ProcSettings({ initial, onSaved }) {
  const { t } = useTranslation();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async () => {
    setBusy(true);
    try { const r = await callProc('saveSettings', s); setS(r.settings); setMsg(t('proc.settings.saved')); onSaved(); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  const num = (k) => <input type="number" min="0" step="any" value={s[k]} onChange={(e) => setS((p) => ({ ...p, [k]: e.target.value }))} className={inputCls} dir="ltr" />;
  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4 max-w-3xl">
      <p className="font-bold text-slate-800">{t('proc.settings.title')}</p>
      <p className="text-xs text-slate-500">{t('proc.settings.hint', { a: money(s.financeFrom), b: money(s.execAbove) })}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label={t('proc.settings.financeFrom')}>{num('financeFrom')}</Field>
        <Field label={t('proc.settings.execAbove')}>{num('execAbove')}</Field>
        <Field label={t('proc.settings.vatRate')}>{num('vatRate')}</Field>
        <Field label={t('proc.settings.overrunPct')}>{num('overrunPct')}</Field>
        <Field label={t('proc.settings.quoteFrom')}>{num('quoteFrom')}</Field>
        <Field label={t('proc.settings.quoteCount')}>{num('quoteCount')}</Field>
        <Field label={t('proc.settings.fiscalStartMonth')}>
          <select value={s.fiscalStartMonth} onChange={(e) => setS((p) => ({ ...p, fiscalStartMonth: Number(e.target.value) }))} className={inputCls}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{t(`proc.months.${m}`)}</option>)}</select>
        </Field>
      </div>
      <Field label={t('proc.settings.terms')}><textarea value={s.terms} onChange={(e) => setS((p) => ({ ...p, terms: e.target.value }))} rows={3} className={inputCls} /></Field>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t('common.save')}</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </section>
  );
}
