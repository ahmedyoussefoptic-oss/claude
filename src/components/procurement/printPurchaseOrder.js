import { printPage, escapeHtml as e } from '../../utils/printPage';
import { money } from '../../config/procurement';

const CSS = `
  table.po { width: 100%; border-collapse: collapse; margin-bottom: 10px }
  table.po th, table.po td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: start; vertical-align: top }
  table.po th { background: #f1f5f9 }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 10px }
  .tot td { font-weight: bold } .num { direction: ltr; text-align: end; unicode-bidi: isolate }
  .terms { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; white-space: pre-wrap; margin-bottom: 10px }
  .sign { display: flex; gap: 12px; margin-top: 26px } .sign div { flex: 1; border-top: 1px solid #334155; padding-top: 4px; text-align: center; font-size: 9pt }
`;
const ltr = (s) => `<span dir="ltr">${e(s)}</span>`;

// The purchase order (أمر شراء) under the school header: supplier, items,
// VAT, total, terms and signatures.
export function printPurchaseOrder({ r, t, i18n, branchName }) {
  const po = r.po;
  const body = `
<div class="meta">
  <div><b>${e(t('proc.poNumber'))}:</b> ${ltr(po.number)}</div>
  <div><b>${e(t('proc.poDate'))}:</b> ${ltr(new Date(po.issuedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }))}</div>
  <div><b>${e(t('proc.supplier'))}:</b> ${e(po.supplierName)}</div>
  <div><b>${e(t('proc.vatNumber'))}:</b> ${ltr(po.supplierVat || '—')}</div>
  <div><b>${e(t('proc.crNumber'))}:</b> ${ltr(po.supplierCr || '—')}</div>
  <div><b>${e(t('proc.deliveryDate'))}:</b> ${ltr(po.deliveryDate || '—')}</div>
  <div><b>${e(t('proc.branch'))}:</b> ${e(branchName(r.branch))}</div>
  <div><b>${e(t('proc.requestNumber'))}:</b> ${ltr(r.number)}</div>
</div>
<table class="po">
  <tr><th>#</th><th>${e(t('proc.item'))}</th><th>${e(t('proc.qty'))}</th><th>${e(t('proc.unit'))}</th><th>${e(t('proc.price'))}</th><th>${e(t('proc.lineTotal'))}</th></tr>
  ${r.items.map((it, i) => `<tr><td>${i + 1}</td><td>${e(it.name)}</td><td class="num">${e(it.qty)}</td><td>${e(it.unit)}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.qty * it.price)}</td></tr>`).join('')}
  <tr class="tot"><td colspan="5">${e(t('proc.subtotal'))}</td><td class="num">${money(po.subtotal)}</td></tr>
  <tr class="tot"><td colspan="5">${e(t('proc.vat', { n: po.vatRate }))}</td><td class="num">${money(po.vat)}</td></tr>
  <tr class="tot"><td colspan="5">${e(t('proc.orderTotal'))} (${e(t('proc.sar'))})</td><td class="num">${money(po.total)}</td></tr>
</table>
<p><b>${e(t('proc.terms'))}</b></p>
<div class="terms">${e(po.terms)}</div>
<div class="sign"><div>${e(t('proc.signProcurement'))}<br>${e(po.issuedByName)}</div><div>${e(t('proc.signFinance'))}</div><div>${e(t('proc.signSupplier'))}</div></div>`;
  printPage({ title: t('proc.purchaseOrder'), subtitle: po.number, school: t('trips.print.school'), body, css: CSS, dir: i18n.dir(), lang: i18n.language });
}
