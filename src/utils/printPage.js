import logo from '../assets/logo.png';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Prints a page in its own window, under the school header. With
// `copyStyles` the app's stylesheets come along, so a rendered part of the
// screen (its outerHTML) prints as it looks — always in light mode, inside
// #report-print-area so the app's print rules show it.
export function printPage({ title, subtitle = '', school, body, landscape = false, copyStyles = false, css = '', dir = 'rtl', lang = 'ar' }) {
  const win = window.open('', '_blank');
  if (!win) return false;
  const logoUrl = new URL(logo, window.location.origin).href;
  const styles = copyStyles
    ? [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML.replace(/href="\//, `href="${window.location.origin}/`)).join('\n')
    : '';
  win.document.write(`<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
${styles}
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  html, body { background: #fff !important; color: #0f172a }
  body { margin: 0; font-family: Tahoma, Arial, sans-serif; font-size: 10pt }
  .pp-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0369a1; padding-bottom: 8px; margin-bottom: 12px }
  .pp-head img { height: 52px } .pp-school { font-weight: bold; font-size: 12pt }
  .pp-title { margin: 0; color: #0369a1; font-size: 16pt } .pp-sub { color: #64748b; font-size: 9pt; margin-top: 2px }
  #report-print-area .overflow-x-auto, #report-print-area .max-h-96 { overflow: visible !important; max-height: none !important }
  ${css}
</style></head><body><div id="report-print-area">
<div class="pp-head"><div style="display:flex;align-items:center;gap:10px"><img src="${logoUrl}" alt=""><span class="pp-school">${escapeHtml(school)}</span></div>
<div style="text-align:${dir === 'rtl' ? 'left' : 'right'}"><h1 class="pp-title">${escapeHtml(title)}</h1>${subtitle ? `<div class="pp-sub">${escapeHtml(subtitle)}</div>` : ''}</div></div>
${body}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300)</script></body></html>`);
  win.document.close();
  return true;
}
