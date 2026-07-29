// Clears wrangler's asset upload cache so the next deploy re-uploads ALL files
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stateDirs = [
  path.join(root, '.wrangler', 'state'),
  path.join(root, '.wrangler', 'tmp'),
];

let cleared = false;
for (const dir of stateDirs) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('🗑️  Cleared:', dir);
    cleared = true;
  }
}
if (!cleared) console.log('ℹ️  No wrangler state dirs found');
console.log('✅ Done — now run: npx wrangler deploy');
