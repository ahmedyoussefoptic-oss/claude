import logo from '../assets/logo.png';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ms) => (ms ? new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) : '');

// Prints the payment invoice of a trip (data from issueTripInvoice).
export function printTripInvoice(inv, t) {
  const win = window.open('', '_blank');
  if (!win) return;
  const logoUrl = new URL(logo, window.location.origin).href;
  const row = (label, value) => (value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '');
  const method = t(`trips.collectMethod.${inv.payment.method}`, { defaultValue: inv.payment.method });
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>
<style>
  @page { size: A4; margin: 14mm } * { box-sizing: border-box } body { margin: 0; font-family: Tahoma, Arial, sans-serif; color: #0f172a; font-size: 11pt }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0369a1; padding-bottom: 10px }
  header img { height: 64px } h1 { margin: 0; color: #0369a1; font-size: 20pt } .no { font-size: 11pt; color: #334155; margin-top: 4px }
  .school { font-weight: bold; font-size: 13pt } .muted { color: #64748b; font-size: 9.5pt }
  h2 { font-size: 12pt; color: #0369a1; margin: 18px 0 6px } table { width: 100%; border-collapse: collapse }
  th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: right } th { width: 32%; background: #f8fafc; font-weight: 600 }
  .total { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px 16px; font-size: 14pt; font-weight: bold; color: #065f46 }
  .paid { display: inline-block; border: 2px solid #059669; color: #059669; border-radius: 6px; padding: 2px 12px; font-weight: bold; transform: rotate(-4deg) }
  footer { margin-top: 28px; display: flex; justify-content: space-between; font-size: 10pt; color: #475569 }
</style></head><body>
<header><div><img src="${logoUrl}" alt=""><div class="school">${esc(inv.schoolName)}</div></div>
<div style="text-align:left"><h1>${esc(t('trips.invoice.title'))}</h1><div class="no">${esc(t('trips.invoice.number'))}: <b dir="ltr">${esc(inv.invoiceNo)}</b></div><div class="muted">${esc(t('trips.invoice.issued'))}: ${esc(fmt(inv.issuedAt))}</div></div></header>
<h2>${esc(t('trips.invoice.student'))}</h2><table>
${row(t('trips.col.student'), inv.student.name)}${row(t('trips.col.nationalId'), inv.student.id)}${row(t('trips.col.branch'), inv.student.branch)}${row(t('trips.col.grade'), `${inv.student.grade} ${inv.student.className}`.trim())}${row(t('trips.invoice.parentPhone'), inv.student.parentPhone)}
</table>
<h2>${esc(t('trips.invoice.trip'))}</h2><table>
${row(t('trips.invoice.tripName'), inv.trip.title)}${row(t('trips.invoice.tripCode'), inv.trip.code)}${row(t('trips.invoice.destination'), inv.trip.destination)}${row(t('trips.invoice.date'), inv.trip.dateLabel)}${row(t('trips.invoice.time'), inv.trip.departTime ? `${inv.trip.departTime} – ${inv.trip.returnTime}` : '')}${row(t('trips.invoice.fee'), t('trips.feeValue', { fee: inv.trip.fee }))}
</table>
<h2>${esc(t('trips.invoice.payment'))}</h2><table>
${row(t('trips.collect.method'), method)}${row(t('trips.collectorLabel'), inv.payment.collector)}${row(t('trips.confirmerLabel'), inv.payment.confirmedBy)}${row(t('trips.invoice.confirmedAt'), fmt(inv.payment.confirmedAt))}${row(t('trips.collect.ref'), inv.payment.ref)}
</table>
<div class="total"><span>${esc(t('trips.invoice.amount'))}: ${esc(t('trips.feeValue', { fee: inv.payment.amount }))}</span><span class="paid">${esc(t('trips.invoice.paid'))}</span></div>
<footer><span>${esc(t('trips.invoice.footer'))}</span><span>${esc(t('trips.invoice.signature'))}: ....................</span></footer>
<script>window.onload = () => window.print()</script></body></html>`);
  win.document.close();
}
