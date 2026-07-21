const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

const passwordHash = bcrypt.hashSync('Admin@2026!', 12);
const mfaSecret = authenticator.generateSecret();

const sql = `INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role) VALUES ('admin', 'admin@lifestories.com', '${passwordHash}', '${mfaSecret}', 0, 'superadmin');`;

console.log(sql);
console.log(`-- MFA Secret: ${mfaSecret}`);
