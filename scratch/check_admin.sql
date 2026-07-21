-- Check if admin_users table exists and show all rows (passwords hidden)
SELECT id, username, email, role, mfa_enabled, created_at,
       CASE WHEN password_hash IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_password
FROM admin_users;
