const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');

// Find everything inside <main class="admin-main">
const mainMatch = html.match(/<main[^>]*class="admin-main"[^>]*>([\s\S]*?)<\/main>/i);
if (!mainMatch) {
  console.log('Could not find <main class="admin-main">');
  process.exit(1);
}

const mainContent = mainMatch[1];

// Find all top-level IDs or class names inside main
const tags = [];
const regex = /<([a-z0-9]+)[^>]*?(?:id="([^"]+)"|class="([^"]+)"|style="([^"]+)")*[^>]*>/gi;
let match;

// Simple regex to find elements at top level of main
const topLevelRegex = /<([a-z0-9]+)\s+[^>]*id="([^"]+)"[^>]*>/gi;
while ((match = topLevelRegex.exec(mainContent)) !== null) {
  console.log(`Found element with id="${match[2]}", tag="${match[1]}"`);
}
