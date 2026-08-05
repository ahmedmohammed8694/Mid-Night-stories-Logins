import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

async function testEndpoint(url, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === expectedStatus) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`Expected status ${expectedStatus}, got ${res.statusCode} for ${url}`));
        }
      });
    }).on('error', reject);
  });
}

async function runE2EIntegrationTests() {
  console.log('🚀 Launching E2E Integration Verification Suite for Midnight Stories...\n');

  try {
    // 1. Static file check
    console.log('1️⃣  Checking frontend assets integrity...');
    const indexExists = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
    const loginExists = fs.existsSync(path.join(PUBLIC_DIR, 'login.html'));
    const adminExists = fs.existsSync(path.join(PUBLIC_DIR, 'admin.html'));
    
    if (!indexExists || !loginExists || !adminExists) {
      throw new Error('Missing critical HTML entrypoints (index.html, login.html, or admin.html)');
    }
    console.log('   - Index HTML:  FOUND');
    console.log('   - Login HTML:  FOUND');
    console.log('   - Admin HTML:  FOUND');
    console.log('✅ Frontend assets verified.\n');

    // 2. HTTP Server & Endpoint verification
    console.log('2️⃣  Testing local HTTP dev-server endpoints...');
    const homeRes = await testEndpoint(`http://localhost:${PORT}/`);
    console.log(`   - GET / -> HTTP ${homeRes.status}`);

    const loginRes = await testEndpoint(`http://localhost:${PORT}/login.html`);
    console.log(`   - GET /login.html -> HTTP ${loginRes.status}`);

    const adminRes = await testEndpoint(`http://localhost:${PORT}/admin`);
    console.log(`   - GET /admin -> HTTP ${adminRes.status}`);

    const booksApiRes = await testEndpoint(`http://localhost:${PORT}/api/books`);
    const books = JSON.parse(booksApiRes.data);
    console.log(`   - GET /api/books -> HTTP ${booksApiRes.status} (Loaded ${books.length} books)`);
    console.log('✅ Local server endpoints verified.\n');

    // 3. User interaction & DOM structure checks
    console.log('3️⃣  Verifying DOM forms & UI dynamic elements...');
    const loginHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8');
    const hasEmailField = loginHtml.includes('type="email"') || loginHtml.includes('id="email"');
    const hasPasswordField = loginHtml.includes('type="password"') || loginHtml.includes('id="password"');

    if (!hasEmailField || !hasPasswordField) {
      throw new Error('Login form is missing essential email or password input fields.');
    }
    console.log('   - Verified presence of Email & Password form fields.');
    console.log('✅ UI layout and DOM assertions passed.\n');

    console.log('🎉 ALL END-TO-END (E2E) INTEGRATION TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ E2E INTEGRATION TEST SUITE FAILED:', err.message);
    process.exit(1);
  }
}

runE2EIntegrationTests();
