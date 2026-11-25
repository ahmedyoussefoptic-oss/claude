import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// «صيانة المرافق» — see functions/maintenance.js. Staff actions go through
// mntAction, the QR and technician pages through mntPublic.
export const callMnt = (action, data = {}) => httpsCallable(functions, 'mntAction')({ ...data, action }).then((r) => r.data);
export const callMntPublic = (action, data = {}) => httpsCallable(functions, 'mntPublic')({ ...data, action }).then((r) => r.data);

export const MNT_CATEGORIES = ['ELECTRIC', 'PLUMBING', 'AC', 'CARPENTRY', 'PAINT', 'CLEANING', 'SAFETY', 'OTHER'];
export const MNT_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
export const MNT_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'CLOSED', 'CANCELLED'];
export const MNT_OPEN = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS'];
export const PLACE_KINDS = ['CLASSROOM', 'LAB', 'OFFICE', 'TOILET', 'HALL', 'YARD', 'CORRIDOR', 'KITCHEN', 'STORE', 'OTHER'];
export const CATEGORY_ICON = { ELECTRIC: '⚡', PLUMBING: '🚰', AC: '❄️', CARPENTRY: '🪚', PAINT: '🎨', CLEANING: '🧹', SAFETY: '🧯', OTHER: '🔧' };
export const STATUS_STYLE = {
  NEW: 'bg-sky-50 text-sky-700 border-sky-200',
  ASSIGNED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 border-amber-200',
  WAITING_PARTS: 'bg-orange-50 text-orange-700 border-orange-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-400 border-slate-200',
};
export const PRIORITY_STYLE = {
  URGENT: 'bg-rose-600 text-white border-rose-600',
  HIGH: 'bg-rose-50 text-rose-700 border-rose-200',
  NORMAL: 'bg-slate-50 text-slate-600 border-slate-200',
  LOW: 'bg-slate-50 text-slate-400 border-slate-200',
};
export const isOverdue = (tk, now = Date.now()) => MNT_OPEN.includes(tk.status) && tk.dueAt > 0 && tk.dueAt < now;
export const fmtDateTime = (msv) => (msv ? new Date(msv).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// A photo from the camera, shrunk to at most 1600px as JPEG before upload
// (the server takes up to 4 MB each, 3 at a time).
export const MAX_PHOTOS = 3;
export async function photoPayload(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = dataUrl; });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.82);
    return { fileName: `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`, mimeType: 'image/jpeg', base64Data: out.split(',')[1] };
  } catch {
    // A format the browser cannot draw (e.g. HEIC on desktop): sent as is.
    return { fileName: file.name || 'photo', mimeType: file.type || 'image/jpeg', base64Data: String(dataUrl).split(',')[1] };
  }
}
