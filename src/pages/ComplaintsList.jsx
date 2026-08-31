import { useState } from 'react';
import { Search, Filter, Plus, ChevronLeft, Download } from 'lucide-react';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import ComplaintForm from '../components/complaints/ComplaintForm';

export default function ComplaintsList() {
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const complaints = [
    { id: '2024001', student: 'خالد عبدالله', parent: 'عبدالله محمد', category: 'رسوم دراسية', branch: 'بنين عام', status: 'مفتوحة', date: '2024-10-15' },
    { id: '2024002', student: 'سارة أحمد', parent: 'أحمد علي', category: 'سلوك', branch: 'بنات دولي', status: 'قيد المعالجة', date: '2024-10-14' },
    { id: '2024003', student: 'محمد فهد', parent: 'فهد عبدالعزيز', category: 'أكاديمي', branch: 'بنين دولي', status: 'مغلقة', date: '2024-10-13' },
    { id: '2024004', student: 'نورة سعد', parent: 'سعد سعود', category: 'مواصلات', branch: 'بنات عام', status: 'متأخرة', date: '2024-10-10' },
  ];

  const getStatusBadge = (status) => {
    switch (status) {
      case 'مفتوحة': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'قيد المعالجة': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'متأخرة': return 'bg-red-100 text-red-800 border-red-200';
      case 'مغلقة': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">سجل الشكاوى</h1>
          <p className="text-slate-500 mt-1">إدارة ومتابعة جميع شكاوى أولياء الأمور</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors flex items-center gap-2 shadow-sm">
            <Download className="w-4 h-4" />
            تصدير
          </button>
          <button 
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            شكوى جديدة
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-50/50">
          <div className="relative w-full sm:w-96">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              placeholder="ابحث برقم الشكوى، اسم الطالب..."
              className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm"
            />
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-sm text-slate-600 hover:bg-slate-50 whitespace-nowrap">
              <Filter className="w-4 h-4" />
              تصفية
            </button>
            <span className="w-px h-6 bg-slate-200 mx-1"></span>
            {['الكل', 'مفتوحة', 'متأخرة', 'مغلقة'].map(status => (
              <button key={status} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${status === 'الكل' ? 'bg-primary text-white font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-right">
            <thead className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-medium whitespace-nowrap">رقم الشكوى</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">الطالب / ولي الأمر</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">التصنيف</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">الفرع</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">التاريخ</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">الحالة</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {complaints.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => setSelectedComplaint(c)}>
                  <td className="px-6 py-4 font-medium text-slate-900">#CMP-{c.id}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{c.student}</div>
                    <div className="text-slate-500 text-xs mt-0.5">{c.parent}</div>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{c.category}</td>
                  <td className="px-6 py-4 text-slate-600">{c.branch}</td>
                  <td className="px-6 py-4 text-slate-600" dir="ltr">{c.date}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadge(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-left">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto">
                      <ChevronLeft className="w-5 h-5" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedComplaint && (
        <ComplaintDetails complaint={selectedComplaint} onClose={() => setSelectedComplaint(null)} />
      )}
      
      {showNewForm && (
        <ComplaintForm onClose={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
