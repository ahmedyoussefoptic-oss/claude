import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { fileToBase64, MAX_PUBLIC_FILE_BYTES } from './publicSubmission';

// Uploads one staff file through the uploadStaffFile Cloud Function (Admin
// SDK) instead of writing to Storage from the browser, so Storage security
// rules can't reject it. Returns the attachment record to store.
export async function uploadStaffFile(folder, recordId, file, name = file.name) {
  if (file.size > MAX_PUBLIC_FILE_BYTES) {
    throw new Error(`الحد الأقصى لحجم الملف ${(MAX_PUBLIC_FILE_BYTES / 1024 / 1024).toFixed(0)} ميجابايت`);
  }
  const { data } = await httpsCallable(functions, 'uploadStaffFile')({
    folder,
    recordId,
    file: { fileName: name, mimeType: file.type || 'application/octet-stream', base64Data: await fileToBase64(file) },
  });
  return data;
}
