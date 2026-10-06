import { useMemo, useState } from 'react';
import { complaintTypesOf, complaintTypesLabel } from '../config/complaintTypes';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, FileText, Wrench, PackageSearch, Repeat, FileSpreadsheet, ChevronLeft, User, Phone, GraduationCap } from 'lucide-react';
import useAuthStore from '../stores/useAuthStore';
import { useBranches, useComplaintTypes, useProblemTypes } from '../hooks/useOrgData';
import { useBranchScopedCollection } from '../hooks/useBranchScopedCollection';
import { TICKET_STATUS_BADGE } from '../config/techSupport';
import { ITEM_STATUS_BADGE } from '../config/lostFound';
import { studentKey } from '../utils/studentKey';
import StudentTrips from '../components/trips/StudentTrips';
import { canAccessTechSupport, canSeeTrips } from '../utils/scope';
import ComplaintDetails from '../components/complaints/ComplaintDetails';
import TechSupportDetails from '../components/techSupport/TechSupportDetails';
import LostFoundDetails from '../components/lostFound/LostFoundDetails';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

const COMPLAINT_STATUS_BADGE = {
  RECEIVED: 'bg-blue-100 text-blue-800 border-blue-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-200',
  WAITING_PARENT_RESPONSE: 'bg-purple-100 text-purple-800 border-purple-200',
  SOLVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-800 border-slate-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
  ESCALATED: 'bg-orange-100 text-orange-800 border-orange-200',
};

const KIND_META = {
  complaint: { icon: FileText, chip: 'bg-sky-100 text-sky-700', statusNs: 'complaint', badge: COMPLAINT_STATUS_BADGE },
  tech: { icon: Wrench, chip: 'bg-violet-100 text-violet-700', statusNs: 'techSupport', badge: TICKET_STATUS_BADGE },
  lostFound: { icon: PackageSearch, chip: 'bg-teal-100 text-teal-700', statusNs: 'lostFound', badge: ITEM_STATUS_BADGE },
};

// The school year runs August → July, so a record from Sep 2026 and one
// from Mar 2027 belong to the same "2026/2027" year.
function academicYearOf(date) {
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

// A year-long reference per student: every complaint, tech-support ticket
// and lost & found report tied to the same student, so repeated issues are
// visible in one place instead of as unrelated records.
export default function StudentRecords() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const { userData } = useAuthStore();
  const branches = useBranches();
  const complaintTypes = useComplaintTypes();
  const problemTypes = useProblemTypes();
  const [searchParams, setSearchParams] = useSearchParams();

  const canSeeTech = canAccessTechSupport(userData);
  const { docs: complaints, loading } = useBranchScopedCollection('complaints', userData);
  const { docs: tickets } = useBranchScopedCollection('techSupportTickets', userData, canSeeTech);
  const { docs: lostItems } = useBranchScopedCollection('lostFoundItems', userData);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(() => academicYearOf(new Date()));
  const [repeatedOnly, setRepeatedOnly] = useState(false);
  const [openRecord, setOpenRecord] = useState(null); // { kind, id }

  const selectedKey = searchParams.get('student');
  const selectStudent = (key) => setSearchParams(key ? { student: key } : {}, { replace: true });

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';

  const records = useMemo(() => {
    const typeName = (id) => complaintTypes.find((ct) => ct.id === id)?.name || id;
    const problemName = (id) => problemTypes.find((p) => p.id === id)?.name || id;
    const base = (kind, d, studentId, extra) => ({
      kind, id: d.id, date: d.createdAt?.toDate?.() || null, status: d.status, branch: d.branch,
      studentId: (studentId || '').trim(), studentName: (d.studentName || '').trim(), stage: d.stage || '', grade: d.grade || '',
      assignedToNames: d.assignedToNames || [], ...extra,
    });
    return [
      ...complaints.map((c) => base('complaint', c, c.studentId, {
        number: c.complaintId, category: complaintTypesOf(c).map(typeName).join(' + '), title: complaintTypesLabel(c, typeName),
        subject: c.subject || '', parentName: c.parentName, parentPhone: c.parentPhone,
      })),
      ...tickets.map((tk) => base('tech', tk, tk.nationalId, {
        number: tk.ticketId, category: problemName(tk.problemType), title: problemName(tk.problemType), subject: tk.platform || '',
        parentName: tk.parentName, parentPhone: tk.parentPhone,
      })),
      // A found item with no owner yet isn't about any student.
      ...lostItems.filter((i) => i.studentId || i.studentName).map((i) => base('lostFound', i, i.studentId, {
        number: i.itemCode, category: t('studentRecords.kinds.lostFound'), title: i.itemName || '', subject: '',
        parentName: i.reporterName, parentPhone: i.reporterPhone,
      })),
    ].filter((r) => r.date);
  }, [complaints, tickets, lostItems, complaintTypes, problemTypes, t]);

  const years = useMemo(() => [...new Set([academicYearOf(new Date()), ...records.map((r) => academicYearOf(r.date))])].sort().reverse(), [records]);

  const students = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      if (yearFilter && academicYearOf(r.date) !== yearFilter) continue;
      const key = studentKey(r.studentId, r.studentName);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, records: [], counts: { complaint: 0, tech: 0, lostFound: 0 } });
      const s = map.get(key);
      s.records.push(r);
      s.counts[r.kind]++;
    }
    return [...map.values()].map((s) => {
      s.records.sort((a, b) => b.date - a.date);
      // Latest record wins for the descriptive fields — it has the student's current grade/branch/contact.
      const pick = (field) => s.records.find((r) => r[field])?.[field] || '';
      const categories = {};
      s.records.forEach((r) => { categories[r.category] = (categories[r.category] || 0) + 1; });
      const [topCategory, topCount] = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
      return {
        ...s, total: s.records.length, last: s.records[0].date,
        name: pick('studentName'), studentId: pick('studentId'), branch: pick('branch'), stage: pick('stage'), grade: pick('grade'),
        parentName: pick('parentName'), parentPhone: pick('parentPhone'),
        topCategory: topCount > 1 ? { name: topCategory, count: topCount } : null,
      };
    }).sort((a, b) => b.total - a.total || b.last - a.last);
  }, [records, yearFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((s) => {
      if (repeatedOnly && s.total < 2) return false;
      if (branchFilter && !s.records.some((r) => r.branch === branchFilter)) return false;
      if (term && !`${s.name} ${s.studentId} ${s.parentName} ${s.parentPhone}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [students, search, branchFilter, repeatedOnly]);

  const selected = selectedKey ? students.find((s) => s.key === selectedKey) : null;
  const repeatedCount = students.filter((s) => s.total >= 2).length;
  const totalRecords = students.reduce((sum, s) => sum + s.total, 0);

  const gradeLabel = (s) => [s.stage, s.grade].filter(Boolean).join(' — ') || '—';
  const fmtDate = (d, pattern = 'PP') => format(d, pattern, { locale: dateLocale });

  const handleExport = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map((s) => ({
      [t('studentRecords.student')]: s.name,
      [t('studentRecords.nationalId')]: s.studentId,
      [t('common.branch')]: branchName(s.branch),
      [t('complaintForm.gradeLabel')]: gradeLabel(s),
      [t('common.parent')]: s.parentName,
      [t('common.phone')]: s.parentPhone,
      [t('studentRecords.kinds.complaint')]: s.counts.complaint,
      [t('studentRecords.kinds.tech')]: s.counts.tech,
      [t('studentRecords.kinds.lostFound')]: s.counts.lostFound,
      [t('studentRecords.total')]: s.total,
      [t('studentRecords.lastRecord')]: fmtDate(s.last, 'yyyy-MM-dd'),
    }))), t('studentRecords.sheetStudents'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.flatMap((s) => s.records.map((r) => ({
      [t('studentRecords.student')]: s.name,
      [t('studentRecords.nationalId')]: s.studentId,
      [t('studentRecords.kind')]: t(`studentRecords.kinds.${r.kind}`),
      [t('studentRecords.number')]: r.number,
      [t('common.date')]: fmtDate(r.date, 'yyyy-MM-dd HH:mm'),
      [t('studentRecords.topic')]: [r.title, r.subject].filter(Boolean).join(' — '),
      [t('common.status')]: t(`statuses.${KIND_META[r.kind].statusNs}.${r.status}`, r.status),
      [t('common.branch')]: branchName(r.branch),
    })))), t('studentRecords.sheetRecords'));
    XLSX.writeFile(wb, `student-records-${(yearFilter || 'all').replace('/', '-')}.xlsx`);
  };

  // The open record is looked up live so actions taken inside its drawer show immediately.
  const openDoc = openRecord && { complaint: complaints, tech: tickets, lostFound: lostItems }[openRecord.kind].find((d) => d.id === openRecord.id);

  const selectCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white';

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('studentRecords.title')}</h1>
          <p className="text-slate-500 mt-1">{t('studentRecords.subtitle')}</p>
        </div>
        <button onClick={handleExport} disabled={filtered.length === 0} className="px-4 py-2.5 bg-white border border-emerald-300 text-emerald-700 rounded-xl hover:bg-emerald-50 font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
          <FileSpreadsheet className="w-4 h-4" />
          {t('studentRecords.exportExcel')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[[t('studentRecords.studentsCount'), students.length, 'bg-sky-50 text-sky-600', GraduationCap],
          [t('studentRecords.repeatedCount'), repeatedCount, 'bg-amber-50 text-amber-600', Repeat],
          [t('studentRecords.recordsCount'), totalRecords, 'bg-emerald-50 text-emerald-600', FileText]].map(([label, value, cls, Icon]) => (
          <div key={label} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-start justify-between">
            <div><p className="text-sm text-slate-500 mb-1">{label}</p><p className="text-3xl font-bold text-slate-900">{value}</p></div>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${cls}`}><Icon className="w-5 h-5" /></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row gap-3 lg:items-center justify-between bg-slate-50/50">
          <div className="relative w-full lg:w-96">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400"><Search className="w-5 h-5" /></div>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('studentRecords.searchPlaceholder')} className="block w-full pr-10 pl-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectCls} dir="ltr">
              <option value="">{t('studentRecords.allYears')}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={selectCls}>
              <option value="">{t('common.allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" onClick={() => setRepeatedOnly((v) => !v)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors border ${repeatedOnly ? 'bg-primary text-white border-primary font-medium' : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-100'}`}>
              <Repeat className="w-3.5 h-3.5" />
              {t('studentRecords.repeatedOnly')}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="h-full flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                <tr>
                  {[t('studentRecords.student'), t('common.branch'), t('complaintForm.gradeLabel'), t('studentRecords.kinds.complaint'), ...(canSeeTech ? [t('studentRecords.kinds.tech')] : []), t('studentRecords.kinds.lostFound'), t('studentRecords.total'), t('studentRecords.lastRecord'), ''].map((h, i) => (
                    <th key={i} className="px-5 py-4 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((s) => (
                  <tr key={s.key} className="hover:bg-slate-50/80 transition-colors cursor-pointer group" onClick={() => selectStudent(s.key)}>
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-900 flex items-center gap-2">
                        {s.name || '—'}
                        {s.total >= 2 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700"><Repeat className="w-3 h-3" />{t('studentRecords.repeated')}</span>}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5" dir="ltr">{s.studentId || '—'}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{branchName(s.branch)}</td>
                    <td className="px-5 py-4 text-slate-600">{gradeLabel(s)}</td>
                    <td className="px-5 py-4 text-slate-700 font-medium">{s.counts.complaint || '—'}</td>
                    {canSeeTech && <td className="px-5 py-4 text-slate-700 font-medium">{s.counts.tech || '—'}</td>}
                    <td className="px-5 py-4 text-slate-700 font-medium">{s.counts.lostFound || '—'}</td>
                    <td className="px-5 py-4"><span className={`inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-lg text-sm font-bold ${s.total >= 3 ? 'bg-red-100 text-red-700' : s.total === 2 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{s.total}</span></td>
                    <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{fmtDate(s.last)}</td>
                    <td className="px-5 py-4 text-left"><div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-primary group-hover:bg-primary/10 transition-colors mr-auto"><ChevronLeft className="w-5 h-5" /></div></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="9" className="px-6 py-12 text-center text-slate-500">{t('studentRecords.noResults')}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4 md:p-6">
          <div className="w-full max-w-4xl bg-slate-50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
              <div>
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  {selected.name || '—'}
                  {selected.total >= 2 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"><Repeat className="w-3 h-3" />{t('studentRecords.repeated')}</span>}
                </h2>
                <p className="text-sm text-slate-500 mt-1">{t('studentRecords.nationalId')}: <span dir="ltr">{selected.studentId || '—'}</span> · {branchName(selected.branch)} · {gradeLabel(selected)}</p>
              </div>
              <button onClick={() => selectStudent(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-6 h-6" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm col-span-2 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><User className="w-5 h-5" /></div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">{t('common.parent')}</p>
                    <p className="font-medium text-slate-900">{selected.parentName || '—'}</p>
                    {selected.parentPhone && <p className="text-sm text-slate-500 mt-1 flex items-center gap-1" dir="ltr"><Phone className="w-3.5 h-3.5" /> {selected.parentPhone}</p>}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                  <p className="text-xs text-slate-500">{t('studentRecords.totalInYear', { year: yearFilter || t('studentRecords.allYears') })}</p>
                  <p className="text-3xl font-bold text-slate-900 mt-1">{selected.total}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                  <p className="text-xs text-slate-500">{t('studentRecords.mostRepeated')}</p>
                  <p className="text-sm font-bold text-slate-900 mt-2">{selected.topCategory ? `${selected.topCategory.name} (${selected.topCategory.count})` : '—'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {Object.entries(selected.counts).filter(([, n]) => n > 0).map(([kind, n]) => {
                  const Icon = KIND_META[kind].icon;
                  return <span key={kind} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${KIND_META[kind].chip}`}><Icon className="w-4 h-4" />{t(`studentRecords.kinds.${kind}`)}: {n}</span>;
                })}
              </div>

              {selected.studentId && canSeeTrips(userData) && <StudentTrips studentId={selected.studentId} />}

              <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                    <tr>{[t('common.date'), t('studentRecords.kind'), t('studentRecords.number'), t('studentRecords.topic'), t('common.status')].map((h) => <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.records.map((r) => {
                      const meta = KIND_META[r.kind];
                      const Icon = meta.icon;
                      return (
                        <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenRecord({ kind: r.kind, id: r.id })}>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${meta.chip}`}><Icon className="w-3 h-3" />{t(`studentRecords.kinds.${r.kind}`)}</span></td>
                          <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap" dir="ltr">{r.number}</td>
                          <td className="px-4 py-3"><p className="text-slate-900">{r.title || '—'}</p>{r.subject && <p className="text-xs text-slate-500 mt-0.5">{r.subject}</p>}</td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap ${meta.badge[r.status] || 'bg-slate-100 text-slate-800 border-slate-200'}`}>{t(`statuses.${meta.statusNs}.${r.status}`, r.status)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {openDoc && openRecord.kind === 'complaint' && <ComplaintDetails complaint={openDoc} onClose={() => setOpenRecord(null)} />}
      {openDoc && openRecord.kind === 'tech' && <TechSupportDetails ticket={openDoc} onClose={() => setOpenRecord(null)} />}
      {openDoc && openRecord.kind === 'lostFound' && <LostFoundDetails item={openDoc} onClose={() => setOpenRecord(null)} />}
    </div>
  );
}
