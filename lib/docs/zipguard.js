// lib/docs/zipguard.js — an .xlsx/.docx is a zip. Check it BEFORE a parser unpacks it (zip bombs, huge entry counts, wrong type).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ENTRIES = 600, MAX_UNPACKED = 60 * 1024 * 1024;
export async function assertSafeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('this does not look like an Office file');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('file is larger than 5 MB');
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)) throw new Error('this does not look like an Office file');
  let JSZip; try { JSZip = (await import('jszip')).default; } catch { return true; }          // exceljs / mammoth bundle their own checks if jszip is not importable
  let zip; try { zip = await JSZip.loadAsync(buffer); } catch { throw new Error('this does not look like a valid Office file'); }
  let total = 0, n = 0;
  zip.forEach((_p, f) => { n++; total += (f._data && Number(f._data.uncompressedSize)) || 0; });
  if (n > MAX_ENTRIES) throw new Error('the file has too many parts');
  if (total > MAX_UNPACKED) throw new Error('the file would unpack to more than 60 MB');
  if (zip.file('xl/vbaProject.bin') || zip.file('word/vbaProject.bin') || zip.file('ppt/vbaProject.bin')) throw new Error('files with macros are not accepted');
  return true;
}
