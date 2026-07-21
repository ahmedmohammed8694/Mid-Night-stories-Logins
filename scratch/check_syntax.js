const fs = require('fs');
const vm = require('vm');

function checkSyntax(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.compileFunction(code);
    console.log(`✅ Syntax OK: ${filePath}`);
  } catch (err) {
    console.error(`❌ Syntax Error in ${filePath}:`, err.message);
  }
}

checkSyntax('public/js/admin.js');
checkSyntax('admin/public/js/admin.js');
checkSyntax('public/js/app.js');
