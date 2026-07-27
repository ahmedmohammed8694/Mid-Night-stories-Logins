const fs = require('fs');
const path = require('path');

const sqlContent = fs.readFileSync(path.join(__dirname, 'remote_books.sql'), 'utf-8');
const lines = sqlContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--') && !l.startsWith('PRAGMA'));

const statements = JSON.stringify(lines);

const jsModule = `// src/seed_data.js - Self-healing seed module for Cloudflare D1
export const SEED_STATEMENTS = ${statements};

export async function autoSeedIfEmpty(db) {
  try {
    const countRes = await db.prepare("SELECT COUNT(*) as c FROM books").first();
    if (countRes && countRes.c > 0) {
      return { seeded: false, count: countRes.c };
    }

    console.log("Database books table is empty (0 books). Auto-seeding 430 books...");
    const chunkSize = 50;
    let executed = 0;

    for (let i = 0; i < SEED_STATEMENTS.length; i += chunkSize) {
      const chunk = SEED_STATEMENTS.slice(i, i + chunkSize);
      const batch = chunk.map(stmt => db.prepare(stmt));
      await db.batch(batch);
      executed += chunk.length;
    }

    const finalCount = (await db.prepare("SELECT COUNT(*) as c FROM books").first())?.c || 0;
    return { seeded: true, count: finalCount, statements: executed };
  } catch (err) {
    console.error("Auto-seed error:", err);
    return { seeded: false, error: err.message };
  }
}
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'seed_data.js'), jsModule, 'utf-8');
console.log('Successfully created src/seed_data.js with', lines.length, 'SQL seed statements.');
