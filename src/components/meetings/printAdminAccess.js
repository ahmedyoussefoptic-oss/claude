import QRCode from 'qrcode';
import { printPage, escapeHtml as e } from '../../utils/printPage';
import { callMeeting, meetingTime } from '../../config/meetings';
import identity from '../../assets/mis-identity.jpg';

// The access of every current meeting in one PDF, for one group:
//   'managers' — the managers' link (+ managers registered by name),
//   'desk'     — the reception's link.
// First how to sign in, then a page per meeting (branch): QR, code and link.
// Returns false when no meeting has access for that group.
export async function printAdminAccess(meetings, { t, i18n, branchName, win, group }) {
  const all = [];
  for (const x of meetings) all.push((await callMeeting('getMeeting', { id: x.id })).meeting);
  const staffOf = (m) => (m.teachers || []).filter((x) => (x.role || 'TEACHER') !== 'TEACHER');
  const full = group === 'managers' ? all.filter((m) => m.managerLink || staffOf(m).length) : all;
  if (!full.length) return false;
  full.sort((a, b) => a.branches.map(branchName).join().localeCompare(b.branches.map(branchName).join(), 'ar') || String(a.date).localeCompare(String(b.date)));
  const qr = (link) => QRCode.toDataURL(link, { width: 420, margin: 1, errorCorrectionLevel: 'M' });
  const k = (key, o) => t(`meetings.adminAccess.${key}`, o);
  const g = (key, o) => t(`meetings.adminAccess.${group}.${key}`, o);
  const time = (m) => `${meetingTime(m.startTime, i18n.language)} – ${meetingTime(m.endTime, i18n.language)}`;

  const card = async (kind, tone, link, pin, note) => `
    <div class="card ${tone}">
      <img src="${await qr(link)}" alt="">
      <div class="cbody">
        <span class="kind">${e(kind)}</span>
        <div class="pin">${e(t('meetings.links.pin'))}<b>${e(pin)}</b></div>
        <div class="link">${e(link)}</div>
        <div class="note">${e(note)}</div>
      </div>
    </div>`;

  const pages = [];
  for (const m of full) {
    const staff = group === 'managers' ? staffOf(m) : [];
    pages.push(`
      <section class="page">
        <div class="mhead">
          <div class="branch">${e(m.branches.map(branchName).join('، '))}</div>
          <div class="mtitle">${e(m.title)}</div>
          <div class="msub">${e([m.date, time(m), m.location].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="cards">
          ${group === 'managers'
    ? (m.managerLink ? await card(k('managersKind'), 'violet', m.managerLink, m.managerPin, t('meetings.links.managersCardNote')) : '')
    : await card(k('deskKind'), 'navy', m.deskLink, m.deskPin, t('meetings.links.deskNote'))}
        </div>
        ${staff.length ? `
          <h3>${e(k('namedStaff'))}</h3>
          <table><thead><tr><th>${e(t('meetings.manager.name'))}</th><th>${e(t('meetings.links.colRole'))}</th><th>${e(t('meetings.links.pin'))}</th><th>${e(t('meetings.links.colLink'))}</th></tr></thead>
          <tbody>${staff.map((s) => `<tr><td><b>${e(s.name)}</b>${s.subject ? `<div class="s">${e(s.subject)}</div>` : ''}</td><td>${e(t(`meetings.roles.${s.role}`))}</td><td class="tpin">${e(s.pin)}</td><td class="tlink">${e(s.link)}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>`);
  }

  const steps = (key) => `<ol>${k(key, { returnObjects: true }).map((s) => `<li>${e(s)}</li>`).join('')}</ol>`;
  const index = `<table class="index"><thead><tr><th>#</th><th>${e(k('colBranch'))}</th><th>${e(k('colMeeting'))}</th><th>${e(k('colDate'))}</th></tr></thead>
    <tbody>${full.map((m, i) => `<tr><td>${i + 1}</td><td><b>${e(m.branches.map(branchName).join('، '))}</b></td><td>${e(m.title)}</td><td>${e(`${m.date} · ${time(m)}`)}</td></tr>`).join('')}</tbody></table>`;

  return printPage({
    title: g('title'),
    subtitle: k('subtitle', { count: full.length }),
    school: t('trips.print.school'),
    dir: i18n.dir(), lang: i18n.language, win,
    css: `
      .identity{width:100%;display:block;margin:0 0 6mm}
      h2{color:#1b345a;font-size:13pt;margin:6mm 0 2mm;padding-inline-start:3mm;border-inline-start:4px solid #1b345a}
      h2.violet{border-color:#7c3aed;color:#5b21b6}
      ol{margin:0;padding-inline-start:7mm;line-height:1.9;font-size:10.5pt} li::marker{font-weight:bold;color:#1b345a}
      .intro{font-size:10.5pt;line-height:1.8;color:#334155;margin:0 0 2mm}
      .warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:3mm;padding:3mm 4mm;margin-top:5mm;font-size:9.5pt;line-height:1.8}
      .warn b{color:#9a3412}
      table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-top:3mm} th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:start;vertical-align:top} th{background:#e2e8f0}
      .index{margin-top:4mm}
      .page{break-before:page;padding-top:2mm}
      .mhead{background:#1b345a;color:#fff;border-radius:4mm;padding:5mm 6mm;margin-bottom:6mm}
      .branch{font-size:20pt;font-weight:bold} .mtitle{font-size:11.5pt;margin-top:1mm;opacity:.95} .msub{font-size:9.5pt;opacity:.8;margin-top:1mm}
      .cards{display:grid;grid-template-columns:1fr;gap:6mm}
      .card{display:flex;gap:6mm;align-items:center;border:2px solid #cbd5e1;border-radius:4mm;padding:5mm;break-inside:avoid}
      .card.violet{border-color:#c4b5fd;background:#faf5ff} .card.navy{border-color:#bfdbfe;background:#f8fafc}
      .card img{width:44mm;height:44mm;flex-shrink:0}
      .cbody{min-width:0;flex:1}
      .kind{display:inline-block;color:#fff;border-radius:3mm;padding:1.2mm 4mm;font-size:11pt;font-weight:bold}
      .violet .kind{background:#7c3aed} .navy .kind{background:#1b345a}
      .pin{margin-top:3mm;font-size:10pt;color:#334155} .pin b{display:block;font-size:26pt;letter-spacing:6px;color:#0f172a;unicode-bidi:isolate;direction:ltr;text-align:start}
      .link{direction:ltr;text-align:left;font-size:8.5pt;color:#475569;word-break:break-all;margin-top:2mm}
      .note{font-size:9pt;color:#64748b;margin-top:2mm}
      .hint{font-size:9pt;color:#64748b;margin-top:4mm}
      h3{font-size:11pt;color:#1b345a;margin:6mm 0 0}
      .tpin{font-size:13pt;font-weight:bold;letter-spacing:2px;direction:ltr;text-align:center} .tlink{direction:ltr;font-size:8pt;word-break:break-all;color:#334155} .s{color:#64748b;font-size:8.5pt}`,
    body: `
      <img class="identity" src="${new URL(identity, window.location.origin).href}" alt="">
      <p class="intro">${e(g('intro'))}</p>
      <h2 class="${group === 'managers' ? 'violet' : ''}">${e(g('stepsTitle'))}</h2>
      ${steps(`${group}.steps`)}
      <div class="warn"><b>${e(k('warnTitle'))}</b>${g('warnings', { returnObjects: true }).map((w) => `<div>• ${e(w)}</div>`).join('')}</div>
      <h2>${e(k('indexTitle'))}</h2>
      ${index}
      ${pages.join('')}`,
  });
}
