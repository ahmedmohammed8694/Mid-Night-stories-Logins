/**
 * create_admin.js
 * Creates the admin user in the remote Cloudflare D1 database.
 * Run with: node scratch/create_admin.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let bcrypt, authenticator;

// Load bcryptjs
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  console.error('ERROR: bcryptjs not found. Run: npm install');
  process.exit(1);
}

// Load otplib
try {
  const otplib = require('otplib');
  authenticator = otplib.authenticator;
} catch (e) {
  console.error('ERROR: otplib not found. Run: npm install');
  process.exit(1);
}

const USERNAME  = 'admin';
const PASSWORD  = 'Admin@2026!';
const EMAIL     = 'admin@midnightstories.com';
const ROLE      = 'superadmin';

console.log('Generating bcrypt hash (this takes a few seconds)...');
const passwordHash = bcrypt.hashSync(PASSWORD, 10);
const mfaSecret    = authenticator.generateSecret();

// DELETE any existing admin with same username first, then INSERT fresh.
const sql = `
DELETE FROM admin_users WHERE username = '${USERNAME}';
INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
VALUES ('${USERNAME}', '${EMAIL}', '${passwordHash}', '${mfaSecret}', 0, '${ROLE}');
`.trim();

const sqlFile = path.join('scratch', 'insert_admin.sql');
fs.writeFileSync(sqlFile, sql);
console.log(`SQL written to ${sqlFile}`);

console.log('Running wrangler to insert into remote D1 database...\n');

try {
  execSync(
    `npx wrangler d1 execute midnight-stories-login-db --remote --file="${sqlFile}"`,
    { stdio: 'inherit', cwd: path.resolve(__dirname, '..') }
  );

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         ADMIN ACCOUNT CREATED SUCCESSFULLY      ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Username : ${USERNAME.padEnd(36)}║`);
  console.log(`║  Password : ${PASSWORD.padEnd(36)}║`);
  console.log(`║  MFA      : DISABLED (enable from dashboard)    ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nLogin at: https://midnightstories.dpdns.org/admin.html\n');
} catch (err) {
  console.error('\n--- WRANGLER ERROR ---');
  console.error(err.message || err);
  console.error('\nTroubleshooting:');
  console.error('1. Make sure you are logged in: npx wrangler login');
  console.error('2. Check your wrangler.toml has the correct database name: midnight-stories-login-db');
  console.error(`3. Try running manually:\n   npx wrangler d1 execute midnight-stories-login-db --remote --file="${sqlFile}"`);
}
