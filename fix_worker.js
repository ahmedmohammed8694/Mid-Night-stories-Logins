const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'worker.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

console.log(`Total lines: ${lines.length}`);

// Find the start of orphaned block: first line after line 2119 (0-indexed: 2119) 
// that is NOT the closing of the support-agents route
// The orphaned block starts at line 2121 (1-indexed) = index 2120 (0-indexed)
// It ends just before "// ── Audit Log ──" 

// Find the line index of "// ── Audit Log ──"
let auditLogIdx = -1;
for (let i = 2100; i < lines.length; i++) {
  if (lines[i].includes('// ── Audit Log ──') || lines[i].includes('Audit Log')) {
    auditLogIdx = i;
    console.log(`Found Audit Log at line ${i + 1}: ${lines[i]}`);
    break;
  }
}

if (auditLogIdx === -1) {
  console.error('Could not find Audit Log anchor');
  process.exit(1);
}

// The orphaned block ends at auditLogIdx - 1
// The orphaned block starts at 2120 (0-indexed) which is line 2121 (1-indexed)
const orphanStart = 2120; // 0-indexed
const orphanEnd = auditLogIdx - 1; // exclusive

console.log(`Removing lines ${orphanStart + 1} to ${orphanEnd + 1} (0-indexed: ${orphanStart} to ${orphanEnd})`);
console.log(`Start line content: ${lines[orphanStart]}`);
console.log(`End line content: ${lines[orphanEnd]}`);

// Remove the orphaned lines
const cleanedLines = [...lines.slice(0, orphanStart), ...lines.slice(auditLogIdx)];

console.log(`New total lines: ${cleanedLines.length}`);

fs.writeFileSync(filePath, cleanedLines.join('\n'), 'utf8');
console.log('Done! worker.js has been cleaned.');
