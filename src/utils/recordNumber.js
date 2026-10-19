import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

// A unique sequential record number from the server (reserveRecordNumber);
// if that call fails, a random 6-digit fallback that can't collide with the
// sequential ones (which start at 10001) in practice.
export async function reserveRecordNumber(kind, prefix) {
  try {
    const { data } = await httpsCallable(functions, 'reserveRecordNumber')({ kind });
    if (data?.number) return data.number;
  } catch (err) {
    console.error('reserveRecordNumber', err);
  }
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
}
