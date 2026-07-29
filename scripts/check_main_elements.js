const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');

const mainStart = html.indexOf('<main class="admin-main">');
const mainEnd = html.indexOf('</main>', mainStart);

const mainChunk = html.substring(mainStart, mainEnd);

const lines = mainChunk.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('<div') && !line.includes('admin-panel') && !line.includes('class="stat-') && !line.includes('class="card') && !line.includes('class="form-') && !line.includes('class="empty-') && !line.includes('class="admin-table')) {
    if (line.includes('id="') || line.includes('class="modal') || line.includes('class="admin-')) {
      console.log(`Line ${idx + 250}: ${line.trim()}`);
    }
  }
});
