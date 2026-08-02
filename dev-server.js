import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

// Auto-copy generated background theme artwork to public/images/
const artifactDir = "C:\\Users\\Mohammed Ahmed\\.gemini\\antigravity-ide\\brain\\e712fadc-b1c5-4f8f-a17b-51b4888f5658";
try {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
  const imgMap = [
    { src: 'home_theme_bg_1785623105859.png', dest: 'home_theme_bg.png' },
    { src: 'books_theme_bg_1785623117693.png', dest: 'books_theme_bg.png' },
    { src: 'auth_theme_bg_1785623129272.png', dest: 'auth_theme_bg.png' },
    { src: 'login_theme_bg_1785630120388.png', dest: 'login_theme_bg.png' },
    { src: 'signup_theme_bg_1785630134039.png', dest: 'signup_theme_bg.png' }
  ];
  for (const item of imgMap) {
    const srcPath = path.join(artifactDir, item.src);
    const destPath = path.join(IMAGES_DIR, item.dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`✅ Verified theme image: ${item.dest}`);
    }
  }
} catch (e) {
  console.warn('Image copy notice:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

  if (reqUrl === '/api/public/books' || reqUrl === '/api/books') {
    try {
      const booksData = JSON.parse(fs.readFileSync(path.join(__dirname, 'books_database.json'), 'utf8'));
      const booksList = booksData.map((b, index) => ({
        id: b.id || (index + 1),
        title: b.title,
        author: b.author,
        author_name: b.author,
        cover_image: b.cover_image_url || '/images/default-cover.svg',
        image_url: b.cover_image_url || '/images/default-cover.svg',
        description: b.description,
        file_type: b.file_format || 'epub'
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(booksList));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify([]));
    }
  }

  if (reqUrl === '/api/auth/google') {
    const clientId = '602442085348-14ndm8n4t50lv7j93mqn9n3t80vjvu79.apps.googleusercontent.com';
    const redirectUri = 'https://midnightstories.dpdns.org/api/auth/google/callback';
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=profile%20email`;
    res.writeHead(302, { 'Location': googleAuthUrl });
    return res.end();
  }

  if (reqUrl === '/') {
    reqUrl = '/index.html';
  } else if (reqUrl === '/admin') {
    reqUrl = '/admin.html';
  } else if (reqUrl === '/user' || reqUrl === '/login') {
    reqUrl = '/login.html';
  }

  let filePath = path.join(PUBLIC_DIR, reqUrl);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const htmlPath = filePath + '.html';
      if (fs.existsSync(htmlPath)) {
        filePath = htmlPath;
      } else {
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Midnight Stories Local Server Active!`);
  console.log(`==================================================`);
  console.log(`👤 User Website:    http://localhost:${PORT}/`);
  console.log(`🔑 User Login:      http://localhost:${PORT}/login.html`);
  console.log(`👑 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`==================================================\n`);
});
