DELETE FROM admin_users WHERE username = 'admin';
INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
VALUES ('admin', 'admin@midnightstories.com', '$2a$10$Zu8oMzAP3uh0WqtOWQzexeox2bs6BO60iQWO/FBlOOT.l.YCXuqI6', 'JBSWY3DPEHPK3PXP', 0, 'superadmin');