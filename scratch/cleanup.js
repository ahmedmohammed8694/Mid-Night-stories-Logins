const fs = require('fs');
const path = require('path');

const filesToRemove = [
  'import_books.sql',
  'import_books_clean.sql',
  'books_database.json',
  'extracted_text.txt',
  'extracted_text_midnight.txt',
  'build_updated_seo_excel.py',
  'generate_excel.js',
  'dump_excel.js',
  'dump_excel.py',
  'read_docx.py',
  'read_docx_xlsx.js',
  'run_and_save.js',
  'run_python.js',
  'test_bedrock.py',
  'test_seo_verification.js',
  'test_suite.js',
  'test_tickets.js',
  'debug.ipynb',
  'verify_db.ipynb',
  'fix.js',
  'fix2.js',
  'fix_orphan.js',
  'fix_orphan.ps1',
  'fix_permissions_worker.js',
  'fix_worker.js',
  'deploy-admin.sh',
  'public/admin/employees.html'
];

filesToRemove.forEach(f => {
  const fullPath = path.join(__dirname, '..', f);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log('Removed:', f);
    } catch(e) {
      console.error('Error removing:', f, e.message);
    }
  }
});
