const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Pure JS ZIP Reader
function readZipEntries(buffer) {
  const entries = {};
  let offset = 0;

  while (offset < buffer.length - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

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
      if (compression === 8) {
        try { data = zlib.inflateRawSync(compData); } catch (e) {
          try { data = zlib.inflateSync(compData); } catch (e2) {}
        }
      } else if (compression === 0) {
        data = compData;
      }
      if (data) {
        entries[name] = data.toString('utf8');
      }
    }

    offset = dataStart + (compressedSize || uncompressedSize);
    while (offset < buffer.length - 4 && buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
    }
  }
  return entries;
}

try {
  const excelPath = path.join(__dirname, 'SEO Files', 'issues_overview_report.xlsx');
  const xlsxBuf = fs.readFileSync(excelPath);
  const entries = readZipEntries(xlsxBuf);

  // 1. Parse Shared Strings
  const sharedStrings = [];
  const ssXml = entries['xl/sharedStrings.xml'];
  if (ssXml) {
    const regex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let match;
    while ((match = regex.exec(ssXml)) !== null) {
      sharedStrings.push(match[1]);
    }
  }

  // 2. Parse Sheet dynamically
  const sheetKey = Object.keys(entries).find(k => k.startsWith('xl/worksheets/'));
  if (!sheetKey) {
    console.error("No worksheet xml found in zip! Available files:", Object.keys(entries));
    process.exit(1);
  }
  const sheetXml = entries[sheetKey];

  // Find all rows
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const rowNum = parseInt(rowMatch[0].match(/r="(\d+)"/)[1]);
    const rowCells = {};
    
    // Regex for both string and numeric/inline cells
    const cellParser = /<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]+)<\/v>)?/g;
    let cellMatch;
    while ((cellMatch = cellParser.exec(rowContent)) !== null) {
      const colLetter = cellMatch[1];
      const attrs = cellMatch[2];
      const val = cellMatch[3];
      
      let finalVal = "";
      if (val !== undefined) {
        if (attrs.includes('t="s"')) {
          const strIdx = parseInt(val);
          finalVal = sharedStrings[strIdx] || "";
        } else {
          finalVal = val;
        }
      }
      rowCells[colLetter] = finalVal;
    }
    rows.push({ rowNum, cells: rowCells });
  }

  // Build Markdown report
  let md = "# Screaming Frog Excel Audit — Full Issue Details\n\n";
  
  md += "| Issue Name | Issue Type | Priority | URLs | % of Total | Description | How To Fix | Help URL |\n";
  md += "|---|---|---|---|---|---|---|---|\n";

  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].cells;
    const name = c['A'] || "";
    const type = c['B'] || "";
    const priority = c['C'] || "";
    const urls = c['D'] || "";
    const pct = c['E'] || "";
    const desc = c['F'] || "";
    const fix = c['G'] || "";
    const help = c['H'] || "N/A";

    md += `| **${name}** | ${type} | ${priority} | ${urls} | ${pct}% | ${desc} | ${fix} | ${help} |\n`;
  }

  fs.writeFileSync(path.join(__dirname, 'SEO Files', 'excel_issues_dump.md'), md);
  console.log("SUCCESS: Generated excel_issues_dump.md");
} catch (e) {
  console.error("Error parsing Excel:", e);
}
