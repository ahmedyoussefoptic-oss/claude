// What the parent wrote and the reply that solved it, for the report's
// detailed list. Logins sent with a solution (Student Accounts, ticket
// credentials) never reach a report: passwords are masked.
const flat = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const maskPasswords = (text) => text.replace(/(كلمة المرور|الرمز السري المؤقت|password)(\s*:?\s*)\S+/gi, '$1$2••••');

export function complaintContent(c) {
  const subject = flat(c.subject);
  const details = flat(c.details);
  return { content: [subject, details && details !== subject ? details : ''].filter(Boolean).join(' — '), reply: flat(c.solutionDetails) };
}

export function ticketContent(tk) {
  const links = (tk.resolutionLinks || []).filter((l) => l && l.url).map((l) => (l.label ? `${l.label}: ${l.url}` : l.url));
  return { content: flat(tk.details), reply: maskPasswords([flat(tk.resolutionNote), ...links].filter(Boolean).join(' | ')) };
}
