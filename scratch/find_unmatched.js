const fs = require('fs');

const lines = fs.readFileSync('src/worker.js', 'utf8').split('\n');

let stack = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Simple check for braces and parens ignoring strings for quick scan
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '{' || char === '(' || char === '[') {
      stack.push({ char, line: i + 1, col: j + 1, text: line.trim().slice(0, 40) });
    } else if (char === '}' || char === ')' || char === ']') {
      if (stack.length === 0) {
        console.log(`Unmatched closing '${char}' at line ${i + 1}:${j + 1}`);
      } else {
        const top = stack[stack.length - 1];
        if (
          (char === '}' && top.char === '{') ||
          (char === ')' && top.char === '(') ||
          (char === ']' && top.char === '[')
        ) {
          stack.pop();
        } else {
          console.log(`Mismatched '${char}' at line ${i + 1}:${j + 1}, expected closing for '${top.char}' from line ${top.line}`);
        }
      }
    }
  }
}

console.log('Unclosed items remaining at EOF:', stack.length);
if (stack.length > 0) {
  console.log('Last unclosed items:');
  stack.slice(-10).forEach(item => {
    console.log(`  Line ${item.line}:${item.col} '${item.char}' in: ${item.text}`);
  });
}
