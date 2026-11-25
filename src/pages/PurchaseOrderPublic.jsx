import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Loader2, Printer, FileText } from 'lucide-react';
import PublicHeader from '../components/common/PublicHeader';
import { money, callProcPublic } from '../config/procurement';
import { printPurchaseOrder } from '../components/procurement/printPurchaseOrder';

const card = 'w-full max-w-3xl bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200';

// «/po/:token» — a purchase order as the supplier sees it (read-only), with
// the printed copy. The link is sent to the supplier on WhatsApp.
export default function PurchaseOrderPublic() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { callProcPublic({ token }).then(setData).catch((err) => setError(err.message)); }, [token]);
  const po = data?.po;
  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <PublicHeader width="max-w-3xl" title={t('proc.purchaseOrder')} />
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 md:p-6">
        {!data ? <div className={`${card} text-center`}>{error ? <p className="text-sm text-rose-700">{error}</p> : <Loader2 className="w-7 h-7 animate-spin text-primary mx-auto" />}</div> : (
          <div className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />{t('proc.purchaseOrder')} <span dir="ltr">{po.number}</span></p>
                <p className="text-sm text-slate-600">{po.supplierName} · {data.branchName}{po.deliveryDate ? <> · {t('proc.deliveryDate')} <span dir="ltr">{po.deliveryDate}</span></> : null}</p>
              </div>
              <button type="button" onClick={() => printPurchaseOrder({ r: { number: data.number, branch: data.branch, items: data.items, po: { ...po, issuedByName: po.issuedByName || '' } }, t, i18n, branchName: () => data.branchName })} className="px-4 py-2 rounded-xl text-sm border border-slate-300 bg-white text-slate-700 flex items-center gap-1.5"><Printer className="w-4 h-4" />{t('proc.printOrder')}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
                <thead><tr className="text-xs text-slate-500 border-b border-slate-100"><th className="py-1.5 text-start font-medium">{t('proc.item')}</th><th className="text-start font-medium">{t('proc.qty')}</th><th className="text-start font-medium">{t('proc.price')}</th><th className="text-start font-medium">{t('proc.lineTotal')}</th></tr></thead>
                <tbody>{data.items.map((it, i) => <tr key={i} className="border-b border-slate-50"><td className="py-1.5">{it.name}</td><td className="tabular-nums">{it.qty} {it.unit}</td><td className="tabular-nums" dir="ltr">{money(it.price)}</td><td className="tabular-nums" dir="ltr">{money(it.qty * it.price)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1 max-w-sm ms-auto">
              <p className="flex justify-between"><span>{t('proc.subtotal')}</span><span dir="ltr">{money(po.subtotal)}</span></p>
              <p className="flex justify-between"><span>{t('proc.vat', { n: po.vatRate })}</span><span dir="ltr">{money(po.vat)}</span></p>
              <p className="flex justify-between font-bold"><span>{t('proc.orderTotal')}</span><span dir="ltr">{money(po.total)} {t('proc.sar')}</span></p>
            </div>
            {po.terms && <div><p className="text-sm font-bold text-slate-800">{t('proc.terms')}</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{po.terms}</p></div>}
          </div>
        )}
      </main>
    </div>
  );
}
