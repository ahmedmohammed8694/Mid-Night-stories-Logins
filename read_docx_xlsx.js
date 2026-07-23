const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Simple PK zip parser in pure JS
function readZipEntries(buffer) {
  const entries = {};
  let offset = 0;

  while (offset < buffer.length - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // Local file header signature

    const flags = buffer.readUInt16LE(offset + 6);
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);

    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;

    if (compressedSize > 0 && dataStart + compressedSize <= buffer.length) {
      const compData = buffer.slice(dataStart, dataStart + compressedSize);
      let data;
      if (compression === 8) { // Deflate
        try {
          data = zlib.inflateRawSync(compData);
        } catch (e) {
          try { data = zlib.inflateSync(compData); } catch (e2) {}
        }
      } else if (compression === 0) { // Store
        data = compData;
      }
      if (data) {
        entries[name] = data.toString('utf8');
      }
    }

    offset = dataStart + (compressedSize || uncompressedSize);
    // Find next header
    while (offset < buffer.length - 4 && buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
    }
  }
  return entries;
}

console.log("Reading DOCX...");
try {
  const docxBuf = fs.readFileSync('Midnight_Stories_Website_Audit_Remediation_Plan.docx');
  const docxEntries = readZipEntries(docxBuf);
  if (docxEntries['word/document.xml']) {
    const text = docxEntries['word/document.xml'].replace(/<[^>]+>/g, ' ');
    console.log("DOCX Content Preview:\n", text.replace(/\s+/g, ' ').substring(0, 3000));
  }
} catch (e) {
  console.error("DOCX error:", e.message);
}

console.log("\nReading XLSX...");
try {
  const xlsxBuf = fs.readFileSync('SEO report Updated.xlsx');
  const xlsxEntries = readZipEntries(xlsxBuf);
  console.log("XLSX Entry Keys:", Object.keys(xlsxEntries).filter(k => k.startsWith('xl/')));
  
  if (xlsxEntries['xl/sharedStrings.xml']) {
    const strings = xlsxEntries['xl/sharedStrings.xml'].replace(/<[^>]+>/g, '\n').split('\n').filter(s => s.trim());
    console.log("XLSX Shared Strings (First 50):", strings.slice(0, 50));
  }
} catch (e) {
  console.error("XLSX error:", e.message);
}
