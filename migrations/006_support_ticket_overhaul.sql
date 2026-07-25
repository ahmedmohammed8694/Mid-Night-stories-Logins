-- 006_support_ticket_overhaul.sql — Modernized & Unified Helpdesk Ticket Schema

-- 1. Ensure new columns on reports table
ALTER TABLE reports ADD COLUMN reference_number TEXT;
ALTER TABLE reports ADD COLUMN last_activity_at DATETIME;
ALTER TABLE reports ADD COLUMN user_unread_count INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN agent_unread_count INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN latest_message_preview TEXT;
ALTER TABLE reports ADD COLUMN custom_fields_json TEXT;
ALTER TABLE reports ADD COLUMN sla_due_at TEXT;
ALTER TABLE reports ADD COLUMN frt_due_at TEXT;
ALTER TABLE reports ADD COLUMN can_reopen INTEGER DEFAULT 1;
ALTER TABLE reports ADD COLUMN type TEXT DEFAULT 'support_ticket';

-- Backfill initial last_activity_at from created_at
UPDATE reports SET last_activity_at = created_at WHERE last_activity_at IS NULL;

-- 2. Create canonical ticket_messages table if not exists
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_id INTEGER,
  sender_role TEXT DEFAULT 'user' CHECK(sender_role IN ('user', 'admin', 'system')),
  is_internal INTEGER DEFAULT 0,
  message_body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Migrate legacy rows from ticket_conversation_threads into ticket_messages if needed
INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
SELECT report_id, sender_id, sender_role, COALESCE(is_internal_note, 0), message_body, created_at
FROM ticket_conversation_threads
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = ticket_conversation_threads.report_id AND tm.created_at = ticket_conversation_threads.created_at AND tm.message_body = ticket_conversation_threads.message_body
);

-- 3. Create/recreate ticket_attachments referencing ticket & message
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES ticket_messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create performance & search indexes
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_ticket_id ON reports(ticket_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(ticket_status);
CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category_id);
CREATE INDEX IF NOT EXISTS idx_reports_last_activity ON reports(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_message_id ON ticket_attachments(message_id);
