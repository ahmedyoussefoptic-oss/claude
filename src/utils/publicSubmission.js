// Shared by the /report public submission forms (complaint / lost&found).
// Mirrors the limits enforced server-side in functions/index.js
// (uploadPublicAttachment) so a rejection surfaces immediately in the form
// rather than after a round-trip to the Cloud Function.
export const MAX_PUBLIC_FILES = 3;
export const MAX_PUBLIC_FILE_BYTES = 4 * 1024 * 1024;

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
