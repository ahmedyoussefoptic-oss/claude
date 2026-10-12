import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, onSnapshot, query, where, doc, setDoc, Timestamp } from 'firebase/firestore';
import { GraduationCap, Loader2, Search, Users as UsersIcon, RotateCcw, FileDown, CheckCircle2, HelpCircle, XCircle, PhoneOff } from 'lucide-react';
import { db } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { useBranches } from '../../hooks/useOrgData';
import { REENROLL_INTENTS, REENROLL_STYLES, REENROLL_REASONS, usePlatformSettings, rosterGrade } from '../../config/platform';
import { Tile, btn } from '../../components/platform/ui';
import Student360 from '../../components/platform/Student360';

const PAGE = 100;
const GRADE_ORDER = ['KG1', 'KG2', 'KG3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'SEN'];

// الطلاب الحاليون — the student roster as one record per student (opens the
// 360° profile), and the annual re-enrollment follow-up (returning /
// undecided / not returning, with reasons).
export default function CurrentStudents() {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const branches = useBranches();
  const settings = usePlatformSettings();
  const year = settings.academicYear;
  const [students, setStudents] = useState(null);
  const [reenroll, setReenroll] = useState({});
  const [tab, setTab] = useState('directory');
  const [branch, setBranch] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [intent, setIntent] = useState('');
  const [term, setTerm] = useState('');
  const [limitN, setLimitN] = useState(PAGE);
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(null);

  // Branch code for a roster row (rows whose branch name didn't match at
  // import have an empty code).
  const byName = useMemo(() => Object.fromEntries(branches.flatMap((b) => [[b.name.trim(), b.id], [b.name.replace(/^فرع\s+/, '').trim(), b.id]])), [branches]);
  const branchOf = (s) => s.branch || byName[String(s.branchName || '').trim().replace(/^فرع\s+/, '')] || '';
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '';

  useEffect(() => {
    getDocs(collection(db, 'students')).then((snap) => setStudents(snap.docs.map((d) => d.data()).filter((s) => s.nationalId))).catch(() => setStudents([]));
  }, []);
  useEffect(() => onSnapshot(query(collection(db, 'reenrollments'), where('year', '==', year)), (snap) => {
    setReenroll(Object.fromEntries(snap.docs.map((d) => [d.data().studentId, d.data()])));
  }, () => {}), [year]);

  const sections = useMemo(() => [...new Set((students || []).map((s) => s.stageName).filter(Boolean))], [students]);
  const filtered = useMemo(() => (students || []).filter((s) => {
    if (branch && branchOf(s) !== branch) return false;
    if (grade && rosterGrade(s) !== grade) return false;
    if (section && s.stageName !== section) return false;
    if (intent && (reenroll[s.nationalId]?.intent || 'NO_RESPONSE') !== intent) return false;
    const q = term.trim();
    if (q && !`${s.name} ${s.nationalId} ${s.className} ${s.mobile}`.includes(q)) return false;
    return true;
  }).sort((a, b) => GRADE_ORDER.indexOf(rosterGrade(a)) - GRADE_ORDER.indexOf(rosterGrade(b)) || String(a.className).localeCompare(String(b.className)) || String(a.name).localeCompare(String(b.name), 'ar')), [students, branch, grade, section, intent, term, reenroll]); // eslint-disable-line react-hooks/exhaustive-deps

  const intentOf = (s) => reenroll[s.nationalId]?.intent || 'NO_RESPONSE';
  const counts = Object.fromEntries(REENROLL_INTENTS.map((i) => [i, filtered.filter((s) => intentOf(s) === i).length]));
  const byBranch = useMemo(() => {
    const m = {};
    filtered.forEach((s) => {
      const b = branchOf(s) || '—';
      m[b] = m[b] || { total: 0, RETURNING: 0, UNDECIDED: 0, NOT_RETURNING: 0, NO_RESPONSE: 0 };
      m[b].total++;
      m[b][intentOf(s)]++;
    });
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [filtered, reenroll]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveIntent = async (s, patch) => {
    setSaving(s.nationalId);
    const cur = reenroll[s.nationalId] || {};
    await setDoc(doc(db, 'reenrollments', `${year}_${s.nationalId}`), {
      year, studentId: s.nationalId, studentName: s.name, branch: branchOf(s), grade: rosterGrade(s), className: s.className || '', mobile: s.mobile || '',
      intent: cur.intent || 'NO_RESPONSE', reason: cur.reason || '', note: cur.note || '', ...patch,
      updatedAt: Timestamp.now(), updatedBy: user.uid, updatedByName: userData?.name || '',
    }, { merge: true });
    setSaving(null);
  };

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map((s) => ({
      [t('platform.student')]: s.name, [t('platform.nationalId')]: s.nationalId, [t('common.branch')]: branchName(branchOf(s)) || s.branchName, [t('platform.grade')]: rosterGrade(s),
      [t('platform.students.class')]: s.className, [t('platform.students.section')]: s.stageName, [t('common.phone')]: s.mobile,
      [t('platform.reenroll.intent')]: t(`platform.reenroll.intents.${intentOf(s)}`), [t('platform.reenroll.reason')]: reenroll[s.nationalId]?.reason ? t(`platform.reenroll.reasons.${reenroll[s.nationalId].reason}`) : '',
      [t('platform.notes')]: reenroll[s.nationalId]?.note || '',
    }))), 'Students');
    XLSX.writeFile(wb, `students-${year}.xlsx`);
  };

  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const sel = (value, onChange, options, all) => (
    <select value={value} onChange={(e) => { onChange(e.target.value); setLimitN(PAGE); }} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
      <option value="">{all}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><GraduationCap className="w-6 h-6 text-primary" />{t('platform.students.title')}</h1>
          <p className="text-slate-500 mt-1">{t('platform.students.subtitle')}</p>
        </div>
        <button onClick={exportExcel} disabled={!students} className={btn.ghost}><FileDown className="w-4 h-4" />{t('platform.exportExcel')}</button>
      </div>

      <div className="flex bg-slate-100 rounded-xl p-1 w-fit">
        {[['directory', UsersIcon], ['reenroll', RotateCcw]].map(([v, Icon]) => (
          <button key={v} onClick={() => setTab(v)} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${tab === v ? 'bg-white shadow-sm text-primary font-medium' : 'text-slate-600'}`}><Icon className="w-4 h-4" />{t(`platform.students.tabs.${v}`, { year })}</button>
        ))}
      </div>

      {tab === 'reenroll' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label={t('platform.reenroll.intents.RETURNING')} value={counts.RETURNING} sub={pct(counts.RETURNING, filtered.length)} icon={CheckCircle2} tone="text-emerald-700" onClick={() => setIntent(intent === 'RETURNING' ? '' : 'RETURNING')} active={intent === 'RETURNING'} />
          <Tile label={t('platform.reenroll.intents.UNDECIDED')} value={counts.UNDECIDED} sub={pct(counts.UNDECIDED, filtered.length)} icon={HelpCircle} tone="text-amber-600" onClick={() => setIntent(intent === 'UNDECIDED' ? '' : 'UNDECIDED')} active={intent === 'UNDECIDED'} />
          <Tile label={t('platform.reenroll.intents.NOT_RETURNING')} value={counts.NOT_RETURNING} sub={pct(counts.NOT_RETURNING, filtered.length)} icon={XCircle} tone="text-rose-600" onClick={() => setIntent(intent === 'NOT_RETURNING' ? '' : 'NOT_RETURNING')} active={intent === 'NOT_RETURNING'} />
          <Tile label={t('platform.reenroll.intents.NO_RESPONSE')} value={counts.NO_RESPONSE} sub={pct(counts.NO_RESPONSE, filtered.length)} icon={PhoneOff} tone="text-slate-600" onClick={() => setIntent(intent === 'NO_RESPONSE' ? '' : 'NO_RESPONSE')} active={intent === 'NO_RESPONSE'} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-2.5" />
            <input value={term} onChange={(e) => { setTerm(e.target.value); setLimitN(PAGE); }} placeholder={t('platform.students.search')} className="pr-8 pl-3 py-1.5 border border-slate-200 rounded-lg text-sm w-60" />
          </div>
          {sel(branch, setBranch, branches.map((b) => [b.id, b.name]), t('common.allBranches'))}
          {sel(grade, setGrade, GRADE_ORDER.map((g) => [g, g]), t('platform.students.allGrades'))}
          {sel(section, setSection, sections.map((s) => [s, s]), t('platform.students.allSections'))}
          <span className="text-sm text-slate-500 mr-auto">{t('platform.students.count', { n: filtered.length })}</span>
        </div>

        {!students ? <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : (
          <>
            {tab === 'reenroll' && !branch && byBranch.length > 1 && (
              <div className="p-4 border-b border-slate-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-slate-500 border-b border-slate-100">{[t('common.branch'), t('platform.students.total'), ...REENROLL_INTENTS.map((i) => t(`platform.reenroll.intents.${i}`))].map((h) => <th key={h} className="text-start py-1.5 px-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{byBranch.map(([b, v]) => (
                    <tr key={b} className="border-b border-slate-50"><td className="py-1.5 px-2">{branchName(b) || '—'}</td><td className="py-1.5 px-2 tabular-nums">{v.total}</td>{REENROLL_INTENTS.map((i) => <td key={i} className="py-1.5 px-2 tabular-nums">{v[i]} <span className="text-xs text-slate-400">({pct(v[i], v.total)})</span></td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                  {[t('platform.student'), t('common.branch'), t('platform.grade'), t('platform.students.section'), t('common.phone'), ...(tab === 'reenroll' ? [t('platform.reenroll.intent'), t('platform.reenroll.reason'), t('platform.notes')] : [])].map((h) => <th key={h} className="text-start px-3 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.slice(0, limitN).map((s) => {
                    const r = reenroll[s.nationalId];
                    return (
                      <tr key={s.nationalId} className="hover:bg-slate-50">
                        <td className="px-3 py-2 cursor-pointer" onClick={() => setOpenId(s.nationalId)}><p className="font-medium text-slate-900 hover:text-primary">{s.name}</p><p className="text-xs text-slate-400" dir="ltr">{s.nationalId}</p></td>
                        <td className="px-3 py-2 text-slate-600">{branchName(branchOf(s)) || s.branchName}</td>
                        <td className="px-3 py-2 text-slate-600" dir="ltr">{rosterGrade(s)} <span className="text-xs text-slate-400">{s.className}</span></td>
                        <td className="px-3 py-2 text-slate-600">{s.stageName}</td>
                        <td className="px-3 py-2 text-slate-500" dir="ltr">{s.mobile}</td>
                        {tab === 'reenroll' && <>
                          <td className="px-3 py-2">
                            <select value={intentOf(s)} disabled={saving === s.nationalId} onChange={(e) => saveIntent(s, { intent: e.target.value, ...(e.target.value === 'RETURNING' ? { reason: '' } : {}) })} className={`px-2 py-1 rounded-lg text-xs border ${REENROLL_STYLES[intentOf(s)]}`}>
                              {REENROLL_INTENTS.map((i) => <option key={i} value={i}>{t(`platform.reenroll.intents.${i}`)}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {['UNDECIDED', 'NOT_RETURNING'].includes(intentOf(s)) && (
                              <select value={r?.reason || ''} onChange={(e) => saveIntent(s, { reason: e.target.value })} className="px-2 py-1 rounded-lg text-xs border border-slate-200 bg-white">
                                <option value="">—</option>{REENROLL_REASONS.map((x) => <option key={x} value={x}>{t(`platform.reenroll.reasons.${x}`)}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2"><input defaultValue={r?.note || ''} onBlur={(e) => { if (e.target.value !== (r?.note || '')) saveIntent(s, { note: e.target.value.trim() }); }} className="w-44 px-2 py-1 rounded-lg text-xs border border-slate-200" /></td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > limitN && <div className="p-3 text-center"><button onClick={() => setLimitN((n) => n + PAGE)} className={btn.ghost}>{t('platform.students.more', { n: filtered.length - limitN })}</button></div>}
          </>
        )}
      </div>

      {openId && <Student360 studentId={openId} branchName={branchName} onClose={() => setOpenId(null)} />}
    </div>
  );
}
