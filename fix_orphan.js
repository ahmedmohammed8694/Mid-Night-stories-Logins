const fs = require('fs');
const path = 'D:\\My Applications\\Midnigth stories\\src\\worker.js';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
console.log('Total lines before:', lines.Count || lines.length);

// Lines to remove are 3003..3038 (1-indexed), which is index 3002..3037 (0-indexed)
const before = lines.slice(0, 3002);   // lines 1..3002 (includes the newly added });)
const after  = lines.slice(3038);       // lines 3039 onwards (starts at app.patch...)

const newContent = [...before, ...after].join('\n');
fs.writeFileSync(path, newContent, 'utf8');
console.log('Done. New total lines:', [...before, ...after].length);
