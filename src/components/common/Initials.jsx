// A coloured circle with the first letter of a name (titles such as «أ.»
// «د.» skipped); the colour follows the name, so a person keeps theirs.
const TONES = ['bg-[#1f3c64]', 'bg-violet-500', 'bg-blue-500', 'bg-[#1f3c64]', 'bg-teal-500', 'bg-amber-500', 'bg-[#1f3c64]', 'bg-rose-500'];

export function initialOf(name) {
  const s = String(name || '').trim();
  const word = s.split(/\s+/).find((w) => w.length > 1 && !/[.:]$/.test(w) && !/^(أ|د|م|ا)\.?$/.test(w)) || s;
  return word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^ال(?=\p{L}{2})/u, '').charAt(0) || '؟';
}

export default function Initials({ name, size = 'w-10 h-10 text-base', className = '' }) {
  const s = String(name || '').trim();
  const h = [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  return <span className={`${size} ${TONES[h % TONES.length]} rounded-full text-white font-extrabold flex items-center justify-center shrink-0 uppercase ${className}`}>{initialOf(s)}</span>;
}
