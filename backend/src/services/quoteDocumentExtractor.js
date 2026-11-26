/**
 * Vendor Quotation Email Attachment Extractor
 *
 * Extracts readable text and multimodal inline parts from inbound vendor quotation
 * email attachments across:
 *   - PDF (.pdf) -> multimodal Gemini inline_data + content-stream text fallback
 *   - Word (.docx, .docm, .doc) -> OOXML ZIP XML, RTF, HTML/XML, and OLE2 text extraction
 *   - Excel (.xlsx, .xlsm, .xls) -> OOXML worksheet tables, BIFF8 OLE2, SpreadsheetML XML, HTML tables
 *   - CSV / TSV / Plain Text -> normalized UTF-8 rows
 *   - Images (.png, .jpg, .webp, .heic, .heif) -> multimodal inline_data (non-signature only)
 *
 * Zero external binary parser dependencies (`xlsx` / `mammoth` intentionally omitted) so
 * there are no prototype-pollution advisories and full compatibility with Cloudflare Workers.
 */

const zlib = require('zlib');
const {
  GEMINI_CONFIG,
  GEMINI_INLINE_MIME_TYPES,
  QUOTE_DOCUMENT_EXTRACTOR_CONFIG,
  resolveAttachmentContentType,
} = require('../config/constants');
const { sanitizeTextForModel } = require('./documentTextSanitizer');
const { logger } = require('./loggerService');

const QUOTE_FORMAT = Object.freeze({
  PDF: 'pdf',
  DOCX: 'docx',
  DOC: 'doc',
  XLSX: 'xlsx',
  XLS: 'xls',
  CSV: 'csv',
  TEXT: 'text',
  IMAGE: 'image',
  UNSUPPORTED: 'unsupported',
});

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const OLE2_ENDOFCHAIN = -2;
const OLE2_FREESECT = -1;

/** Decode common XML/HTML entities into readable UTF-8 text. */
function decodeXmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** Normalize raw attachment content into a Node Buffer. */
function toAttachmentBuffer(rawContent) {
  if (!rawContent) return null;
  if (Buffer.isBuffer(rawContent)) return rawContent;
  if (rawContent instanceof Uint8Array || ArrayBuffer.isView(rawContent)) {
    return Buffer.from(rawContent.buffer, rawContent.byteOffset, rawContent.byteLength);
  }
  if (rawContent instanceof ArrayBuffer) {
    return Buffer.from(rawContent);
  }
  if (typeof rawContent === 'string') {
    const trimmed = rawContent.trim();
    if (!trimmed) return null;
    if (/^[A-Za-z0-9+/\r\n]+=*$/.test(trimmed) && trimmed.length >= 4 && trimmed.length % 4 === 0) {
      return Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
    }
    return Buffer.from(rawContent, 'utf8');
  }
  return null;
}

/** Determine canonical MIME type and normalized format category for an attachment. */
function classifyQuoteAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return { format: QUOTE_FORMAT.UNSUPPORTED, mimeType: 'application/octet-stream', fileName: 'attachment' };
  }
  const fileName = String(attachment.fileName || attachment.filename || 'attachment').trim() || 'attachment';
  const lowerName = fileName.toLowerCase();
  const declared = attachment.contentType || attachment.mimeType || '';
  const mimeType = resolveAttachmentContentType(declared, fileName);

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return { format: QUOTE_FORMAT.PDF, mimeType: 'application/pdf', fileName };
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.ms-word.document.macroenabled.12' ||
    /\.(docx|docm)$/i.test(lowerName)
  ) {
    return { format: QUOTE_FORMAT.DOCX, mimeType, fileName };
  }
  if (mimeType === 'application/msword' || /\.doc$/i.test(lowerName)) {
    return { format: QUOTE_FORMAT.DOC, mimeType: 'application/msword', fileName };
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel.sheet.macroenabled.12' ||
    /\.(xlsx|xlsm)$/i.test(lowerName)
  ) {
    return { format: QUOTE_FORMAT.XLSX, mimeType, fileName };
  }
  if (mimeType === 'application/vnd.ms-excel' || /\.xls$/i.test(lowerName)) {
    return { format: QUOTE_FORMAT.XLS, mimeType: 'application/vnd.ms-excel', fileName };
  }
  if (
    mimeType === 'text/csv' ||
    mimeType === 'text/tab-separated-values' ||
    mimeType === 'application/csv' ||
    /\.(csv|tsv)$/i.test(lowerName)
  ) {
    return { format: QUOTE_FORMAT.CSV, mimeType, fileName };
  }
  if (mimeType.startsWith('text/') || /\.(txt|md|log)$/i.test(lowerName)) {
    return { format: QUOTE_FORMAT.TEXT, mimeType, fileName };
  }
  if (mimeType.startsWith('image/') && GEMINI_INLINE_MIME_TYPES.includes(mimeType)) {
    return { format: QUOTE_FORMAT.IMAGE, mimeType, fileName };
  }
  return { format: QUOTE_FORMAT.UNSUPPORTED, mimeType, fileName };
}

/** Check whether a buffer begins with the ZIP magic signature (PK 0x03 0x04). */
function isZipBuffer(buf) {
  return Boolean(buf && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);
}

/** Check whether a buffer begins with the OLE2 Compound File Binary signature. */
function isOle2Buffer(buf) {
  if (!buf || buf.length < 512) return false;
  for (let i = 0; i < OLE2_MAGIC.length; i += 1) {
    if (buf[i] !== OLE2_MAGIC[i]) return false;
  }
  return true;
}

/** Inflate or copy a single ZIP entry payload within memory safety limits. */
function readZipData(compressed, compressionMethod, maxOutputLength) {
  if (compressionMethod === 0) {
    if (compressed.length > maxOutputLength) {
      throw new Error('ZIP entry exceeds maximum uncompressed size limit.');
    }
    return compressed;
  }
  if (compressionMethod === 8) {
    return zlib.inflateRawSync(compressed, { maxOutputLength });
  }
  return null;
}

function appendZipEntry(entries, name, slice, compMethod, state) {
  const maxEntryBytes = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_UNCOMPRESSED_ENTRY_BYTES;
  const maxTotalBytes = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_TOTAL_UNCOMPRESSED_BYTES;
  try {
    const data = readZipData(slice, compMethod, maxEntryBytes);
    if (data && state.totalUncompressed + data.length <= maxTotalBytes) {
      state.totalUncompressed += data.length;
      entries.set(name, data);
    }
  } catch {
    // Skip unreadable or oversized XML part so remaining entries still extract
  }
}

/**
 * Parse ZIP archive entries via Central Directory (supporting data-descriptor streams),
 * falling back to local headers when no EOCD record is present.
 */
function parseZipEntries(buf) {
  const entries = new Map();
  if (!isZipBuffer(buf)) return entries;

  const maxEntries = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_ZIP_ENTRIES;
  const maxEntryBytes = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_UNCOMPRESSED_ENTRY_BYTES;
  const state = { totalUncompressed: 0 };

  let eocdOffset = -1;
  const minScan = Math.max(0, buf.length - 65557);
  for (let pos = buf.length - 22; pos >= minScan; pos -= 1) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize <= eocdOffset) {
      let ptr = cdOffset;
      while (ptr + 46 <= cdOffset + cdSize && entries.size < maxEntries) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
        const compMethod = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 20);
        const uncompSize = buf.readUInt32LE(ptr + 24);
        const fnLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const localOffset = buf.readUInt32LE(ptr + 42);
        const headerEnd = ptr + 46 + fnLen + extraLen + commentLen;
        if (headerEnd > cdOffset + cdSize) break;

        const name = buf.subarray(ptr + 46, ptr + 46 + fnLen).toString('utf8').toLowerCase();
        ptr = headerEnd;

        if (!name || name.endsWith('/') || uncompSize > maxEntryBytes || localOffset + 30 > buf.length) continue;
        if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
        const lFnLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lFnLen + lExtraLen;
        if (dataStart + compSize > buf.length) continue;

        appendZipEntry(entries, name, buf.subarray(dataStart, dataStart + compSize), compMethod, state);
      }
      return entries;
    }
  }

  let offset = 0;
  while (offset + 30 <= buf.length && entries.size < maxEntries) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const compMethod = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const fnLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fnLen + extraLen;
    if (dataStart + compSize > buf.length || compSize === 0) break;

    const name = buf.subarray(offset + 30, offset + 30 + fnLen).toString('utf8').toLowerCase();
    offset = dataStart + compSize;
    if (!name || name.endsWith('/')) continue;

    appendZipEntry(entries, name, buf.subarray(dataStart, dataStart + compSize), compMethod, state);
  }
  return entries;
}

/** Convert WordprocessingML XML (word/document.xml, header/footer XML) into readable text & pipe-delimited tables. */
function parseDocxXml(xml) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tc\b[^>]*>\s*(?:<w:tcPr>[\s\S]*?<\/w:tcPr>\s*)?(?:<w:p\b[^>]*>)?/gi, ' | ')
      .replace(/<w:tr\b[^>]*>/gi, '\n')
      .replace(/<w:p\b[^>]*>/gi, '\n')
      .replace(/<w:tab\b[^>]*\/>/gi, ' ')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\|\s*/g, '\n')
    .replace(/\s*\|\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract text and tables from a Word .docx / .docm ZIP container. */
function extractDocxText(buffer) {
  const entries = parseZipEntries(buffer);
  if (entries.size === 0) return '';

  const targetKeys = Array.from(entries.keys())
    .filter((k) => /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(k))
    .sort((a, b) => {
      if (a === 'word/document.xml') return -1;
      if (b === 'word/document.xml') return 1;
      return a.localeCompare(b);
    });

  const sections = [];
  for (const key of targetKeys) {
    const parsed = parseDocxXml(entries.get(key).toString('utf8'));
    if (parsed) sections.push(parsed);
  }
  return sections.join('\n\n').trim();
}

/** Convert Excel column label (e.g. A -> 0, AA -> 26) to zero-based column index. */
function colLettersToIndex(colLetters) {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i += 1) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** Extract shared strings from xl/sharedStrings.xml preserving rich-text <r><t> runs. */
function parseXlsxSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const inner = siMatch[1];
    const tParts = [];
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
    let tMatch;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      tParts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(tParts.join(''));
  }
  return strings;
}

/** Resolve ordered worksheet paths and names from xl/workbook.xml and workbook.xml.rels. */
function resolveXlsxSheets(entries) {
  const relsXml = entries.has('xl/_rels/workbook.xml.rels') ? entries.get('xl/_rels/workbook.xml.rels').toString('utf8') : '';
  const relMap = new Map();
  const relRegex = /<Relationship\b([^>]+)\/?>/gi;
  let relMatch;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const attrs = relMatch[1];
    const idMatch = attrs.match(/\bId="([^"]+)"/i);
    const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
    if (idMatch && targetMatch) {
      const rawTarget = targetMatch[1].replace(/^\/+/, '').toLowerCase();
      const fullPath = rawTarget.startsWith('xl/') ? rawTarget : `xl/${rawTarget}`;
      relMap.set(idMatch[1], fullPath);
    }
  }

  const wbXml = entries.has('xl/workbook.xml') ? entries.get('xl/workbook.xml').toString('utf8') : '';
  const ordered = [];
  const sheetRegex = /<sheet\b([^>]+)\/?>/gi;
  let sMatch;
  while ((sMatch = sheetRegex.exec(wbXml)) !== null) {
    const attrs = sMatch[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const ridMatch = attrs.match(/\br:id="([^"]+)"/i);
    const targetPath = ridMatch ? relMap.get(ridMatch[1]) : null;
    if (targetPath && entries.has(targetPath)) {
      ordered.push({ name: decodeXmlEntities(nameMatch ? nameMatch[1] : targetPath), path: targetPath });
    }
  }

  if (ordered.length > 0) return ordered;

  return Array.from(entries.keys())
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((p, idx) => ({ name: `Sheet${idx + 1}`, path: p }));
}

/** Parse one worksheet XML buffer into pipe-delimited rows. */
function parseXlsxWorksheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowBody = rowMatch[1];
    const cellsByCol = new Map();
    let maxCol = -1;
    let sequentialCol = 0;

    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let cMatch;
    while ((cMatch = cellRegex.exec(rowBody)) !== null) {
      const attrs = cMatch[1] || '';
      const inner = cMatch[2] || '';
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1].toUpperCase()) : sequentialCol;
      sequentialCol = colIdx + 1;

      const typeMatch = attrs.match(/\bt="([^"]+)"/i);
      const cellType = typeMatch ? typeMatch[1] : 'n';
      let val = '';

      if (cellType === 'inlineStr') {
        const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
        const parts = [];
        let tm;
        while ((tm = tRegex.exec(inner)) !== null) parts.push(decodeXmlEntities(tm[1]));
        val = parts.join('').trim();
      } else {
        const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        const rawVal = vMatch ? decodeXmlEntities(vMatch[1]).trim() : '';
        if (cellType === 's') {
          const strIdx = Number(rawVal);
          val = Number.isInteger(strIdx) && strIdx >= 0 && strIdx < sharedStrings.length ? String(sharedStrings[strIdx]).trim() : rawVal;
        } else if (cellType === 'b') {
          val = rawVal === '1' ? 'TRUE' : rawVal === '0' ? 'FALSE' : rawVal;
        } else {
          val = rawVal;
        }
      }

      if (val !== '') {
        cellsByCol.set(colIdx, val);
        if (colIdx > maxCol) maxCol = colIdx;
      }
    }

    if (maxCol >= 0) {
      const lineCells = [];
      for (let c = 0; c <= Math.min(maxCol, 40); c += 1) {
        lineCells.push(cellsByCol.get(c) || '');
      }
      if (lineCells.some(Boolean)) {
        rows.push(lineCells.join(' | '));
      }
    }
  }
  return rows;
}

/** Extract workbook sheets as "SHEET: <name>\ncol1 | col2" from an .xlsx/.xlsm buffer. */
function extractXlsxText(buffer) {
  const entries = parseZipEntries(buffer);
  if (entries.size === 0) return '';

  const sharedXml = entries.has('xl/sharedstrings.xml') ? entries.get('xl/sharedstrings.xml').toString('utf8') : '';
  const sharedStrings = parseXlsxSharedStrings(sharedXml);
  const sheets = resolveXlsxSheets(entries);

  const blocks = [];
  for (const sheet of sheets) {
    const sheetXml = entries.get(sheet.path).toString('utf8');
    const rows = parseXlsxWorksheetXml(sheetXml, sharedStrings);
    if (rows.length > 0) {
      blocks.push(`SHEET: ${sheet.name}\n${rows.join('\n')}`);
    }
  }
  return blocks.join('\n\n').trim();
}

/** Follow an OLE2 FAT or MiniFAT sector chain within bounds to guard against circular headers. */
function readSectorChain(startSector, table, readSectorFn) {
  const chunks = [];
  const visited = new Set();
  const maxSteps = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.OLE2_MAX_CHAIN_STEPS;
  const maxBytes = QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_OLE2_STREAM_BYTES;
  let total = 0;
  let sector = startSector;

  while (sector >= 0 && sector < table.length && !visited.has(sector) && visited.size < maxSteps) {
    visited.add(sector);
    const slice = readSectorFn(sector);
    if (!slice) break;
    chunks.push(slice);
    total += slice.length;
    if (total >= maxBytes) break;
    const next = table[sector];
    if (next === OLE2_ENDOFCHAIN || next === OLE2_FREESECT || next < 0) break;
    sector = next;
  }
  return Buffer.concat(chunks);
}

/** Parse named streams out of a legacy Microsoft OLE2 Compound File Binary container. */
function extractOle2Streams(buf) {
  const streams = new Map();
  if (!isOle2Buffer(buf)) return streams;

  const sectorShift = buf.readUInt16LE(30);
  const miniSectorShift = buf.readUInt16LE(32);
  if (sectorShift < 9 || sectorShift > 12 || miniSectorShift < 5 || miniSectorShift > 8) return streams;

  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const maxSectors = Math.min(
    Math.floor((buf.length - 512) / sectorSize) + 1,
    QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_OLE2_SECTORS
  );
  const readFatSector = (secIdx) => {
    const start = 512 + secIdx * sectorSize;
    if (start < 512 || start >= buf.length) return null;
    return buf.subarray(start, Math.min(buf.length, start + sectorSize));
  };

  const dirStartSector = buf.readInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56) || 4096;
  const miniFatStart = buf.readInt32LE(60);
  const difatStart = buf.readInt32LE(68);
  const numDifat = buf.readInt32LE(72);

  const fatSectorList = [];
  for (let i = 0; i < 109; i += 1) {
    const sec = buf.readInt32LE(76 + i * 4);
    if (sec >= 0 && sec < maxSectors) fatSectorList.push(sec);
  }

  let curDifat = difatStart;
  const difatVisited = new Set();
  for (let d = 0; d < numDifat && curDifat >= 0 && curDifat < maxSectors && !difatVisited.has(curDifat); d += 1) {
    difatVisited.add(curDifat);
    const secBuf = readFatSector(curDifat);
    if (!secBuf || secBuf.length < sectorSize) break;
    const perSec = Math.floor((sectorSize - 4) / 4);
    for (let j = 0; j < perSec; j += 1) {
      const sec = secBuf.readInt32LE(j * 4);
      if (sec >= 0 && sec < maxSectors) fatSectorList.push(sec);
    }
    curDifat = secBuf.readInt32LE(sectorSize - 4);
  }

  const fat = [];
  for (const fatSec of fatSectorList) {
    const secBuf = readFatSector(fatSec);
    if (!secBuf) continue;
    for (let off = 0; off + 4 <= secBuf.length; off += 4) {
      fat.push(secBuf.readInt32LE(off));
    }
  }
  if (fat.length === 0) return streams;

  const dirStream = readSectorChain(dirStartSector, fat, readFatSector);
  const miniFatStream = miniFatStart >= 0 ? readSectorChain(miniFatStart, fat, readFatSector) : Buffer.alloc(0);
  const miniFat = [];
  for (let off = 0; off + 4 <= miniFatStream.length; off += 4) {
    miniFat.push(miniFatStream.readInt32LE(off));
  }

  let rootMiniStream = Buffer.alloc(0);
  const pendingEntries = [];
  for (let off = 0; off + 128 <= dirStream.length; off += 128) {
    const entryType = dirStream[off + 66];
    const nameByteLen = dirStream.readUInt16LE(off + 64);
    if (entryType === 0 || nameByteLen < 2 || nameByteLen > 64) continue;
    const entryName = dirStream.subarray(off, off + nameByteLen - 2).toString('utf16le').replace(/\0/g, '').trim();
    const startSec = dirStream.readInt32LE(off + 116);
    const streamSize = dirStream.readUInt32LE(off + 120);

    if (entryType === 5) {
      rootMiniStream = startSec >= 0 ? readSectorChain(startSec, fat, readFatSector).subarray(0, streamSize) : Buffer.alloc(0);
    } else if (entryType === 2 && entryName && streamSize > 0) {
      pendingEntries.push({ entryName, startSec, streamSize });
    }
  }

  const readMiniSector = (secIdx) => {
    const start = secIdx * miniSectorSize;
    if (start < 0 || start >= rootMiniStream.length) return null;
    return rootMiniStream.subarray(start, Math.min(rootMiniStream.length, start + miniSectorSize));
  };

  for (const entry of pendingEntries) {
    const raw =
      entry.streamSize < miniCutoff && rootMiniStream.length > 0 && miniFat.length > 0
        ? readSectorChain(entry.startSec, miniFat, readMiniSector)
        : readSectorChain(entry.startSec, fat, readFatSector);
    streams.set(entry.entryName, raw.subarray(0, entry.streamSize));
  }

  return streams;
}

/** Decode BIFF8 packed RK number (handles IEEE float high bits and 30-bit signed integer + /100 scaling). */
function decodeBiffRkNumber(rk) {
  const isInt = (rk & 0x02) !== 0;
  const div100 = (rk & 0x01) !== 0;
  let value;
  if (isInt) {
    value = rk >> 2;
  } else {
    const tmp = Buffer.alloc(8);
    tmp.writeUInt32LE(rk & 0xfffffffc, 4);
    value = tmp.readDoubleLE(0);
  }
  return div100 ? value / 100 : value;
}

/** Read a BIFF8 string across record/CONTINUE chunks starting at state `{ chunkIdx, offset }`. */
function readBiff8String(chunks, state, { oneByteLen = false } = {}) {
  const ensureChunk = () => {
    while (state.chunkIdx < chunks.length && state.offset >= chunks[state.chunkIdx].length) {
      state.chunkIdx += 1;
      state.offset = 0;
    }
    return state.chunkIdx < chunks.length;
  };
  const readBytes = (len) => {
    const out = Buffer.alloc(len);
    let written = 0;
    while (written < len && ensureChunk()) {
      const cur = chunks[state.chunkIdx];
      const take = Math.min(len - written, cur.length - state.offset);
      cur.copy(out, written, state.offset, state.offset + take);
      state.offset += take;
      written += take;
    }
    return out.subarray(0, written);
  };

  if (!ensureChunk()) return '';
  const cch = oneByteLen ? readBytes(1)[0] : readBytes(2).readUInt16LE(0);
  if (!cch) return '';
  if (!ensureChunk()) return '';
  const flags = readBytes(1)[0];
  let isUtf16 = (flags & 0x01) !== 0;
  const hasExt = (flags & 0x04) !== 0;
  const hasRich = (flags & 0x08) !== 0;

  const rtCount = hasRich ? readBytes(2).readUInt16LE(0) : 0;
  const extSize = hasExt ? readBytes(4).readUInt32LE(0) : 0;

  let charsLeft = cch;
  const textParts = [];
  while (charsLeft > 0 && ensureChunk()) {
    const cur = chunks[state.chunkIdx];
    const availBytes = cur.length - state.offset;
    const bpc = isUtf16 ? 2 : 1;
    const takeChars = Math.min(charsLeft, Math.floor(availBytes / bpc));
    if (takeChars > 0) {
      const slice = cur.subarray(state.offset, state.offset + takeChars * bpc);
      textParts.push(slice.toString(isUtf16 ? 'utf16le' : 'latin1'));
      state.offset += takeChars * bpc;
      charsLeft -= takeChars;
    }
    if (charsLeft > 0) {
      state.chunkIdx += 1;
      state.offset = 0;
      if (state.chunkIdx < chunks.length && state.offset < chunks[state.chunkIdx].length) {
        isUtf16 = (chunks[state.chunkIdx][state.offset] & 0x01) !== 0;
        state.offset += 1;
      }
    }
  }

  if (rtCount > 0) readBytes(rtCount * 4);
  if (extSize > 0) readBytes(extSize);
  return textParts.join('');
}

/** Walk BIFF records in a Workbook stream slice from `startPos` and collect records. */
function collectBiffRecords(stream, startPos) {
  const records = [];
  let pos = startPos;
  while (pos + 4 <= stream.length) {
    const id = stream.readUInt16LE(pos);
    const len = stream.readUInt16LE(pos + 2);
    const bodyStart = pos + 4;
    const bodyEnd = bodyStart + len;
    if (bodyEnd > stream.length) break;
    records.push({ id, data: stream.subarray(bodyStart, bodyEnd), offset: pos });
    pos = bodyEnd;
    if (id === 0x000a && records.length > 1) break;
  }
  return records;
}

/** Extract BIFF8 sheet rows from a legacy OLE2 Excel Workbook/Book stream. */
function parseBiff8Workbook(stream) {
  const globalRecords = collectBiffRecords(stream, 0);
  const boundSheets = [];
  const sharedStrings = [];

  for (let i = 0; i < globalRecords.length; i += 1) {
    const rec = globalRecords[i];
    if (rec.id === 0x0085 && rec.data.length >= 8) {
      const bofOffset = rec.data.readUInt32LE(0);
      const sheetName = readBiff8String([rec.data], { chunkIdx: 0, offset: 6 }, { oneByteLen: true });
      boundSheets.push({ name: sheetName || `Sheet${boundSheets.length + 1}`, offset: bofOffset });
    } else if (rec.id === 0x00fc && rec.data.length >= 8) {
      const sstChunks = [rec.data.subarray(8)];
      while (i + 1 < globalRecords.length && globalRecords[i + 1].id === 0x003c) {
        i += 1;
        sstChunks.push(globalRecords[i].data);
      }
      const totalUnique = rec.data.readUInt32LE(4);
      const sstState = { chunkIdx: 0, offset: 0 };
      for (let s = 0; s < totalUnique && sstState.chunkIdx < sstChunks.length; s += 1) {
        sharedStrings.push(readBiff8String(sstChunks, sstState));
      }
    }
  }

  const sheetBlocks = [];
  for (const sheet of boundSheets) {
    if (sheet.offset < 0 || sheet.offset >= stream.length) continue;
    const recs = collectBiffRecords(stream, sheet.offset);
    const rowsMap = new Map();
    const putCell = (r, c, value) => {
      if (value === null || value === undefined) return;
      const str = String(value).trim();
      if (!str) return;
      if (!rowsMap.has(r)) rowsMap.set(r, new Map());
      rowsMap.get(r).set(c, str);
    };

    let lastFormulaPos = null;
    for (const rec of recs) {
      if (rec.id === 0x00fd && rec.data.length >= 10) {
        const r = rec.data.readUInt16LE(0);
        const c = rec.data.readUInt16LE(2);
        const sstIdx = rec.data.readUInt32LE(6);
        putCell(r, c, sharedStrings[sstIdx] ?? '');
      } else if ((rec.id === 0x0204 || rec.id === 0x00d6) && rec.data.length >= 9) {
        const r = rec.data.readUInt16LE(0);
        const c = rec.data.readUInt16LE(2);
        putCell(r, c, readBiff8String([rec.data], { chunkIdx: 0, offset: 6 }));
      } else if (rec.id === 0x0203 && rec.data.length >= 14) {
        putCell(rec.data.readUInt16LE(0), rec.data.readUInt16LE(2), rec.data.readDoubleLE(6));
      } else if (rec.id === 0x027e && rec.data.length >= 10) {
        putCell(rec.data.readUInt16LE(0), rec.data.readUInt16LE(2), decodeBiffRkNumber(rec.data.readUInt32LE(6)));
      } else if (rec.id === 0x00bd && rec.data.length >= 6) {
        const r = rec.data.readUInt16LE(0);
        const colFirst = rec.data.readUInt16LE(2);
        const count = Math.floor((rec.data.length - 6) / 6);
        for (let k = 0; k < count; k += 1) {
          putCell(r, colFirst + k, decodeBiffRkNumber(rec.data.readUInt32LE(4 + k * 6 + 2)));
        }
      } else if (rec.id === 0x0006 && rec.data.length >= 14) {
        const r = rec.data.readUInt16LE(0);
        const c = rec.data.readUInt16LE(2);
        const isSpecial = rec.data.readUInt16LE(12) === 0xffff;
        if (isSpecial && rec.data[6] === 0) {
          lastFormulaPos = { r, c };
        } else if (!isSpecial) {
          putCell(r, c, rec.data.readDoubleLE(6));
          lastFormulaPos = null;
        }
      } else if (rec.id === 0x0207 && lastFormulaPos && rec.data.length >= 3) {
        putCell(lastFormulaPos.r, lastFormulaPos.c, readBiff8String([rec.data], { chunkIdx: 0, offset: 0 }));
        lastFormulaPos = null;
      } else {
        lastFormulaPos = null;
      }
    }

    const rowIndices = Array.from(rowsMap.keys()).sort((a, b) => a - b);
    const lines = [];
    for (const rIdx of rowIndices) {
      const colMap = rowsMap.get(rIdx);
      const maxCol = Math.min(Math.max(...colMap.keys()), 40);
      const lineCells = [];
      for (let c = 0; c <= maxCol; c += 1) {
        lineCells.push(colMap.get(c) || '');
      }
      if (lineCells.some(Boolean)) lines.push(lineCells.join(' | '));
    }
    if (lines.length > 0) {
      sheetBlocks.push(`SHEET: ${sheet.name}\n${lines.join('\n')}`);
    }
  }
  return sheetBlocks.join('\n\n').trim();
}

/** Parse SpreadsheetML 2003 XML (<Workbook> <Worksheet> <Row> <Cell> <Data>). */
function parseSpreadsheetMlXml(xml) {
  const blocks = [];
  const wsRegex = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet>/gi;
  let wsMatch;
  while ((wsMatch = wsRegex.exec(xml)) !== null) {
    const nameMatch = wsMatch[1].match(/\bss:Name="([^"]+)"/i);
    const sheetName = decodeXmlEntities(nameMatch ? nameMatch[1] : `Sheet${blocks.length + 1}`);
    const lines = [];
    const rowRegex = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(wsMatch[2])) !== null) {
      const cells = [];
      const dataRegex = /<Data\b[^>]*>([\s\S]*?)<\/Data>/gi;
      let dMatch;
      while ((dMatch = dataRegex.exec(rowMatch[1])) !== null) {
        cells.push(decodeXmlEntities(dMatch[1]).replace(/\s+/g, ' ').trim());
      }
      if (cells.some(Boolean)) lines.push(cells.join(' | '));
    }
    if (lines.length > 0) blocks.push(`SHEET: ${sheetName}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n').trim();
}

/** Flatten an HTML table string into pipe-delimited text without circular dependency. */
function flattenSimpleHtmlTables(html) {
  let text = html.replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  text = text.replace(/<tr\b[^>]*>([\s\S]*?)(?=<\/tr>|<tr\b|<\/table>|$)/gi, (_, rowBody) => {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|$)/gi;
    let m;
    while ((m = cellRegex.exec(rowBody)) !== null) {
      cells.push(decodeXmlEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    }
    return cells.some(Boolean) ? `\n${cells.join(' | ')}\n` : '';
  });
  return decodeXmlEntities(
    text.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract text from a legacy Excel .xls buffer (BIFF8 OLE2, SpreadsheetML XML, HTML table, or ZIP). */
function extractXlsText(buffer) {
  if (!buffer || buffer.length === 0) return '';
  if (isZipBuffer(buffer)) return extractXlsxText(buffer);

  if (isOle2Buffer(buffer)) {
    const streams = extractOle2Streams(buffer);
    const workbookStream = streams.get('Workbook') || streams.get('Book');
    if (workbookStream) {
      const parsed = parseBiff8Workbook(workbookStream);
      if (parsed) return parsed;
    }
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
  if (/<Workbook\b/i.test(head) || /urn:schemas-microsoft-com:office:spreadsheet/i.test(head)) {
    return parseSpreadsheetMlXml(buffer.toString('utf8'));
  }
  if (/<(?:html|table)\b/i.test(head)) {
    return flattenSimpleHtmlTables(buffer.toString('utf8'));
  }
  return '';
}

/** Strip RTF control words and groups into readable plain text with cell/row separators. */
function extractRtfText(rtfSource) {
  const skipDestinations = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'fldinst', 'header', 'footer',
    'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
  ]);
  const out = [];
  const stack = [];
  let skipDepth = null;
  let i = 0;

  while (i < rtfSource.length) {
    const ch = rtfSource[i];
    if (ch === '{') {
      stack.push(skipDepth);
      i += 1;
      continue;
    }
    if (ch === '}') {
      skipDepth = stack.length > 0 ? stack.pop() : null;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      const next = rtfSource[i + 1];
      if (!next) break;
      if (next === '*') {
        skipDepth = stack.length;
        i += 2;
        continue;
      }
      if (next === "'" && /^[0-9a-fA-F]{2}$/.test(rtfSource.slice(i + 2, i + 4))) {
        if (skipDepth === null) out.push(String.fromCharCode(parseInt(rtfSource.slice(i + 2, i + 4), 16)));
        i += 4;
        continue;
      }
      if ('\\{}'.includes(next)) {
        if (skipDepth === null) out.push(next);
        i += 2;
        continue;
      }
      if (next === '~') {
        if (skipDepth === null) out.push(' ');
        i += 2;
        continue;
      }
      const ctrlMatch = rtfSource.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (ctrlMatch) {
        const word = ctrlMatch[1].toLowerCase();
        const param = ctrlMatch[2];
        i += 1 + ctrlMatch[0].length;
        if (skipDestinations.has(word) && skipDepth === null) {
          skipDepth = stack.length;
        }
        if (skipDepth === null) {
          if (word === 'par' || word === 'line' || word === 'row') out.push('\n');
          else if (word === 'tab' || word === 'cell') out.push(' | ');
          else if (word === 'u' && param !== undefined) {
            const code = parseInt(param, 10);
            out.push(String.fromCharCode(code < 0 ? code + 65536 : code));
            if (rtfSource[i] === '?') i += 1;
          }
        }
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (skipDepth === null) out.push(ch);
    i += 1;
  }
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Scan printable ASCII or UTF-16LE character runs out of a raw Word stream. */
function scanOle2TextRuns(wordStream, { wide = false } = {}) {
  const step = wide ? 2 : 1;
  const runs = [];
  let cur = '';
  for (let i = 0; i + step - 1 < wordStream.length; i += step) {
    const lo = wordStream[i];
    const hi = wide ? wordStream[i + 1] : 0;
    if (hi === 0 && ((lo >= 0x20 && lo <= 0x7e) || lo === 0x09)) {
      cur += String.fromCharCode(lo);
    } else if (hi === 0 && (lo === 0x0d || lo === 0x0a || lo === 0x07)) {
      cur += lo === 0x07 ? ' | ' : '\n';
    } else {
      if (cur.trim().length >= 8 && /[a-zA-Z0-9]{2,}/.test(cur)) {
        runs.push(cur.trim());
      }
      cur = '';
    }
  }
  if (cur.trim().length >= 8) runs.push(cur.trim());
  return runs;
}

/** Extract printable ASCII and UTF-16LE text runs from a legacy OLE2 WordDocument stream. */
function extractOle2WordText(wordStream) {
  if (!wordStream || wordStream.length === 0) return '';

  if (wordStream.length >= 0x54) {
    const fcMin = wordStream.readUInt32LE(0x18);
    const ccpText = wordStream.readUInt32LE(0x4c);
    if (fcMin > 0 && fcMin < wordStream.length && ccpText > 0 && ccpText < 500000) {
      const candidateEnd = Math.min(wordStream.length, fcMin + ccpText);
      const ansiCandidate = wordStream.subarray(fcMin, candidateEnd).toString('latin1');
      const printableRatio = (ansiCandidate.match(/[\x20-\x7e\r\n\t\x07]/g) || []).length / Math.max(1, ansiCandidate.length);
      if (printableRatio >= 0.75) {
        const cleaned = ansiCandidate
          .replace(/\x07/g, ' | ')
          .replace(/\r/g, '\n')
          .replace(/[^\x20-\x7e\n]/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (cleaned.length >= 10) return cleaned;
      }
    }
  }

  const runs = [
    ...scanOle2TextRuns(wordStream, { wide: false }),
    ...scanOle2TextRuns(wordStream, { wide: true }),
  ];
  const unique = Array.from(new Set(runs.filter((r) => !/^(?:WordDocument|Root Entry|SummaryInformation|Microsoft Word)/i.test(r))));
  return unique.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Extract text from a legacy Word .doc buffer (OLE2 Word97-2003, RTF, ZIP/DOCX, Word XML, or HTML). */
function extractDocText(buffer) {
  if (!buffer || buffer.length === 0) return '';
  if (isZipBuffer(buffer)) return extractDocxText(buffer);

  if (isOle2Buffer(buffer)) {
    const streams = extractOle2Streams(buffer);
    const wordStream = streams.get('WordDocument');
    if (wordStream) return extractOle2WordText(wordStream);
  }

  const textHead = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').trimStart();
  if (/^\{\\rtf/i.test(textHead)) {
    return extractRtfText(buffer.toString('latin1'));
  }
  if (/<(?:html|table)\b/i.test(textHead)) {
    return flattenSimpleHtmlTables(buffer.toString('utf8'));
  }
  if (/<\?xml|<w:wordDocument/i.test(textHead)) {
    return parseDocxXml(buffer.toString('utf8'));
  }
  return '';
}

/** Extract plain text lines from PDF content streams (both uncompressed and zlib FlateDecode streams). */
function extractPdfTextFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const binary = buffer.toString('latin1');
  const lines = [];

  const decodePdfLiteral = (rawLiteral) =>
    rawLiteral
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, ' ');

  const decodePdfTextOperators = (streamText) => {
    const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|')/g;
    let m;
    while ((m = tjRegex.exec(streamText)) !== null) {
      const clean = decodePdfLiteral(m[1]).trim();
      if (clean) lines.push(clean);
    }

    const tjArrRegex = /\[(.*?)\]\s*TJ/g;
    while ((m = tjArrRegex.exec(streamText)) !== null) {
      const strMatches = m[1].match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
      if (strMatches) {
        const joined = strMatches
          .map((s) => decodePdfLiteral(s.slice(1, -1)))
          .join(' ')
          .trim();
        if (joined) lines.push(joined);
      }
    }
  };

  const streamMarker = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let sm;
  while ((sm = streamMarker.exec(binary)) !== null) {
    const rawStream = sm[1];
    if (rawStream.length > QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_PDF_STREAM_BYTES) continue;
    decodePdfTextOperators(rawStream);

    const streamBytes = Buffer.from(rawStream, 'latin1');
    for (const inflateFn of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        const out = inflateFn(streamBytes, { maxOutputLength: QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_UNCOMPRESSED_ENTRY_BYTES });
        if (out && out.length > 0) {
          decodePdfTextOperators(out.toString('latin1'));
          break;
        }
      } catch {
        // Ignore streams that use non-deflate filters (e.g. DCTDecode images)
      }
    }
    if (lines.length >= 600) break;
  }

  return Array.from(new Set(lines)).join('\n').trim();
}

/** Format CSV/TSV text cleanly with pipe-delimited columns for Gemini extraction. */
function normalizeDelimitedText(rawText, fileName) {
  const delimiter = /\.tsv$/i.test(fileName) ? '\t' : ',';
  const rows = [];
  for (const rawLine of String(rawText || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (delimiter === '\t') {
      rows.push(trimmed.split('\t').map((c) => c.trim()).join(' | '));
      continue;
    }
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (ch === '"') {
        if (inQuotes && trimmed[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return rows.length > 0 ? `SHEET: ${fileName}\n${rows.join('\n')}` : '';
}

/**
 * Extract readable text blocks and multimodal inline parts from inbound vendor quote attachments.
 * Supports PDF, Word (.doc, .docx, .docm), Excel (.xlsx, .xlsm, .xls), CSV/TSV, text, and images.
 *
 * @param {Array<object>} attachments
 * @returns {{ extractedText: string, inlineParts: Array<{mimeType: string, data: string, fileName: string}>, processedAttachments: Array<object>, skippedAttachments: Array<string> }}
 */
function extractVendorQuoteAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { extractedText: '', inlineParts: [], processedAttachments: [], skippedAttachments: [] };
  }

  const textSections = [];
  const inlineParts = [];
  const processedAttachments = [];
  const skippedAttachments = [];

  for (const attachment of attachments.slice(0, QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_ATTACHMENTS)) {
    if (!attachment || attachment.role === 'signature') continue;
    const { format, mimeType, fileName } = classifyQuoteAttachment(attachment);
    const buffer = toAttachmentBuffer(attachment.content);
    if (!buffer || buffer.length === 0) {
      skippedAttachments.push(fileName);
      continue;
    }

    let extracted = '';
    let sentInline = false;

    try {
      switch (format) {
        case QUOTE_FORMAT.PDF: {
          extracted = extractPdfTextFromBuffer(buffer);
          if (
            inlineParts.length < QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_INLINE_PARTS &&
            buffer.length <= GEMINI_CONFIG.MAX_DOCUMENT_BYTES
          ) {
            inlineParts.push({ mimeType: 'application/pdf', data: buffer.toString('base64'), fileName });
            sentInline = true;
          }
          break;
        }
        case QUOTE_FORMAT.DOCX:
          extracted = extractDocxText(buffer);
          break;
        case QUOTE_FORMAT.DOC:
          extracted = extractDocText(buffer);
          break;
        case QUOTE_FORMAT.XLSX:
          extracted = extractXlsxText(buffer);
          break;
        case QUOTE_FORMAT.XLS:
          extracted = extractXlsText(buffer);
          break;
        case QUOTE_FORMAT.CSV:
          extracted = normalizeDelimitedText(buffer.toString('utf8'), fileName);
          break;
        case QUOTE_FORMAT.TEXT:
          extracted = buffer.toString('utf8').trim();
          break;
        case QUOTE_FORMAT.IMAGE:
          if (
            inlineParts.length < QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_INLINE_PARTS &&
            buffer.length <= GEMINI_CONFIG.MAX_DOCUMENT_BYTES
          ) {
            inlineParts.push({ mimeType, data: buffer.toString('base64'), fileName });
            sentInline = true;
          }
          break;
        default:
          skippedAttachments.push(fileName);
          continue;
      }
    } catch (err) {
      logger.warn('Failed to parse vendor quotation attachment; skipping cleanly', {
        fileName,
        format,
        error: err.message,
      }, 'QUOTE_DOCUMENT_EXTRACTOR');
      skippedAttachments.push(fileName);
      continue;
    }

    const sanitizedText = extracted
      ? sanitizeTextForModel(extracted, QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_TEXT_CHARS).text.trim()
      : '';
    if (sanitizedText) {
      textSections.push(`ATTACHMENT (${format.toUpperCase()}): ${fileName}\n${sanitizedText}`);
    }
    if (sanitizedText || sentInline) {
      processedAttachments.push({
        fileName,
        format,
        mimeType,
        extractedChars: sanitizedText.length,
        sentInline,
      });
    } else {
      skippedAttachments.push(fileName);
    }
  }

  const combinedText = sanitizeTextForModel(
    textSections.join('\n\n'),
    QUOTE_DOCUMENT_EXTRACTOR_CONFIG.MAX_TEXT_CHARS
  ).text.trim();

  return {
    extractedText: combinedText,
    inlineParts,
    processedAttachments,
    skippedAttachments,
  };
}

module.exports = {
  QUOTE_FORMAT,
  classifyQuoteAttachment,
  toAttachmentBuffer,
  parseZipEntries,
  parseDocxXml,
  extractDocxText,
  extractDocText,
  extractXlsxText,
  extractXlsText,
  extractOle2Streams,
  extractPdfTextFromBuffer,
  extractRtfText,
  normalizeDelimitedText,
  extractVendorQuoteAttachments,
};
