-- schema.sql — Unified D1 Database Schema for Midnight Stories
PRAGMA foreign_keys = OFF;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS ticket_attachments;
DROP TABLE IF EXISTS ticket_audit_logs;
DROP TABLE IF EXISTS canned_responses;
DROP TABLE IF EXISTS ticket_categories;
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
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS moderation_log;
DROP TABLE IF EXISTS ticket_conversation_threads;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS stories;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS categories;

-- Create Tables
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
  channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'naval')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  channel_type TEXT DEFAULT 'education',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  ticket_id TEXT UNIQUE,
  subject TEXT,
  category_id INTEGER REFERENCES ticket_categories(id) ON DELETE SET NULL,
  reported_item_type TEXT DEFAULT 'support' CHECK(reported_item_type IN ('story','comment','user','support','billing','technical','account','feature_request')),
  reported_item_id INTEGER DEFAULT 0,
  reason TEXT NOT NULL,
  report_description TEXT,
  attachment_url TEXT,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  ticket_status TEXT DEFAULT 'open' CHECK(ticket_status IN ('open', 'investigating', 'waiting_on_user', 'resolved', 'closed')),
  reporter_ip_hash TEXT,
  reporter_id INTEGER REFERENCES users(id),
  assigned_agent_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_by INTEGER REFERENCES admin_users(id),
  resolved_at DATETIME,
  reopened_at DATETIME,
  enforcement_action TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_conversation_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL CHECK(sender_role IN ('admin', 'user')),
  is_internal_note INTEGER DEFAULT 0 CHECK(is_internal_note IN (0, 1)),
  message_body TEXT NOT NULL,
  attachment_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES ticket_conversation_threads(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'naval')),
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
  channel_type TEXT NOT NULL CHECK(channel_type IN ('education', 'naval')),
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

INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Naval History', 'naval-history', 'naval');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Maritime Engineering', 'maritime-engineering', 'naval');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Naval Tactics & Strategy', 'naval-tactics-strategy', 'naval');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Nautical Studies', 'nautical-studies', 'naval');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Ship Design & Architecture', 'ship-design-architecture', 'naval');
INSERT OR IGNORE INTO categories (name, slug, channel_type) VALUES ('Submarine Operations', 'submarine-operations', 'naval');

-- Seed Helpdesk Ticket Categories
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (1, 'Technical Issue', 'Bugs, platform errors, and reader mode glitches');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (2, 'Account & Security', 'Password resets, email updates, and MFA login issues');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (3, 'Billing & Subscriptions', 'Payment receipts, membership plans, and refund requests');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (4, 'Feature Request', 'Suggestions for new library tools and app improvements');
INSERT OR IGNORE INTO ticket_categories (id, name, description) VALUES (5, 'General Inquiry', 'Questions regarding content submission and publishing');

-- Seed Canned Responses
INSERT OR IGNORE INTO canned_responses (id, title, content, category_id) VALUES 
(1, 'Need More Information', 'Thank you for reaching out to Midnight Support. Could you please provide additional details or a screenshot of the issue so we can investigate further?', 1),
(2, 'Issue Under Investigation', 'Hello! We have received your ticket and our engineering team is actively investigating this issue. We will update you as soon as a fix is deployed.', 1),
(3, 'Password Reset Instructions', 'Hello, to reset your account password, please go to the Login page, click "Forgot Password", and follow the verification link sent to your registered email.', 2),
(4, 'Ticket Resolved Confirmation', 'We are pleased to inform you that your request has been successfully resolved. If you require further assistance, you may reopen this ticket within 7 days.', 5);

PRAGMA foreign_keys = ON;
