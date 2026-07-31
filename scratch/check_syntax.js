const fs = require('fs');
const acorn = require('acorn');

const code = fs.readFileSync('src/worker.js', 'utf8');

try {
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  console.log('✅ SYNTAX OK! worker.js parsed successfully with 0 errors.');
} catch (err) {
  console.error('❌ SYNTAX ERROR:', err.message, 'at line', err.loc ? err.loc.line : 'unknown', 'col', err.loc ? err.loc.column : '');
}
