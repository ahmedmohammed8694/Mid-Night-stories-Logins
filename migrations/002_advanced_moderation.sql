CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, ip_address TEXT, user_agent TEXT, status TEXT CHECK(status IN ('success', 'failed')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admin_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, admin_id INTEGER NOT NULL REFERENCES admin_users(id), title TEXT, body TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN visit_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN interaction_permissions TEXT DEFAULT '{"like":true, "comment":true, "follow":true, "block":true}';
