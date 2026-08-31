import { X, Send, Paperclip, Clock, CheckCircle2, User, Phone, MapPin } from 'lucide-react';
import { useState } from 'react';

export default function ComplaintDetails({ complaint, onClose }) {
  const [reply, setReply] = useState('');

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-end">
      <div className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-900">شكوى #CMP-{complaint.id}</h2>
              <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-amber-100 text-amber-800 border-amber-200">
                {complaint.status}
              </span>
            </div>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" /> 15 أكتوبر 2024 - 10:30 صباحاً
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Info Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">ولي الأمر</p>
                <p className="font-medium text-slate-900">{complaint.parent}</p>
                <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> 0501234567
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">الفرع و الطالب</p>
                <p className="font-medium text-slate-900">{complaint.branch}</p>
                <p className="text-sm text-slate-500 mt-1">{complaint.student}</p>
              </div>
            </div>
          </div>

          {/* Complaint Text */}
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3 text-lg flex items-center gap-2">
              التفاصيل الأساسية
            </h3>
            <p className="text-slate-600 leading-relaxed text-sm">
              واجهنا مشكلة في تأخر الباص عن الموعد المعتاد لمدة 45 دقيقة يوم الأحد الماضي، مما أدى لتأخر ابني عن الحصة الأولى. نرجو منكم حل المشكلة أو تغيير السائق في أقرب وقت ممكن.
            </p>
          </div>

          {/* Timeline / History */}
          <div>
            <h3 className="font-bold text-slate-900 mb-4 px-1">سجل المتابعة</h3>
            <div className="space-y-4 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-200">
              
              {/* Event 1 */}
              <div className="relative flex gap-4">
                <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shrink-0 z-10 shadow-sm shadow-primary/30 ring-4 ring-slate-50">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                  <div className="flex justify-between mb-2">
                    <p className="font-medium text-slate-900">تم تسجيل الشكوى</p>
                    <p className="text-xs text-slate-400" dir="ltr">15 Oct, 10:30 AM</p>
                  </div>
                  <p className="text-sm text-slate-600">بواسطة: خدمة العملاء (سارة)</p>
                </div>
              </div>

              {/* Event 2 */}
              <div className="relative flex gap-4">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-slate-50">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-1">
                  <div className="flex justify-between mb-2">
                    <p className="font-medium text-slate-900">تم التحويل للمشرف</p>
                    <p className="text-xs text-slate-400" dir="ltr">15 Oct, 11:00 AM</p>
                  </div>
                  <p className="text-sm text-slate-600">رسالة: يرجى المتابعة مع شركة النقل وإفادتنا.</p>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white border-t border-slate-200 p-4">
          <div className="flex items-end gap-3">
            <button className="p-3 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-colors border border-transparent hover:border-primary/20 bg-slate-50">
              <Paperclip className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <textarea 
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="اكتب رداً أو تحديثاً للحالة..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none resize-none h-[52px]"
                rows={1}
              />
            </div>
            <button className="px-6 h-[52px] bg-primary text-white rounded-xl hover:bg-primary-dark font-medium transition-colors shadow-sm flex items-center gap-2">
              إرسال
              <Send className="w-4 h-4 -scale-x-100" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
