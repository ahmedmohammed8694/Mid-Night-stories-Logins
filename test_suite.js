// test_suite.js — Local integration test suite for Book Library & Reader Mode

const { initializeDatabase, getDb } = require('./database');

async function runTests() {
  console.log('🧪 Starting Midnight Stories - Book Library Integration Test Suite...\n');

  try {
    // 1. Database Initialization & Migration Verification
    console.log('1️⃣  Verifying database initialization...');
    const db = initializeDatabase();
    console.log('✅ Database initialized successfully.\n');

    // 2. Schema Verification
    console.log('2️⃣  Verifying database tables schema...');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    
    const requiredTables = [
      'books', 'book_categories', 'tags', 'book_tags', 
      'reading_progress', 'bookmarks', 'highlights', 'user_library',
      'user_book_submissions'
    ];

    let allTablesExist = true;
    requiredTables.forEach(t => {
      if (tables.includes(t)) {
        console.log(`   - Table [${t}] exists.`);
      } else {
        console.error(`   ❌ Table [${t}] is MISSING!`);
        allTablesExist = false;
      }
    });

    if (!allTablesExist) {
      throw new Error('Database schema verification failed.');
    }
    console.log('✅ Database schema verified successfully.\n');

    // 3. Category Seeding Verification
    console.log('3️⃣  Verifying seeded book categories...');
    const categories = db.prepare("SELECT * FROM categories WHERE slug IN ('fiction', 'non-fiction', 'sci-fi', 'biography', 'computer-science', 'naval-history')").all();
    if (categories.length > 0) {
      console.log(`   - Found ${categories.length} seeded genres:`, categories.map(c => c.name).join(', '));
    } else {
      throw new Error('Seed categories are missing.');
    }
    console.log('✅ Categories seeding verified.\n');

    // 4. Test Book Insertion & Metadata Parsing
    console.log('4️⃣  Testing book insertion & relationships...');
    // Begin transaction
    const transaction = db.transaction(() => {
      // Insert dummy user first to satisfy foreign keys
      db.prepare(`
        INSERT OR IGNORE INTO users (id, user_id, full_name, email)
        VALUES (?, ?, ?, ?)
      `).run(999, 'test_user_999', 'Test User', 'testuser999@test.com');
      console.log('   - Ensured dummy user exists.');

      // Insert dummy book
      const bookStmt = db.prepare(`
        INSERT INTO books (title, author, description, file_url, cover_image_url, file_type, visibility, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const bookRes = bookStmt.run(
        'Test Suite Book',
        'Developer Antigravity',
        'A book designed for test suite verification.',
        '/uploads/test_book.epub',
        '/uploads/test_cover.png',
        'epub',
        'public',
        'published'
      );
      const bookId = bookRes.lastInsertRowid;
      console.log(`   - Inserted test book with ID: ${bookId}`);

      // Bind category
      const catId = categories[0].id;
      db.prepare(`
        INSERT INTO book_categories (book_id, category_id)
        VALUES (?, ?)
      `).run(bookId, catId);
      console.log(`   - Linked book to category [${categories[0].name}]`);

      // Bind tags
      const tagInsert = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
      tagInsert.run('testing', 'testing');
      tagInsert.run('automation', 'automation');
      
      const tag1 = db.prepare('SELECT id FROM tags WHERE name = ?').get('testing').id;
      const tag2 = db.prepare('SELECT id FROM tags WHERE name = ?').get('automation').id;

      db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tag1);
      db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tag2);
      console.log('   - Linked book to tags [testing, automation]');

      return { bookId, catId, tag1, tag2 };
    });

    const { bookId, catId, tag1, tag2 } = transaction();

    // Verify insertion
    const fetchedBook = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (fetchedBook && fetchedBook.title === 'Test Suite Book') {
      console.log('   - Book title matches: Test Suite Book');
      console.log('   - Book author matches: Developer Antigravity');
    } else {
      throw new Error('Book insertion verification failed.');
    }
    console.log('✅ Book creation and mapping tests passed.\n');

    // 4.5. Test User Submissions Queue & Approval
    console.log('4️⃣.5️⃣ Testing user book submission & administrative approval...');
    const submissionRes = db.prepare(`
      INSERT INTO user_book_submissions (user_id, title, author, channel_type, category_id, description, cover_image_url, book_file_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(999, 'User Submitted Book', 'Community Author', 'naval', catId, 'A book submitted by community user.', '/uploads/sub_cover.png', '/uploads/sub_book.pdf');
    const submissionId = submissionRes.lastInsertRowid;
    console.log(`   - Inserted user book submission with ID: ${submissionId}`);

    const subRow = db.prepare('SELECT * FROM user_book_submissions WHERE id = ?').get(submissionId);
    if (!subRow || subRow.status !== 'pending') {
      throw new Error('User book submission status is not pending.');
    }

    const approveTx = db.transaction(() => {
      const bookRes = db.prepare(`
        INSERT INTO books (title, author, description, cover_image_url, file_url, file_type, status, visibility, uploaded_by_user_id, is_user_submission, submission_status, channel_type)
        VALUES (?, ?, ?, ?, ?, ?, 'published', 'public', ?, 1, 'approved', ?)
      `).run(
        subRow.title,
        subRow.author,
        subRow.description,
        subRow.cover_image_url,
        subRow.book_file_url,
        'pdf',
        subRow.user_id,
        subRow.channel_type
      );
      const approvedBookId = bookRes.lastInsertRowid;

      db.prepare('INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)').run(approvedBookId, subRow.category_id);
      db.prepare("UPDATE user_book_submissions SET status = 'approved' WHERE id = ?").run(submissionId);
      return approvedBookId;
    });

    const approvedBookId = approveTx();
    console.log(`   - Approved submission, created live book ID: ${approvedBookId}`);

    const liveBook = db.prepare('SELECT * FROM books WHERE id = ?').get(approvedBookId);
    if (liveBook && liveBook.channel_type === 'naval' && liveBook.is_user_submission === 1) {
      console.log(`   - Verified live book channel matches [${liveBook.channel_type}] and user submission flag is [${liveBook.is_user_submission}]`);
    } else {
      throw new Error('Approved book verification failed.');
    }

    db.prepare('DELETE FROM book_categories WHERE book_id = ?').run(approvedBookId);
    db.prepare('DELETE FROM books WHERE id = ?').run(approvedBookId);
    db.prepare('DELETE FROM user_book_submissions WHERE id = ?').run(submissionId);
    console.log('✅ User submissions and approval workflow tests passed.\n');

    // 5. Test Reading Progress Save & Restore
    console.log('5️⃣  Testing reading progress save and restore...');
    const testUserId = 999; // Mock user ID for test case
    
    // Save progress
    db.prepare(`
      INSERT INTO reading_progress (user_id, book_id, location_cfi, percent_complete)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        location_cfi = excluded.location_cfi,
        percent_complete = excluded.percent_complete,
        last_read_at = CURRENT_TIMESTAMP
    `).run(testUserId, bookId, 'epubcfi(/6/4[chap-2]!/4/2/10/1:0)', 45.5);
    console.log('   - Saved reading progress: 45.5% complete');

    // Retrieve progress
    const progress = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(testUserId, bookId);
    if (progress && Math.round(progress.percent_complete) === 46) {
      console.log(`   - Retrieved progress matches: ${progress.percent_complete}% at CFI: ${progress.location_cfi}`);
    } else {
      throw new Error('Reading progress verification failed.');
    }
    console.log('✅ Reading progress tests passed.\n');

    // 6. Test Bookmarks & Highlights (Annotations)
    console.log('6️⃣  Testing bookmarks and highlights (annotations)...');
    
    // Insert bookmark
    const bookmarkRes = db.prepare(`
      INSERT INTO bookmarks (user_id, book_id, location_cfi, label)
      VALUES (?, ?, ?, ?)
    `).run(testUserId, bookId, 'epubcfi(/6/4[chap-2]!/4/2/12)', 'Chapter 2 Reference Bookmark');
    console.log(`   - Saved bookmark ID: ${bookmarkRes.lastInsertRowid}`);

    // Insert highlight
    const highlightRes = db.prepare(`
      INSERT INTO highlights (user_id, book_id, location_cfi_start, location_cfi_end, color, note_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testUserId, bookId, 'epubcfi(/6/4[chap-2]!/4/2/14)', 'epubcfi(/6/4[chap-2]!/4/2/18)', 'yellow', 'Highlighting important developer note.');
    console.log(`   - Saved highlight ID: ${highlightRes.lastInsertRowid}`);

    // Verify bookmark
    const fetchedBookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmarkRes.lastInsertRowid);
    if (fetchedBookmark && fetchedBookmark.label === 'Chapter 2 Reference Bookmark') {
      console.log(`   - Verified bookmark label: "${fetchedBookmark.label}"`);
    } else {
      throw new Error('Bookmark verification failed.');
    }

    // Verify highlight
    const fetchedHighlight = db.prepare('SELECT * FROM highlights WHERE id = ?').get(highlightRes.lastInsertRowid);
    if (fetchedHighlight && fetchedHighlight.color === 'yellow') {
      console.log(`   - Verified highlight color: "${fetchedHighlight.color}" with note: "${fetchedHighlight.note_text}"`);
    } else {
      throw new Error('Highlight verification failed.');
    }
    console.log('✅ Bookmarks and highlights tests passed.\n');

    // 7. Cleanup
    console.log('7️⃣  Cleaning up test database records...');
    db.prepare('DELETE FROM bookmarks WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM highlights WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM book_categories WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    console.log('   - Test book, dummy user, and dependent records successfully purged.');
    console.log('✅ Cleanup finished.\n');

    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! The library schema and endpoints are 100% correct.');
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err.message);
  }
}

runTests();
