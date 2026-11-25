import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { photoPayload } from './maintenance';

// «المشتريات» — see functions/procurement.js (one function, procAction).
export const callProc = (action, data = {}) => httpsCallable(functions, 'procAction')({ ...data, action }).then((r) => r.data);

export const PROC_CATEGORIES = ['MAINTENANCE', 'STATIONERY', 'CLEANING', 'IT', 'FURNITURE', 'EDUCATIONAL', 'SERVICES', 'OTHER'];
export const PROC_STATUSES = ['PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIAL', 'RECEIVED', 'INVOICED', 'PAID', 'CANCELLED'];
export const PROC_ACTIVE = ['PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'ORDERED', 'PARTIAL', 'RECEIVED', 'INVOICED'];
export const PROC_STATUS_STYLE = {
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 border-amber-200',
  RETURNED: 'bg-orange-50 text-orange-700 border-orange-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-200',
  ORDERED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PARTIAL: 'bg-violet-50 text-violet-700 border-violet-200',
  RECEIVED: 'bg-teal-50 text-teal-700 border-teal-200',
  INVOICED: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-400 border-slate-200',
};
export const STEP_STYLE = { PENDING: 'bg-white text-slate-500 border-slate-200', APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200', REJECTED: 'bg-rose-50 text-rose-700 border-rose-200', RETURNED: 'bg-orange-50 text-orange-700 border-orange-200' };
export const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// An attachment: photos shrunk like the maintenance ones, PDFs as they are.
export async function filePayload(file) {
  if (file.type !== 'application/pdf') return photoPayload(file);
  const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
  return { fileName: file.name, mimeType: 'application/pdf', base64Data: String(dataUrl).split(',')[1] };
}
