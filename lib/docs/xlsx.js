// lib/docs/xlsx.js — build a workbook from a VALIDATED spec (see spec.js) and read workbooks back.
// exceljs is imported lazily so the server still boots if the package is not installed yet.
import { MIME, LIMITS } from './spec.js';
import { assertSafeZip } from './zipguard.js';

const load = async () => { try { return (await import('exceljs')).default; } catch { throw new Error('Excel support is not installed on the server (run: npm install exceljs)'); } };
const NUMFMT = { number: '#,##0.00', integer: '#,##0', percent: '0.0%', date: 'yyyy-mm-dd', text: '@' };
const fmtOf = (c) => (c.format === 'currency' ? (c.currency ? `"${c.currency}" #,##0.00` : '#,##0.00') : NUMFMT[c.format] || undefined);

export async function buildXlsx(spec) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SHERZ AI'; wb.created = new Date(); wb.title = spec.title || spec.filename;
  for (const s of spec.sheets) {
    const ws = wb.addWorksheet(s.name, { views: s.freezeHeader && s.columns.length ? [{ state: 'frozen', ySplit: 1 }] : [] });
    const hasHeader = s.columns.length > 0;
    if (hasHeader) {
      const h = ws.addRow(s.columns.map((c) => c.header));
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.eachCell((cell, i) => { const f = s.columns[i - 1]?.format; if (f && f !== 'text' && f !== 'date') cell.alignment = { horizontal: 'right' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B3F8F' } }; cell.alignment = { ...(cell.alignment || {}), vertical: 'middle', wrapText: true }; });
      h.height = 22;
    }
    for (const r of s.rows) {
      const row = ws.addRow(r.map((c) => (c && typeof c === 'object' ? (c.f !== undefined ? { formula: c.f.slice(1) } : c.d !== undefined ? new Date(c.d + 'T00:00:00Z') : null) : c)));
      r.forEach((c, i) => { const col = s.columns[i]; const cell = row.getCell(i + 1); if (c && typeof c === 'object' && c.d !== undefined) cell.numFmt = NUMFMT.date; else if (col) { const f = fmtOf(col); if (f && f !== '@' && (typeof c === 'number' || (c && c.f !== undefined))) cell.numFmt = f; } });
    }
    const widest = Math.max(s.columns.length, ...s.rows.map((r) => r.length), 0);
    for (let i = 0; i < widest; i++) {
      const col = s.columns[i];
      let w = col?.width;
      if (!w) { const lens = [col?.header?.length || 0, ...s.rows.slice(0, 200).map((r) => { const c = r[i]; return c && typeof c === 'object' ? 12 : String(c ?? '').length; })]; w = Math.min(60, Math.max(10, Math.max(...lens) + 2)); }
      ws.getColumn(i + 1).width = w;
    }
    if (s.autoFilter && hasHeader && widest) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widest } };
  }
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('the generated file is larger than 5 MB — use fewer rows');
  return { buffer: buf, mime: MIME.xlsx };
}

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.formula !== undefined) return v.result !== undefined && v.result !== null ? String(v.result) : '=' + v.formula;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);                       // hyperlink cell → show its text, never the target
    if (v.error) return String(v.error);
    return '';
  }
  return String(v);
};
export async function parseXlsx(buffer, { maxRows = 200, maxCols = 30, maxChars = 7000 } = {}) {
  await assertSafeZip(buffer);
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('this does not look like a valid .xlsx file'); }
  let budget = maxChars;
  const sheets = [];
  for (const ws of wb.worksheets.slice(0, LIMITS.xlsx.sheets)) {
    const rows = []; let truncated = false;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= maxRows || budget <= 0) { truncated = true; return; }
      const cells = []; const last = Math.min(row.cellCount, maxCols);
      for (let c = 1; c <= last; c++) cells.push(cellText(row.getCell(c).value).replace(/<<<|>>>/g, '').slice(0, 200));
      budget -= cells.join('').length + cells.length; rows.push(cells);
    });
    sheets.push({ name: ws.name, rowCount: ws.actualRowCount, columnCount: ws.actualColumnCount, rows, truncated: truncated || ws.actualRowCount > rows.length });
  }
  return { sheets };
}
