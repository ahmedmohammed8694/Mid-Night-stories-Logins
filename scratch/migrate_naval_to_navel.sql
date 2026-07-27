-- Migration: Rename 'naval' to 'navel' in CHECK constraints
-- SQLite D1 compatible approach: recreate tables with updated constraints

PRAGMA foreign_keys = OFF;

-- ─────────────────────────────────────────────
-- 1. Migrate: categories
-- ─────────────────────────────────────────────
ALTER TABLE categories RENAME TO _categories_old;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'navel')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (id, name, slug, channel_type, parent_id, created_at)
SELECT id, name, slug,
  CASE WHEN channel_type = 'naval' THEN 'navel' ELSE channel_type END,
  parent_id, created_at
FROM _categories_old;

DROP TABLE _categories_old;

-- ─────────────────────────────────────────────
-- 2. Migrate: books
-- ─────────────────────────────────────────────
ALTER TABLE books RENAME TO _books_old;

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

INSERT INTO books (id, title, author, description, publisher, language, isbn, published_date, page_count, est_read_minutes, cover_image_url, file_url, file_type, status, visibility, uploaded_by, approved_by, channel_type, uploaded_by_user_id, is_user_submission, submission_status, created_at, updated_at)
SELECT id, title, author, description, publisher, language, isbn, published_date, page_count, est_read_minutes, cover_image_url, file_url, file_type, status, visibility, uploaded_by, approved_by,
  CASE WHEN channel_type = 'naval' THEN 'navel' ELSE channel_type END,
  uploaded_by_user_id, is_user_submission, submission_status, created_at, updated_at
FROM _books_old;

DROP TABLE _books_old;

-- ─────────────────────────────────────────────
-- 3. Migrate: user_book_submissions
-- ─────────────────────────────────────────────
ALTER TABLE user_book_submissions RENAME TO _user_book_submissions_old;

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

INSERT INTO user_book_submissions (id, user_id, title, author, channel_type, category_id, description, cover_image_url, book_file_url, status, rejection_reason, created_at)
SELECT id, user_id, title, author,
  CASE WHEN channel_type = 'naval' THEN 'navel' ELSE channel_type END,
  category_id, description, cover_image_url, book_file_url, status, rejection_reason, created_at
FROM _user_book_submissions_old;

DROP TABLE _user_book_submissions_old;

PRAGMA foreign_keys = ON;
