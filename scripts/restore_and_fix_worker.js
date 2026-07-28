// Restore worker.js from git and apply only the safe targeted fixes
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = 'D:\\My Applications\\Midnigth stories';
const workerPath = path.join(cwd, 'src', 'worker.js');

// Step 1: Get the last committed version of worker.js
console.log('📦 Fetching last committed worker.js from git HEAD...');
let original;
try {
  original = execSync('git show HEAD:src/worker.js', { cwd, maxBuffer: 50 * 1024 * 1024 }).toString();
  console.log(`✅ Got ${original.length} chars from git HEAD`);
} catch (e) {
  console.error('❌ git show failed:', e.message);
  process.exit(1);
}

// Step 2: The only change we need to apply is:
// Close the settings route and remove the orphan block.
// The orphan is between the settings route closing and app.patch('/api/admin/tickets/:id/assign'
// In the ORIGINAL file (from git), the settings route is NOT closed with });
// So we need to:
//   a) Add }); after the try/catch that ends with return c.json({})
//   b) Remove the dangling orphan block (which starts with an empty CRLF line and if (search))

// Find the settings route area
const settingsRouteEnd = "    return c.json({});\n  }\n";
const patchRoute = "app.patch('/api/admin/tickets/:id/assign'";

const settingsIdx = original.indexOf(settingsRouteEnd);
const patchIdx = original.indexOf(patchRoute);

console.log(`Settings route end at: ${settingsIdx}`);
console.log(`Patch route at: ${patchIdx}`);

if (settingsIdx === -1 || patchIdx === -1) {
  console.log('Using CRLF variants...');
}

// Try CRLF variant
const settingsRouteEndCRLF = "    return c.json({});\r\n  }\r\n";
const settingsIdxCRLF = original.indexOf(settingsRouteEndCRLF);
const patchIdxCRLF = original.indexOf(patchRoute);

const si = settingsIdx !== -1 ? settingsIdx : settingsIdxCRLF;
const pi = patchIdxCRLF;

if (si === -1 || pi === -1) {
  console.error('❌ Could not find markers. Writing original as-is (no patch applied).');
  fs.writeFileSync(workerPath, original, 'utf8');
  console.log('✅ Restored original from git (umodified). Check manually.');
  process.exit(0);
}

// The "end of settings route" is after the closing }
// We need to insert }); and then skip to app.patch
const endOfSettingsTryCatch = si + settingsRouteEnd.length;

// Everything before end of settings try/catch
const before = original.slice(0, endOfSettingsTryCatch);
// The closing }); for the route handler
const routeClose = '});\n\n';
// Everything from the patch route onward
const after = original.slice(pi);

const fixed = before + routeClose + after;
fs.writeFileSync(workerPath, fixed, 'utf8');
console.log(`✅ Restored from git and applied targeted fix. New size: ${fixed.length} chars`);
console.log('🚀 Now run: npx wrangler deploy');
