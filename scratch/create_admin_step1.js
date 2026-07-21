/**
 * create_admin_step1.js
 * Step 1: Generates the SQL with a bcrypt hash and writes it to scratch/insert_admin.sql
 * Run with: node scratch/create_admin_step1.js
 * Then follow the instructions printed at the end.
 */

const fs   = require('fs');
const path = require('path');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch {
  console.error('\n❌ Cannot find bcryptjs. Run this first:\n   npm install\n');
  process.exit(1);
}

const USERNAME = 'admin';
const PASSWORD = 'Admin@2026!';
const EMAIL    = 'admin@midnightstories.com';
const ROLE     = 'superadmin';

console.log('⏳ Generating bcrypt hash (this takes ~3 seconds)...');
const hash = bcrypt.hashSync(PASSWORD, 10);
console.log('✅ Hash generated.');

// Use a fixed dummy MFA secret; user can enable MFA later from the dashboard
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';

const sql = [
  `DELETE FROM admin_users WHERE username = '${USERNAME}';`,
  `INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)`,
  `VALUES ('${USERNAME}', '${EMAIL}', '${hash}', '${MFA_SECRET}', 0, '${ROLE}');`
].join('\n');

const outFile = path.join(__dirname, 'insert_admin.sql');
fs.writeFileSync(outFile, sql);

console.log('\n✅ SQL file written to: scratch/insert_admin.sql');
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('▶  Now run this command to push to the live database:');
console.log('');
console.log('   npx wrangler d1 execute midnight-stories-login-db --remote --file=scratch/insert_admin.sql');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n  Username : ${USERNAME}`);
console.log(`  Password : ${PASSWORD}`);
console.log('\n  Login at: https://midnightstories.dpdns.org/admin.html\n');
