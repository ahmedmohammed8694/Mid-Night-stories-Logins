// Run this with: node scripts/fix_worker_orphan.js
const fs = require('fs');
const filePath = require('path').join(__dirname, '..', 'src', 'worker.js');

const raw = fs.readFileSync(filePath, 'utf8');

// The orphaned block starts right after `});\n\n` that closes the settings route
// and ends right before `app.patch('/api/admin/tickets/:id/assign'`
// We identify the orphan by the unique comment inside it
const ORPHAN_START_MARKER = '    if (search) {';
const ORPHAN_END_MARKER = "app.patch('/api/admin/tickets/:id/assign'";

const startIdx = raw.indexOf(ORPHAN_START_MARKER);
const endIdx = raw.indexOf(ORPHAN_END_MARKER);

if (startIdx === -1 || endIdx === -1) {
  console.log('Orphan block not found — file may already be clean!');
  console.log('startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(0);
}

// Remove everything from start of orphan to just before app.patch
const before = raw.slice(0, startIdx);
const after = raw.slice(endIdx);

// Clean up any trailing whitespace/blank lines before the patch route
const cleaned = before.trimEnd() + '\n\n' + after;

fs.writeFileSync(filePath, cleaned, 'utf8');
console.log('✅ Orphan block removed successfully!');
console.log('  Removed characters:', endIdx - startIdx);
