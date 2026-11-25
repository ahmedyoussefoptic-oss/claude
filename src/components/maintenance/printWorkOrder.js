import { printPage, escapeHtml as e } from '../../utils/printPage';
import { fmtDateTime } from '../../config/maintenance';

const CSS = `
  table.wo { width: 100%; border-collapse: collapse; margin-bottom: 10px }
  table.wo th, table.wo td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: start; vertical-align: top }
  table.wo th { background: #f1f5f9; width: 22%; font-weight: bold }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; min-height: 70px; margin-bottom: 10px; white-space: pre-wrap }
  .lbl { font-weight: bold; margin: 8px 0 4px }
  .photos img { height: 110px; margin-inline-end: 6px; border: 1px solid #e2e8f0; border-radius: 4px }
  .sign { display: flex; gap: 12px; margin-top: 18px } .sign div { flex: 1; border-top: 1px solid #334155; padding-top: 4px; text-align: center; font-size: 9pt }
`;
// The ltr isolate for dates inside Arabic text.
const ltr = (s) => `<span dir="ltr">${e(s)}</span>`;

// The printed work order (أمر عمل) under the school header.
export function printWorkOrder({ tk, t, i18n, branchName }) {
  const row = (k, v) => `<tr><th>${e(k)}</th><td>${v}</td></tr>`;
  const body = `
<table class="wo">
  ${row(t('mnt.number'), ltr(tk.number))}
  ${row(t('mnt.branch'), e(branchName(tk.branch)))}
  ${row(t('mnt.place'), e(tk.place || '—'))}
  ${row(t('mnt.category'), e(t(`mnt.categories.${tk.category}`)))}
  ${row(t('mnt.priority'), e(t(`mnt.priorities.${tk.priority}`)))}
  ${row(t('mnt.statusLabel'), e(t(`mnt.status.${tk.status}`)))}
  ${row(t('mnt.reporter'), e(tk.reporterName || '—'))}
  ${row(t('mnt.createdAt'), ltr(fmtDateTime(tk.createdAt)))}
  ${row(t('mnt.dueAt'), ltr(fmtDateTime(tk.dueAt)))}
  ${row(t('mnt.assignee'), e(tk.techName || '—'))}
</table>
<p class="lbl">${e(t('mnt.titleField'))}: ${e(tk.title)}</p>
<div class="box">${e(tk.description || '')}</div>
${tk.photos.length ? `<div class="photos">${tk.photos.map((p) => `<img src="${e(p.fileUrl)}" alt="">`).join('')}</div>` : ''}
<p class="lbl">${e(t('mnt.workDone'))}</p>
<div class="box">${e(tk.workNote || '')}</div>
<p class="lbl">${e(t('mnt.parts'))}</p>
<div class="box" style="min-height:40px">${e(tk.parts || '')}</div>
<p class="lbl">${e(t('mnt.doneAt'))}: ${tk.doneAt ? ltr(fmtDateTime(tk.doneAt)) : '………………'}</p>
<div class="sign"><div>${e(t('mnt.signTech'))}</div><div>${e(t('mnt.signSupervisor'))}</div><div>${e(t('mnt.signReporter'))}</div></div>`;
  printPage({ title: t('mnt.workOrder'), subtitle: tk.number, school: t('trips.print.school'), body, css: CSS, dir: i18n.dir(), lang: i18n.language });
}
