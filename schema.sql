-- schema.sql — D1 Database schema, indices, and seed data for Midnight Stories

-- Drop existing tables if they exist
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS banned_identifiers;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS moderation_log;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS stories;
DROP TABLE IF EXISTS categories;

-- Create Tables
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  body TEXT NOT NULL,
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
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  UNIQUE(story_id, ip_hash)
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('story','comment')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reporter_ip_hash TEXT,
  resolved INTEGER DEFAULT 0,
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

-- Indices
CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_category ON stories(category_id);
CREATE INDEX idx_stories_created ON stories(created_at);
CREATE INDEX idx_comments_story ON comments(story_id);
CREATE INDEX idx_reports_resolved ON reports(resolved);
CREATE INDEX idx_banned_identifier ON banned_identifiers(identifier);

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

-- Seed Admin User (Username: admin, Password: Admin@2026!)
INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role) VALUES (
  'admin', 
  'admin@lifestories.com', 
  '$2a$12$mKISeXBNOlR6xmtCReTA1OFVqxc5DR8itya2Y7NjpHzHG1uqlqDTe', 
  'JBSWY3DPEHPK3PXP', 
  0, 
  'superadmin'
);

-- Seed Settings
INSERT INTO settings (key, value) VALUES ('rate_limit_posts_per_hour', '5');
INSERT INTO settings (key, value) VALUES ('rate_limit_comments_per_hour', '15');
INSERT INTO settings (key, value) VALUES ('auto_hide_report_threshold', '3');
INSERT INTO settings (key, value) VALUES ('require_manual_approval', 'false');
INSERT INTO settings (key, value) VALUES ('banned_keywords', '["kill yourself","kys","end it all"]');

-- Seed Sample Stories (Category IDs: Childhood = 1, Recovery = 4, Relationships = 5, Career/School = 6, Mental Health = 7)
INSERT INTO stories (id, title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (
  1,
  'The Day I Finally Let Go',
  'For years, I carried the weight of something that happened in my childhood. I never told anyone — not my closest friend, not my partner, nobody. I thought if I buried it deep enough, it would just dissolve. But it didn''t. It grew roots.\n\nOne ordinary Tuesday, sitting in traffic, I started crying. Not the quiet kind. The kind where your whole body shakes. And for the first time, I didn''t fight it. I let every wave crash.\n\nThat was three years ago. I''m not "fixed" — I don''t think that''s the right word. But I''m lighter. I started therapy. I started this slow, awkward process of talking about what happened. And you know what surprised me most? The world didn''t end when I said it out loud.\n\nIf you''re holding something that feels too heavy to share — I see you. You don''t have to carry it alone forever.',
  7,
  'approved',
  'd4b68e98-25fc-48bc-9f93-013de8f0b7e4',
  'seed-data',
  47,
  3
);

INSERT INTO comments (story_id, body, status, ip_hash) VALUES (1, 'This resonates so deeply. Thank you for sharing.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (1, 'I had my "Tuesday" moment last month. Sending you strength.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (1, 'The part about the world not ending — that hit me hard. Thank you.', 'approved', 'seed-data');

INSERT INTO stories (id, title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (
  2,
  'Growing Up in a House of Silence',
  'My parents never yelled. They never hit. From the outside, our house probably looked perfect. But inside, there was this suffocating silence. Nobody talked about feelings. Nobody asked if you were okay. If you cried, you were told to go to your room until you "calmed down."\n\nI learned to become invisible. I learned that needing help was weakness. I learned that love was something you earned by being quiet and easy.\n\nIt took me until my 30s to realize that emotional neglect is real, that what I experienced had a name, and that it explained so much — why I couldn''t ask for help, why I felt like a burden, why I apologized for existing.\n\nI''m unlearning now. It''s messy. Some days I still automatically go silent when I''m hurt. But I''m trying.',
  1,
  'approved',
  'f7b68e98-25fc-48bc-9f93-013de8f0b7e5',
  'seed-data',
  63,
  2
);

INSERT INTO comments (story_id, body, status, ip_hash) VALUES (2, 'I could have written this. The "apologizing for existing" part — exactly.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (2, 'Emotional neglect is so invisible. Thank you for giving it words.', 'approved', 'seed-data');

INSERT INTO stories (id, title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (
  3,
  'A Letter to My Younger Self',
  'Hey kid,\n\nI know right now everything feels impossible. I know you think you''re the only person in the world who feels this way. You''re not.\n\nI won''t spoil everything, but I want you to know: it gets different. Not perfect — different. You''ll find people who actually listen. You''ll discover that the thing you''re most ashamed of? Other people have been through it too. And they''ll look at you with understanding, not disgust.\n\nYou''ll learn that being vulnerable doesn''t make you weak. It makes you real. And real is something a lot of people in this world are hungry for.\n\nKeep going. Not because I can promise a fairy tale ending, but because the chapters ahead are worth reading.\n\nWith love,\nYou, twenty years from now',
  4,
  'approved',
  'a3b68e98-25fc-48bc-9f93-013de8f0b7e6',
  'seed-data',
  91,
  4
);

INSERT INTO comments (story_id, body, status, ip_hash) VALUES (3, 'I needed this today. More than you know.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (3, 'Writing letters to my younger self has been part of my therapy. It works.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (3, '"Real is something people are hungry for" — beautiful.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (3, 'Thank you. Just... thank you.', 'approved', 'seed-data');

INSERT INTO stories (id, title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (
  4,
  'The Weight of a Secret Marriage',
  'I married someone from a different cultural background, and we kept it secret from both our families for two years. Two years of lies, separate holidays, coded phone calls, and this constant low-level terror of being found out.\n\nWhen we finally told our families, the fallout was exactly what we feared. Some doors closed. Some relationships broke. My mother didn''t speak to me for six months.\n\nBut here''s the thing nobody tells you about choosing your own path: the relief is extraordinary. Not the absence of consequences — those are real and painful. But the relief of not performing a version of yourself anymore. Of not living inside a lie.\n\nWe''re four years in now. My mom came to dinner last month. It was awkward and imperfect. But it was real. And I''d choose real over easy every single time.',
  5,
  'approved',
  'b2b68e98-25fc-48bc-9f93-013de8f0b7e7',
  'seed-data',
  38,
  2
);

INSERT INTO comments (story_id, body, status, ip_hash) VALUES (4, 'Living authentically despite the cost — this takes real courage.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (4, 'I''m in a similar situation right now. This gives me hope.', 'approved', 'seed-data');

INSERT INTO stories (id, title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (
  5,
  'What Losing My Job Taught Me About Identity',
  'When I got laid off, people said things like "it''s just a job" and "something better will come along." They meant well. But they didn''t understand — it wasn''t just a job. It was who I was.\n\nI had built my entire identity around being productive, successful, needed. Without that title and that inbox full of urgent emails, I didn''t know who I was. Literally. I''d sit in coffee shops and think: who am I if I''m not useful?\n\nThe six months of unemployment that followed were some of the darkest of my life. But somewhere in that darkness, I found something I hadn''t expected: me. Not the LinkedIn version. Not the "what do you do?" party answer. Just me.\n\nI learned to cook. I spent time with my aging father. I read books that had nothing to do with self-improvement. I started volunteering at a food bank — not to put it on a resume, but because it felt right.\n\nI have a new job now. It''s fine. But I no longer let it be my whole identity. That''s the gift the worst year of my life gave me.',
  6,
  'approved',
  'c5b68e98-25fc-48bc-9f93-013de8f0b7e8',
  'seed-data',
  55,
  3
);

INSERT INTO comments (story_id, body, status, ip_hash) VALUES (5, 'The "who am I if I''m not useful" question — that''s the one that kept me up at night too.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (5, 'This is beautiful. Thank you for sharing your journey.', 'approved', 'seed-data');
INSERT INTO comments (story_id, body, status, ip_hash) VALUES (5, 'Going through this right now. Thank you for the reminder that it gets different.', 'approved', 'seed-data');
