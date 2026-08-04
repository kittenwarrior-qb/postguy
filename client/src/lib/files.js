/** Attaching a file means shipping its bytes to the server, base64-encoded. */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Chunked, because btoa on a multi-megabyte string overflows the call stack. */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * @returns {Promise<{ fileName: string, contentType: string, size: number, data: string }>}
 * @throws when the file is larger than the payload limit
 */
export async function readFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB`,
    );
  }
  return {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    data: toBase64(await file.arrayBuffer()),
  };
}
