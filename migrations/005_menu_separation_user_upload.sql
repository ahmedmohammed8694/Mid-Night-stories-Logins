-- migrations/005_menu_separation_user_upload.sql — Migration to add strict category separation, uploader association, and upload queue

-- 1. Alter categories table to track channel type
ALTER TABLE categories ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'naval'));

-- 2. Alter books table to track channel type, uploader, user submission flag, and submission status
ALTER TABLE books ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'education' CHECK(channel_type IN ('education', 'naval'));
ALTER TABLE books ADD COLUMN uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE books ADD COLUMN is_user_submission INTEGER DEFAULT 0 CHECK(is_user_submission IN (0, 1));
ALTER TABLE books ADD COLUMN submission_status TEXT DEFAULT 'approved' CHECK(submission_status IN ('pending', 'approved', 'rejected'));

-- 3. Create user book submissions queue table
CREATE TABLE IF NOT EXISTS user_book_submissions (
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
