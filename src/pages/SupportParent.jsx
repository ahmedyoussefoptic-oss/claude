import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, BookOpenCheck, CheckCircle2, XCircle, FileSignature, AlertTriangle, Clock, CalendarDays } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { callSupport } from '../config/support';

const card = 'w-full max-w-xl bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-200';
const inputCls = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const RELATIONS = ['FATHER', 'MOTHER', 'OTHER'];

// «/support/:token» — the parent's page for a nomination: after the
// student's ID, the programme and its days, then the consent (or not); a
// parent who declines signs the pledge here.
export default function SupportParent() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [peek, setPeek] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [nid, setNid] = useState('');
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState('');
  const [parentName, setParentName] = useState('');
  const [relation, setRelation] = useState('FATHER');
  const [reason, setReason] = useState('');
  const [agree, setAgree] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => { callSupport('supportParentPeek', { token }).then(setPeek).catch((err) => setLoadError(err.message)); }, [token]);
  const digits = (v) => String(v || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, '');
  const run = async (name, extra = {}) => {
    setBusy(true);
    setError(null);
    try { setView(await callSupport(name, { token, nationalId: digits(nid), ...extra })); setChanging(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const relText = t(`support.parent.relations.${relation}`);
  const status = view?.status;
  const asking = view && (['APPROVED', 'PENDING_CONSENT'].includes(status) || (changing && ['CONSENTED', 'DECLINED'].includes(status)));
  const pledging = view && ['DECLINED', 'PLEDGE_SENT'].includes(status) && !changing;

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-xl" />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6 gap-4">
        {loadError ? <div className={`${card} text-center`}><AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" /><p className="text-slate-700">{loadError}</p></div>
          : !peek ? <Loader2 className="w-8 h-8 animate-spin text-primary mt-16" />
            : (
              <>
                <div className="text-center mt-2">
                  <BookOpenCheck className="w-10 h-10 text-primary mx-auto mb-2" />
                  <h1 className="text-2xl font-bold text-primary">{t(`support.parent.title.${peek.type}`)}</h1>
                  <p className="text-sm text-slate-500 mt-1">{peek.cycle}</p>
                </div>

                {!view ? (
                  <form onSubmit={(e) => { e.preventDefault(); run('supportParentGet'); }} className={`${card} space-y-3`}>
                    <p className="text-sm text-slate-700">{t('support.parent.idPrompt')}</p>
                    <input value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" dir="ltr" maxLength={20} autoComplete="off" className={`${inputCls} text-center tracking-widest text-lg`} />
                    {error && <p className="text-sm text-rose-700">{error}</p>}
                    <button disabled={busy || digits(nid).length < 6} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.parent.continue')}</button>
                  </form>
                ) : (
                  <>
                    <div className={`${card} space-y-2 text-sm`}>
                      <p className="text-slate-500">{t('support.parent.student')}: <b className="text-slate-900">{view.student}</b></p>
                      <p className="text-slate-700">{t('support.parent.nominated', { program: t(`support.types.${view.type}`) })}{view.subjects.length ? ` ${t('support.parent.inSubjects', { subjects: view.subjects.join('، ') })}` : ''}.</p>
                      <p className="flex items-center gap-1.5 text-slate-700"><Clock className="w-4 h-4 text-primary" />{view.when}</p>
                      <p className="flex items-center gap-1.5 text-slate-700"><CalendarDays className="w-4 h-4 text-primary" />{t('support.parent.period')} <span dir="ltr">{view.from} → {view.to}</span></p>
                      {view.group && <p className="text-slate-700">{t('support.parent.group', { name: view.group.name })}{view.group.room ? ` · ${t('support.parent.room', { room: view.group.room })}` : ''}</p>}
                    </div>

                    {status === 'CONSENTED' && !changing && (
                      <div className={`${card} text-center`}>
                        <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
                        <p className="font-bold text-slate-900">{t('support.parent.consented')}</p>
                        <p className="text-sm text-slate-600 mt-1">{t('support.parent.consentedBody')}</p>
                        <button type="button" onClick={() => { setChanging(true); setAnswer(''); }} className="mt-4 text-xs text-slate-500 underline">{t('support.parent.change')}</button>
                      </div>
                    )}

                    {asking && (
                      <form onSubmit={(e) => { e.preventDefault(); run('supportParentRespond', { answer, parentName, relation: relText, reason }); }} className={`${card} space-y-3`}>
                        <p className="font-bold text-slate-900">{t('support.parent.question')}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setAnswer('YES')} className={`py-3 rounded-xl border-2 font-bold flex items-center justify-center gap-2 ${answer === 'YES' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-200 text-emerald-700'}`}><CheckCircle2 className="w-5 h-5" />{t('support.parent.yes')}</button>
                          <button type="button" onClick={() => setAnswer('NO')} className={`py-3 rounded-xl border-2 font-bold flex items-center justify-center gap-2 ${answer === 'NO' ? 'bg-rose-600 text-white border-rose-600' : 'border-rose-200 text-rose-700'}`}><XCircle className="w-5 h-5" />{t('support.parent.no')}</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder={t('support.parent.name')} className={`${inputCls} col-span-2`} />
                          <select value={relation} onChange={(e) => setRelation(e.target.value)} className={inputCls}>{RELATIONS.map((r) => <option key={r} value={r}>{t(`support.parent.relations.${r}`)}</option>)}</select>
                        </div>
                        {answer === 'NO' && <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('support.parent.reason')} className={inputCls} />}
                        {error && <p className="text-sm text-rose-700">{error}</p>}
                        <button disabled={busy || !answer || parentName.trim().length < 2} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.parent.send')}</button>
                      </form>
                    )}

                    {pledging && (
                      <form onSubmit={(e) => { e.preventDefault(); run('supportParentPledge', { parentName, relation: relText, agree }); }} className={`${card} space-y-3`}>
                        <p className="font-bold text-slate-900 flex items-center gap-2"><FileSignature className="w-5 h-5 text-violet-600" />{t('support.parent.pledgeTitle')}</p>
                        <p className="text-sm text-slate-700 leading-7 bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-line">{view.pledgeText}</p>
                        <div className="grid grid-cols-3 gap-2">
                          <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder={t('support.parent.name')} className={`${inputCls} col-span-2`} />
                          <select value={relation} onChange={(e) => setRelation(e.target.value)} className={inputCls}>{RELATIONS.map((r) => <option key={r} value={r}>{t(`support.parent.relations.${r}`)}</option>)}</select>
                        </div>
                        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />{t('support.parent.agree')}</label>
                        {error && <p className="text-sm text-rose-700">{error}</p>}
                        <button disabled={busy || !agree || parentName.trim().length < 2} className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('support.parent.sign')}</button>
                        <button type="button" onClick={() => { setChanging(true); setAnswer('YES'); }} className="w-full text-xs text-emerald-700 underline">{t('support.parent.changeToYes')}</button>
                      </form>
                    )}

                    {status === 'PLEDGE_SIGNED' && (
                      <div className={`${card} text-center`}>
                        <FileSignature className="w-12 h-12 text-violet-600 mx-auto mb-2" />
                        <p className="font-bold text-slate-900">{t('support.parent.signed')}</p>
                        <p className="text-sm text-slate-600 mt-1">{t('support.parent.signedBody', { name: view.pledge?.name || '' })}</p>
                      </div>
                    )}
                    {['NOMINATED', 'REJECTED', 'WITHDRAWN'].includes(status) && <div className={`${card} text-center text-slate-600`}>{t('support.parent.closed')}</div>}
                  </>
                )}
                <p className="text-center text-xs text-slate-400 pb-6">{peek.school}</p>
              </>
            )}
      </main>
    </div>
  );
}
