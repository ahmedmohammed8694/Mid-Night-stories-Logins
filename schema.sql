-- schema.sql — Unified D1 Database Schema for Midnight Stories
PRAGMA foreign_keys = OFF;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS ticket_attachments;
DROP TABLE IF EXISTS ticket_messages;
DROP TABLE IF EXISTS employee_permission_overrides;
DROP TABLE IF EXISTS employee_users;
DROP TABLE IF EXISTS team_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS team_category_assignments;
DROP TABLE IF EXISTS account_subcategory_access;
DROP TABLE IF EXISTS account_category_access;
DROP TABLE IF EXISTS ticket_subcategories;
DROP TABLE IF EXISTS ticket_custom_fields;
DROP TABLE IF EXISTS ticket_ratings;
DROP TABLE IF EXISTS ticket_audit_logs;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS canned_responses;
DROP TABLE IF EXISTS ticket_categories;
DROP TABLE IF EXISTS sla_rules;
DROP TABLE IF EXISTS admin_messages;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_participants;
DROP TABLE IF EXISTS chat_rooms;
DROP TABLE IF EXISTS reads;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS user_book_submissions;
DROP TABLE IF EXISTS user_library;
DROP TABLE IF EXISTS highlights;
DROP TABLE IF EXISTS bookmarks;
DROP TABLE IF EXISTS reading_progress;
DROP TABLE IF EXISTS book_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS book_categories;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS banned_identifiers;
DROP TABLE IF EXISTS user_warnings;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS accounts;

-- Create Tables

-- sla_rules and accounts/teams must come before ticket_categories/subcategories
CREATE TABLE sla_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority TEXT NOT NULL UNIQUE CHECK(priority IN ('urgent', 'high', 'medium', 'low')),
  frt_hours REAL NOT NULL,
  ttr_hours REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  domain     TEXT UNIQUE,
  status     TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id TEXT,
  dob TEXT,
  phone_number TEXT,
  bio TEXT,
  profile_pic TEXT,
  privacy_settings TEXT DEFAULT '{"show_phone":false,"show_email":false}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account_status TEXT DEFAULT 'active' CHECK(account_status IN ('active','suspended','banned','shadowbanned')),
  dm_permission TEXT DEFAULT 'full' CHECK(dm_permission IN ('full','text_only','suspended')),
  interaction_permissions TEXT DEFAULT '{"like":true, "comment":true, "follow":true, "block":true}'
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'navel')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_categories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  is_global        INTEGER DEFAULT 1,
  default_sla_id   INTEGER REFERENCES sla_rules(id) ON DELETE SET NULL,
  default_priority TEXT DEFAULT 'medium' CHECK(default_priority IN ('low','medium','high','urgent')),
  default_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status           TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_subcategories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id      INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  default_sla_id   INTEGER REFERENCES sla_rules(id) ON DELETE SET NULL,
  default_priority TEXT CHECK(default_priority IN ('low','medium','high','urgent')),
  default_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status           TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT,
  content TEXT NOT NULL,
  category_id INTEGER,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),
  submitter_token TEXT NOT NULL,
  ip_hash TEXT,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  UNIQUE(story_id, user_id)
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ticket_id TEXT UNIQUE,
  subject TEXT,
  category_id INTEGER REFERENCES ticket_categories(id) ON DELETE SET NULL,
  subcategory_id INTEGER REFERENCES ticket_subcategories(id) ON DELETE SET NULL,
  reported_item_type TEXT DEFAULT 'support' CHECK(reported_item_type IN ('story','comment','user','support','billing','technical','account','feature_request')),
  reported_item_id INTEGER DEFAULT 0,
  reason TEXT,
  report_description TEXT,
  attachment_url TEXT,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  ticket_status TEXT DEFAULT 'open' CHECK(ticket_status IN ('open', 'investigating', 'waiting_on_user', 'resolved', 'closed')),
  assigned_agent_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_by INTEGER REFERENCES admin_users(id),
  resolved_at DATETIME,
  reopened_at DATETIME,
  enforcement_action TEXT,
  reference_number TEXT,
  custom_fields_json TEXT,
  sla_due_at TEXT,
  frt_due_at TEXT,
  can_reopen INTEGER DEFAULT 1,
  type TEXT DEFAULT 'support_ticket',
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_unread_count INTEGER DEFAULT 0,
  agent_unread_count INTEGER DEFAULT 0,
  latest_message_preview TEXT,
  reporter_ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_id INTEGER,
  sender_role TEXT DEFAULT 'user' CHECK(sender_role IN ('user', 'admin', 'system')),
  is_internal INTEGER DEFAULT 0,
  message_body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_attachments (
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

CREATE TABLE ticket_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES ticket_categories(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK(field_type IN ('text', 'number', 'select', 'textarea', 'url')),
  options_json TEXT,
  is_required INTEGER DEFAULT 0,
  placeholder TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id)
);

CREATE TABLE canned_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category_id INTEGER REFERENCES ticket_categories(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('admin', 'user', 'system')),
  action_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  mfa_secret TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  role TEXT DEFAULT 'admin' CHECK(role IN ('admin','superadmin')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
VALUES ('admin', 'admin@midnightstories.com', '$2a$10$Zu8oMzAP3uh0WqtOWQzexeox2bs6BO60iQWO/FBlOOT.l.YCXuqI6', 'JBSWY3DPEHPK3PXP', 0, 'superadmin');

CREATE TABLE user_warnings (
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

CREATE TABLE banned_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'ip' CHECK(type IN ('ip','fingerprint')),
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT,
  publisher TEXT,
  language TEXT DEFAULT 'en',
  isbn TEXT,
  published_date TEXT,
  page_count INTEGER,
  est_read_minutes INTEGER,
  cover_image_url TEXT,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK(file_type IN ('epub', 'pdf')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived', 'pending')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'restricted')),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'navel')),
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_user_submission INTEGER DEFAULT 0 CHECK(is_user_submission IN (0, 1)),
  submission_status TEXT DEFAULT 'approved' CHECK(submission_status IN ('pending', 'approved', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE book_categories (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE book_tags (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT,
  percent_complete REAL DEFAULT 0,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi_start TEXT NOT NULL,
  location_cfi_end TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  note_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  shelf_status TEXT NOT NULL CHECK(shelf_status IN ('want_to_read', 'currently_reading', 'finished')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE user_book_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK(channel_type IN ('education', 'navel')),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  description TEXT,
  cover_image_url TEXT,
  book_file_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, following_id)
);

CREATE TABLE reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, story_id)
);

CREATE TABLE chat_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id, user_id)
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source_id INTEGER,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed Categories
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Childhood', 'childhood', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Family', 'family', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Loss & Grief', 'loss-grief', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Recovery', 'recovery', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Relationships', 'relationships', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Career & School', 'career-school', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Mental Health', 'mental-health', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Identity', 'identity', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Triumph', 'triumph', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('LGBTQ+', 'lgbtq', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Other', 'other', 'education');

-- Seed new book-related categories
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Fiction', 'fiction', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Non-Fiction', 'non-fiction', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Sci-Fi', 'sci-fi', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Romance', 'romance', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Self-Help', 'self-help', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Biography', 'biography', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Academic', 'academic', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Children', 'children', 'education');

-- Seed Educational & Naval separation categories
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Computer Science', 'computer-science', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Engineering', 'engineering', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Mathematics', 'mathematics', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Competitive Exams', 'competitive-exams', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('General Science', 'general-science', 'education');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Academic References', 'academic-references', 'education');

INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Navel History', 'navel-history', 'navel');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Maritime Engineering', 'maritime-engineering', 'navel');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Navel Tactics & Strategy', 'navel-tactics-strategy', 'navel');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Nautical Studies', 'nautical-studies', 'navel');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Ship Design & Architecture', 'ship-design-architecture', 'navel');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Submarine Operations', 'submarine-operations', 'navel');

-- Seed Helpdesk Ticket Categories
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (1, '📖 Story & Content Moderation', 'Copyright, plagiarism, inappropriate content, and story/comment reports');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (2, '📚 Book Library & Reader Mode', 'EPUB/PDF rendering bugs, missing pages, corrupt files, and audiobook errors');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (3, '👤 Account & Access', 'Password resets, email verification, profile updates, and suspension appeals');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (4, '💳 Billing & Subscriptions', 'Payment failures, receipts, premium upgrades, and refund inquiries');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (5, '🛠️ Platform & Technical Bugs', 'App crashes, slow performance, bookmark sync issues, and broken links');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (6, '💡 Feature Requests & Feedback', 'Reader UI suggestions, author tools, and publishing partnerships');

-- Seed Subcategories
INSERT OR IGNORE INTO ticket_subcategories (id, category_id, name, description) VALUES
(1, 1, 'Story Report / Takedown', 'Report infringing, plagiarized, or inappropriate story content'),
(2, 1, 'Comment Report / Spam', 'Report offensive, harassing, or spam comments'),
(3, 2, 'EPUB / PDF Reader Bug', 'Fix file formatting, rendering, or page flip glitches'),
(4, 2, 'Corrupt File / Upload Error', 'Report unreadable or corrupted book downloads'),
(5, 3, 'Login / Password Reset', 'Assistance with locked or unaccessible accounts'),
(6, 3, 'Suspension Appeal', 'Appeal an account suspension or interaction restriction'),
(7, 4, 'Failed Payment / Renewal', 'Help with declined card transactions or billing retries'),
(8, 4, 'Refund Request', 'Request invoice receipt or subscription refund'),
(9, 5, 'Reader Sync / Crash Bug', 'Technical bug report for bookmark sync or application crash'),
(10, 6, 'New Reader Feature Idea', 'Suggestions for reader UI and community experience');

-- Seed Default SLA Rules (in Hours)
INSERT OR IGNORE INTO sla_rules (id, priority, frt_hours, ttr_hours) VALUES
(1, 'urgent', 1.0, 4.0),
(2, 'high', 4.0, 12.0),
(3, 'medium', 12.0, 24.0),
(4, 'low', 24.0, 72.0);

-- ============================================================
-- ADMIN-SPECIFIC TABLES (RBAC, Employee Provisioning, Access Control)
-- ============================================================

-- Account ↔ Category access (non-global categories)
CREATE TABLE account_category_access (
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, category_id)
);

-- Account ↔ Subcategory access (optional per-account override)
CREATE TABLE account_subcategory_access (
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subcategory_id INTEGER NOT NULL REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
  enabled        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, subcategory_id)
);

-- Team ↔ Category routing assignments
CREATE TABLE team_category_assignments (
  team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, category_id, subcategory_id)
);

-- Permissions
CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  module      TEXT NOT NULL,
  description TEXT
);

-- Roles
CREATE TABLE roles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  scope      TEXT DEFAULT 'account' CHECK(scope IN ('global','account','team')),
  is_system  INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Role ↔ Permissions
CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  PRIMARY KEY (role_id, permission_id)
);

-- Team ↔ Roles (roles approved for a team)
CREATE TABLE team_roles (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_default INTEGER DEFAULT 0,
  PRIMARY KEY (team_id, role_id)
);

-- Employee users (provisioned staff)
CREATE TABLE employee_users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  team_id           INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  role_id           INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  full_name         TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  phone             TEXT,
  password_hash     TEXT,
  invite_token      TEXT UNIQUE,
  invite_expires    DATETIME,
  employment_status TEXT DEFAULT 'pending_invite' CHECK(employment_status IN ('active','suspended','deactivated','pending_invite')),
  last_login_at     DATETIME,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Employee permission overrides (exceptional, audited)
CREATE TABLE employee_permission_overrides (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employee_users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  reason        TEXT NOT NULL,
  granted_by    INTEGER NOT NULL REFERENCES employee_users(id),
  expires_at    DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, permission_id)
);

-- Immutable audit log for all access-sensitive actions
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,
  actor_type  TEXT NOT NULL CHECK(actor_type IN ('employee','admin','system')),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  old_value   TEXT,
  new_value   TEXT,
  ip_hash     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed ticket_categories with new columns
UPDATE ticket_categories SET is_global = 1, status = 'active' WHERE status IS NULL;

-- Seed Permissions
INSERT OR IGNORE INTO permissions (code, module, description) VALUES
  ('ticket.view',       'tickets',  'View tickets'),
  ('ticket.assign',     'tickets',  'Assign tickets to agents'),
  ('ticket.reply',      'tickets',  'Reply to tickets'),
  ('ticket.resolve',    'tickets',  'Mark tickets as resolved'),
  ('ticket.reopen',     'tickets',  'Reopen closed tickets'),
  ('ticket.delete',     'tickets',  'Delete tickets'),
  ('category.create',   'taxonomy', 'Create ticket categories'),
  ('category.edit',     'taxonomy', 'Edit ticket categories'),
  ('category.archive',  'taxonomy', 'Archive ticket categories'),
  ('category.delete',   'taxonomy', 'Delete ticket categories'),
  ('account.view',      'accounts', 'View account settings'),
  ('account.manage',    'accounts', 'Manage account settings'),
  ('user.create',       'users',    'Create users'),
  ('user.deactivate',   'users',    'Deactivate users'),
  ('user.manage_roles', 'users',    'Manage user roles'),
  ('report.view',       'reports',  'View analytics reports'),
  ('report.export',     'reports',  'Export analytics reports');

-- Seed default roles
INSERT OR IGNORE INTO roles (name, scope, is_system, status) VALUES
  ('Super Admin', 'global',  1, 'active'),
  ('Admin',       'account', 1, 'active'),
  ('Agent',       'team',    1, 'active'),
  ('Viewer',      'team',    1, 'active');

-- Agent: ticket.view + ticket.reply + ticket.resolve + ticket.reopen
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow' FROM roles r, permissions p
WHERE r.name = 'Agent' AND p.code IN ('ticket.view','ticket.reply','ticket.resolve','ticket.reopen');

-- Admin: all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow' FROM roles r, permissions p WHERE r.name = 'Admin';

-- Super Admin: all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow' FROM roles r, permissions p WHERE r.name = 'Super Admin';

-- Seed Canned Responses
INSERT OR IGNORE INTO canned_responses (id, title, content, category_id) VALUES 
(1, 'Need More Information', 'Thank you for reaching out to Midnight Support. Could you please provide additional details or a screenshot of the issue so we can investigate further?', 1),
(2, 'Issue Under Investigation', 'Hello! We have received your ticket and our engineering team is actively investigating this issue. We will update you as soon as a fix is deployed.', 1),
(3, 'Password Reset Instructions', 'Hello, to reset your account password, please go to the Login page, click "Forgot Password", and follow the verification link sent to your registered email.', 3),
(4, 'Content Takedown Actioned', 'Thank you for your report. Our moderation team has reviewed the flagged story/comment and taken appropriate enforcement action.', 1),
(5, 'Ticket Resolved Confirmation', 'We are pleased to inform you that your request has been successfully resolved. If you require further assistance, you may reopen this ticket within 7 days.', 5);

PRAGMA foreign_keys = ON;
