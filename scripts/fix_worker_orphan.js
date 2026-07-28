// Fixes the orphaned CRLF block in src/worker.js between the settings route and app.patch
const fs = require('fs');
const file = 'src/worker.js';
let src = fs.readFileSync(file, 'utf8');

// The orphan starts right after the blank LF line following });\n
// Marker: the first CRLF line after the settings route close
// We find the exact boundary using unique text in the orphan
const ORPHAN_MARKER = '    if (search) {';
const NEXT_ROUTE    = "app.patch('/api/admin/tickets/:id/assign'";

const a = src.indexOf(ORPHAN_MARKER);
const b = src.indexOf(NEXT_ROUTE);

if (a === -1 || b === -1 || a >= b) {
  console.error('❌ Markers not found or in wrong order. a=' + a + ' b=' + b);
  process.exit(1);
}

// Keep everything before the orphan, skip the orphan, keep from next route onward
src = src.slice(0, a) + src.slice(b);

fs.writeFileSync(file, src, 'utf8');
console.log('✅ Orphan block removed (' + (b - a) + ' chars deleted). Ready to deploy.');
