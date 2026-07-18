
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT UNIQUE,
  reported_item_type TEXT NOT NULL CHECK(reported_item_type IN ('story','comment','user')),
  reported_item_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  report_description TEXT,
  attachment_url TEXT,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
  ticket_status TEXT DEFAULT 'open' CHECK(ticket_status IN ('open', 'investigating', 'waiting_on_user', 'resolved', 'closed')),
  reporter_ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reporter_id INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES admin_users(id),
  resolved_at DATETIME,
  enforcement_action TEXT
);

INSERT INTO reports_new (id, reported_item_type, reported_item_id, reason, reporter_ip_hash, created_at, reporter_id, resolved_by, resolved_at, enforcement_action, ticket_status)
SELECT id, target_type, target_id, reason, reporter_ip_hash, created_at, reporter_id, resolved_by, resolved_at, enforcement_action, CASE WHEN resolved = 1 THEN 'resolved' ELSE 'open' END FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

CREATE TABLE ticket_conversation_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL CHECK(sender_role IN ('admin', 'user')),
  message_body TEXT NOT NULL,
  attachment_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
