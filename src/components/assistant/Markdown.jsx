// A small Markdown renderer for the assistant's answers: headings, lists,
// tables, **bold** and `code`. Builds React elements (no HTML injection).
function inline(text, key) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${key}-${i}`} className="px-1 rounded bg-slate-100 text-[0.85em]" dir="ltr">{p.slice(1, -1)}</code>;
    return p;
  });
}
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export default function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const size = ['text-lg', 'text-base', 'text-sm', 'text-sm'][h[1].length - 1];
      out.push(<p key={i} className={`${size} font-bold text-slate-900 mt-3 mb-1`}>{inline(h[2], i)}</p>);
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="w-full text-xs border-collapse">
            <thead><tr>{head.map((c, j) => <th key={j} className="border border-slate-200 bg-slate-50 px-2 py-1 text-start font-semibold">{inline(c, `${i}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border border-slate-200 px-2 py-1">{inline(c, `${i}r${k}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      i--;
      out.push(<ul key={i} className="list-disc ps-5 my-1 space-y-0.5">{items.map((it, k) => <li key={k}>{inline(it, `${i}l${k}`)}</li>)}</ul>);
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) { out.push(<hr key={i} className="my-2 border-slate-200" />); continue; }
    out.push(<p key={i} className="my-1 leading-relaxed">{inline(line, i)}</p>);
  }
  return <div className="text-sm text-slate-800">{out}</div>;
}
