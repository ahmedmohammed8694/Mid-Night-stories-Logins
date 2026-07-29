const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');

let out = [];

// Find <main class="admin-main">
const mainStartIndex = html.indexOf('<main class="admin-main">');
const mainEndIndex = html.indexOf('</main>', mainStartIndex);

out.push(`mainStartIndex: ${mainStartIndex}, mainEndIndex: ${mainEndIndex}`);

const mainHTML = html.substring(mainStartIndex, mainEndIndex);

// Find all panels
const panelRegex = /<div[^>]*class="([^"]*admin-panel[^"]*)"[^>]*id="([^"]+)"[^>]*>/gi;
let m;
while ((m = panelRegex.exec(mainHTML)) !== null) {
  out.push(`Panel: id=${m[2]}, class="${m[1]}"`);
}

// Find non-panel divs inside main
const divRegex = /<div[^>]*id="([^"]+)"[^>]*>/gi;
while ((m = divRegex.exec(mainHTML)) !== null) {
  if (!m[1].startsWith('panel-')) {
    out.push(`Non-panel DIV inside main: id=${m[1]}`);
  }
}

fs.writeFileSync(path.join(__dirname, 'out.txt'), out.join('\n'));
console.log('Wrote to out.txt');
