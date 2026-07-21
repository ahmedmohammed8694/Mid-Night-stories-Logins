const fs = require('fs');
const { execSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

console.log("Generating initial admin credentials...");

// Generate a secure hash for the default password
const passwordHash = bcrypt.hashSync('Admin@2026!', 12);
const mfaSecret = authenticator.generateSecret();

// Prepare the SQL insert statement
const sql = `
INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
VALUES ('admin', 'admin@lifestories.com', '${passwordHash}', '${mfaSecret}', 0, 'superadmin');
`;

// Write the SQL to a temporary file
const sqlFilePath = 'scratch/insert_admin.sql';
fs.writeFileSync(sqlFilePath, sql.trim());

console.log("SQL script created. Pushing to Cloudflare D1 Remote Database...");

try {
  // Execute the wrangler command to apply the SQL to the remote database
  execSync('npx wrangler d1 execute midnight-stories-login-db --remote --file=scratch/insert_admin.sql', { stdio: 'inherit' });
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          ADMIN ACCOUNT CREATED                       ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Username : admin                                    ║');
  console.log('║  Password : Admin@2026!                              ║');
  console.log(`║  MFA Secret: ${mfaSecret.padEnd(23)} ║`);
  console.log('║  (Save this secret if you plan to enable MFA!)       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('You can now log in at https://admin.midnightstories.dpdns.org/');
} catch (error) {
  console.error("Failed to execute wrangler command. Make sure you are logged in to Cloudflare.");
}
