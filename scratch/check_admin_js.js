const fs = require('fs');
const code = fs.readFileSync('public/js/admin.js', 'utf8');

try {
  new Function(code);
  console.log("SUCCESS: admin.js has valid syntax!");
} catch (err) {
  console.error("SYNTAX ERROR in admin.js:", err);
}
