import { useState } from 'react';
import { Search, Loader2, FileText, CheckCircle2, Clock } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export default function ParentPortal() {
  const [ticketId, setTicketId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!ticketId) return;

    setLoading(true);
    setError('');
    
    // Simulate API call for now (or use actual firestore call)
    try {
      // Mock data for presentation
      setTimeout(() => {
        if (ticketId === '2024001') {
          setResult({
            id: '2024001',
            status: 'قيد المعالجة',
            category: 'رسوم دراسية',
            date: '15 أكتوبر 2024',
            history: [
              { status: 'تم تسجيل الشكوى', time: '10:30 صباحاً', done: true },
              { status: 'تحت المراجعة من الإدارة', time: '11:15 صباحاً', done: true },
              { status: 'قيد المعالجة من قبل المحاسب', time: '', done: false }
            ]
          });
        } else {
          setError('عفواً، لم يتم العثور على شكوى بهذا الرقم.');
          setResult(null);
        }
        setLoading(false);
      }, 800);
    } catch (err) {
      setError('حدث خطأ في النظام.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Public Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center font-bold">م</div>
            <span className="font-bold text-lg">مدارس المكتشف العالمية</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center p-6 mt-10">
        
        <div className="w-full max-w-xl mb-10 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">بوابة متابعة الشكاوى</h1>
          <p className="text-slate-500">أدخل رقم الشكوى المرسل إليك عبر الواتساب أو الرسالة النصية للاستعلام عن حالتها الحالية.</p>
        </div>

        {/* Search Box */}
        <div className="w-full max-w-xl bg-white p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <form onSubmit={handleSearch}>
            <div className="relative flex items-center">
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                dir="ltr"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Ex: 2024001"
                className="block w-full pr-12 pl-32 py-4 border-2 border-slate-100 rounded-xl bg-slate-50 text-slate-900 focus:bg-white focus:border-primary focus:ring-0 transition-colors outline-none text-lg text-left tracking-widest font-mono"
              />
              <button
                type="submit"
                disabled={loading || !ticketId}
                className="absolute left-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark font-medium transition-colors disabled:opacity-70 flex items-center justify-center w-[110px]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'استعلام'}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 text-center">
              {error}
            </div>
          )}
        </div>

        {/* Result Area */}
        {result && (
          <div className="w-full max-w-xl mt-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between pb-6 border-b border-slate-100 mb-6">
              <div>
                <p className="text-sm text-slate-500 mb-1">شكوى رقم</p>
                <h2 className="text-xl font-bold text-slate-900 font-mono">#CMP-{result.id}</h2>
              </div>
              <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200">
                {result.status}
              </span>
            </div>

            <div className="space-y-6 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-100">
              {result.history.map((step, idx) => (
                <div key={idx} className={`relative flex gap-4 ${step.done ? 'opacity-100' : 'opacity-50'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-white ${step.done ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {step.done ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                  </div>
                  <div className="pt-1">
                    <p className={`font-medium ${step.done ? 'text-slate-900' : 'text-slate-500'}`}>{step.status}</p>
                    {step.time && <p className="text-sm text-slate-400 mt-1">{step.time}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
      
      {/* Footer */}
      <footer className="py-6 text-center text-slate-500 text-sm border-t border-slate-200 mt-auto bg-white">
        © 2024 مدارس المكتشف العالمية. جميع الحقوق محفوظة.
      </footer>
    </div>
  );
}
