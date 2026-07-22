const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'stories.db');
console.log('Opening database:', dbPath);

try {
  const db = new Database(dbPath);
  const tables = ['users', 'categories', 'stories', 'comments', 'likes', 'reports', 'books', 'book_categories', 'settings', 'banned_identifiers', 'moderation_log'];
  
  console.log('\n=== Local SQLite Database Stats ===');
  for (const table of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      console.log(`Table ${table.padEnd(20)}: ${row.count} rows`);
    } catch (err) {
      console.log(`Table ${table.padEnd(20)}: Error: ${err.message}`);
    }
  }
  db.close();
} catch (err) {
  console.error('Error opening database:', err);
}
