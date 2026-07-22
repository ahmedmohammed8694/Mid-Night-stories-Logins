const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const dbPath = path.join(__dirname, '..', 'data', 'stories.db');
const sqlPath = path.join(__dirname, 'seed_stories_to_d1.sql');

console.log('Opening local SQLite database:', dbPath);

try {
  const db = new Database(dbPath);

  // 1. Get stories
  const stories = db.prepare('SELECT * FROM stories').all();
  console.log(`Read ${stories.length} stories from local DB.`);

  // 2. Get comments
  const comments = db.prepare('SELECT * FROM comments').all();
  console.log(`Read ${comments.length} comments from local DB.`);

  // 3. Get likes
  const likes = db.prepare('SELECT * FROM likes').all();
  console.log(`Read ${likes.length} likes from local DB.`);

  // 4. Get users (if any)
  const users = db.prepare('SELECT * FROM users').all();
  console.log(`Read ${users.length} users from local DB.`);

  const sqlLines = [];
  sqlLines.push('-- seed_stories_to_d1.sql');
  sqlLines.push('PRAGMA foreign_keys = OFF;');
  sqlLines.push('');
  sqlLines.push('DELETE FROM likes;');
  sqlLines.push('DELETE FROM comments;');
  sqlLines.push('DELETE FROM stories;');
  sqlLines.push('DELETE FROM users;');
  sqlLines.push('');

  // Helper to escape strings
  function esc(val) {
    if (val === null || val === undefined) return 'NULL';
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  // Generate users inserts
  for (const u of users) {
    sqlLines.push(
      `INSERT OR IGNORE INTO users (id, user_id, full_name, email, password_hash, google_id, dob, phone_number, bio, profile_pic, privacy_settings, created_at, updated_at, account_status, dm_permission) ` +
      `VALUES (${u.id}, ${esc(u.user_id)}, ${esc(u.full_name)}, ${esc(u.email)}, ${esc(u.password_hash)}, ${esc(u.google_id)}, ${esc(u.dob)}, ${esc(u.phone_number)}, ${esc(u.bio)}, ${esc(u.profile_pic)}, ${esc(u.privacy_settings)}, ${esc(u.created_at)}, ${esc(u.updated_at)}, ${esc(u.account_status)}, ${esc(u.dm_permission)});`
    );
  }

  // Generate stories inserts (map 'body' to 'content')
  for (const s of stories) {
    sqlLines.push(
      `INSERT OR IGNORE INTO stories (id, user_id, title, content, category_id, image_url, status, submitter_token, ip_hash, like_count, comment_count, created_at, updated_at) ` +
      `VALUES (${s.id}, ${s.user_id ? s.user_id : 'NULL'}, ${esc(s.title)}, ${esc(s.body)}, ${s.category_id ? s.category_id : 'NULL'}, ${esc(s.image_url)}, ${esc(s.status)}, ${esc(s.submitter_token)}, ${esc(s.ip_hash)}, ${s.like_count || 0}, ${s.comment_count || 0}, ${esc(s.created_at)}, ${esc(s.updated_at)});`
    );
  }

  // Generate comments inserts (map 'body' to 'content')
  for (const c of comments) {
    sqlLines.push(
      `INSERT OR IGNORE INTO comments (id, story_id, user_id, content, status, ip_hash, created_at) ` +
      `VALUES (${c.id}, ${c.story_id}, ${c.user_id ? c.user_id : 'NULL'}, ${esc(c.body)}, ${esc(c.status)}, ${esc(c.ip_hash)}, ${esc(c.created_at)});`
    );
  }

  // Generate likes inserts
  for (const l of likes) {
    sqlLines.push(
      `INSERT OR IGNORE INTO likes (id, story_id, user_id, ip_hash, created_at) ` +
      `VALUES (${l.id}, ${l.story_id}, ${l.user_id ? l.user_id : 'NULL'}, ${esc(l.ip_hash)}, ${esc(l.created_at)});`
    );
  }

  sqlLines.push('');
  sqlLines.push('PRAGMA foreign_keys = ON;');

  fs.writeFileSync(sqlPath, sqlLines.join('\n'), 'utf-8');
  console.log(`\nGenerated SQL script at ${sqlPath}`);

  db.close();

  // Exec wrangler local and remote
  console.log('\nApplying SQL script to LOCAL Wrangler D1 environment...');
  try {
    execSync('npx wrangler d1 execute midnight-stories-login-db --local --file=scratch/seed_stories_to_d1.sql', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
    console.log('Successfully updated local D1 database.');
  } catch (err) {
    console.warn('Wrangler local execute warning:', err.message);
  }

  console.log('\nApplying SQL script to REMOTE Cloudflare D1 database...');
  try {
    execSync('npx wrangler d1 execute midnight-stories-login-db --remote --file=scratch/seed_stories_to_d1.sql', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
    console.log('Successfully updated remote Cloudflare D1 database!');
  } catch (err) {
    console.error('Wrangler remote execute error:', err.message);
    console.log('\nTo resolve: run the command manually in your terminal:');
    console.log('npx wrangler d1 execute midnight-stories-login-db --remote --file=scratch/seed_stories_to_d1.sql');
  }

} catch (err) {
  console.error('Error during synchronization:', err);
}
