-- Add account_status and dm_permission to users
ALTER TABLE users ADD COLUMN account_status TEXT DEFAULT 'active' CHECK(account_status IN ('active','suspended','banned','shadowbanned'));
ALTER TABLE users ADD COLUMN dm_permission TEXT DEFAULT 'full' CHECK(dm_permission IN ('full','text_only','suspended'));

-- User warnings table
CREATE TABLE IF NOT EXISTS user_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  level TEXT NOT NULL CHECK(level IN ('first_warning','second_warning','final_notice')),
  template TEXT NOT NULL,
  reason TEXT NOT NULL,
  rule_broken TEXT,
  penalties TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Enhance reports table
ALTER TABLE reports ADD COLUMN reporter_id INTEGER REFERENCES users(id);
ALTER TABLE reports ADD COLUMN admin_reply TEXT;
ALTER TABLE reports ADD COLUMN resolved_by INTEGER REFERENCES admin_users(id);
ALTER TABLE reports ADD COLUMN resolved_at DATETIME;
ALTER TABLE reports ADD COLUMN enforcement_action TEXT;
