const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'worker.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add import after moderation.js import
if (!code.includes("from './permissions.js';")) {
  code = code.replace(
    "from './moderation.js';",
    "from './moderation.js';\nimport { getEffectivePermissions, writeAuditLog } from './permissions.js';"
  );
}

// 2. Remove dynamic import of ./permissions.js
code = code.replace(
  "  const { getEffectivePermissions } = await import('./permissions.js');\n",
  ""
);

// 3. Replace permission_overrides with employee_permission_overrides
code = code.replace(/permission_overrides/g, 'employee_permission_overrides');

fs.writeFileSync(filePath, code, 'utf8');
console.log('Successfully updated src/worker.js');
