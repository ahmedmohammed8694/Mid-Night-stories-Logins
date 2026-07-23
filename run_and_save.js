const fs = require('fs');
const path = require('path');

const scratchDir = path.join(__dirname, 'scratch');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

// Redirect console.log to buffer
let logs = [];
const originalLog = console.log;
console.log = function(...args) {
  logs.push(args.join(' '));
  originalLog.apply(console, args);
};

try {
  require('./test_seo_verification.js');
} catch (e) {
  console.log('Error running verification:', e.message);
}

try {
  require('./generate_excel.js');
  console.log('Successfully regenerated SEO report Updated.xlsx');
} catch (e) {
  console.log('Error generating excel:', e.message);
}

fs.writeFileSync(path.join(scratchDir, 'verification_results.txt'), logs.join('\n'), 'utf8');
