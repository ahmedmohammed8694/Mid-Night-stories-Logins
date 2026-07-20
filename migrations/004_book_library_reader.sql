-- migrations/004_book_library_reader.sql
-- Additive migration for Book Library & Reader Mode

-- 1. Alter categories table to support parent_id (hierarchical categories)
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

-- 2. Create books table
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

-- 3. Create book_categories many-to-many junction table
CREATE TABLE IF NOT EXISTS book_categories (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

-- 4. Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

-- 5. Create book_tags many-to-many junction table
CREATE TABLE IF NOT EXISTS book_tags (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

-- 6. Create reading_progress table
CREATE TABLE IF NOT EXISTS reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT, -- EPUB CFI or PDF page/scroll offset
  percent_complete REAL DEFAULT 0,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, book_id)
);

-- 7. Create bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_cfi TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Create highlights table
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

-- 9. Create user_library table
CREATE TABLE IF NOT EXISTS user_library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  shelf_status TEXT NOT NULL CHECK(shelf_status IN ('want_to_read', 'currently_reading', 'finished')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, book_id)
);

-- Indices for faster querying
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
