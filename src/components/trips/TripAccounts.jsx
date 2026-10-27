import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Loader2, Lock, Unlock, KeyRound, FileDown, Printer, Pencil, Plus, Trash2, X, TrendingUp, Wallet, Coins, Percent, Trophy } from 'lucide-react';
import { functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { printPage, escapeHtml } from '../../utils/printPage';

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const money = (n) => (n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('en', { maximumFractionDigits: 2 }));
const pctText = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const inputCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const COST_SUGGESTIONS = ['transport', 'tickets', 'meals', 'supervisors', 'gifts', 'insurance', 'other'];

// Academic year: September 1 → August 31.
function academicYearRange(now = new Date()) {
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-09-01`, to: `${y + 1}-08-31` };
}

// A trip's figures from its cost items: lump sums ("TRIP") plus per-student
// costs times the students who take part (confirmed); revenue is what was
// actually collected, and "expected" uses every approved student.
export function tripAccountFigures(tr) {
  const fixed = tr.items.filter((x) => x.kind !== 'STUDENT').reduce((a, x) => a + x.amount, 0);
  const perStudent = tr.items.filter((x) => x.kind === 'STUDENT').reduce((a, x) => a + x.amount, 0);
  const participants = tr.confirmed;
  const cost = fixed + perStudent * participants;
  const revenue = tr.collected;
  const profit = revenue - cost;
  const expectedRevenue = tr.approved * tr.fee;
  const expectedProfit = expectedRevenue - (fixed + perStudent * tr.approved);
  return {
    hasCosts: tr.items.length > 0, fixed, perStudent, participants, cost, revenue, profit,
    margin: revenue > 0 ? profit / revenue : null,
    costPerStudent: participants > 0 ? cost / participants : null,
    breakEven: tr.fee > perStudent && fixed > 0 ? Math.ceil(fixed / (tr.fee - perStudent)) : null,
    expectedRevenue, expectedProfit,
  };
}

// «حسابات الرحلات»: base cost, profit and margin of each trip and the most
// profitable trips, behind the trip-accounts password (checked server-side).
export default function TripAccounts({ onOpenTrip }) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockError, setLockError] = useState(null);
  const [range, setRange] = useState(academicYearRange);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const loadStatus = useCallback(() => call('tripAccountsStatus').then(setStatus).catch((err) => setStatusError(err.message)), []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  const unlocked = !!status?.unlockedUntil;

  // An expired session drops back to the password screen.
  const handle = (err) => {
    if (err.code === 'functions/failed-precondition') { setStatus((s) => ({ ...s, unlockedUntil: null })); setRows(null); setLockError(err.message); } else setError(err.message);
  };
  const load = useCallback(() => {
    setRows(null);
    setError(null);
    call('getTripAccounts', range).then((d) => setRows(d.trips)).catch(handle);
  }, [range]);
  useEffect(() => { if (unlocked) load(); }, [unlocked, load]);

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setLockError(null);
    try {
      const fn = status.passwordSet ? 'unlockTripAccounts' : 'setTripAccountsPassword';
      if (!status.passwordSet && password.length < 4) throw new Error(t('trips.accounts.tooShort'));
      const { unlockedUntil } = await call(fn, status.passwordSet ? { password } : { next: password });
      setPassword('');
      setStatus((s) => ({ ...s, passwordSet: true, unlockedUntil }));
    } catch (err) {
      setLockError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const lock = async () => {
    await call('lockTripAccounts').catch(() => {});
    setRows(null);
    setStatus((s) => ({ ...s, unlockedUntil: null }));
  };

  const list = useMemo(() => (rows || []).map((tr) => ({ ...tr, f: tripAccountFigures(tr) })), [rows]);
  const withCosts = list.filter((r) => r.f.hasCosts);
  const totals = useMemo(() => {
    const sum = (k) => withCosts.reduce((a, r) => a + r.f[k], 0);
    const revenue = sum('revenue');
    const profit = sum('profit');
    return { revenue, cost: sum('cost'), profit, margin: revenue > 0 ? profit / revenue : null, expectedProfit: sum('expectedProfit'), allRevenue: list.reduce((a, r) => a + r.f.revenue, 0) };
  }, [withCosts, list]);
  const ranking = [...withCosts].sort((a, b) => b.f.profit - a.f.profit);
  const maxProfit = Math.max(1, ...ranking.map((r) => Math.abs(r.f.profit)));

  if (statusError) return <p className="p-10 text-center text-sm text-red-600">{statusError}</p>;
  if (!status) return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;

  if (!unlocked) {
    const canSet = !status.passwordSet && status.isOwner;
    return (
      <div className="p-6 flex justify-center">
        <form onSubmit={submitPassword} className="w-full max-w-sm bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-3 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Lock className="w-6 h-6" /></div>
          <p className="font-bold text-slate-900">{t('trips.accounts.lockedTitle')}</p>
          {!status.passwordSet && !status.isOwner ? (
            <p className="text-sm text-slate-500">{t('trips.accounts.noPassword')}</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">{canSet ? t('trips.accounts.setHint') : t('trips.accounts.enterHint')}</p>
              <input type="password" autoComplete={canSet ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
                placeholder={canSet ? t('trips.accounts.newPassword') : t('trips.accounts.password')} className={`${inputCls} w-full text-center`} />
              <button disabled={busy || !password} className="w-full px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : canSet ? <KeyRound className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}{canSet ? t('trips.accounts.setPassword') : t('trips.accounts.open')}
              </button>
            </>
          )}
          {lockError && <p className="text-sm text-red-600">{lockError}</p>}
        </form>
      </div>
    );
  }

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.map((r) => ({
      [t('trips.print.code')]: r.tripCode, [t('trips.report.trip')]: r.title, [t('common.date')]: r.date, [t('trips.form.branches')]: r.branches.map(branchName).join('، '),
      [t('trips.search.fee')]: r.fee, [t('trips.accounts.participants')]: r.confirmed, [t('trips.accounts.approved')]: r.approved,
      [t('trips.accounts.revenue')]: r.f.revenue, [t('trips.accounts.fixedCost')]: r.f.fixed, [t('trips.accounts.perStudentCost')]: r.f.perStudent,
      [t('trips.accounts.totalCost')]: r.f.hasCosts ? r.f.cost : '', [t('trips.accounts.costPerStudent')]: r.f.hasCosts && r.f.costPerStudent != null ? Math.round(r.f.costPerStudent * 100) / 100 : '',
      [t('trips.accounts.profit')]: r.f.hasCosts ? r.f.profit : '', [t('trips.accounts.margin')]: r.f.hasCosts ? pctText(r.f.margin) : '',
      [t('trips.accounts.breakEven')]: r.f.breakEven ?? '', [t('trips.accounts.expectedProfit')]: r.f.hasCosts ? r.f.expectedProfit : '',
      [t('trips.accounts.costItems')]: r.items.map((x) => `${x.label}: ${x.amount}${x.kind === 'STUDENT' ? ` (${t('trips.accounts.kind.STUDENT')})` : ''}`).join(' · '),
    }))), 'Trips');
    XLSX.writeFile(wb, `trip-accounts-${range.from}_${range.to}.xlsx`);
  };

  const print = () => {
    const card = (label, value, sub = '') => `<div class="card"><div class="l">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ''}</div>`;
    const head = [t('trips.report.trip'), t('common.date'), t('trips.search.fee'), t('trips.accounts.participants'), t('trips.accounts.revenue'), t('trips.accounts.fixedCost'),
      t('trips.accounts.perStudentCost'), t('trips.accounts.totalCost'), t('trips.accounts.costPerStudent'), t('trips.accounts.profit'), t('trips.accounts.margin'), t('trips.accounts.breakEven')];
    const tr = (r) => `<tr><td><b>${escapeHtml(r.title)}</b><div class="s">${escapeHtml(r.tripCode)}</div></td><td>${escapeHtml(r.date)}</td><td>${money(r.fee)}</td><td>${r.confirmed}</td><td>${money(r.f.revenue)}</td>
      ${r.f.hasCosts ? `<td>${money(r.f.fixed)}</td><td>${money(r.f.perStudent)}</td><td>${money(r.f.cost)}</td><td>${money(r.f.costPerStudent)}</td><td class="${r.f.profit < 0 ? 'neg' : 'pos'}">${money(r.f.profit)}</td><td>${pctText(r.f.margin)}</td><td>${r.f.breakEven ?? '—'}</td>`
    : `<td colspan="7" class="s">${escapeHtml(t('trips.accounts.noCosts'))}</td>`}</tr>`;
    printPage({
      title: t('trips.accounts.reportTitle'),
      subtitle: `${t('trips.print.period', { from: range.from, to: range.to })} · ${t('trips.print.count', { count: list.length })}`,
      school: t('trips.print.school'),
      landscape: true,
      dir: i18n.dir(),
      lang: i18n.language,
      body: `<div class="cards">${card(t('trips.accounts.revenue'), money(totals.revenue), t('trips.accounts.withCostsOnly'))}${card(t('trips.accounts.totalCost'), money(totals.cost))}${card(t('trips.accounts.netProfit'), money(totals.profit))}${card(t('trips.accounts.avgMargin'), pctText(totals.margin))}${card(t('trips.accounts.expectedProfit'), money(totals.expectedProfit))}</div>
<h3>${escapeHtml(t('trips.accounts.ranking'))}</h3><table><thead><tr><th>#</th><th>${escapeHtml(t('trips.report.trip'))}</th><th>${escapeHtml(t('trips.accounts.profit'))}</th><th>${escapeHtml(t('trips.accounts.margin'))}</th></tr></thead><tbody>
${ranking.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.title)}</td><td class="${r.f.profit < 0 ? 'neg' : 'pos'}">${money(r.f.profit)}</td><td>${pctText(r.f.margin)}</td></tr>`).join('') || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
<h3>${escapeHtml(t('trips.accounts.byTrip'))}</h3><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${list.map(tr).join('')}</tbody></table>
<p class="s">${escapeHtml(t('trips.accounts.formula'))}</p>`,
      css: `.cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 10px } .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #f8fafc }
  .card .l { font-size: 8.5pt; color: #64748b } .card .v { font-size: 15pt; font-weight: bold; margin-top: 2px } .s { font-size: 8pt; color: #64748b }
  h3 { color: #0369a1; font-size: 11pt; margin: 12px 0 5px } table { width: 100%; border-collapse: collapse; font-size: 8.5pt } th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: start; vertical-align: top }
  th { background: #f1f5f9 } thead { display: table-header-group } tr { break-inside: avoid } .pos { color: #047857; font-weight: bold } .neg { color: #be123c; font-weight: bold }`,
    });
  };

  const th = 'px-3 py-2 text-start font-medium whitespace-nowrap';
  const td = 'px-3 py-2 whitespace-nowrap';
  const statCard = (label, value, Icon, cls, sub) => (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
      <p className="text-xs text-slate-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" />{label}</p>
      <p className={`text-xl font-bold mt-1 ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="p-4 space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.fromDate')}</label><input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={inputCls} /></div>
        <div><label className="block text-xs text-slate-500 mb-1">{t('common.toDate')}</label><input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={inputCls} /></div>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={!list.length} className="px-3 py-2 rounded-xl text-sm border border-emerald-300 text-emerald-700 bg-white flex items-center gap-1.5 disabled:opacity-50"><FileDown className="w-4 h-4" />{t('trips.exportExcel')}</button>
        <button onClick={print} disabled={!list.length} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" />{t('trips.accounts.printReport')}</button>
        <button onClick={lock} className="px-3 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5"><Lock className="w-4 h-4" />{t('trips.accounts.lock')}</button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : rows && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {statCard(t('trips.accounts.revenue'), money(totals.revenue), Wallet, 'text-slate-800', t('trips.accounts.revenueSub', { count: withCosts.length, total: list.length }))}
            {statCard(t('trips.accounts.totalCost'), money(totals.cost), Coins, 'text-amber-700')}
            {statCard(t('trips.accounts.netProfit'), money(totals.profit), TrendingUp, totals.profit < 0 ? 'text-rose-700' : 'text-emerald-700')}
            {statCard(t('trips.accounts.avgMargin'), pctText(totals.margin), Percent, 'text-sky-700')}
            {statCard(t('trips.accounts.expectedProfit'), money(totals.expectedProfit), TrendingUp, 'text-violet-700', t('trips.accounts.expectedSub'))}
          </div>

          <section>
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Trophy className="w-4 h-4 text-amber-500" />{t('trips.accounts.ranking')}</h3>
            {ranking.length === 0 ? <p className="text-sm text-slate-400 bg-slate-50 rounded-xl p-4 text-center">{t('trips.accounts.rankingEmpty')}</p> : (
              <div className="space-y-1.5">
                {ranking.slice(0, 10).map((r, i) => (
                  <button key={r.id} onClick={() => onOpenTrip(r.id)} className="w-full flex items-center gap-2 text-sm text-start hover:bg-slate-50 rounded-lg px-1">
                    <span className="w-6 text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="w-56 truncate font-medium text-slate-800">{r.title}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${r.f.profit < 0 ? 'bg-rose-400' : 'bg-emerald-500'}`} style={{ width: `${(Math.abs(r.f.profit) / maxProfit) * 100}%` }} /></div>
                    <span className={`w-24 text-end tabular-nums font-bold ${r.f.profit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(r.f.profit)}</span>
                    <span className="w-12 text-end text-xs text-slate-500">{pctText(r.f.margin)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="font-bold text-slate-800 mb-2">{t('trips.accounts.byTrip')}</h3>
            {list.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">{t('trips.empty')}</p> : (
              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className={th}>{t('trips.report.trip')}</th><th className={th}>{t('trips.search.fee')}</th><th className={th}>{t('trips.accounts.participants')}</th>
                      <th className={th}>{t('trips.accounts.revenue')}</th><th className={th}>{t('trips.accounts.totalCost')}</th><th className={th}>{t('trips.accounts.costPerStudent')}</th>
                      <th className={th}>{t('trips.accounts.profit')}</th><th className={th}>{t('trips.accounts.margin')}</th><th className={th}>{t('trips.accounts.breakEven')}</th><th className={th} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>
                          <button onClick={() => onOpenTrip(r.id)} className="font-medium text-slate-900 hover:text-primary text-start">{r.title}</button>
                          <p className="text-xs text-slate-400"><span dir="ltr">{r.date}</span> · <span dir="ltr">{r.tripCode}</span></p>
                        </td>
                        <td className={td}>{r.fee > 0 ? money(r.fee) : t('trips.free')}</td>
                        <td className={td}>{r.confirmed}<span className="text-xs text-slate-400"> / {r.approved}</span></td>
                        <td className={td}>{money(r.f.revenue)}</td>
                        {r.f.hasCosts ? (
                          <>
                            <td className={td}>{money(r.f.cost)}{r.f.perStudent > 0 && <span className="block text-[11px] text-slate-400">{t('trips.accounts.costSplit', { fixed: money(r.f.fixed), per: money(r.f.perStudent) })}</span>}</td>
                            <td className={td}>{money(r.f.costPerStudent)}</td>
                            <td className={`${td} font-bold ${r.f.profit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(r.f.profit)}</td>
                            <td className={td}>{pctText(r.f.margin)}</td>
                            <td className={td}>{r.f.breakEven ?? '—'}</td>
                          </>
                        ) : <td className={`${td} text-xs text-amber-700`} colSpan={5}>{t('trips.accounts.noCosts')}</td>}
                        <td className={td}>
                          <button onClick={() => setEditing(r)} className="px-2.5 py-1 rounded-lg text-xs border border-slate-300 bg-white text-slate-700 flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />{r.f.hasCosts ? t('trips.accounts.editCosts') : t('trips.accounts.addCosts')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1.5">{t('trips.accounts.formula')}</p>
          </section>
        </>
      )}

      {editing && (
        <CostsDialog
          trip={editing}
          onClose={() => setEditing(null)}
          onSaved={({ items, notes }) => { setRows((rs) => rs.map((x) => (x.id === editing.id ? { ...x, items, notes } : x))); setEditing(null); }}
          onError={(err) => { setEditing(null); handle(err); }}
        />
      )}
    </div>
  );
}

function CostsDialog({ trip, onClose, onSaved, onError }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => (trip.items.length ? trip.items.map((x) => ({ ...x, amount: String(x.amount) })) : [{ label: t('trips.accounts.suggest.transport'), kind: 'TRIP', amount: '' }]));
  const [notes, setNotes] = useState(trip.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const clean = items.map((x) => ({ label: x.label.trim(), kind: x.kind, amount: Number(x.amount) || 0 })).filter((x) => x.label && x.amount > 0);
  const f = tripAccountFigures({ ...trip, items: clean });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await call('saveTripCosts', { tripId: trip.id, items: clean, notes }));
    } catch (err) {
      if (err.code === 'functions/failed-precondition') onError(err); else setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div><p className="font-bold text-slate-900">{t('trips.accounts.costsTitle')}</p><p className="text-xs text-slate-500">{trip.title} · <span dir="ltr">{trip.date}</span></p></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <datalist id="trip-cost-labels">{COST_SUGGESTIONS.map((k) => <option key={k} value={t(`trips.accounts.suggest.${k}`)} />)}</datalist>
          {items.map((x, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input list="trip-cost-labels" value={x.label} onChange={(e) => set(i, { label: e.target.value })} placeholder={t('trips.accounts.itemLabel')} className={`${inputCls} flex-1 min-w-[160px]`} />
              <select value={x.kind} onChange={(e) => set(i, { kind: e.target.value })} className={inputCls}>
                <option value="TRIP">{t('trips.accounts.kind.TRIP')}</option>
                <option value="STUDENT">{t('trips.accounts.kind.STUDENT')}</option>
              </select>
              <input type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={x.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder={t('trips.accounts.amount')} className={`${inputCls} w-32`} />
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg" title={t('trips.accounts.removeItem')}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setItems((xs) => [...xs, { label: '', kind: 'TRIP', amount: '' }])} className="px-3 py-1.5 rounded-lg text-sm border border-dashed border-slate-300 text-slate-600 flex items-center gap-1"><Plus className="w-4 h-4" />{t('trips.accounts.addItem')}</button>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t('trips.accounts.notes')} className={`${inputCls} w-full`} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm bg-slate-50 rounded-xl p-3">
            <div><p className="text-xs text-slate-500">{t('trips.accounts.fixedCost')}</p><p className="font-bold">{money(f.fixed)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.perStudentCost')}</p><p className="font-bold">{money(f.perStudent)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.totalCost')} ({t('trips.accounts.forStudents', { count: f.participants })})</p><p className="font-bold">{money(f.cost)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.costPerStudent')}</p><p className="font-bold">{money(f.costPerStudent)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.revenue')}</p><p className="font-bold">{money(f.revenue)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.profit')}</p><p className={`font-bold ${f.profit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(f.profit)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.margin')}</p><p className="font-bold">{pctText(f.margin)}</p></div>
            <div><p className="text-xs text-slate-500">{t('trips.accounts.breakEven')}</p><p className="font-bold">{f.breakEven ?? '—'}</p></div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700">{t('common.cancel')}</button>
          <button disabled={saving} onClick={save} className="px-4 py-2 rounded-xl text-sm bg-primary text-white font-medium flex items-center gap-2 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
