import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { collection, addDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { Loader2, Phone, MessageCircle, FileText, Wrench, PackageSearch, Bus, DoorOpen, ShieldCheck, Plus, Trash2, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { db, functions } from '../../config/firebase';
import useAuthStore from '../../stores/useAuthStore';
import { waLink } from '../../utils/whatsapp';
import { PICKUP_RELATIONS, REENROLL_STYLES, rosterGrade } from '../../config/platform';
import { Modal, Field, Pill, inputCls, btn } from './ui';

const day = (ms) => (ms ? format(new Date(ms), 'yyyy-MM-dd') : '—');

// Everything about one current student across the system: complaints, tech
// tickets, lost & found, trips, leave permissions, re-enrollment, and the
// people authorised to collect them.
export default function Student360({ studentId, branchName, onClose }) {
  const { t } = useTranslation();
  const { user, userData } = useAuthStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pickup, setPickup] = useState({ name: '', relation: 'FATHER', nationalId: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    httpsCallable(functions, 'getStudent360')({ studentId }).then((r) => setData(r.data)).catch((err) => setError(err.message));
  }, [studentId]);
  useEffect(() => { load(); }, [load]);

  const addPickup = async () => {
    if (!pickup.name.trim()) return;
    setBusy(true);
    await addDoc(collection(db, 'authorizedPickups'), {
      studentId, name: pickup.name.trim(), relation: pickup.relation, nationalId: pickup.nationalId.trim(), phone: pickup.phone.trim(),
      active: true, addedByName: userData?.name || '', addedBy: user.uid, createdAt: Timestamp.now(),
    });
    setPickup({ name: '', relation: 'FATHER', nationalId: '', phone: '' });
    setBusy(false);
    load();
  };
  const togglePickup = async (p) => {
    await updateDoc(doc(db, 'authorizedPickups', p.id), { active: !p.active, updatedAt: Timestamp.now() });
    load();
  };

  const s = data?.student;
  const section = (title, Icon, rows, render, empty) => (
    <section className="border border-slate-100 rounded-2xl p-4">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-2"><Icon className="w-4 h-4 text-primary" />{title} <span className="text-slate-400 font-normal">({rows.length})</span></p>
      {rows.length === 0 ? <p className="text-xs text-slate-400">{empty || '—'}</p> : <ul className="divide-y divide-slate-50 text-sm">{rows.map(render)}</ul>}
    </section>
  );

  return (
    <Modal
      title={s?.name || t('platform.student')}
      subtitle={s && <span className="flex flex-wrap items-center gap-3">
        <span dir="ltr">{s.nationalId}</span><span>{branchName(s.branch) || s.branchName}</span><span dir="ltr">{rosterGrade(s)} {s.className}</span><span>{s.stageName}</span>
        {s.mobile && <a href={`tel:${s.mobile}`} className="flex items-center gap-1 hover:text-primary" dir="ltr"><Phone className="w-4 h-4" />{s.mobile}</a>}
        {s.mobile && <a href={waLink(s.mobile, '')} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-700"><MessageCircle className="w-4 h-4" />WhatsApp</a>}
      </span>}
      onClose={onClose} size="max-w-5xl"
    >
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{error}</div>}
      {!data && !error && <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>}
      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {[[FileText, 'complaints', data.complaints.length], [Wrench, 'tickets', data.tickets.length], [PackageSearch, 'lostFound', data.lostFound.length], [Bus, 'trips', data.trips.length], [DoorOpen, 'leaves', data.leaves.length]].map(([Icon, k, n]) => (
              <span key={k} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-slate-100 text-slate-700"><Icon className="w-4 h-4" />{t(`platform.students.kinds.${k}`)}: <b>{n}</b></span>
            ))}
            {data.reenrollments.map((r) => <Pill key={r.id} className={REENROLL_STYLES[r.intent]}><RotateCcw className="w-3 h-3 ml-1" />{r.year}: {t(`platform.reenroll.intents.${r.intent}`)}</Pill>)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {section(t('platform.students.kinds.complaints'), FileText, data.complaints, (c) => (
              <li key={c.id} className="py-1.5 flex justify-between gap-2"><span><span className="font-mono text-xs text-slate-400" dir="ltr">{c.number}</span> {c.subject}{c.visit && ' 🪑'}</span><span className="text-xs text-slate-500 shrink-0">{t(`statuses.complaint.${c.status}`, c.status)} · {day(c.at)}</span></li>
            ))}
            {section(t('platform.students.kinds.leaves'), DoorOpen, data.leaves, (l) => (
              <li key={l.id} className="py-1.5 flex justify-between gap-2"><span>{t(`platform.leaves.reasons.${l.reason}`)} — {l.pickup}</span><span className="text-xs text-slate-500 shrink-0">{t(`platform.leaves.status.${l.status}`)} · {day(l.at)}</span></li>
            ))}
            {section(t('platform.students.kinds.trips'), Bus, data.trips, (tr) => (
              <li key={tr.tripId} className="py-1.5 flex justify-between gap-2"><span>{tr.title}</span><span className="text-xs text-slate-500 shrink-0">{t(`trips.decision.${tr.decision}`, tr.decision || '')}{tr.boarded === true ? ` · ${t('trips.attended')}` : ''} · {tr.date}</span></li>
            ))}
            {section(t('platform.students.kinds.tickets'), Wrench, data.tickets, (tk) => (
              <li key={tk.id} className="py-1.5 flex justify-between gap-2"><span className="font-mono text-xs text-slate-400" dir="ltr">{tk.number}</span><span className="text-xs text-slate-500">{t(`statuses.techSupport.${tk.status}`, tk.status)} · {day(tk.at)}</span></li>
            ))}
            {section(t('platform.students.kinds.lostFound'), PackageSearch, data.lostFound, (i) => (
              <li key={i.id} className="py-1.5 flex justify-between gap-2"><span>{i.item}</span><span className="text-xs text-slate-500">{t(`statuses.lostFound.${i.status}`, i.status)} · {day(i.at)}</span></li>
            ))}

            <section className="border border-slate-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-2"><ShieldCheck className="w-4 h-4 text-primary" />{t('platform.students.pickups')}</p>
              <ul className="divide-y divide-slate-50 text-sm mb-3">
                {data.pickups.map((p) => (
                  <li key={p.id} className={`py-1.5 flex justify-between gap-2 ${p.active ? '' : 'opacity-50 line-through'}`}>
                    <span>{p.name} <span className="text-xs text-slate-500">{t(`platform.relations.${p.relation}`, p.relation)}</span> {p.nationalId && <span className="text-xs text-slate-400" dir="ltr">{p.nationalId}</span>}
                      {p.idImage?.fileUrl && <a href={p.idImage.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline ms-1">{t('platform.students.idImage')}</a>}
                      {p.source === 'PARENT_LEAVE' && <span className="text-[11px] text-amber-700 ms-1">({t('platform.students.addedByParent')})</span>}</span>
                    <button onClick={() => togglePickup(p)} className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1">{p.active ? <><Trash2 className="w-3.5 h-3.5" />{t('platform.students.deactivate')}</> : t('platform.students.reactivate')}</button>
                  </li>
                ))}
                {data.pickups.length === 0 && <li className="text-xs text-slate-400 py-1">{t('platform.students.noPickups')}</li>}
              </ul>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('platform.leaves.pickupName')}><input value={pickup.name} onChange={(e) => setPickup((x) => ({ ...x, name: e.target.value }))} className={inputCls} /></Field>
                <Field label={t('platform.leaves.relation')}><select value={pickup.relation} onChange={(e) => setPickup((x) => ({ ...x, relation: e.target.value }))} className={inputCls}>{PICKUP_RELATIONS.map((r) => <option key={r} value={r}>{t(`platform.relations.${r}`)}</option>)}</select></Field>
                <Field label={t('platform.leaves.nationalId')}><input value={pickup.nationalId} onChange={(e) => setPickup((x) => ({ ...x, nationalId: e.target.value }))} className={inputCls} dir="ltr" /></Field>
                <Field label={t('common.phone')}><input value={pickup.phone} onChange={(e) => setPickup((x) => ({ ...x, phone: e.target.value }))} className={inputCls} dir="ltr" /></Field>
              </div>
              <button disabled={busy || !pickup.name.trim()} onClick={addPickup} className={`${btn.primary} mt-2`}><Plus className="w-4 h-4" />{t('platform.students.addPickup')}</button>
            </section>
          </div>
        </>
      )}
    </Modal>
  );
}
