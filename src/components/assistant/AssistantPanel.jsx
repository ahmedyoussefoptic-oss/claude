import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Sparkles, X, Send, Loader2, Plus, Copy, Check, Printer } from 'lucide-react';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import Markdown from './Markdown';

const chatKey = (uid) => `assistantChat:${uid}`;
const readChatId = (uid) => { try { return localStorage.getItem(chatKey(uid)); } catch { return null; } };
const writeChatId = (uid, id) => { try { if (id) localStorage.setItem(chatKey(uid), id); else localStorage.removeItem(chatKey(uid)); } catch { /* storage unavailable */ } };

function printAnswer(node, title) {
  const win = window.open('', '_blank');
  if (!win || !node) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:16mm;color:#0f172a;font-size:11pt}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:right}th{background:#f1f5f9}</style>
</head><body>${node.innerHTML}<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

// «المساعد الذكي»: a floating chat on every staff page (assistantChat).
export default function AssistantPanel() {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState(null);
  const [items, setItems] = useState([]); // { role, text }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const endRef = useRef(null);
  const answerRefs = useRef({});

  useEffect(() => onSnapshot(doc(db, 'settings', 'assistant'), (snap) => setCfg(snap.data() || {}), () => setCfg({})), []);

  // Reopen the last conversation.
  useEffect(() => {
    if (!open || !user || chatId !== null) return;
    const id = readChatId(user.uid);
    if (!id) { setChatId(''); return; }
    getDoc(doc(db, 'assistantChats', id))
      .then((snap) => {
        if (snap.exists() && !snap.data().full) { setChatId(id); setItems((snap.data().transcript || []).map(({ role, text }) => ({ role, text }))); } else setChatId('');
      })
      .catch(() => setChatId(''));
  }, [open, user, chatId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items, busy]);

  const allowed = user && userData && cfg?.enabled === true && userData.role !== 'RECEPTIONIST' && userData.modules?.assistant !== false && userData.active !== false;
  if (!allowed) return null;

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setError(null);
    setItems((list) => [...list, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const { data } = await httpsCallable(functions, 'assistantChat', { timeout: 300000 })({ chatId: chatId || null, message });
      setItems((list) => [...list, { role: 'assistant', text: data.reply }]);
      if (data.full) { setChatId(''); writeChatId(user.uid, null); } else { setChatId(data.chatId); writeChatId(user.uid, data.chatId); }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const newChat = () => { setItems([]); setChatId(''); writeChatId(user.uid, null); setError(null); };
  const copy = async (i, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ }
  };
  const suggestions = [t('assistant.s1'), t('assistant.s2'), t('assistant.s3'), t('assistant.s4')];

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-5 left-5 z-[90] w-14 h-14 rounded-full bg-gradient-to-br from-primary to-indigo-600 text-white shadow-xl flex items-center justify-center hover:scale-105 transition" title={t('assistant.title')}>
          <Sparkles className="w-6 h-6" />
        </button>
      )}
      {open && (
        <div className="fixed z-[95] bottom-0 left-0 md:bottom-5 md:left-5 w-full md:w-[440px] h-[85vh] md:h-[640px] bg-white md:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 py-3 bg-gradient-to-l from-primary to-indigo-600 text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight">{t('assistant.title')}</p>
              <p className="text-[11px] text-white/80">{t('assistant.subtitle')}</p>
            </div>
            <button onClick={newChat} className="p-1.5 rounded-lg hover:bg-white/15" title={t('assistant.newChat')}><Plus className="w-4 h-4" /></button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/15"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {items.length === 0 && !busy && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{t('assistant.hello', { name: userData.name || '' })}</p>
                <div className="flex flex-col gap-2">
                  {suggestions.map((s) => <button key={s} onClick={() => send(s)} className="text-start text-sm px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-primary/50 text-slate-700">{s}</button>)}
                </div>
                <p className="text-[11px] text-slate-400">{t('assistant.scopeNote')}</p>
              </div>
            )}
            {items.map((m, i) => (m.role === 'user' ? (
              <div key={i} className="flex justify-start"><div className="max-w-[85%] bg-primary text-white text-sm rounded-2xl rounded-ss-sm px-3 py-2 whitespace-pre-wrap">{m.text}</div></div>
            ) : (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl rounded-se-sm px-3 py-2">
                <div ref={(el) => { answerRefs.current[i] = el; }}><Markdown text={m.text} /></div>
                <div className="flex gap-1 mt-1 justify-end">
                  <button onClick={() => copy(i, m.text)} className="p-1 rounded-md text-slate-400 hover:text-slate-700" title={t('assistant.copy')}>{copied === i ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}</button>
                  <button onClick={() => printAnswer(answerRefs.current[i], t('assistant.title'))} className="p-1 rounded-md text-slate-400 hover:text-slate-700" title={t('assistant.print')}><Printer className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )))}
            {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />{t('assistant.thinking')}</div>}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="shrink-0 p-3 border-t border-slate-200 flex gap-2 bg-white">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t('assistant.placeholder')}
              className="flex-1 resize-none px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 max-h-32"
            />
            <button disabled={busy || !input.trim()} className="px-3 rounded-xl bg-primary text-white disabled:opacity-50"><Send className="w-4 h-4 rtl:-scale-x-100" /></button>
          </form>
        </div>
      )}
    </>
  );
}
