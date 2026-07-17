// database.js — SQLite database initialization, schema, and seed data
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.VERCEL
  ? '/tmp/stories.db'
  : path.join(__dirname, 'data', 'stories.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    if (!process.env.VERCEL) {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  // ── Create Tables ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stories (
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

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),
      ip_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      UNIQUE(story_id, ip_hash)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('story','comment')),
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reporter_ip_hash TEXT,
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS moderation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      admin_id INTEGER,
      action TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      mfa_secret TEXT,
      mfa_enabled INTEGER DEFAULT 0,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS banned_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'ip' CHECK(type IN ('ip','fingerprint')),
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
    CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category_id);
    CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);
    CREATE INDEX IF NOT EXISTS idx_reports_resolved ON reports(resolved);
    CREATE INDEX IF NOT EXISTS idx_banned_identifier ON banned_identifiers(identifier);
  `);

  // ── Seed Categories ──
  const defaultCategories = [
    { name: 'Childhood', slug: 'childhood' },
    { name: 'Family', slug: 'family' },
    { name: 'Loss & Grief', slug: 'loss-grief' },
    { name: 'Recovery', slug: 'recovery' },
    { name: 'Relationships', slug: 'relationships' },
    { name: 'Career & School', slug: 'career-school' },
    { name: 'Mental Health', slug: 'mental-health' },
    { name: 'Identity', slug: 'identity' },
    { name: 'Triumph', slug: 'triumph' },
    { name: 'LGBTQ+', slug: 'lgbtq' },
    { name: 'Other', slug: 'other' }
  ];


  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)'
  );
  for (const cat of defaultCategories) {
    insertCategory.run(cat.name, cat.slug);
  }

  // ── Seed Admin User ──
  const existingAdmin = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync('Admin@2026!', 12);
    const mfaSecret = authenticator.generateSecret();
    db.prepare(
      'INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('admin', 'admin@lifestories.com', passwordHash, mfaSecret, 0, 'superadmin');
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║          ADMIN ACCOUNT CREATED                       ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log('║  Username : admin                                    ║');
    console.log('║  Password : Admin@2026!                              ║');
    console.log(`║  MFA Secret: ${mfaSecret}              ║`);
    console.log('║  (Use this secret in Google Authenticator)           ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
  }

  // ── Seed Sample Stories ──
  const storyCount = db.prepare('SELECT COUNT(*) as count FROM stories').get().count;
  if (storyCount === 0) {
    const insertStory = db.prepare(
      'INSERT INTO stories (title, body, category_id, status, submitter_token, ip_hash, like_count, comment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertComment = db.prepare(
      'INSERT INTO comments (story_id, body, status, ip_hash) VALUES (?, ?, ?, ?)'
    );

    const sampleStories = [
      {
        title: 'The Day I Finally Let Go',
        body: "For years, I carried the weight of something that happened in my childhood. I never told anyone — not my closest friend, not my partner, nobody. I thought if I buried it deep enough, it would just dissolve. But it didn't. It grew roots.\n\nOne ordinary Tuesday, sitting in traffic, I started crying. Not the quiet kind. The kind where your whole body shakes. And for the first time, I didn't fight it. I let every wave crash.\n\nThat was three years ago. I'm not \"fixed\" — I don't think that's the right word. But I'm lighter. I started therapy. I started this slow, awkward process of talking about what happened. And you know what surprised me most? The world didn't end when I said it out loud.\n\nIf you're holding something that feels too heavy to share — I see you. You don't have to carry it alone forever.",
        category_slug: 'mental-health',
        likes: 47,
        comments: [
          'This resonates so deeply. Thank you for sharing.',
          'I had my "Tuesday" moment last month. Sending you strength.',
          'The part about the world not ending — that hit me hard. Thank you.'
        ]
      },
      {
        title: 'Growing Up in a House of Silence',
        body: "My parents never yelled. They never hit. From the outside, our house probably looked perfect. But inside, there was this suffocating silence. Nobody talked about feelings. Nobody asked if you were okay. If you cried, you were told to go to your room until you \"calmed down.\"\n\nI learned to become invisible. I learned that needing help was weakness. I learned that love was something you earned by being quiet and easy.\n\nIt took me until my 30s to realize that emotional neglect is real, that what I experienced had a name, and that it explained so much — why I couldn't ask for help, why I felt like a burden, why I apologized for existing.\n\nI'm unlearning now. It's messy. Some days I still automatically go silent when I'm hurt. But I'm trying.",
        category_slug: 'childhood',
        likes: 63,
        comments: [
          'I could have written this. The \"apologizing for existing\" part — exactly.',
          'Emotional neglect is so invisible. Thank you for giving it words.',
        ]
      },
      {
        title: 'A Letter to My Younger Self',
        body: "Hey kid,\n\nI know right now everything feels impossible. I know you think you're the only person in the world who feels this way. You're not.\n\nI won't spoil everything, but I want you to know: it gets different. Not perfect — different. You'll find people who actually listen. You'll discover that the thing you're most ashamed of? Other people have been through it too. And they'll look at you with understanding, not disgust.\n\nYou'll learn that being vulnerable doesn't make you weak. It makes you real. And real is something a lot of people in this world are hungry for.\n\nKeep going. Not because I can promise a fairy tale ending, but because the chapters ahead are worth reading.\n\nWith love,\nYou, twenty years from now",
        category_slug: 'recovery',
        likes: 91,
        comments: [
          'I needed this today. More than you know.',
          'Writing letters to my younger self has been part of my therapy. It works.',
          '"Real is something people are hungry for" — beautiful.',
          'Thank you. Just... thank you.'
        ]
      },
      {
        title: 'The Weight of a Secret Marriage',
        body: "I married someone from a different cultural background, and we kept it secret from both our families for two years. Two years of lies, separate holidays, coded phone calls, and this constant low-level terror of being found out.\n\nWhen we finally told our families, the fallout was exactly what we feared. Some doors closed. Some relationships broke. My mother didn't speak to me for six months.\n\nBut here's the thing nobody tells you about choosing your own path: the relief is extraordinary. Not the absence of consequences — those are real and painful. But the relief of not performing a version of yourself anymore. Of not living inside a lie.\n\nWe're four years in now. My mom came to dinner last month. It was awkward and imperfect. But it was real. And I'd choose real over easy every single time.",
        category_slug: 'relationships',
        likes: 38,
        comments: [
          'Living authentically despite the cost — this takes real courage.',
          'I\'m in a similar situation right now. This gives me hope.'
        ]
      },
      {
        title: 'What Losing My Job Taught Me About Identity',
        body: "When I got laid off, people said things like \"it's just a job\" and \"something better will come along.\" They meant well. But they didn't understand — it wasn't just a job. It was who I was.\n\nI had built my entire identity around being productive, successful, needed. Without that title and that inbox full of urgent emails, I didn't know who I was. Literally. I'd sit in coffee shops and think: who am I if I'm not useful?\n\nThe six months of unemployment that followed were some of the darkest of my life. But somewhere in that darkness, I found something I hadn't expected: me. Not the LinkedIn version. Not the \"what do you do?\" party answer. Just me.\n\nI learned to cook. I spent time with my aging father. I read books that had nothing to do with self-improvement. I started volunteering at a food bank — not to put it on a resume, but because it felt right.\n\nI have a new job now. It's fine. But I no longer let it be my whole identity. That's the gift the worst year of my life gave me.",
        category_slug: 'career-school',
        likes: 55,
        comments: [
          'The \"who am I if I\'m not useful\" question — that\'s the one that kept me up at night too.',
          'This is beautiful. Thank you for sharing your journey.',
          'Going through this right now. Thank you for the reminder that it gets different.'
        ]
      }
    ];

    for (const story of sampleStories) {
      const category = db.prepare('SELECT id FROM categories WHERE slug = ?').get(story.category_slug);
      const token = uuidv4();
      const result = insertStory.run(
        story.title,
        story.body,
        category ? category.id : null,
        'approved',
        token,
        'seed-data',
        story.likes,
        story.comments.length
      );
      for (const comment of story.comments) {
        insertComment.run(result.lastInsertRowid, comment, 'approved', 'seed-data');
      }
    }

    console.log(`Seeded ${sampleStories.length} sample stories with comments.`);
  }

  // ── Seed Default Settings ──
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('rate_limit_posts_per_hour', '5');
  insertSetting.run('rate_limit_comments_per_hour', '15');
  insertSetting.run('auto_hide_report_threshold', '3');
  insertSetting.run('require_manual_approval', 'true');
  insertSetting.run('banned_keywords', JSON.stringify([
    'kill yourself', 'kys', 'end it all'
  ]));

  return db;
}

module.exports = { getDb, initializeDatabase };
