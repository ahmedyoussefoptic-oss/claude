import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { KeyRound, Search, Loader2, X, Eye, EyeOff, Copy, Check, Send, MessageCircle, CheckCircle2, AlertTriangle, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { functions } from '../../config/firebase';
import { useBranches } from '../../hooks/useOrgData';
import { waLink } from '../../utils/whatsapp';
import { searchStudents, studentDisplayName } from '../../utils/students';

// Tech support → «حسابات الطلاب»: type a student ID (or name / parent
// mobile) → the student's roster data and both logins (Classera + MIS
// portal), read through getStudentAccounts, and one click to send them to
// the parent's registered mobile (sendStudentAccounts → WhatsApp API).
export default function StudentAccountsTool({ onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const branches = useBranches();
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [show, setShow] = useState({});
  const [copied, setCopied] = useState('');
  const [systems, setSystems] = useState({ classera: true, portal: true });
  const [sent, setSent] = useState(null);
  const [target, setTarget] = useState({ mode: 'registered', phone: '', reason: '' });

  const load = async (id) => {
    setBusy('load'); setError(null); setData(null); setSent(null); setMatches([]); setShow({});
    try {
      const { data: res } = await httpsCallable(functions, 'getStudentAccounts')({ nationalId: id });
      setData(res);
      setSystems({ classera: !!res.classera, portal: !!res.portal });
      setTarget({ mode: res.student?.mobile ? 'registered' : 'other', phone: '', reason: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  const find = async (e) => {
    e?.preventDefault();
    const q = term.trim();
    if (!q) return;
    const digits = q.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, '');
    if (/^[12]\d{9}$/.test(digits)) { load(digits); return; }
    setBusy('search'); setError(null);
    try {
      const list = await searchStudents(q, 8);
      if (list.length === 1) load(list[0].nationalId);
      else { setMatches(list); if (!list.length) setError(t('studentAccounts.notFound')); }
    } finally {
      setBusy('');
    }
  };
  const send = async () => {
    setBusy('send'); setError(null); setSent(null);
    try {
      const alt = target.mode === 'other' ? { altPhone: target.phone, altReason: target.reason } : {};
      const { data: res } = await httpsCallable(functions, 'sendStudentAccounts')({ nationalId: data.student.nationalId, systems: Object.keys(systems).filter((k) => systems[k]), ...alt });
      setSent(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  const copy = async (key, text) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1200); } catch { /* ignore */ } };

  const account = (key, acc, title) => (
    <div className={`border rounded-2xl p-4 ${acc ? 'border-slate-200' : 'border-dashed border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <label className="flex items-center gap-2 font-bold text-slate-900">
          {acc && <input type="checkbox" checked={!!systems[key]} onChange={(e) => setSystems((s) => ({ ...s, [key]: e.target.checked }))} />}
          {title}
        </label>
        {acc && <span className="text-[11px] text-slate-400">{[acc.level || acc.grade, acc.section || acc.className].filter(Boolean).join(' · ')}</span>}
      </div>
      {!acc ? <p className="text-sm text-slate-400">{t('studentAccounts.noAccount')}</p> : (
        <div className="space-y-2 text-sm">
          {[['username', t('studentAccounts.username'), acc.username], ['password', t('studentAccounts.password'), acc.password]].map(([f, label, value]) => (
            <div key={f} className="flex items-center gap-2">
              <span className="w-28 text-slate-500 shrink-0">{label}</span>
              <span className="flex-1 font-mono bg-slate-50 border border-slate-100 rounded-lg px-2 py-1" dir="ltr">
                {!value ? <span className="text-amber-600 font-sans">{t('studentAccounts.empty')}</span> : f === 'password' && !show[key] ? '••••••••' : value}
              </span>
              {f === 'password' && value && <button type="button" onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))} className="p-1.5 text-slate-400 hover:text-primary">{show[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
              {value && <button type="button" onClick={() => copy(`${key}${f}`, value)} className="p-1.5 text-slate-400 hover:text-primary">{copied === `${key}${f}` ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const s = data?.student;
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-0 md:p-6">
      <div className="w-full max-w-3xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full md:h-auto md:max-h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" />{t('studentAccounts.title')}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <form onSubmit={find} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" />
              <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('studentAccounts.placeholder')} className="w-full pr-9 pl-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
            </div>
            <button type="submit" disabled={!!busy || !term.trim()} className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              {busy === 'search' || busy === 'load' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{t('studentAccounts.show')}
            </button>
          </form>
          <p className="text-xs text-slate-500">{t('studentAccounts.hint')}</p>

          {matches.length > 0 && (
            <ul className="border border-slate-200 rounded-xl divide-y divide-slate-100">
              {matches.map((m) => (
                <li key={m.nationalId}><button type="button" onClick={() => load(m.nationalId)} className="w-full text-start px-4 py-2 hover:bg-slate-50 text-sm flex justify-between gap-2">
                  <span><b>{studentDisplayName(m)}</b> <span className="text-xs text-slate-500">{[m.branch ? branchName(m.branch) : m.branchName, m.gradeName, m.className].filter(Boolean).join(' · ')}</span></span>
                  <span className="text-xs text-slate-400" dir="ltr">{m.nationalId}</span>
                </button></li>
              ))}
            </ul>
          )}
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}

          {s && (
            <>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="md:col-span-2"><p className="text-xs text-slate-500">{t('common.student')}</p><p className="font-bold text-slate-900">{s.name}</p>{s.nameEn && s.nameEn !== s.name && <p className="text-xs text-slate-500">{s.nameEn}</p>}</div>
                <div><p className="text-xs text-slate-500">{t('studentAccounts.nationalId')}</p><p className="font-mono" dir="ltr">{s.nationalId}</p></div>
                <div><p className="text-xs text-slate-500">{t('common.branch')}</p><p>{branchName(s.branch) || s.branchName}</p></div>
                <div><p className="text-xs text-slate-500">{t('studentAccounts.gradeClass')}</p><p dir="ltr" className="text-start">{[s.stageName, s.gradeName, s.className].filter(Boolean).join(' · ')}</p></div>
                <div><p className="text-xs text-slate-500">{t('studentAccounts.parentMobile')}</p>{s.mobile ? <a href={`tel:${s.mobile}`} className="flex items-center gap-1 text-primary" dir="ltr"><Phone className="w-3.5 h-3.5" />{s.mobile}</a> : <p className="text-amber-600">{t('studentAccounts.noMobile')}</p>}</div>
              </div>
              {!data.hasAccounts ? <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">{t('studentAccounts.noAccounts')}</p> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {account('classera', data.classera, t('studentAccounts.classera'))}
                  {account('portal', data.portal, t('studentAccounts.portal'))}
                </div>
              )}
              {data.lastSentAt && <p className="text-xs text-slate-500">{t('studentAccounts.lastSent', { when: format(new Date(data.lastSentAt), 'yyyy-MM-dd HH:mm'), name: data.lastSentByName })}</p>}

              {sent ? (
                <div className={`rounded-xl p-4 text-sm space-y-2 ${sent.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                  <p className="font-bold flex items-center gap-1.5">{sent.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{sent.ok ? t('studentAccounts.sentOk', { phone: sent.phone, ticket: sent.ticketId }) : t('studentAccounts.sentFailed', { ticket: sent.ticketId })}</p>
                  {!sent.ok && <p className="text-xs">{sent.error}</p>}
                  <div className="flex flex-wrap gap-2">
                    {!sent.ok && sent.phone && <a href={waLink(sent.phone, sent.message)} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{t('studentAccounts.sendManual')}</a>}
                    <button type="button" onClick={() => { onClose(); navigate(`/tech-support?openId=${sent.ticketDocId}`); }} className="px-3 py-1.5 rounded-lg border border-current text-xs">{t('studentAccounts.openTicket')}</button>
                  </div>
                </div>
              ) : data.hasAccounts && (
                <div className="space-y-3">
                <div className="border border-slate-200 rounded-2xl p-3 space-y-2 text-sm">
                  <p className="text-xs font-bold text-slate-600">{t('studentAccounts.sendTo')}</p>
                  <label className={`flex items-center gap-2 ${s.mobile ? '' : 'opacity-50'}`}>
                    <input type="radio" disabled={!s.mobile} checked={target.mode === 'registered'} onChange={() => setTarget((x) => ({ ...x, mode: 'registered' }))} />
                    {t('studentAccounts.toRegistered')} <span dir="ltr" className="font-mono text-slate-600">{s.mobile || '—'}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={target.mode === 'other'} onChange={() => setTarget((x) => ({ ...x, mode: 'other' }))} />
                    {t('studentAccounts.toOther')}
                  </label>
                  {target.mode === 'other' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-6">
                      <input value={target.phone} onChange={(e) => setTarget((x) => ({ ...x, phone: e.target.value }))} placeholder="05xxxxxxxx" dir="ltr" className="px-3 py-2 border border-slate-200 rounded-xl text-sm" />
                      <input value={target.reason} onChange={(e) => setTarget((x) => ({ ...x, reason: e.target.value }))} placeholder={t('studentAccounts.otherReason')} className="px-3 py-2 border border-slate-200 rounded-xl text-sm" />
                      <p className="sm:col-span-2 text-[11px] text-amber-700">{t('studentAccounts.otherWarning')}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">{t('studentAccounts.sendHint')}</p>
                  <button type="button" disabled={!!busy || !(systems.classera || systems.portal) || (target.mode === 'registered' ? !s.mobile : (!/^0?5\d{8}$/.test(target.phone.replace(/\D/g, '').replace(/^966/, '')) || target.reason.trim().length < 2))} onClick={send} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                    {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{t('studentAccounts.send')}
                  </button>
                </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
