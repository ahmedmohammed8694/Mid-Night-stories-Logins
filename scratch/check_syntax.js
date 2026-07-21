const fs = require('fs');
const vm = require('vm');

function checkFile(path) {
  try {
    const code = fs.readFileSync(path, 'utf8');
    new vm.Script(code);
    console.log(path + " parsed successfully!");
  } catch (e) {
    console.log("Error in " + path + ": " + e.message);
  }
}

checkFile('public/js/app.js');
checkFile('public/js/admin.js');
checkFile('admin/public/js/admin.js');
