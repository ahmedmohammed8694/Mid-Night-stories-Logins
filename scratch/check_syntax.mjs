import fs from 'fs';

const code = fs.readFileSync('src/worker.js', 'utf8');

console.log('Total file lines:', code.split('\n').length);

// Let's check for any template literal backticks count or unmatched quotes
let backticks = (code.match(/`/g) || []).length;
console.log('Backticks count:', backticks, '(Is even:', backticks % 2 === 0, ')');

// Check line 500 to 540 where we recently edited
const lines = code.split('\n');
console.log('Lines 515-545 snippet:');
for (let i = 515; i < 545; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
