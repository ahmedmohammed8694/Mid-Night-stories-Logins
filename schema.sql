-- schema.sql — D1 Database schema for Midnight Stories

-- Drop existing tables if they exist
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS banned_identifiers;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS moderation_log;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS reads;
DROP TABLE IF EXISTS follows;
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
  dm_permission TEXT DEFAULT 'full' CHECK(dm_permission IN ('full','text_only','suspended'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
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
  likes_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, story_id)
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

CREATE TABLE reports (
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

CREATE TABLE ticket_conversation_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL CHECK(sender_role IN ('admin', 'user')),
  message_body TEXT NOT NULL,
  attachment_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  admin_id INTEGER,
  action TEXT NOT NULL,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  mfa_secret TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  role TEXT DEFAULT 'admin',
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

-- Indices
CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_category ON stories(category_id);
CREATE INDEX idx_stories_created ON stories(created_at);
CREATE INDEX idx_comments_story ON comments(story_id);
CREATE INDEX idx_reports_resolved ON reports(resolved);
CREATE INDEX idx_banned_identifier ON banned_identifiers(identifier);
CREATE UNIQUE INDEX idx_users_user_id ON users(user_id);

-- Seed Categories
INSERT INTO categories (name, slug) VALUES ('Childhood', 'childhood');
INSERT INTO categories (name, slug) VALUES ('Family', 'family');
INSERT INTO categories (name, slug) VALUES ('Loss & Grief', 'loss-grief');
INSERT INTO categories (name, slug) VALUES ('Recovery', 'recovery');
INSERT INTO categories (name, slug) VALUES ('Relationships', 'relationships');
INSERT INTO categories (name, slug) VALUES ('Career & School', 'career-school');
INSERT INTO categories (name, slug) VALUES ('Mental Health', 'mental-health');
INSERT INTO categories (name, slug) VALUES ('Identity', 'identity');
INSERT INTO categories (name, slug) VALUES ('Triumph', 'triumph');
INSERT INTO categories (name, slug) VALUES ('LGBTQ+', 'lgbtq');
INSERT INTO categories (name, slug) VALUES ('Other', 'other');

-- Seed Settings
INSERT INTO settings (key, value) VALUES ('rate_limit_posts_per_hour', '5');
INSERT INTO settings (key, value) VALUES ('rate_limit_comments_per_hour', '15');
INSERT INTO settings (key, value) VALUES ('auto_hide_report_threshold', '3');
INSERT INTO settings (key, value) VALUES ('require_manual_approval', 'false');
INSERT INTO settings (key, value) VALUES ('banned_keywords', '["kill yourself","kys","end it all"]');

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_one_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_two_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
  last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_one_id, user_two_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('like', 'comment', 'follow', 'chat_request', 'chat_accepted', 'chat_declined', 'chat_message')),
  target_id INTEGER,
  content TEXT,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ── Book Library & Reader Mode Tables (Additive) ──
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS books (
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS book_categories (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT,
  percent_complete REAL DEFAULT 0,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi_start TEXT NOT NULL,
  location_cfi_end TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  note_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  shelf_status TEXT NOT NULL CHECK(shelf_status IN ('want_to_read', 'currently_reading', 'finished')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_user_library_user ON user_library(user_id);

-- Seed new book-related categories
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Fiction', 'fiction');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Non-Fiction', 'non-fiction');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Sci-Fi', 'sci-fi');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Romance', 'romance');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Self-Help', 'self-help');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Biography', 'biography');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Academic', 'academic');
INSERT OR IGNORE INTO categories (name, slug) VALUES ('Children', 'children');
